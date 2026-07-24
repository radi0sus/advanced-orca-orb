# Advanced ORCA Orb

A browser-based, static web app for analyzing the
`LOEWDIN REDUCED ORBITAL POPULATIONS PER MO` section of ORCA output files.
No server, no build step, no dependencies to install - just open
`index.html` (double-click or drag & drop works, including via `file://`).

Based on [`orca_orb.py`](https://github.com/radi0sus/orca_orb).  

## Required ORCA input

ORCA: [https://orcaforum.kofo.mpg.de/](https://orcaforum.kofo.mpg.de/)  

The reduced orbital population section is not printed by ORCA by default.
Request it with **either**:

```
%output
  Print[ P_ReducedOrbPopMO_L ]  1  # default = on
end
```

**or** the simpler, coarser

```
! LargePrint
```

`LargePrint` prints a lot more than just the reduced orbital populations,
so the `%output` block above is the leaner option if that's all you need.

## Getting started

Open `index.html` in your browser and load an ORCA output file that
contains the section described above. The structure (if a Cartesian
coordinates block precedes the Loewdin section) and the population data
are parsed in one pass, no matter which orbital window you later select.

## Features

- **Orbital window**: quick preset buttons (HOMO±5/10/25/50, All) plus
  numeric "from"/"to" fields for an exact custom range. Everything else in
  the app - charts, tables, export - reacts live to whatever range is set.
- **Threshold slider**: hides contributions below the chosen percentage
  everywhere at once (charts, tables, export).
- **Constraint by element**: clickable element pills restrict the analysis
  to one or more elements.
- **Atom selection**: click atoms in the 3D viewer or in the atom list
  (left panel) to select them; selection is synchronized both ways and
  drives the AO detail view. A search box filters the atom list by element
  or atom number. A **1-based** toggle switches atom numbering between
  ORCA's native 0-based scheme (Cu0, C1, ...) and a 1-based scheme
  (Cu1, C2, ...); this affects every atom label throughout the app -
  viewer, atom list, charts, tables and export.
- **Elements tab**: a stacked horizontal bar chart showing, for each
  orbital in the current window, how much each element contributes.
- **Atoms tab**: a heatmap of per-atom contributions across the orbital
  window, honoring the current threshold and element/atom constraints.
- **AO heatmaps tab**: one heatmap per selected atom, resolved down to
  individual atomic orbitals.
- **Atom data / AO data tabs**: sortable, plain data tables of the same
  atom- and AO-resolved contributions, for a tabular view alongside the
  charts.
- **3D viewer**: 3Dmol.js-based structure view with adjustable bond
  detection tolerance, atom halo highlighting for the current selection,
  and a consistent color per element shared with every other view in the
  app (pills, atom list, charts).
- **Export**: the raw parsed data as CSV, or a full text analysis report
  (TXT) - both reflect exactly the threshold, constraints, and orbital
  window currently set in the UI.

## 3Dmol.js license, citation and Plotly license

3Dmol.js is licensed under a permissive BSD-3-Clause license (see
`static/vendor/3dmol.LICENSE`).

Please cite:

> Rego, N. and Koes, D. (2015).
> 3Dmol.js: molecular visualization with WebGL.
> *Bioinformatics*, 31(8), 1322–1324.
> https://academic.oup.com/bioinformatics/article/31/8/1322/213186

The plots are rendered with [Plotly.js](https://plotly.com/javascript/)
(MIT license, see `static/vendor/plotly.LICENSE`).