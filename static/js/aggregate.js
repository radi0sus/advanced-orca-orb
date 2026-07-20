"use strict";

/*
  Port of the aggregation / constraint / range logic from orca_orb.py.
  Operates on the flat row list produced by ORBWEB_PARSER.parseOrcaOrbFile
  (see orca-import.js for the row shape).
*/
window.ORBWEB_AGGREGATE = (() => {
  const ORBRANGE_RE = /^(\d+)[:-](\d+)$/;
  const ORBRANGE_HOMO_RE = /^h(?:omo)?(\d+)$/i;

  /*
    Orbital range parsing - mirrors the -o/--orbitals CLI argument:
      "all"          -> full range
      "h" / "homo"   -> just the HOMO
      "5"            -> just orbital 5
      "0-10"/"0:10"  -> orbitals 0 to 10
      "h10"          -> HOMO-10 .. HOMO+10
    Returns { orbStart, orbEnd, error } - error is a user-facing message,
    or null if the input was valid and within range.
  */
  function parseOrbitalRange(input, homoNum, totNumOrbA) {
    const val = (input || "all").trim();

    if (val === "" || val.toLowerCase() === "all") {
      return { orbStart: 0, orbEnd: totNumOrbA, error: null };
    }

    if (/^(h|homo)$/i.test(val)) {
      return { orbStart: homoNum, orbEnd: homoNum, error: null };
    }

    if (/^\d+$/.test(val)) {
      const n = parseInt(val, 10);
      return checkRange(n, n, totNumOrbA);
    }

    let m = val.match(ORBRANGE_RE);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = parseInt(m[2], 10);
      if (start > end) {
        return { orbStart: null, orbEnd: null, error: "Start orbital > end orbital." };
      }
      return checkRange(start, end, totNumOrbA);
    }

    m = val.match(ORBRANGE_HOMO_RE);
    if (m) {
      const n = parseInt(m[1], 10);
      return checkRange(homoNum - n, homoNum + n, totNumOrbA);
    }

    return { orbStart: null, orbEnd: null, error: "Malformed orbital range." };
  }

  function checkRange(start, end, totNumOrbA) {
    if (start < 0 || end < 0 || end > totNumOrbA) {
      return {
        orbStart: null,
        orbEnd: null,
        error: `Value exceeds range of orbitals: 0...${totNumOrbA}.`
      };
    }
    return { orbStart: start, orbEnd: end, error: null };
  }

  /*
    Convenience presets for the UI buttons (±10/±25/±50/all), built on
    top of the same parser so behaviour stays identical to typing
    "h10" etc. by hand.
  */
  function presetRange(preset, homoNum, totNumOrbA) {
    if (preset === "all") return parseOrbitalRange("all", homoNum, totNumOrbA);
    return parseOrbitalRange(`h${preset}`, homoNum, totNumOrbA);
  }

  /*
    Constraints parsing - mirrors -c/--constraints. Element tokens
    (e.g. "C,N") and atom-number tokens (e.g. "1,4,5") cannot be mixed;
    whichever pattern matches first (element regex has priority, same
    as the Python elm/atm.match() order) wins, unmatched leftovers are
    silently dropped (case-sensitive, same as original).
    Returns { listElements, listAtoms, applConstr }.
  */
  function parseConstraints(input, availableElements, availableAtoms) {
    const val = (input || "").trim();
    const allElements = availableElements;
    const allAtoms = availableAtoms;

    if (val === "" || val.toLowerCase() === "none") {
      return { listElements: allElements, listAtoms: allAtoms, applConstr: "none" };
    }

    const elmMatches = val.match(/[A-Z][a-z]?/g) || [];
    const looksLikeElement = /^[A-Z]/.test(val);

    if (looksLikeElement && elmMatches.length > 0) {
      const found = elmMatches.filter((e) => allElements.includes(e));
      if (found.length > 0) {
        return {
          listElements: [...new Set(found)],
          listAtoms: allAtoms,
          applConstr: `Elements ${found.join(",")}`
        };
      }
    }

    const atmMatches = (val.match(/\d+/g) || []).map(Number);
    if (atmMatches.length > 0) {
      const found = atmMatches.filter((a) => allAtoms.includes(a));
      if (found.length > 0) {
        found.sort((a, b) => a - b);
        return {
          listElements: allElements,
          listAtoms: [...new Set(found)],
          applConstr: `Atoms ${found.join(",")}`
        };
      }
    }

    return {
      listElements: allElements,
      listAtoms: allAtoms,
      applConstr: "none",
      warning: "None of the specified elements or atoms were found. Using all."
    };
  }

  /*
    Element-contribution summary (first table in o-analysis.txt):
    NOT subject to threshold or constraints, always all elements.
    sum(cntrb) grouped by (orbNum, orbEn, occ, element), per spin.
    Returns array sorted by orbNum, then element.
  */
  function sumByElement(rows, spin, orbStart, orbEnd) {
    const map = new Map();
    for (const r of rows) {
      if (r.spin !== spin || r.orbNum < orbStart || r.orbNum > orbEnd) continue;
      const key = `${r.orbNum}|${r.element}`;
      if (!map.has(key)) {
        map.set(key, { orbNum: r.orbNum, orbEn: r.orbEn, occ: r.occ, element: r.element, sum: 0 });
      }
      map.get(key).sum += r.cntrb;
    }
    return [...map.values()].sort((a, b) => a.orbNum - b.orbNum || a.element.localeCompare(b.element));
  }

  /*
    Atom-contribution summary: threshold + constraints applied.
    sum(cntrb) grouped by (orbNum, orbEn, occ, element, atomNo).
  */
  function sumByAtom(rows, spin, orbStart, orbEnd, listElements, listAtoms, threshold) {
    const map = new Map();
    for (const r of rows) {
      if (r.spin !== spin || r.orbNum < orbStart || r.orbNum > orbEnd) continue;
      if (!listElements.includes(r.element) || !listAtoms.includes(r.atomNo)) continue;
      const key = `${r.orbNum}|${r.atomNo}`;
      if (!map.has(key)) {
        map.set(key, {
          orbNum: r.orbNum, orbEn: r.orbEn, occ: r.occ,
          element: r.element, atomNo: r.atomNo, sum: 0
        });
      }
      map.get(key).sum += r.cntrb;
    }
    return [...map.values()]
      .filter((row) => row.sum >= threshold)
      .sort((a, b) => a.orbNum - b.orbNum || a.atomNo - b.atomNo);
  }

  /*
    Reduced-AO-contribution summary: threshold + constraints applied.
    sum(cntrb) grouped by (orbNum, orbEn, occ, element, atomNo, orbRed).
  */
  function sumByReducedAO(rows, spin, orbStart, orbEnd, listElements, listAtoms, threshold) {
    const map = new Map();
    for (const r of rows) {
      if (r.spin !== spin || r.orbNum < orbStart || r.orbNum > orbEnd) continue;
      if (!listElements.includes(r.element) || !listAtoms.includes(r.atomNo)) continue;
      const key = `${r.orbNum}|${r.atomNo}|${r.orbRed}`;
      if (!map.has(key)) {
        map.set(key, {
          orbNum: r.orbNum, orbEn: r.orbEn, occ: r.occ,
          element: r.element, atomNo: r.atomNo, orbRed: r.orbRed, sum: 0
        });
      }
      map.get(key).sum += r.cntrb;
    }
    return [...map.values()]
      .filter((row) => row.sum >= threshold)
      .sort((a, b) => a.orbNum - b.orbNum || a.atomNo - b.atomNo || a.orbRed.localeCompare(b.orbRed));
  }

  /*
    Full (unreduced) AO-in-orbital detail for a specific set of atoms -
    replaces the -a/--aorbitals CLI flag. In the web app this is driven
    by clicking atoms in the atom list or in the 3D viewer instead of
    typing atom numbers.
    Threshold applies; constraints (element/atom) are intersected with
    the requested atom set, same as the Python original.
  */
  function aoInOrbitalForAtoms(rows, spin, orbStart, orbEnd, listElements, listAtoms, threshold, requestedAtoms) {
    const wanted = requestedAtoms.filter(
      (a) => listAtoms.includes(a) && rows.some((r) => r.atomNo === a && listElements.includes(r.element))
    );
    if (wanted.length === 0) return [];

    const map = new Map();
    for (const r of rows) {
      if (r.spin !== spin || r.orbNum < orbStart || r.orbNum > orbEnd) continue;
      if (!wanted.includes(r.atomNo)) continue;
      if (r.cntrb < threshold) continue;
      const key = `${r.orbNum}|${r.atomNo}|${r.orbital}`;
      if (!map.has(key)) {
        map.set(key, {
          orbNum: r.orbNum, orbEn: r.orbEn, occ: r.occ,
          element: r.element, atomNo: r.atomNo, orbital: r.orbital, sum: 0
        });
      }
      map.get(key).sum += r.cntrb;
    }
    return [...map.values()].sort(
      (a, b) => a.orbNum - b.orbNum || a.atomNo - b.atomNo || a.orbital.localeCompare(b.orbital)
    );
  }

  return {
    parseOrbitalRange,
    presetRange,
    parseConstraints,
    sumByElement,
    sumByAtom,
    sumByReducedAO,
    aoInOrbitalForAtoms
  };
})();
