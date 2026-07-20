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

  function init(containerId) {
    const el = document.getElementById(containerId);
    const css = getComputedStyle(document.documentElement);
    let bg = css.getPropertyValue("--viewer-bg").trim() || "#1a1a1a";
    if (bg.startsWith("#")) bg = "0x" + bg.slice(1);

    viewer = $3Dmol.createViewer(el, { backgroundColor: bg, antialias: true });
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
  }

  return { init, load, render, resize, resetView, setAtomClickCallback, setBondTolerance, updateBackgroundColor };
})();
