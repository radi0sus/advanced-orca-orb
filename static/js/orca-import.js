"use strict";

/*
  Parser for the "LOEWDIN REDUCED ORBITAL POPULATIONS PER MO" section of an
  ORCA output file. Ported from orca_orb.py (Sebastian Dechert, 2019).

  Output shape (flat row list, one row per atom-orbital-contribution),
  intentionally mirroring the columns of the original pandas DataFrame
  `oall` after its rename() call:

    { orbNum, spin, orbEn, occ, atomNo, element, orbital, orbRed, cntrb }

    orbNum   int    orbital number (0-based, as printed by ORCA)
    spin     0|1    0 = alpha, 1 = beta
    orbEn    float  orbital energy (Eh)
    occ      float  occupation number
    atomNo   int    atom number (0-based, as printed by ORCA)
    element  str    element symbol
    orbital  str    full AO label, e.g. "dz2", "pz", "s"
    orbRed   str    reduced AO label: first character of `orbital` (s/p/d/f)
    cntrb    float  contribution in %
*/
window.ORBWEB_PARSER = (() => {
  const LOEWDIN_HEADER = "LOEWDIN REDUCED ORBITAL POPULATIONS PER MO";
  const NUMBER_PATTERN = "[-+]?(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[Ee][-+]?\\d+)?";

  function parseOrcaOrbFile(text, filename = "") {
    const lines = text.split(/\r?\n/);

    // Keep the *last* occurrence, same as the Python original - a file
    // can contain several Loewdin analyses (e.g. optimization steps),
    // and only the final one belongs to the converged geometry.
    let loewdinLast = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(LOEWDIN_HEADER)) loewdinLast = i;
    }

    if (loewdinLast === -1) {
      throw new Error(`"${LOEWDIN_HEADER}" not found in file.`);
    }

    const { rows, spin } = parseLoewdinBlock(lines, loewdinLast + 1);

    if (rows.length === 0) {
      throw new Error(
        `"${LOEWDIN_HEADER}" was found, but no orbital data could be parsed from it.`
      );
    }

    const geometry = parseOrcaAtomList(lines, loewdinLast);

    const totNumOrbA = maxOrbNum(rows, 0);
    const totNumOrbB = spin === 1 ? maxOrbNum(rows, 1) : null;
    const homoNum = computeHomoNum(rows);

    const elements = [...new Set(rows.map((r) => r.element))].sort();
    const atoms = [...new Set(rows.map((r) => r.atomNo))].sort((a, b) => a - b);

    return {
      filename,
      rows,
      spin,
      geometry,
      totNumOrbA,
      totNumOrbB,
      homoNum,
      elements,
      atoms
    };
  }

  /*
    State machine over the lines following the Loewdin header.

    ORCA prints the section as repeated "mini-blocks" (one page of
    columns at a time, typically 6 orbitals per page):

      line 0        orbital numbers,   e.g. "0    1    2    3    4    5"
      line 1        orbital energies
      line 2        occupations
      line 3..N     atom_no  element  AO-label   contrib0  contrib1  ...

    A single blank line ends a mini-block (page); flush it into `rows`.
    A second consecutive blank line ends the whole section.
    Lines containing "--", "SPIN" or "THRESHOLD" are header/separator
    noise and are skipped entirely (mirrors the Python `not in line`
    guard) - they neither count as data nor as the blank-line boundary.
    "SPIN DOWN" flips the running `spin` flag for everything parsed
    after it, exactly like the original.
  */
  function parseLoewdinBlock(lines, startIdx) {
    let spin = 0;
    let emptyLineCount = 0;
    let rawLines = [];
    const rows = [];
    const emptyRe = /^\s*$/;

    for (let idx = startIdx; idx < lines.length; idx++) {
      const line = lines[idx];

      if (line.includes("SPIN DOWN")) spin = 1;

      if (line.includes("--") || line.includes("SPIN") || line.includes("THRESHOLD")) {
        continue;
      }

      if (emptyRe.test(line)) {
        if (rawLines.length > 0) {
          flushMiniBlock(rawLines, spin, rows);
          rawLines = [];
        }
        emptyLineCount++;
        if (emptyLineCount === 2) break;
        continue;
      }

      emptyLineCount = 0;
      rawLines.push(line.trim().split(/\s+/));
    }

    return { rows, spin };
  }

  function flushMiniBlock(rawLines, spin, rows) {
    if (rawLines.length < 4) return; // need at least header rows + 1 atom line

    const orbNums = rawLines[0];
    const orbEns = rawLines[1];
    const occs = rawLines[2];
    const nCols = orbNums.length;

    for (let c = 0; c < nCols; c++) {
      const orbNum = parseInt(orbNums[c], 10);
      const orbEn = parseFloat(orbEns[c]);
      const occ = parseFloat(occs[c]);
      if (!Number.isFinite(orbNum)) continue;

      for (let r = 3; r < rawLines.length; r++) {
        const tokens = rawLines[r];
        if (tokens.length < 4) continue;

        const atomNo = parseInt(tokens[0], 10);
        const element = tokens[1];
        const orbital = tokens[2];
        const cntrb = parseFloat(tokens[3 + c]);

        if (!Number.isFinite(atomNo) || !Number.isFinite(cntrb)) continue;

        rows.push({
          orbNum,
          spin,
          orbEn,
          occ,
          atomNo,
          element,
          orbital,
          orbRed: orbital.charAt(0),
          cntrb
        });
      }
    }
  }

  function maxOrbNum(rows, spin) {
    let max = -1;
    for (const r of rows) {
      if (r.spin === spin && r.orbNum > max) max = r.orbNum;
    }
    return max;
  }

  /*
    Faithful port of:
      homo_num = oall.groupby('orb_occ')['orb_num'].max()
      homo_num = homo_num.loc[1, 'orb_num']
    i.e.: take the second-smallest unique occupation value (ascending),
    and return the highest orbital number carrying that occupation.
    For a normal closed- or open-shell case the unique occupations are
    {0, 2} or {0, 1}, so "second smallest" == "the occupied one" - this
    reproduces the original's HOMO detection exactly. Falls back to the
    highest occupation present if only one occupation value exists,
    instead of throwing (the Python .loc[1] would raise a KeyError there).
  */
  function computeHomoNum(rows) {
    const uniqueOccs = [...new Set(rows.map((r) => r.occ))].sort((a, b) => a - b);
    const targetOcc = uniqueOccs.length >= 2 ? uniqueOccs[1] : uniqueOccs[0];
    let max = -1;
    for (const r of rows) {
      if (r.occ === targetOcc && r.orbNum > max) max = r.orbNum;
    }
    return max;
  }

  /*
    Geometry: last "CARTESIAN COORDINATES (ANGSTROEM)" block appearing
    before `beforeIndex` (the Loewdin section start) - i.e. the geometry
    the calculation actually ran on. Ported from advanced_orca_ir's
    parser.js (parseOrcaAtomList).
  */
  function parseOrcaAtomList(lines, beforeIndex) {
    let sectionStart = -1;

    for (let i = 0; i < beforeIndex && i < lines.length; i++) {
      if (lines[i].trim() === "CARTESIAN COORDINATES (ANGSTROEM)") {
        sectionStart = i;
      }
    }

    if (sectionStart === -1) return [];

    const atoms = [];
    const atomLineRe = new RegExp(
      "^([A-Za-z]{1,3})\\s+(" +
        NUMBER_PATTERN +
        ")\\s+(" +
        NUMBER_PATTERN +
        ")\\s+(" +
        NUMBER_PATTERN +
        ")\\s*$"
    );

    let i = sectionStart + 1;
    if (lines[i] && /^-+$/.test(lines[i].trim())) i++;

    for (; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === "") break;

      const match = trimmed.match(atomLineRe);
      if (!match) break;

      atoms.push({
        index: atoms.length,
        element: match[1],
        x: Number(match[2]),
        y: Number(match[3]),
        z: Number(match[4])
      });
    }

    return atoms;
  }

  return { parseOrcaOrbFile };
})();
