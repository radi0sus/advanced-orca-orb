"use strict";

/*
  Plotly replacements for the three plot types in orca_orb.py's "plot
  section" (matplotlib/seaborn). Colors/behaviour are matched where it
  matters for readability, not pixel-identical:

    - Element contributions -> stacked horizontal bar (ax.plot.barh)
    - Atom contributions     -> heatmap, annotations off above a UI limit
    - AO-in-orbital           -> one heatmap PER selected atom, driven by
                                 atom-list/3Dmol click selection instead of
                                 the -a/--aorbitals CLI flag and its
                                 constr_for_atoms_set/list_of_atoms_ao gate

  Heatmap cell semantics:

    - Missing cells are plotted as `null`, remain visually blank, and get
      a dash marker when annotations are enabled.
    - Exact 0.0% values are plotted as real values and receive the
      low-end color of the heatmap scale.
    - Positive contributions are colored relative to the current visible
      maximum.
    - Cell labels are intentionally rounded to whole numbers, e.g. "1",
      to keep dense heatmaps readable.
    - Hover tooltips still show one decimal place and the percent sign.

  Implementation note:

    Heatmaps use numeric x/y coordinates internally and show the atom/AO
    and orbital labels via ticktext. This is more robust than categorical
    axes here.

    The atom heatmap is purged before every redraw. This avoids Plotly
    reusing stale axis state during threshold changes, which can otherwise
    trigger "Something went wrong with axis scaling".
*/
window.ORBWEB_PLOTS = (() => {
  function themeColors() {
    const css = getComputedStyle(document.documentElement);

    return {
      text: css.getPropertyValue("--text").trim(),
      muted: css.getPropertyValue("--muted").trim(),
      border: css.getPropertyValue("--border").trim(),
      panel: css.getPropertyValue("--panel").trim(),
      accent: css.getPropertyValue("--accent").trim()
    };
  }

  function baseLayout(extra) {
    const c = themeColors();

    return Object.assign(
      {
        margin: { l: 90, r: 20, t: 70, b: 50 },
        autosize: true,
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        font: {
          color: c.text,
          size: 11
        },
        hoverlabel: {
          bgcolor: c.panel,
          bordercolor: c.border,
          font: {
            color: c.text
          }
        }
      },
      extra
    );
  }

  const CONFIG = {
    displayModeBar: "hover",
    displaylogo: false,
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
    responsive: true
  };

  const HEATMAP_COLORSCALE = "Viridis";
  const ANNOTATION_CELL_LIMIT = 25000;

  function annotationTextColor(v, vmax) {
    if (vmax <= 0) return "#ffffff";
    return v > vmax * 0.62 ? "#0b1f1c" : "#ffffff";
  }

  function formatHeatmapValue(v) {
    return String(Math.round(v));
  }

  function orbLabel(orbNum, occ) {
    return `${orbNum} (occ ${occ.toFixed(2)})`;
  }

  function renderElementBar(containerId, elRows, homoNum, spinLabel) {
    const el = document.getElementById(containerId);

    if (!el) return;

    freezeHeight(el);
    Plotly.purge(el);

    if (elRows.length === 0) {
      el.innerHTML = "";
      unfreezeHeight(el);
      return;
    }

    const orbKeys = [...new Set(elRows.map((r) => `${r.orbNum}|${r.occ}`))]
      .map((k) => {
        const [orbNum, occ] = k.split("|");

        return {
          orbNum: Number(orbNum),
          occ: Number(occ)
        };
      })
      .sort((a, b) => a.orbNum - b.orbNum);

    const yLabels = orbKeys.map((k) => orbLabel(k.orbNum, k.occ));
    const yValues = yLabels.map((_, i) => i);
    const elements = [...new Set(elRows.map((r) => r.element))].sort();

    const byKey = new Map();

    for (const r of elRows) {
      byKey.set(`${r.orbNum}|${r.occ}|${r.element}`, r.sum);
    }

    const traces = elements.map((element) => ({
      type: "bar",
      orientation: "h",
      name: element,
      x: orbKeys.map((k) => byKey.get(`${k.orbNum}|${k.occ}|${element}`) || 0),
      y: yValues,
      marker: {
        color: window.ORBWEB_ELEMENTS.getColor(element)
      },
      hovertemplate: `${element}: %{x:.1f}%<extra></extra>`
    }));

    const layout = baseLayout({
      barmode: "stack",
      title: {
        text: `Element contributions (>= 0%) to orbitals${spinLabel}. HOMO = ${homoNum}.`,
        font: {
          size: 12
        }
      },
      xaxis: {
        title: "Contribution (%)",
        range: [0, 100]
      },
      yaxis: {
        title: "Orbital (Occupation)",
        tickmode: "array",
        tickvals: yValues,
        ticktext: yLabels,
        automargin: true,
        range: heatmapRange(yValues)
      },
      height: Math.max(220, yLabels.length * 22 + 90),
      legend: {
        orientation: "h",
        yanchor: "bottom",
        y: 1,
        xanchor: "left",
        x: 0
      }
    });

    Plotly.newPlot(el, traces, layout, CONFIG).then(() => unfreezeHeight(el));
  }

  function buildMatrix(rows, colKeyFn, colLabelFn, colSortFn) {
    const orbKeys = [...new Set(rows.map((r) => `${r.orbNum}|${r.occ}`))]
      .map((k) => {
        const [o, c] = k.split("|");

        return {
          orbNum: Number(o),
          occ: Number(c)
        };
      })
      .sort((a, b) => a.orbNum - b.orbNum);

    const colValues = [...new Set(rows.map(colKeyFn))].sort(colSortFn);
    const yLabels = orbKeys.map((k) => orbLabel(k.orbNum, k.occ));
    const xLabels = colValues.map(colLabelFn);
    const xValues = xLabels.map((_, i) => i);
    const yValues = yLabels.map((_, i) => i);

    const byKey = new Map();

    for (const r of rows) {
      byKey.set(`${r.orbNum}|${r.occ}|${colKeyFn(r)}`, r.sum);
    }

    let vmax = null;

    const z = orbKeys.map((ok) => {
      return colValues.map((cv) => {
        const key = `${ok.orbNum}|${ok.occ}|${cv}`;

        if (!byKey.has(key)) {
          return null;
        }

        const v = byKey.get(key);

        if (!Number.isFinite(v)) {
          return null;
        }

        if (vmax === null || v > vmax) {
          vmax = v;
        }

        return v;
      });
    });

    const customdata = yLabels.map((yLabel) => {
      return xLabels.map((xLabel) => {
        return [xLabel, yLabel];
      });
    });

    return {
      xLabels,
      yLabels,
      xValues,
      yValues,
      z,
      customdata,
      orbKeys,
      colValues,
      vmax
    };
  }

  function buildAnnotations(z, vmax) {
    const annotations = [];
    const c = themeColors();
    const effectiveMax = heatmapZmax(vmax);

    z.forEach((row, yi) => {
      row.forEach((v, xi) => {
        if (v === null) {
          annotations.push({
            x: xi,
            y: yi,
            text: "\u2013",
            showarrow: false,
            font: {
              size: 10,
              color: c.muted
            }
          });

          return;
        }

        annotations.push({
          x: xi,
          y: yi,
          text: formatHeatmapValue(v),
          showarrow: false,
          font: {
            size: 9,
            color: annotationTextColor(v, effectiveMax)
          }
        });
      });
    });

    return annotations;
  }

  function heatmapZmax(vmax) {
    if (vmax === null) return 100;
    if (vmax <= 0) return 1;
    return vmax;
  }

  function heatmapRange(values) {
    if (values.length === 0) {
      return [-0.5, 0.5];
    }

    return [-0.5, values.length - 0.5];
  }

  function freezeHeight(el) {
    // Plotly.purge() empties the container, which trips the
    // `.plot-block:empty { display: none }` CSS rule and collapses it
    // to zero height. Plotly.newPlot() then redraws asynchronously
    // (it resolves via a promise/rAF, not synchronously), so the
    // browser paints the collapsed state in between - that's the
    // visible "pump" on every threshold/selection change. Locking in
    // the previous rendered height (and overriding :empty via inline
    // display) keeps the layout stable across the purge -> redraw gap.
    const prevHeight = el.offsetHeight;

    if (prevHeight > 0) {
      el.style.minHeight = `${prevHeight}px`;
    }

    el.style.display = "block";
  }

  function unfreezeHeight(el) {
    el.style.minHeight = "";
    el.style.display = "";
  }

  function renderAtomHeatmap(containerId, atomRows, homoNum, threshold, applConstr, spinLabel, atomLabelFn) {
    const el = document.getElementById(containerId);

    if (!el) return;

    freezeHeight(el);
    Plotly.purge(el);

    if (atomRows.length === 0) {
      el.innerHTML = "";
      unfreezeHeight(el);
      return;
    }

    const {
      xLabels,
      yLabels,
      xValues,
      yValues,
      z,
      customdata,
      orbKeys,
      colValues,
      vmax
    } = buildMatrix(
      atomRows,
      (r) => r.atomNo,
      (atomNo) => atomLabelFn(atomNo),
      (a, b) => a - b
    );

    const zmax = heatmapZmax(vmax);
    const cellCount = orbKeys.length * colValues.length;
    const showAnnotations = cellCount <= ANNOTATION_CELL_LIMIT;

    const trace = {
      type: "heatmap",
      z,
      x: xValues,
      y: yValues,
      customdata,
      colorscale: HEATMAP_COLORSCALE,
      showscale: true,
      zmin: 0,
      zmax,
      xgap: 1,
      ygap: 1,
      hoverongaps: false,
      hovertemplate: "Orbital %{customdata[1]}<br>Atom %{customdata[0]}<br>%{z:.1f}%<extra></extra>"
    };

    const layout = baseLayout({
      title: {
        text: `Atom contributions (>= ${threshold}%) to orbitals${spinLabel}. HOMO = ${homoNum}.` +
          (applConstr !== "none" ? ` Constraints: ${applConstr}.` : ""),
        font: {
          size: 12
        }
      },
      xaxis: {
        title: "Atom",
        tickmode: "array",
        tickvals: xValues,
        ticktext: xLabels,
        tickangle: -90,
        automargin: true,
        showgrid: false,
        zeroline: false,
        range: heatmapRange(xValues)
      },
      yaxis: {
        title: "Orbital (Occupation)",
        tickmode: "array",
        tickvals: yValues,
        ticktext: yLabels,
        automargin: true,
        showgrid: false,
        zeroline: false,
        range: heatmapRange(yValues)
      },
      annotations: showAnnotations ? buildAnnotations(z, vmax) : [],
      height: Math.max(240, yLabels.length * 22 + 110)
    });

    Plotly.newPlot(el, [trace], layout, CONFIG).then(() => unfreezeHeight(el));
  }

  function renderAoHeatmaps(containerEl, aoRowsByAtom, homoNum, threshold, spinLabel, atomLabelFn) {
    freezeHeight(containerEl);
    containerEl.innerHTML = "";

    if (aoRowsByAtom.size === 0) {
      const p = document.createElement("div");

      p.className = "aodetail-empty";
      p.textContent = "No atom selected - click an atom in the list on the left or in the 3D view to see its AO breakdown.";

      containerEl.appendChild(p);
      unfreezeHeight(containerEl);

      return;
    }

    const plotPromises = [];

    for (const [atomNo, rows] of aoRowsByAtom.entries()) {
      if (rows.length === 0) {
        const p = document.createElement("div");

        p.className = "aodetail-empty";
        p.textContent = `${atomLabelFn(atomNo)}: no AO contribution \u2265 ${threshold}% in the currently displayed orbital range.`;

        containerEl.appendChild(p);

        continue;
      }

      const wrap = document.createElement("div");
      wrap.className = "ao-heatmap-wrap";

      const div = document.createElement("div");
      div.className = "ao-heatmap";
      div.id = `ao-heatmap-${atomNo}`;

      wrap.appendChild(div);
      containerEl.appendChild(wrap);

      const {
        xLabels,
        yLabels,
        xValues,
        yValues,
        z,
        customdata,
        orbKeys,
        colValues,
        vmax
      } = buildMatrix(
        rows,
        (r) => r.orbital,
        (orbital) => `${atomLabelFn(atomNo)}-${orbital}`,
        (a, b) => a.localeCompare(b)
      );

      const zmax = heatmapZmax(vmax);
      const cellCount = orbKeys.length * colValues.length;
      const showAnnotations = cellCount <= ANNOTATION_CELL_LIMIT;

      const trace = {
        type: "heatmap",
        z,
        x: xValues,
        y: yValues,
        customdata,
        colorscale: HEATMAP_COLORSCALE,
        showscale: true,
        zmin: 0,
        zmax,
        xgap: 1,
        ygap: 1,
        hoverongaps: false,
        hovertemplate: "Orbital %{customdata[1]}<br>AO %{customdata[0]}<br>%{z:.1f}%<extra></extra>"
      };

      const layout = baseLayout({
        title: {
          text: `AO contributions (>= ${threshold}%) to orbitals${spinLabel} \u2014 ${atomLabelFn(atomNo)}. HOMO = ${homoNum}.`,
          font: {
            size: 12
          }
        },
        xaxis: {
          title: "AO",
          tickmode: "array",
          tickvals: xValues,
          ticktext: xLabels,
          automargin: true,
          showgrid: false,
          zeroline: false,
          range: heatmapRange(xValues)
        },
        yaxis: {
          title: "Orbital (Occupation)",
          tickmode: "array",
          tickvals: yValues,
          ticktext: yLabels,
          automargin: true,
          showgrid: false,
          zeroline: false,
          range: heatmapRange(yValues)
        },
        annotations: showAnnotations ? buildAnnotations(z, vmax) : [],
        height: Math.max(200, yLabels.length * 22 + 100)
      });

      plotPromises.push(Plotly.newPlot(div, [trace], layout, CONFIG));
    }

    Promise.all(plotPromises).then(() => unfreezeHeight(containerEl));
  }

  return {
    renderElementBar,
    renderAtomHeatmap,
    renderAoHeatmaps
  };
})();