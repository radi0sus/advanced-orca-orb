"use strict";

/*
  Export: raw CSV (equivalent of orca.out.csv) and the analysis text
  report (equivalent of o-analysis.txt). Both always cover the FULL set
  of parsed data / the currently configured analysis parameters - never
  just a UI-only display window - unless the user has explicitly set the
  range/threshold/constraint to something narrower.

  The text report uses plain, single-header-row fixed-width tables
  (right-aligned, 2-space gutters) rather than a literal reproduction of
  pandas' two-line hierarchical header - easier to read in any plain
  text viewer, and "Cntrb" sits on the same header line as the other
  column names instead of floating above them.
*/
window.ORBWEB_EXPORT = (() => {
  function downloadBlob(filename, text, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportRawCsv(data, filename) {
    const header = ["orb_num", "orb_spin", "orb_en", "orb_occ", "atom_no", "element", "orb_red", "orbital", "orb_comp"];
    const lines = [header.join(",")];
    for (const r of data.rows) {
      lines.push([r.orbNum, r.spin, r.orbEn, r.occ, r.atomNo, r.element, r.orbRed, r.orbital, r.cntrb].join(","));
    }
    downloadBlob(filename.replace(/\.[^.]+$/, "") + ".csv", lines.join("\n"), "text/csv");
  }

  /*
    Renders `rows` (plain objects) as a right-aligned, fixed-width text
    table with a single header row.

    columns: [{ key, header, decimals? }] in display order. Numbers are
    formatted with `decimals` (if given); everything else is stringified
    as-is.

    groupKeys: leading columns (by key) that get blanked on a row when
    their value is identical to the previous row's AND every group key
    before it also matched - the classic "hierarchical index" print
    style used in the reference o-analysis.txt (e.g. OrbNo/Energy/
    Occupation only printed once per orbital, even when several
    atoms/AOs contribute to that orbital).
  */
  function formatCell(row, col) {
    const v = row[col.key];
    if (typeof v === "number" && col.decimals !== undefined) return v.toFixed(col.decimals);
    return String(v);
  }

  function fixedWidthTable(rows, columns, groupKeys = []) {
    if (rows.length === 0) return "(none)";

    const cells = rows.map((row) => columns.map((col) => formatCell(row, col)));

    // Blank out repeated leading group-key values, row over row.
    for (let i = cells.length - 1; i > 0; i--) {
      let stillMatching = true;
      for (let c = 0; c < columns.length; c++) {
        const key = columns[c].key;
        if (!groupKeys.includes(key)) continue;
        if (stillMatching && cells[i][c] === cells[i - 1][c] && rows[i][key] === rows[i - 1][key]) {
          cells[i][c] = "";
        } else {
          stillMatching = false;
        }
      }
    }

    const widths = columns.map((col, c) =>
      Math.max(col.header.length, ...cells.map((row) => row[c].length))
    );

    const pad = (s, w) => " ".repeat(Math.max(0, w - s.length)) + s;
    const headerLine = columns.map((col, c) => pad(col.header, widths[c])).join("  ");
    const dataLines = cells.map((row) => row.map((s, c) => pad(s, widths[c])).join("  "));

    return [headerLine, ...dataLines].join("\n");
  }

  /*
    Section 1 (element contributions) is a genuine pivot in the Python
    original - one column per element - rather than a flat Cntrb column,
    so it gets its own builder instead of fixedWidthTable's group-key
    scheme.
  */
  function elementPivotTable(elRows) {
    if (elRows.length === 0) return "(none)";

    const orbKeys = [...new Set(elRows.map((r) => `${r.orbNum}|${r.orbEn}|${r.occ}`))]
      .map((k) => { const [o, e, c] = k.split("|"); return { orbNum: Number(o), orbEn: Number(e), occ: Number(c) }; })
      .sort((a, b) => a.orbNum - b.orbNum);

    const elements = [...new Set(elRows.map((r) => r.element))].sort();
    const byKey = new Map();
    for (const r of elRows) byKey.set(`${r.orbNum}|${r.element}`, r.sum);

    const rows = orbKeys.map((ok) => {
      const row = { orbNum: ok.orbNum, orbEn: ok.orbEn, occ: ok.occ };
      for (const el of elements) row[el] = byKey.get(`${ok.orbNum}|${el}`) || 0;
      return row;
    });

    const columns = [
      { key: "orbNum", header: "OrbNo" },
      { key: "orbEn", header: "OrbitalEnergy", decimals: 5 },
      { key: "occ", header: "Occupation", decimals: 1 },
      ...elements.map((element) => ({ key: element, header: element, decimals: 1 }))
    ];

    return fixedWidthTable(rows, columns, []);
  }

  const ATOM_COLUMNS = [
    { key: "orbNum", header: "OrbNo" },
    { key: "orbEn", header: "OrbitalEnergy", decimals: 5 },
    { key: "occ", header: "Occupation", decimals: 1 },
    { key: "element", header: "Element" },
    { key: "atomNoLabel", header: "AtomNo" },
    { key: "sum", header: "Cntrb", decimals: 1 }
  ];
  const ATOM_GROUP_KEYS = ["orbNum", "orbEn", "occ"];

  const AO_RED_COLUMNS = [
    { key: "orbNum", header: "OrbNo" },
    { key: "orbEn", header: "OrbitalEnergy", decimals: 5 },
    { key: "occ", header: "Occupation", decimals: 1 },
    { key: "element", header: "Element" },
    { key: "atomNoLabel", header: "AtomNo" },
    { key: "orbRed", header: "Orb" },
    { key: "sum", header: "Cntrb", decimals: 1 }
  ];

  const AO_FULL_COLUMNS = [
    { key: "orbNum", header: "OrbNo" },
    { key: "orbEn", header: "OrbitalEnergy", decimals: 5 },
    { key: "occ", header: "Occupation", decimals: 1 },
    { key: "element", header: "Element" },
    { key: "atomNoLabel", header: "AtomNo" },
    { key: "orbRed", header: "Orb" },
    { key: "orbital", header: "OrbOr" },
    { key: "sum", header: "Cntrb", decimals: 1 }
  ];

  const AO_DETAIL_COLUMNS = [
    { key: "atomNoLabel", header: "AtomNo" },
    { key: "element", header: "Element" },
    { key: "orbRed", header: "Orb" },
    { key: "orbital", header: "OrbOr" },
    { key: "orbNum", header: "OrbNo" },
    { key: "occ", header: "Occ", decimals: 1 },
    { key: "sum", header: "Cntrb", decimals: 1 }
  ];
  const AO_DETAIL_GROUP_KEYS = ["atomNoLabel", "element", "orbRed", "orbital"];

  function withAtomLabel(rows, atomLabelFn) {
    return rows.map((r) => ({
      ...r,
      atomNoLabel: atomLabelFn(r.atomNo),
      orbRed: r.orbRed || (r.orbital ? r.orbital.charAt(0) : "")
    }));
  }

  function sectionHeader(title) {
    return `\n${title}\n${"=".repeat(66)}`;
  }

  function exportAnalysisReport(ctx, filename) {
    const {
      data, threshold, orbStart, orbEnd, applConstr, spin, selectedAtoms, atomLabelFn,
      elByOrbA, atByOrbA, aoByOrbA, aoFullByOrbA,
      elByOrbB, atByOrbB, aoByOrbB, aoFullByOrbB,
      aoDetailRows
    } = ctx;

    const alphaStr = spin === 1 ? " (alpha)" : "";
    const lines = [];
    lines.push("=".repeat(66));
    lines.push(`LOEWDIN REDUCED ORBITAL POPULATIONS PER MO analysis of ${data.filename}`);
    lines.push(orbStart === orbEnd ? `Analyzed orbital          : ${orbStart}` : `Analyzed orbitals         : ${orbStart}...${orbEnd}`);
    if (spin === 1) {
      lines.push(`Alpha spin orbitals       : ${data.totNumOrbA}`);
      lines.push(`Beta spin orbitals        : ${data.totNumOrbB}`);
    } else {
      lines.push(`Number of orbitals        : ${data.totNumOrbA}`);
    }
    lines.push(`Orbital no. of the HOMO   : ${data.homoNum}`);
    lines.push(`Threshold for printing (%): ${threshold}`);
    lines.push(`Applied constraint        : ${applConstr}`);
    lines.push(`Atoms for AO heat maps    : ${selectedAtoms.length > 0 ? selectedAtoms.map(atomLabelFn).join(", ") : "none"}`);
    lines.push("=".repeat(66));

    lines.push(sectionHeader(`Summary of element contributions (>= 0%) to orbitals${alphaStr}:`));
    lines.push(elementPivotTable(elByOrbA));
    if (spin === 1) {
      lines.push(sectionHeader("Summary of element contributions (>= 0%) to orbitals (beta):"));
      lines.push(elementPivotTable(elByOrbB));
    }

    lines.push(sectionHeader(`Summary of atom contributions (>= ${threshold}%) to orbitals${alphaStr}:`));
    lines.push(fixedWidthTable(withAtomLabel(atByOrbA, atomLabelFn), ATOM_COLUMNS, ATOM_GROUP_KEYS));
    if (spin === 1) {
      lines.push(sectionHeader(`Summary of atom contributions (>= ${threshold}%) to orbitals (beta):`));
      lines.push(fixedWidthTable(withAtomLabel(atByOrbB, atomLabelFn), ATOM_COLUMNS, ATOM_GROUP_KEYS));
    }

    lines.push(sectionHeader(`Summary of reduced AO contributions (>= ${threshold}%) to orbitals${alphaStr}:`));
    lines.push(fixedWidthTable(withAtomLabel(aoByOrbA, atomLabelFn), AO_RED_COLUMNS, ATOM_GROUP_KEYS));
    if (spin === 1) {
      lines.push(sectionHeader(`Summary of reduced AO contributions (>= ${threshold}%) to orbitals (beta):`));
      lines.push(fixedWidthTable(withAtomLabel(aoByOrbB, atomLabelFn), AO_RED_COLUMNS, ATOM_GROUP_KEYS));
    }

    lines.push(sectionHeader(`Summary of AO contributions (>= ${threshold}%) to orbitals${alphaStr}:`));
    lines.push(fixedWidthTable(withAtomLabel(aoFullByOrbA, atomLabelFn), AO_FULL_COLUMNS, ATOM_GROUP_KEYS));
    if (spin === 1) {
      lines.push(sectionHeader(`Summary of AO contributions (>= ${threshold}%) to orbitals (beta):`));
      lines.push(fixedWidthTable(withAtomLabel(aoFullByOrbB, atomLabelFn), AO_FULL_COLUMNS, ATOM_GROUP_KEYS));
    }

    if (selectedAtoms.length > 0) {
      lines.push(sectionHeader(`AOs (contribution >= ${threshold}%) in orbitals - selected atoms:`));
      const sorted = withAtomLabel(aoDetailRows, atomLabelFn).sort((a, b) =>
        a.atomNo - b.atomNo || a.orbRed.localeCompare(b.orbRed) || a.orbital.localeCompare(b.orbital) || a.orbNum - b.orbNum
      );
      lines.push(fixedWidthTable(sorted, AO_DETAIL_COLUMNS, AO_DETAIL_GROUP_KEYS));
    }

    downloadBlob(filename.replace(/\.[^.]+$/, "") + "-analysis.txt", lines.join("\n"));
  }

  return { exportRawCsv, exportAnalysisReport };
})();
