"use strict";

/*
  3Dmol.js wrapper, adapted from the existing viewer.js (modeviz project).
  Prepared and fully wired (init, load, click-selection) but not yet
  exercised beyond plain selection - no vibration/animation here, since
  there is no "normal mode" concept in the orbital-contribution tool.
  The halo-overlay strategy (translucent spheres instead of recoloring
  the atom itself) is kept unchanged, including its rationale.
*/
window.ORBWEB_VIEWER = (() => {
  const Elements = window.ORBWEB_ELEMENTS;

  const SELECT_COLOR = "#00d4ff"; // cyan - explicit atom click selection
  const CONTRIB_COLOR = "#ff3fa4"; // magenta - summed orbital contribution in the current range

  let viewer = null;
  let model = null;
  let atoms = [];
  let bonds = [];
  let bondTolerancePct = 8;
  let hasZoomed = false;
  let onAtomClick = null;

  // --- Orientation gizmo (small XYZ axis indicator, rotates with the model) ---
  let gizmoEnabled = false;
  let gizmoCanvas = null;
  let gizmoCtx = null;

  // "Home" (unrotated) axis directions: the actual molecule-frame unit
  // vectors (1,0,0)/(0,1,0)/(0,0,1), NOT a stylized/isometric remap. This
  // matters: the whole point of the gizmo is to let you check "is this
  // atom really out along -z" against the atom table's x/y/z columns, so
  // it has to track 3Dmol's real coordinate convention 1:1 - molecule +x
  // is screen-right, +y is screen-up, +z points out of the screen towards
  // the viewer, all before any rotation. The live model rotation
  // quaternion (from viewer.getView()) is applied on top of these every
  // frame, since rotationGroup is the parent of modelGroup in 3Dmol's
  // scene graph (i.e. screen_vec = R(q) * molecule_vec).
  const GIZMO_HOME = {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 0, y: 0, z: 1 }
  };
  const GIZMO_COLORS = { x: "#e6483c", y: "#2fae4e", z: "#2f8fe6" };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function quatRotate(q, v) {
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
      x: v.x + q.w * tx + (q.y * tz - q.z * ty),
      y: v.y + q.w * ty + (q.z * tx - q.x * tz),
      z: v.z + q.w * tz + (q.x * ty - q.y * tx)
    };
  }

  function drawGizmo() {
    if (!gizmoEnabled || !gizmoCtx || !viewer) return;

    const view = viewer.getView();
    // getView(): [posX, posY, posZ, dist, q.x, q.y, q.z, q.w, ...]
    const q = { x: view[4], y: view[5], z: view[6], w: view[7] };

    const w = gizmoCanvas.width;
    const h = gizmoCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const len = Math.min(w, h) * 0.27;
    const pad = 9;

    gizmoCtx.clearRect(0, 0, w, h);

    const axes = ["x", "y", "z"].map((key) => {
      const rotated = quatRotate(q, GIZMO_HOME[key]);
      return { key, rotated, color: GIZMO_COLORS[key] };
    });

    // Draw back-to-front so nearer axes overlap farther ones.
    axes.sort((a, b) => a.rotated.z - b.rotated.z);

    for (const axis of axes) {
      const endX = cx + axis.rotated.x * len;
      const endY = cy - axis.rotated.y * len;
      const depth = (axis.rotated.z + 1) / 2; // 0 (far) .. 1 (near)
      const alpha = 0.55 + depth * 0.45;

      // Cap the arrowhead length to a fraction of THIS axis's own
      // projected (screen-space) length, not a fixed pixel value - a
      // strongly foreshortened axis can project to only a few pixels,
      // and a fixed head length would then swallow the whole shaft (or
      // even overshoot past the origin), leaving no visible line and
      // making the head look like it's sitting at the wrong end instead
      // of capping off a visible shaft.
      const projLen = Math.hypot(endX - cx, endY - cy);
      const headLen = Math.min(7, projLen * 0.45);
      const angle = Math.atan2(endY - cy, endX - cx);
      const shaftEndX = endX - headLen * Math.cos(angle);
      const shaftEndY = endY - headLen * Math.sin(angle);

      gizmoCtx.globalAlpha = alpha;
      gizmoCtx.strokeStyle = axis.color;
      gizmoCtx.fillStyle = axis.color;
      gizmoCtx.lineWidth = 2.5;

      gizmoCtx.beginPath();
      gizmoCtx.moveTo(cx, cy);
      gizmoCtx.lineTo(shaftEndX, shaftEndY);
      gizmoCtx.stroke();

      gizmoCtx.beginPath();
      gizmoCtx.moveTo(endX, endY);
      gizmoCtx.lineTo(
        endX - headLen * Math.cos(angle - Math.PI / 6),
        endY - headLen * Math.sin(angle - Math.PI / 6)
      );
      gizmoCtx.lineTo(
        endX - headLen * Math.cos(angle + Math.PI / 6),
        endY - headLen * Math.sin(angle + Math.PI / 6)
      );
      gizmoCtx.closePath();
      gizmoCtx.fill();

      gizmoCtx.font = "600 11px sans-serif";
      gizmoCtx.textAlign = "center";
      gizmoCtx.textBaseline = "middle";
      const labelX = clamp(cx + axis.rotated.x * (len + 13), pad, w - pad);
      const labelY = clamp(cy - axis.rotated.y * (len + 13), pad, h - pad);
      gizmoCtx.fillText(axis.key.toUpperCase(), labelX, labelY);
    }

    gizmoCtx.globalAlpha = 1;
  }

  function setAxesEnabled(enabled) {
    gizmoEnabled = enabled;
    if (!gizmoCanvas) {
      gizmoCanvas = document.getElementById("axes-gizmo");
      gizmoCtx = gizmoCanvas ? gizmoCanvas.getContext("2d") : null;
    }
    if (gizmoCanvas) gizmoCanvas.classList.toggle("visible", enabled);
    if (enabled) drawGizmo();
  }

  function init(containerId) {
    const el = document.getElementById(containerId);
    const css = getComputedStyle(document.documentElement);
    let bg = css.getPropertyValue("--viewer-bg").trim() || "#1a1a1a";
    if (bg.startsWith("#")) bg = "0x" + bg.slice(1);

    viewer = $3Dmol.createViewer(el, { backgroundColor: bg, antialias: true });
    viewer.setViewChangeCallback(drawGizmo);
  }

  function setAtomClickCallback(fn) {
    onAtomClick = fn;
  }

  function load(geometryAtoms) {
    atoms = geometryAtoms || [];
    bonds = Elements.findBonds(atoms, bondTolerancePct);
    hasZoomed = false;
    render({});
  }

  function setBondTolerance(pct) {
    bondTolerancePct = pct;
    if (atoms.length > 0) bonds = Elements.findBonds(atoms, bondTolerancePct);
  }

  function resize() {
    if (!viewer) return;
    if (typeof viewer.resize === "function") viewer.resize();
    viewer.render();
  }

  function updateBackgroundColor() {
    if (!viewer) return;
    const css = getComputedStyle(document.documentElement);
    let bg = css.getPropertyValue("--viewer-bg").trim() || "#1a1a1a";
    if (bg.startsWith("#")) bg = "0x" + bg.slice(1);
    viewer.setBackgroundColor(bg);
    viewer.render();
  }

  /*
    contributions: Map<atomIndex, fraction 0..1> - summed contribution
    of that atom across the currently displayed orbital range/threshold,
    or null to just show plain element colors.
    selectedAtoms: Set<atomIndex> of atoms explicitly clicked/selected
    (shared with the text atom list - same Set instance either way).
  */
  function render({ contributions = null, selectedAtoms = new Set(), contribThreshold = 0 } = {}) {
    if (!viewer || atoms.length === 0) return;

    viewer.removeAllModels();
    viewer.removeAllShapes();
    viewer.removeAllLabels();

    const xyzLines = [atoms.length.toString(), "orca-orb-viewer"];
    for (const a of atoms) xyzLines.push(`${a.element} ${a.x} ${a.y} ${a.z}`);
    model = viewer.addModel(xyzLines.join("\n"), "xyz");

    const elements = [...new Set(atoms.map((a) => a.element))];
    for (const el of elements) {
      model.setStyle({ elem: el }, { sphere: { radius: 0.24, color: Elements.getColor(el) } });
    }

    if (contributions) {
      for (const [atomIndex, fraction] of contributions.entries()) {
        if (fraction < contribThreshold) continue;
        const atomObj = atoms[atomIndex];
        if (!atomObj) continue;
        viewer.addSphere({
          center: { x: atomObj.x, y: atomObj.y, z: atomObj.z },
          radius: 0.34 + fraction * 0.5,
          color: CONTRIB_COLOR,
          opacity: 0.4 + fraction * 0.35
        });
      }
    }

    for (const atomIndex of selectedAtoms) {
      const atomObj = atoms[atomIndex];
      if (!atomObj) continue;
      viewer.addSphere({
        center: { x: atomObj.x, y: atomObj.y, z: atomObj.z },
        radius: 0.46, color: SELECT_COLOR, opacity: 0.5
      });
      viewer.addSphere({
        center: { x: atomObj.x, y: atomObj.y, z: atomObj.z },
        radius: 0.5, color: SELECT_COLOR, wireframe: true, opacity: 0.9
      });
    }

    for (const bond of bonds) {
      const a = atoms[bond.i];
      const b = atoms[bond.j];
      if (!a || !b) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      viewer.addCylinder({ start: { x: a.x, y: a.y, z: a.z }, end: mid, radius: 0.07, color: Elements.getColor(a.element), fromCap: 1, toCap: 0 });
      viewer.addCylinder({ start: { x: b.x, y: b.y, z: b.z }, end: mid, radius: 0.07, color: Elements.getColor(b.element), fromCap: 1, toCap: 0 });
    }

    model.setClickable({}, true, (atom) => {
      if (!atom) return;
      const atomObj = atoms[atom.index];
      if (!atomObj) return;
      if (onAtomClick) onAtomClick(atomObj.index);
    });

    if (!hasZoomed) {
      viewer.zoomTo();
      viewer.zoom(0.8);
      hasZoomed = true;
    }

    viewer.render();
    renderLegend(elements);
    drawGizmo();
  }

  function renderLegend(elements) {
    const el = document.getElementById("viewer-legend");
    if (!el) return;
    const priority = { H: 0, C: 1 };
    const sorted = [...elements].sort((a, b) => {
      const pa = priority[a] ?? 2;
      const pb = priority[b] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });
    el.innerHTML = sorted
      .map((s) => `<div class="viewer-legend-item"><span class="viewer-legend-swatch" style="background:${Elements.getColor(s)}"></span><span>${s}</span></div>`)
      .join("");
  }

  function resetView() {
    if (!viewer) return;
    viewer.zoomTo();
    viewer.zoom(0.8);
    viewer.render();
    drawGizmo();
  }

  return { init, load, render, resize, resetView, setAtomClickCallback, setBondTolerance, updateBackgroundColor, setAxesEnabled };
})();
