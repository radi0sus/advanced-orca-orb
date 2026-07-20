"use strict";

window.ORBWEB_UI = (() => {
  function displayIndex(state, atomIndex) {
    return state.oneBasedIndex ? atomIndex + 1 : atomIndex;
  }

  function atomLabel(state, atomNo) {
    const atom = state.data.geometry[atomNo];
    return atom ? `${atom.element}${displayIndex(state, atomNo)}` : `#${atomNo}`;
  }

  const ATOM_COLUMNS = [
    { key: "orbNum", label: "Orbital" },
    { key: "orbEn", label: "Energy / Eh" },
    { key: "occ", label: "Occ." },
    { key: "element", label: "El." },
    { key: "atomNo", label: "Atom" },
    { key: "sum", label: "Contrib. %" }
  ];

  const AO_COLUMNS = [
    { key: "orbNum", label: "Orbital" },
    { key: "orbEn", label: "Energy / Eh" },
    { key: "occ", label: "Occ." },
    { key: "atomNo", label: "Atom" },
    { key: "orbital", label: "AO" },
    { key: "sum", label: "Contrib. %" }
  ];

  function renderAtomTable(el, state, rows) {
    el.tableHead.innerHTML = "";
    el.tableBody.innerHTML = "";

    const trHead = document.createElement("tr");

    for (const col of ATOM_COLUMNS) {
      const th = document.createElement("th");
      th.textContent = col.label;

      if (state.sortKey === col.key) {
        th.classList.add(state.sortDir === "asc" ? "sort-asc" : "sort-desc");
      }

      th.addEventListener("click", () => {
        if (state.sortKey === col.key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = col.key;
          state.sortDir = col.key === "orbNum" ? "asc" : "desc";
        }

        window.ORBWEB_APP.renderAll();
      });

      trHead.appendChild(th);
    }

    el.tableHead.appendChild(trHead);

    const sorted = rows.slice().sort((a, b) => {
      const va = a[state.sortKey];
      const vb = b[state.sortKey];

      if (va < vb) return state.sortDir === "asc" ? -1 : 1;
      if (va > vb) return state.sortDir === "asc" ? 1 : -1;

      return a.orbNum - b.orbNum ||
        a.atomNo - b.atomNo ||
        a.element.localeCompare(b.element);
    });

    for (const row of sorted) {
      const tr = document.createElement("tr");

      const cells = [
        row.orbNum,
        row.orbEn.toFixed(5),
        row.occ.toFixed(2),
        row.element,
        atomLabel(state, row.atomNo),
        row.sum.toFixed(1)
      ];

      for (const val of cells) {
        const td = document.createElement("td");
        td.textContent = val;
        tr.appendChild(td);
      }

      el.tableBody.appendChild(tr);
    }

    if (sorted.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");

      td.colSpan = ATOM_COLUMNS.length;
      td.className = "aodetail-empty";
      td.textContent = "No contributions clear the current threshold in this orbital range.";

      tr.appendChild(td);
      el.tableBody.appendChild(tr);
    }
  }

  function renderAtomList(el, state) {
    el.atomListBody.innerHTML = "";

    if (!state.data) return;

    const query = state.atomSearch;

    const rows = state.data.geometry.filter((atom) => {
      if (!query) return true;

      const label = `${atom.element}${displayIndex(state, atom.index)}`.toLowerCase();

      return label.includes(query) || atom.element.toLowerCase().includes(query);
    });

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");

      td.colSpan = 5;
      td.className = "atom-list-empty";
      td.textContent = "No matching atoms.";

      tr.appendChild(td);
      el.atomListBody.appendChild(tr);

      return;
    }

    for (const atom of rows) {
      const tr = document.createElement("tr");

      tr.dataset.atomIndex = atom.index;

      if (state.selectedAtoms.has(atom.index)) {
        tr.classList.add("selected");
      }

      tr.innerHTML =
        `<td>${atom.element}${displayIndex(state, atom.index)}</td>` +
        `<td class="el-cell"><span class="el-swatch" style="background:${window.ORBWEB_ELEMENTS.getColor(atom.element)}"></span>${atom.element}</td>` +
        `<td>${atom.x.toFixed(4)}</td>` +
        `<td>${atom.y.toFixed(4)}</td>` +
        `<td>${atom.z.toFixed(4)}</td>`;

      tr.addEventListener("click", () => window.ORBWEB_APP.toggleAtomSelection(atom.index));
      el.atomListBody.appendChild(tr);
    }
  }

  function renderSelectionChips(el, state) {
    el.selectionChips.innerHTML = "";

    if (state.selectedAtoms.size === 0) {
      el.selectionRow.style.display = "none";
      return;
    }

    el.selectionRow.style.display = "";

    let i = 0;

    for (const atomNo of state.selectedAtoms) {
      i++;

      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML =
        `<span class="chip-index">${i}</span>` +
        `${atomLabel(state, atomNo)}` +
        `<span class="chip-remove" data-idx="${atomNo}">\u00d7</span>`;

      el.selectionChips.appendChild(chip);
    }

    el.selectionChips.querySelectorAll(".chip-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.ORBWEB_APP.toggleAtomSelection(parseInt(btn.dataset.idx, 10));
      });
    });
  }

  function renderAoDetail(el, state, aoRows) {
    el.aoDetailBody.innerHTML = "";
    el.aoDetailHead.innerHTML = "";

    if (state.selectedAtoms.size === 0) {
      el.aoDetailEmpty.style.display = "";
      el.aoDetailEmpty.textContent =
        "Select one or more atoms (in the list or in the 3D view) to see their per-AO breakdown across the displayed orbitals.";
      el.aoDetailTable.style.display = "none";

      return;
    }

    if (aoRows.length === 0) {
      el.aoDetailEmpty.style.display = "";
      el.aoDetailEmpty.textContent =
        "No AO contribution of the selected atom(s) clears the current threshold in this orbital range.";
      el.aoDetailTable.style.display = "none";

      return;
    }

    el.aoDetailEmpty.style.display = "none";
    el.aoDetailTable.style.display = "";

    const trHead = document.createElement("tr");

    for (const col of AO_COLUMNS) {
      const th = document.createElement("th");
      th.textContent = col.label;

      if (state.aoSortKey === col.key) {
        th.classList.add(state.aoSortDir === "asc" ? "sort-asc" : "sort-desc");
      }

      th.addEventListener("click", () => {
        if (state.aoSortKey === col.key) {
          state.aoSortDir = state.aoSortDir === "asc" ? "desc" : "asc";
        } else {
          state.aoSortKey = col.key;
          state.aoSortDir = col.key === "orbNum" ? "asc" : "desc";
        }

        window.ORBWEB_APP.renderAll();
      });

      trHead.appendChild(th);
    }

    el.aoDetailHead.appendChild(trHead);

    const sorted = aoRows.slice().sort((a, b) => {
      const va = a[state.aoSortKey];
      const vb = b[state.aoSortKey];

      if (va < vb) return state.aoSortDir === "asc" ? -1 : 1;
      if (va > vb) return state.aoSortDir === "asc" ? 1 : -1;

      return a.orbNum - b.orbNum ||
        a.atomNo - b.atomNo ||
        a.orbital.localeCompare(b.orbital);
    });

    for (const row of sorted) {
      const tr = document.createElement("tr");

      const cells = [
        row.orbNum,
        row.orbEn.toFixed(5),
        row.occ.toFixed(2),
        atomLabel(state, row.atomNo),
        row.orbital,
        row.sum.toFixed(1)
      ];

      for (const val of cells) {
        const td = document.createElement("td");
        td.textContent = val;
        tr.appendChild(td);
      }

      el.aoDetailBody.appendChild(tr);
    }
  }

  return {
    atomLabel,
    displayIndex,
    renderAtomTable,
    renderAtomList,
    renderSelectionChips,
    renderAoDetail
  };
})();