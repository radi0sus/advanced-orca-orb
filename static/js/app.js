"use strict";

window.ORBWEB_APP = (() => {
  const Parser = window.ORBWEB_PARSER;
  const Aggregate = window.ORBWEB_AGGREGATE;
  const Viewer = window.ORBWEB_VIEWER;
  const UI = window.ORBWEB_UI;
  const Export = window.ORBWEB_EXPORT;
  const Plots = window.ORBWEB_PLOTS;

  const DEFAULT_THRESHOLD = 5;
  const RENDER_DEBOUNCE_MS = 220;

  const state = {
    data: null,
    filename: "",
    threshold: DEFAULT_THRESHOLD,
    rangePreset: "10",     // "5" | "10" | "25" | "50" | "all" | "custom"
    orbStart: 0,
    orbEnd: 0,
    listElements: [],
    listAtoms: [],
    applConstr: "none",
    // Selection now does double duty, by request: it drives the AO Detail
    // heatmaps AND is the constraint (element/atom filter) for the
    // element/atom/table views. Populated either by clicking an element
    // pill (adds/removes every atom of that element), by clicking an
    // atom directly (list or 3D view), or both combined.
    selectedAtoms: new Set(),
    sortKey: "sum",
    sortDir: "desc",
    aoSortKey: "sum",
    aoSortDir: "desc",
    atomSearch: "",
    oneBasedIndex: false,   // fixed - ORCA itself numbers atoms from 0 (Cu0, N1, ...)
    displaySpin: 0          // 0 = alpha, 1 = beta (only relevant if data.spin === 1)
  };

  const el = {
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("file-input"),
    fileMeta: document.getElementById("file-meta"),
    emptyState: document.getElementById("empty-state"),
    controlsBar: document.getElementById("controls-bar"),
    appMain: document.getElementById("app-main"),
    warningBanner: document.getElementById("warning-banner"),
    busyOverlay: document.getElementById("busy-overlay"),

    rangeButtons: document.querySelectorAll("[data-range-preset]"),
    rangeStartInput: document.getElementById("range-start-input"),
    rangeEndInput: document.getElementById("range-end-input"),
    thresholdSlider: document.getElementById("threshold-slider"),
    thresholdNumber: document.getElementById("threshold-number"),
    thresholdLabel: document.getElementById("threshold-label"),
    spinGroup: document.getElementById("spin-group"),
    spinButtons: document.querySelectorAll("[data-spin]"),
    exportCsv: document.getElementById("export-csv"),
    exportReport: document.getElementById("export-report"),

    resetViewBtn: document.getElementById("reset-view"),
    bondTolerance: document.getElementById("bond-tolerance"),
    bondToleranceLabel: document.getElementById("bond-tolerance-label"),
    clearSelectionBtn: document.getElementById("clear-selection"),
    selectionChips: document.getElementById("selection-chips"),
    selectionRow: document.getElementById("selection-row"),
    elementPills: document.getElementById("element-pills"),
    atomSearch: document.getElementById("atom-search"),
    atomListBody: document.getElementById("atom-list-body"),

    tableHead: document.getElementById("atom-table-head"),
    tableBody: document.getElementById("atom-table-body"),
    rangeStatus: document.getElementById("range-status"),

    tabButtons: document.querySelectorAll("[data-tab]"),
    panes: {
      elements: document.getElementById("pane-elements"),
      atoms: document.getElementById("pane-atoms"),
      aodetail: document.getElementById("pane-aodetail"),
      table: document.getElementById("pane-table"),
      aotable: document.getElementById("pane-aotable")
    },
    elementBarPlot: document.getElementById("element-bar-plot"),
    atomHeatmapPlot: document.getElementById("atom-heatmap-plot"),
    aoHeatmapContainer: document.getElementById("ao-heatmap-container"),

    aoDetailHead: document.getElementById("ao-detail-head"),
    aoDetailBody: document.getElementById("ao-detail-body"),
    aoDetailEmpty: document.getElementById("ao-detail-empty"),
    aoDetailTable: document.getElementById("ao-detail-table")
  };

  let activeTab = "elements";
  let viewerInitialized = false;
  let recomputeTimer = null;
  let busyHideTimer = null;
  let lastPlotData = null;
  const dirtyPlots = new Set(["elements", "atoms", "aodetail"]);

  function init() {
    Viewer.setAtomClickCallback((atomIndex) => toggleAtomSelection(atomIndex));

    syncThresholdControls(DEFAULT_THRESHOLD);

    el.fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) loadFile(file);
    });

    el.dropzone.addEventListener("click", () => el.fileInput.click());

    ["dragenter", "dragover"].forEach((evt) => {
      el.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        el.dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((evt) => {
      el.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        el.dropzone.classList.remove("dragover");
      });
    });

    el.dropzone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });

    el.rangeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        state.rangePreset = btn.dataset.rangePreset;
        updateRangeButtonStates();
        scheduleRecomputeAndRenderAll();
      });
    });

    el.rangeStartInput.addEventListener("change", () => {
      state.rangePreset = "custom";
      updateRangeButtonStates();
      scheduleRecomputeAndRenderAll(explicitRangeFromInputs());
    });

    el.rangeEndInput.addEventListener("change", () => {
      state.rangePreset = "custom";
      updateRangeButtonStates();
      scheduleRecomputeAndRenderAll(explicitRangeFromInputs());
    });

    el.thresholdSlider.addEventListener("input", () => {
      setThresholdFromControl(el.thresholdSlider.value, {
        debounce: true,
        updateNumberInput: true
      });
    });

    el.thresholdNumber.addEventListener("input", () => {
      setThresholdFromControl(el.thresholdNumber.value, {
        debounce: true,
        updateNumberInput: false
      });
    });

    el.thresholdNumber.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;

      e.preventDefault();

      setThresholdFromControl(el.thresholdNumber.value, {
        debounce: false,
        updateNumberInput: true
      });
    });

    el.spinButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        cancelScheduledRecompute();

        state.displaySpin = parseInt(btn.dataset.spin, 10);

        el.spinButtons.forEach((b) => {
          b.classList.toggle("active", b === btn);
        });

        recomputeAndRenderAllWithBusy();
      });
    });

    el.exportCsv.addEventListener("click", () => {
      if (state.data) Export.exportRawCsv(state.data, state.filename);
    });

    el.exportReport.addEventListener("click", () => {
      if (state.data) exportReport();
    });

    el.resetViewBtn.addEventListener("click", () => Viewer.resetView());

    el.bondTolerance.addEventListener("input", () => {
      const pct = parseInt(el.bondTolerance.value, 10);

      el.bondToleranceLabel.textContent = `${pct}%`;

      Viewer.setBondTolerance(pct);
      render3D();
    });

    el.clearSelectionBtn.addEventListener("click", () => {
      cancelScheduledRecompute();

      state.selectedAtoms.clear();

      recomputeAndRenderAllWithBusy();
    });

    el.atomSearch.addEventListener("input", () => {
      state.atomSearch = el.atomSearch.value.trim().toLowerCase();

      UI.renderAtomList(el, state);
    });

    window.addEventListener("resize", () => {
      Viewer.resize();
      resizeVisiblePlots();
    });

    el.tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

    darkModeQuery.addEventListener("change", () => {
      if (viewerInitialized) Viewer.updateBackgroundColor();

      render3D();
    });
  }

  function showBusy() {
    if (!el.busyOverlay) return;

    if (busyHideTimer !== null) {
      clearTimeout(busyHideTimer);
      busyHideTimer = null;
    }

    el.busyOverlay.classList.add("visible");
    el.busyOverlay.setAttribute("aria-hidden", "false");
  }

  function hideBusySoon() {
    if (!el.busyOverlay) return;

    if (busyHideTimer !== null) {
      clearTimeout(busyHideTimer);
    }

    busyHideTimer = window.setTimeout(() => {
      el.busyOverlay.classList.remove("visible");
      el.busyOverlay.setAttribute("aria-hidden", "true");
      busyHideTimer = null;
    }, 80);
  }

  function cancelScheduledRecompute() {
    if (recomputeTimer === null) return;

    clearTimeout(recomputeTimer);

    recomputeTimer = null;
  }

  function afterPaint(fn) {
    // showBusy() just flips the overlay to display:flex, but a single
    // requestAnimationFrame callback still runs *before* the browser's
    // next paint - so if the heavy synchronous work starts inside that
    // same callback, the spinner never actually gets painted before the
    // main thread blocks (no spinner "cycle", just a raw delay, worst
    // on the unthrottled Clear Selection path which has no debounce gap
    // to paint in). Nesting a second rAF guarantees the browser paints
    // the pending overlay-visible frame before `fn` runs.
    requestAnimationFrame(() => {
      requestAnimationFrame(fn);
    });
  }

  function scheduleRecomputeAndRenderAll(explicitRangeStr, delay = RENDER_DEBOUNCE_MS) {
    cancelScheduledRecompute();
    showBusy();

    recomputeTimer = window.setTimeout(() => {
      recomputeTimer = null;

      afterPaint(() => {
        try {
          recomputeAndRenderAll(explicitRangeStr);
        } finally {
          hideBusySoon();
        }
      });
    }, delay);
  }

  function recomputeAndRenderAllWithBusy(explicitRangeStr) {
    showBusy();

    afterPaint(() => {
      try {
        recomputeAndRenderAll(explicitRangeStr);
      } finally {
        hideBusySoon();
      }
    });
  }

  function clampThreshold(value) {
    const min = parseFloat(el.thresholdSlider.min);
    const max = parseFloat(el.thresholdSlider.max);
    const step = parseFloat(el.thresholdSlider.step);
    const parsed = parseFloat(value);

    if (!Number.isFinite(parsed)) {
      return state.threshold;
    }

    const clamped = Math.min(max, Math.max(min, parsed));
    const snapped = Math.round(clamped / step) * step;

    return Number(snapped.toFixed(6));
  }

  function formatThreshold(value) {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  function syncThresholdControls(value) {
    const threshold = clampThreshold(value);

    state.threshold = threshold;
    el.thresholdSlider.value = threshold;
    el.thresholdNumber.value = threshold;
    el.thresholdLabel.textContent = `${formatThreshold(threshold)}%`;
  }

  function setThresholdFromControl(value, options = {}) {
    const {
      debounce = true,
      updateNumberInput = true
    } = options;

    const threshold = clampThreshold(value);

    state.threshold = threshold;
    el.thresholdSlider.value = threshold;
    el.thresholdLabel.textContent = `${formatThreshold(threshold)}%`;

    if (updateNumberInput) {
      el.thresholdNumber.value = threshold;
    }

    if (debounce) {
      scheduleRecomputeAndRenderAll();
    } else {
      cancelScheduledRecompute();
      recomputeAndRenderAllWithBusy();
    }
  }

  function explicitRangeFromInputs() {
    const start = parseInt(el.rangeStartInput.value, 10);
    const end = parseInt(el.rangeEndInput.value, 10);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }

    return `${start}-${end}`;
  }

  function plotDivsForTab(tab) {
    if (tab === "elements") return [el.elementBarPlot];
    if (tab === "atoms") return [el.atomHeatmapPlot];
    if (tab === "aodetail") return [...el.aoHeatmapContainer.querySelectorAll(".ao-heatmap")];

    return [];
  }

  function resizeVisiblePlots() {
    if (!window.Plotly) return;

    plotDivsForTab(activeTab).forEach((div) => {
      if (div && div.data) {
        Plotly.Plots.resize(div);
      }
    });
  }

  function switchTab(tab) {
    activeTab = tab;

    el.tabButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    Object.entries(el.panes).forEach(([name, pane]) => {
      pane.style.display = name === tab ? "" : "none";
    });

    // Plotly sizes a hidden container as 0x0. Rather than trust
    // Plotly.Plots.resize() to recover cleanly after a plot's pane sat
    // behind display:none (that resize() call was the actual remaining
    // source of "Something went wrong with axis scaling" - e.g.
    // atoms -> aodetail -> atoms), force a full fresh redraw of the
    // newly-visible tab's plot every time, using the container's
    // current (correct) size. Guarded by an activeTab check: if the
    // user switches tabs again before this rAF fires, `tab` is no
    // longer the visible pane.
    if (tab === "elements" || tab === "atoms" || tab === "aodetail") {
      showBusy();

      afterPaint(() => {
        if (activeTab !== tab) {
          hideBusySoon();
          return;
        }

        try {
          dirtyPlots.add(tab);
          drawPlotIfActive(tab);
        } finally {
          hideBusySoon();
        }
      });
    }
  }

  function loadFile(file) {
    cancelScheduledRecompute();
    showBusy();

    const reader = new FileReader();

    reader.onload = () => {
      try {
        cancelScheduledRecompute();

        const data = Parser.parseOrcaOrbFile(reader.result, file.name);

        state.data = data;
        state.filename = file.name;
        state.selectedAtoms = new Set();
        state.displaySpin = 0;
        state.rangePreset = "10";
        state.sortKey = "sum";
        state.sortDir = "desc";
        state.aoSortKey = "sum";
        state.aoSortDir = "desc";

        syncThresholdControls(DEFAULT_THRESHOLD);

        el.rangeButtons.forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.rangePreset === "10");
        });

        el.spinButtons.forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.spin === "0");
        });

        el.emptyState.style.display = "none";
        el.controlsBar.style.display = "flex";
        el.appMain.style.display = "grid";
        el.spinGroup.style.display = data.spin === 1 ? "flex" : "none";

        el.fileMeta.textContent =
          `${file.name} \u2014 ${data.rows.length.toLocaleString()} contributions, ` +
          `${data.totNumOrbA + 1} orbitals${data.spin === 1 ? " (open shell)" : ""}, HOMO = ${data.homoNum}` +
          (data.geometry.length === 0 ? " \u2014 no geometry found (3D view disabled)" : ` \u2014 ${data.geometry.length} atoms`);

        renderElementPills();

        if (data.geometry.length > 0) {
          if (!viewerInitialized) {
            Viewer.init("viewer-3d");
            viewerInitialized = true;
          }

          Viewer.load(data.geometry);

          requestAnimationFrame(() => {
            requestAnimationFrame(() => Viewer.resize());
          });
        }

        recomputeAndRenderAll();
      } catch (err) {
        alert("Error reading file:\n" + err.message);
      } finally {
        hideBusySoon();
      }
    };

    reader.readAsText(file);
  }

  function updateRangeButtonStates() {
    el.rangeButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.rangePreset === state.rangePreset);
    });
  }

  // One pill per element present in the file. Clicking a pill selects
  // every atom of that element if not all of them are already selected,
  // or deselects them all if they already are - the constraint-by-
  // element shortcut requested alongside manual atom/3D selection.
  function renderElementPills() {
    el.elementPills.innerHTML = "";

    for (const element of state.data.elements) {
      const atomsOfElement = state.data.geometry
        .filter((a) => a.element === element)
        .map((a) => a.index);

      const btn = document.createElement("button");

      btn.className = "pill-btn";
      btn.textContent = element;
      btn.dataset.element = element;
      btn.style.borderLeft = `4px solid ${window.ORBWEB_ELEMENTS.getColor(element)}`;

      btn.addEventListener("click", () => {
        cancelScheduledRecompute();

        const allSelected = atomsOfElement.every((idx) => {
          return state.selectedAtoms.has(idx);
        });

        if (allSelected) {
          atomsOfElement.forEach((idx) => {
            state.selectedAtoms.delete(idx);
          });
        } else {
          atomsOfElement.forEach((idx) => {
            state.selectedAtoms.add(idx);
          });
        }

        recomputeAndRenderAllWithBusy();
      });

      el.elementPills.appendChild(btn);
    }

    updateElementPillStates();
  }

  function updateElementPillStates() {
    if (!state.data) return;

    el.elementPills.querySelectorAll(".pill-btn").forEach((btn) => {
      const element = btn.dataset.element;

      const atomsOfElement = state.data.geometry
        .filter((a) => a.element === element)
        .map((a) => a.index);

      const selectedCount = atomsOfElement.filter((idx) => {
        return state.selectedAtoms.has(idx);
      }).length;

      btn.classList.toggle("active", selectedCount === atomsOfElement.length);
      btn.classList.toggle("partial", selectedCount > 0 && selectedCount < atomsOfElement.length);
    });
  }

  function toggleAtomSelection(atomNo) {
    cancelScheduledRecompute();

    if (state.selectedAtoms.has(atomNo)) {
      state.selectedAtoms.delete(atomNo);
    } else {
      state.selectedAtoms.add(atomNo);
    }

    recomputeAndRenderAllWithBusy();
  }

  // The current atom selection (however it was built up) is both the
  // "atoms of interest" for the AO Detail tab and the atom-level
  // constraint for the element/atom tables and heatmaps. Empty selection
  // means "no constraint" (all atoms considered), matching the Python
  // default.
  function currentConstraint() {
    if (state.selectedAtoms.size === 0) {
      return {
        listElements: state.data.elements,
        listAtoms: state.data.atoms,
        applConstr: "none"
      };
    }

    const atoms = [...state.selectedAtoms].sort((a, b) => a - b);

    return {
      listElements: state.data.elements,
      listAtoms: atoms,
      applConstr: `Atoms ${atoms.map((a) => UI.atomLabel(state, a)).join(", ")}`
    };
  }

  // Recomputes range/constraints from current controls, then re-renders.
  // explicitRangeStr, if given, overrides the preset-derived range string
  // for this call (used by the From/To number inputs).
  function recomputeAndRenderAll(explicitRangeStr) {
    if (!state.data) return;

    const d = state.data;

    let rangeStr = explicitRangeStr;

    if (!rangeStr) {
      rangeStr = state.rangePreset === "all"
        ? "all"
        : (state.rangePreset === "custom" ? null : `h${state.rangePreset}`);
    }

    const range = rangeStr
      ? Aggregate.parseOrbitalRange(rangeStr, d.homoNum, d.totNumOrbA)
      : {
          orbStart: state.orbStart,
          orbEnd: state.orbEnd,
          error: null
        };

    let warning = null;

    if (range.error) {
      warning = range.error;

      const fallback = Aggregate.parseOrbitalRange("all", d.homoNum, d.totNumOrbA);

      state.orbStart = fallback.orbStart;
      state.orbEnd = fallback.orbEnd;
    } else {
      state.orbStart = range.orbStart;
      state.orbEnd = range.orbEnd;
    }

    el.rangeStartInput.value = state.orbStart;
    el.rangeEndInput.value = state.orbEnd;

    const constr = currentConstraint();

    state.listElements = constr.listElements;
    state.listAtoms = constr.listAtoms;
    state.applConstr = constr.applConstr;

    el.warningBanner.style.display = warning ? "" : "none";
    el.warningBanner.textContent = warning || "";

    updateRangeButtonStates();
    updateElementPillStates();

    renderAll();
  }

  function currentAtomRows() {
    return Aggregate.sumByAtom(
      state.data.rows,
      state.displaySpin,
      state.orbStart,
      state.orbEnd,
      state.listElements,
      state.listAtoms,
      state.threshold
    );
  }

  function renderAll() {
    if (!state.data) return;

    const atomRows = currentAtomRows();

    el.rangeStatus.textContent =
      `Orbitals ${state.orbStart}\u2013${state.orbEnd} of 0\u2013${state.data.totNumOrbA}` +
      (state.applConstr !== "none" ? ` \u00b7 constraint: ${state.applConstr}` : "") +
      (state.data.spin === 1 ? ` \u00b7 ${state.displaySpin === 1 ? "beta" : "alpha"}` : "");

    UI.renderAtomTable(el, state, atomRows);
    UI.renderAtomList(el, state);
    UI.renderSelectionChips(el, state);

    const aoRows = state.selectedAtoms.size > 0
      ? Aggregate.aoInOrbitalForAtoms(
          state.data.rows,
          state.displaySpin,
          state.orbStart,
          state.orbEnd,
          state.listElements,
          state.listAtoms,
          state.threshold,
          [...state.selectedAtoms]
        )
      : [];

    UI.renderAoDetail(el, state, aoRows);

    renderPlots(atomRows, aoRows);
    render3D();
  }

  const spinLabelFor = () => {
    return state.data.spin === 1 ? (state.displaySpin === 1 ? " (beta)" : " (alpha)") : "";
  };

  function renderPlots(atomRows, aoRows) {
    const elByOrb = Aggregate.sumByElement(
      state.data.rows,
      state.displaySpin,
      state.orbStart,
      state.orbEnd
    );

    const spinLabel = spinLabelFor();

    const aoRowsByAtom = new Map();

    for (const atomNo of state.selectedAtoms) {
      aoRowsByAtom.set(atomNo, aoRows.filter((r) => r.atomNo === atomNo));
    }

    lastPlotData = { elByOrb, atomRows, aoRowsByAtom, spinLabel };

    dirtyPlots.add("elements");
    dirtyPlots.add("atoms");
    dirtyPlots.add("aodetail");

    drawPlotIfActive(activeTab);
  }

  // Plotly sizes a hidden (display:none) container as 0x0. Drawing into
  // it there is what actually threw "Something went wrong with axis
  // scaling" - a later resize() was too late to fix that. So plots are
  // only ever drawn while their pane is the visible one; other panes are
  // just marked dirty and get a fresh draw (not just a resize) once the
  // user switches to them.
  function drawPlotIfActive(tab) {
    if (activeTab !== tab || !lastPlotData || !dirtyPlots.has(tab)) return;

    const { elByOrb, atomRows, aoRowsByAtom, spinLabel } = lastPlotData;

    if (tab === "elements") {
      Plots.renderElementBar("element-bar-plot", elByOrb, state.data.homoNum, spinLabel);
    } else if (tab === "atoms") {
      Plots.renderAtomHeatmap(
        "atom-heatmap-plot",
        atomRows,
        state.data.homoNum,
        state.threshold,
        state.applConstr,
        spinLabel,
        (atomNo) => UI.atomLabel(state, atomNo)
      );
    } else if (tab === "aodetail") {
      Plots.renderAoHeatmaps(
        el.aoHeatmapContainer,
        aoRowsByAtom,
        state.data.homoNum,
        state.threshold,
        spinLabel,
        (atomNo) => UI.atomLabel(state, atomNo)
      );
    } else {
      return;
    }

    dirtyPlots.delete(tab);
  }

  // Only the explicit click-selection halo (cyan) is shown - no automatic
  // contribution-based highlighting. The atom-contribution table already
  // shows that information; duplicating it as an always-on viewer halo
  // just made most/all atoms light up whenever the orbital window was
  // wide, which looked like everything was "selected".
  function render3D() {
    if (!viewerInitialized) return;

    Viewer.render({
      selectedAtoms: state.selectedAtoms
    });
  }

  function exportReport() {
    const d = state.data;

    const elByOrbA = Aggregate.sumByElement(
      d.rows,
      0,
      state.orbStart,
      state.orbEnd
    );

    const atByOrbA = Aggregate.sumByAtom(
      d.rows,
      0,
      state.orbStart,
      state.orbEnd,
      state.listElements,
      state.listAtoms,
      state.threshold
    );

    const aoByOrbA = Aggregate.sumByReducedAO(
      d.rows,
      0,
      state.orbStart,
      state.orbEnd,
      state.listElements,
      state.listAtoms,
      state.threshold
    );

    const aoFullByOrbA = Aggregate.aoInOrbitalForAtoms(
      d.rows,
      0,
      state.orbStart,
      state.orbEnd,
      state.listElements,
      state.listAtoms,
      state.threshold,
      state.listAtoms
    );

    let elByOrbB = [];
    let atByOrbB = [];
    let aoByOrbB = [];
    let aoFullByOrbB = [];

    if (d.spin === 1) {
      elByOrbB = Aggregate.sumByElement(
        d.rows,
        1,
        state.orbStart,
        state.orbEnd
      );

      atByOrbB = Aggregate.sumByAtom(
        d.rows,
        1,
        state.orbStart,
        state.orbEnd,
        state.listElements,
        state.listAtoms,
        state.threshold
      );

      aoByOrbB = Aggregate.sumByReducedAO(
        d.rows,
        1,
        state.orbStart,
        state.orbEnd,
        state.listElements,
        state.listAtoms,
        state.threshold
      );

      aoFullByOrbB = Aggregate.aoInOrbitalForAtoms(
        d.rows,
        1,
        state.orbStart,
        state.orbEnd,
        state.listElements,
        state.listAtoms,
        state.threshold,
        state.listAtoms
      );
    }

    const selectedAtoms = [...state.selectedAtoms].sort((a, b) => a - b);

    const aoDetailRows = selectedAtoms.length > 0
      ? Aggregate.aoInOrbitalForAtoms(
          d.rows,
          state.displaySpin,
          state.orbStart,
          state.orbEnd,
          state.listElements,
          state.listAtoms,
          state.threshold,
          selectedAtoms
        )
      : [];

    Export.exportAnalysisReport({
      data: d,
      threshold: state.threshold,
      orbStart: state.orbStart,
      orbEnd: state.orbEnd,
      applConstr: state.applConstr,
      spin: d.spin,
      selectedAtoms,
      atomLabelFn: (atomNo) => UI.atomLabel(state, atomNo),
      elByOrbA,
      atByOrbA,
      aoByOrbA,
      aoFullByOrbA,
      elByOrbB,
      atByOrbB,
      aoByOrbB,
      aoFullByOrbB,
      aoDetailRows
    }, state.filename);
  }

  init();

  return {
    toggleAtomSelection,
    renderAll
  };
})();