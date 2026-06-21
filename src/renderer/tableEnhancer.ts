// Browser-only "rich table" layer. Upgrades the plain HTML tables that
// markdown-it emits into interactive grids: horizontal scrolling for wide
// tables, drag-to-resize columns and rows, click-to-sort headers (3-state),
// and an optional per-column filter row.
//
// Crucially this is a *non-destructive* enhancement: it keeps the exact
// `<table>/<thead>/<tbody>/<tr>/<td>` structure the review-comment system
// anchors to, instead of re-rendering into virtualized <div> rows like a
// heavy grid library would. That is what lets per-cell comments keep working
// while still gaining sort/filter — every cell stays a real DOM cell, and each
// row carries a stable `data-mdr-row` identity so a comment anchored to a cell
// follows that cell across sorting/filtering.
import { t } from './i18n';

const MIN_COL_WIDTH = 56;
const MIN_ROW_HEIGHT = 28;
const ENHANCED_FLAG = 'mdrEnhanced';

type SortDir = 'asc' | 'desc' | 'none';

const MAX_AUTOFIT_WIDTH = 640;

const ICONS = {
  filter:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>',
  reset:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3"/></svg>',
  autofit:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6L4 12l5 6M15 6l5 6-5 6M4 12h16"/></svg>',
  columns:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5h16v14H4zM10 5v14M16 5v14"/></svg>',
};

/**
 * Enhances every Markdown table inside `root` in place. Safe to call after each
 * re-render (already-enhanced tables are skipped). `onLayoutChange` is invoked
 * whenever a sort/filter/resize shifts cell geometry so the host can reposition
 * any floating UI (e.g. an open comment popup).
 */
export function enhanceTables(
  root: HTMLElement,
  onLayoutChange?: () => void
): void {
  const tables = Array.from(
    root.querySelectorAll<HTMLTableElement>('table[data-source-line]')
  );
  for (const table of tables) {
    if (table.classList.contains('frontmatter')) {
      continue;
    }
    if ((table.dataset as DOMStringMap)[ENHANCED_FLAG]) {
      continue;
    }
    try {
      enhanceTable(table, onLayoutChange);
    } catch {
      /* never let a single malformed table break the whole render */
    }
  }
}

// A single, shared "click outside to close" handler for every table's column
// visibility menu. Bound once for the whole document (not per table) so that
// repeated re-renders — which discard and re-enhance tables — never accumulate
// orphaned listeners that retain detached DOM.
let columnMenuDismisserBound = false;
function ensureColumnMenuDismisser(): void {
  if (columnMenuDismisserBound) {
    return;
  }
  columnMenuDismisserBound = true;
  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    document
      .querySelectorAll<HTMLElement>('.mdr-col-menuwrap')
      .forEach((wrap) => {
        const menu = wrap.querySelector<HTMLElement>('.mdr-col-menu');
        if (!menu || menu.hidden || wrap.contains(target)) {
          return;
        }
        menu.hidden = true;
        const btn = wrap.querySelector<HTMLElement>('button');
        btn?.classList.remove('active');
        btn?.setAttribute('aria-expanded', 'false');
      });
  });
}

function enhanceTable(
  table: HTMLTableElement,
  onLayoutChange?: () => void
): void {
  const maybeHeaderRow = table.tHead?.rows[0];
  const maybeBody = table.tBodies[0];
  if (!maybeHeaderRow || !maybeBody) {
    return;
  }
  // Aliased to non-nullable locals so the narrowing survives into the nested
  // helper closures below (TS doesn't carry control-flow narrowing into them).
  const headerRow: HTMLTableRowElement = maybeHeaderRow;
  const body: HTMLTableSectionElement = maybeBody;
  (table.dataset as DOMStringMap)[ENHANCED_FLAG] = '1';
  table.classList.add('mdr-rich-table');

  // 1. Stamp a stable, sort/filter-proof identity onto every row. This is the
  //    same value the comment system stores in `thread.cell.row`, captured here
  //    BEFORE we ever reorder rows so it never drifts.
  Array.from(table.rows).forEach((row) => {
    if (!row.hasAttribute('data-mdr-row')) {
      row.setAttribute('data-mdr-row', String(row.rowIndex));
    }
  });

  const colCount = headerRow.cells.length;

  // 2. Lock columns to explicit pixel widths via a <colgroup> + fixed layout so
  //    they can be dragged and so a wide table overflows (and scrolls) instead
  //    of squeezing prose.
  const colgroup = document.createElement('colgroup');
  const cols: HTMLTableColElement[] = [];
  const widths = measureColumnWidths(headerRow, colCount);
  for (let i = 0; i < colCount; i++) {
    const col = document.createElement('col');
    col.style.setProperty('width', `${widths[i]}px`, 'important');
    colgroup.appendChild(col);
    cols.push(col);
  }
  table.insertBefore(colgroup, table.firstChild);
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  table.style.setProperty('width', `${totalWidth}px`, 'important');
  table.style.setProperty('table-layout', 'fixed', 'important');
  table.style.setProperty('max-width', 'none', 'important');
  table.style.setProperty('display', 'table', 'important');
  table.style.setProperty('margin', '0', 'important');

  // 3. Wrap in a scroll container + toolbar.
  const block = document.createElement('div');
  block.className = 'mdr-table-block';
  const scroll = document.createElement('div');
  scroll.className = 'mdr-table-scroll';
  table.parentNode?.insertBefore(block, table);
  const toolbar = buildToolbar();
  block.appendChild(toolbar.el);
  block.appendChild(scroll);
  scroll.appendChild(table);

  // Column visibility + width helpers (shared by the toolbar and resizers).
  const hiddenCols = new Set<number>();

  function recomputeWidth(): void {
    const total = cols.reduce(
      (sum, c, i) =>
        hiddenCols.has(i) ? sum : sum + (parseFloat(c.style.width) || 0),
      0
    );
    table.style.setProperty('width', `${total}px`, 'important');
  }

  function setColumnHidden(colIndex: number, hidden: boolean): void {
    if (hidden) {
      hiddenCols.add(colIndex);
    } else {
      hiddenCols.delete(colIndex);
    }
    cols[colIndex].style.display = hidden ? 'none' : '';
    for (const row of Array.from(table.rows)) {
      const cell = row.cells[colIndex] as HTMLElement | undefined;
      if (cell) {
        cell.style.display = hidden ? 'none' : '';
      }
    }
    recomputeWidth();
  }

  // Measures the widest cell in a column (header + data, not the filter row)
  // by briefly switching to auto layout + nowrap, then snaps the column to it.
  function autoFitColumn(colIndex: number): void {
    const rows = Array.from(table.rows).filter(
      (r) => !r.classList.contains('mdr-filter-row')
    );
    const cells = rows
      .map((r) => r.cells[colIndex] as HTMLElement | undefined)
      .filter((c): c is HTMLElement => !!c);
    if (!cells.length) {
      return;
    }
    const prevWS = cells.map((c) => c.style.whiteSpace);
    const prevLayout = table.style.getPropertyValue('table-layout');
    cells.forEach((c) =>
      c.style.setProperty('white-space', 'nowrap', 'important')
    );
    cols[colIndex].style.removeProperty('width');
    table.style.setProperty('table-layout', 'auto', 'important');
    table.style.removeProperty('width');
    let max = MIN_COL_WIDTH;
    for (const c of cells) {
      max = Math.max(max, Math.ceil(c.getBoundingClientRect().width));
    }
    max = Math.min(max + 4, MAX_AUTOFIT_WIDTH);
    cells.forEach((c, i) => {
      if (prevWS[i]) {
        c.style.setProperty('white-space', prevWS[i]);
      } else {
        c.style.removeProperty('white-space');
      }
    });
    table.style.setProperty('table-layout', prevLayout || 'fixed', 'important');
    cols[colIndex].style.setProperty('width', `${max}px`, 'important');
    recomputeWidth();
  }

  function autoFitAll(): void {
    for (let i = 0; i < colCount; i++) {
      if (!hiddenCols.has(i)) {
        autoFitColumn(i);
      }
    }
    onLayoutChange?.();
  }

  function buildColumnsMenu(): void {
    toolbar.columnsMenu.innerHTML = '';
    Array.from(headerRow.cells).forEach((th, i) => {
      const labelText =
        (th.querySelector('.mdr-th-label')?.textContent ?? '').trim() ||
        `#${i + 1}`;
      const item = document.createElement('label');
      item.className = 'mdr-col-menu-item';
      item.setAttribute('role', 'menuitemcheckbox');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !hiddenCols.has(i);
      cb.addEventListener('change', () => {
        // Keep at least one column visible.
        if (!cb.checked && hiddenCols.size >= colCount - 1) {
          cb.checked = true;
          return;
        }
        setColumnHidden(i, !cb.checked);
        onLayoutChange?.();
      });
      const span = document.createElement('span');
      span.textContent = labelText;
      item.appendChild(cb);
      item.appendChild(span);
      toolbar.columnsMenu.appendChild(item);
    });
  }

  // 4. Sorting + column resize on each header cell.
  let sortCol = -1;
  let sortDir: SortDir = 'none';

  function applySort(colIndex: number): void {
    if (sortCol === colIndex) {
      sortDir = sortDir === 'none' ? 'asc' : sortDir === 'asc' ? 'desc' : 'none';
    } else {
      sortCol = colIndex;
      sortDir = 'asc';
    }
    sortRows(body, colIndex, sortDir);
    updateSortIndicators(headerRow, sortCol, sortDir);
    onLayoutChange?.();
  }

  Array.from(headerRow.cells).forEach((th, colIndex) => {
    th.classList.add('mdr-th');
    const label = document.createElement('span');
    label.className = 'mdr-th-label';
    // Move the header's existing content into a label span so the sort
    // indicator and resize grip can sit beside it without being reordered.
    while (th.firstChild) {
      label.appendChild(th.firstChild);
    }
    const ind = document.createElement('span');
    ind.className = 'mdr-sort-ind';
    ind.setAttribute('aria-hidden', 'true');
    th.appendChild(label);
    th.appendChild(ind);

    th.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          '.mdr-col-resizer, .mdr-row-resizer, .mdr-cell-marker, .mdr-cell-add'
        )
      ) {
        return;
      }
      applySort(colIndex);
    });

    addColResizer(th, cols[colIndex], table, cols, hiddenCols, onLayoutChange, () =>
      autoFitColumn(colIndex)
    );
  });

  // 5. Row-height resize grip in the first cell of every row.
  Array.from(table.rows).forEach((row) => {
    if (row.cells.length) {
      addRowResizer(row, row.cells[0] as HTMLElement, onLayoutChange);
    }
  });

  // 6. Per-column filter row (hidden until the funnel is toggled).
  const filterRow = buildFilterRow(table, body, colCount, () => {
    updateInfo();
    onLayoutChange?.();
  });
  table.tHead?.appendChild(filterRow);

  // 7. Toolbar wiring: filter toggle + reset.
  let filtersVisible = false;
  toolbar.filterBtn.addEventListener('click', () => {
    filtersVisible = !filtersVisible;
    filterRow.classList.toggle('mdr-hidden', !filtersVisible);
    toolbar.filterBtn.classList.toggle('active', filtersVisible);
    toolbar.filterBtn.setAttribute('aria-pressed', String(filtersVisible));
    if (filtersVisible) {
      filterRow.querySelector('input')?.focus();
    }
    onLayoutChange?.();
  });
  filterRow.classList.add('mdr-hidden');

  // 8. Auto-fit + column show/hide.
  toolbar.autofitBtn.addEventListener('click', () => autoFitAll());

  buildColumnsMenu();
  toolbar.columnsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = toolbar.columnsMenu.hidden;
    toolbar.columnsMenu.hidden = !open;
    toolbar.columnsBtn.classList.toggle('active', open);
    toolbar.columnsBtn.setAttribute('aria-expanded', String(open));
  });
  // A single document-level dismisser handles every table's column menu (see
  // ensureColumnMenuDismisser) so re-renders don't leak one listener per table.
  ensureColumnMenuDismisser();

  toolbar.resetBtn.addEventListener('click', () => {
    sortCol = -1;
    sortDir = 'none';
    restoreOriginalOrder(body);
    updateSortIndicators(headerRow, -1, 'none');
    filterRow.querySelectorAll('input').forEach((input) => {
      input.value = '';
    });
    applyFilters(body, []);
    for (let i = 0; i < colCount; i++) {
      if (hiddenCols.has(i)) {
        setColumnHidden(i, false);
      }
    }
    buildColumnsMenu();
    updateInfo();
    onLayoutChange?.();
  });

  function updateInfo(): void {
    const total = body.rows.length;
    const visible = Array.from(body.rows).filter(
      (r) => r.style.display !== 'none'
    ).length;
    toolbar.info.textContent =
      visible === total
        ? t('tableRowCount', { n: total })
        : t('tableRowFiltered', { shown: visible, total });
  }

  updateInfo();
}

// Measures the natural rendered width of each column from the header cells
// (the table is still in its pre-enhancement, content-sized layout here).
function measureColumnWidths(
  headerRow: HTMLTableRowElement,
  colCount: number
): number[] {
  const widths: number[] = [];
  for (let i = 0; i < colCount; i++) {
    const cell = headerRow.cells[i] as HTMLElement | undefined;
    const w = cell ? Math.ceil(cell.getBoundingClientRect().width) : 120;
    widths.push(Math.max(MIN_COL_WIDTH, w || 120));
  }
  return widths;
}

interface Toolbar {
  el: HTMLElement;
  filterBtn: HTMLButtonElement;
  autofitBtn: HTMLButtonElement;
  columnsBtn: HTMLButtonElement;
  columnsMenu: HTMLElement;
  resetBtn: HTMLButtonElement;
  info: HTMLElement;
}

function toolButton(icon: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mdr-tbtn';
  btn.title = label;
  btn.innerHTML = icon + `<span>${label}</span>`;
  return btn;
}

function buildToolbar(): Toolbar {
  const el = document.createElement('div');
  el.className = 'mdr-table-toolbar';

  const filterBtn = toolButton(ICONS.filter, t('tableFilter'));
  filterBtn.setAttribute('aria-pressed', 'false');

  const autofitBtn = toolButton(ICONS.autofit, t('tableAutofit'));

  // Columns show/hide lives in a small popover anchored to its button.
  const columnsWrap = document.createElement('span');
  columnsWrap.className = 'mdr-col-menuwrap';
  const columnsBtn = toolButton(ICONS.columns, t('tableColumns'));
  columnsBtn.setAttribute('aria-haspopup', 'true');
  columnsBtn.setAttribute('aria-expanded', 'false');
  const columnsMenu = document.createElement('div');
  columnsMenu.className = 'mdr-col-menu';
  columnsMenu.setAttribute('role', 'menu');
  columnsMenu.hidden = true;
  columnsWrap.appendChild(columnsBtn);
  columnsWrap.appendChild(columnsMenu);

  const resetBtn = toolButton(ICONS.reset, t('tableReset'));

  const info = document.createElement('span');
  info.className = 'mdr-table-info';

  el.appendChild(filterBtn);
  el.appendChild(autofitBtn);
  el.appendChild(columnsWrap);
  el.appendChild(resetBtn);
  el.appendChild(info);
  return { el, filterBtn, autofitBtn, columnsBtn, columnsMenu, resetBtn, info };
}

function buildFilterRow(
  table: HTMLTableElement,
  body: HTMLTableSectionElement,
  colCount: number,
  onChange: () => void
): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = 'mdr-filter-row';
  const values: string[] = new Array(colCount).fill('');
  for (let i = 0; i < colCount; i++) {
    const cell = document.createElement('th');
    cell.className = 'mdr-filter-cell';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mdr-filter-input';
    input.placeholder = t('tableFilterPlaceholder');
    input.setAttribute('aria-label', t('tableFilterColumn', { n: i + 1 }));
    const colIndex = i;
    input.addEventListener('input', () => {
      values[colIndex] = input.value.trim().toLowerCase();
      applyFilters(body, values);
      onChange();
    });
    // Don't let clicks in the filter bubble up to header sorting.
    input.addEventListener('click', (e) => e.stopPropagation());
    cell.appendChild(input);
    row.appendChild(cell);
  }
  return row;
}

function cellText(row: HTMLTableRowElement, colIndex: number): string {
  const cell = row.cells[colIndex];
  return (cell?.textContent ?? '').trim();
}

function applyFilters(
  body: HTMLTableSectionElement,
  values: string[]
): void {
  const hasFilter = values.some((v) => v);
  for (const row of Array.from(body.rows)) {
    if (!hasFilter) {
      row.style.display = '';
      continue;
    }
    const match = values.every((v, col) =>
      v ? cellText(row, col).toLowerCase().includes(v) : true
    );
    row.style.display = match ? '' : 'none';
  }
}

// Numeric when both look like numbers; otherwise a locale-aware string compare.
function compareValues(a: string, b: string): number {
  const na = parseFloat(a.replace(/[, ]/g, ''));
  const nb = parseFloat(b.replace(/[, ]/g, ''));
  const aNum = a !== '' && !Number.isNaN(na);
  const bNum = b !== '' && !Number.isNaN(nb);
  if (aNum && bNum) {
    return na - nb;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function sortRows(
  body: HTMLTableSectionElement,
  colIndex: number,
  dir: SortDir
): void {
  if (dir === 'none') {
    restoreOriginalOrder(body);
    return;
  }
  const rows = Array.from(body.rows);
  const factor = dir === 'asc' ? 1 : -1;
  rows.sort(
    (a, b) => compareValues(cellText(a, colIndex), cellText(b, colIndex)) * factor
  );
  // Re-appending in the new order moves the existing <tr> nodes (and any comment
  // markers nested inside their cells) without recreating them.
  for (const row of rows) {
    body.appendChild(row);
  }
}

function restoreOriginalOrder(body: HTMLTableSectionElement): void {
  const rows = Array.from(body.rows);
  rows.sort(
    (a, b) =>
      Number(a.getAttribute('data-mdr-row') ?? 0) -
      Number(b.getAttribute('data-mdr-row') ?? 0)
  );
  for (const row of rows) {
    body.appendChild(row);
  }
}

function updateSortIndicators(
  headerRow: HTMLTableRowElement,
  sortCol: number,
  dir: SortDir
): void {
  Array.from(headerRow.cells).forEach((th, i) => {
    const ind = th.querySelector('.mdr-sort-ind');
    if (!ind) {
      return;
    }
    if (i === sortCol && dir !== 'none') {
      ind.textContent = dir === 'asc' ? '▲' : '▼';
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    } else {
      ind.textContent = '';
      th.removeAttribute('aria-sort');
    }
  });
}

function addColResizer(
  th: HTMLTableCellElement,
  col: HTMLTableColElement,
  table: HTMLTableElement,
  allCols: HTMLTableColElement[],
  hiddenCols: Set<number>,
  onLayoutChange?: () => void,
  onAutoFit?: () => void
): void {
  const grip = document.createElement('span');
  grip.className = 'mdr-col-resizer';
  grip.setAttribute('aria-hidden', 'true');
  grip.title = t('tableAutofitHint');
  th.appendChild(grip);

  let startX = 0;
  let startWidth = 0;

  const onMove = (e: PointerEvent): void => {
    const dx = e.clientX - startX;
    const next = Math.max(MIN_COL_WIDTH, startWidth + dx);
    col.style.setProperty('width', `${next}px`, 'important');
    const total = allCols.reduce(
      (sum, c, i) =>
        hiddenCols.has(i) ? sum : sum + (parseFloat(c.style.width) || 0),
      0
    );
    table.style.setProperty('width', `${total}px`, 'important');
    onLayoutChange?.();
  };
  const onUp = (e: PointerEvent): void => {
    grip.releasePointerCapture(e.pointerId);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.body.classList.remove('mdr-col-resizing');
  };
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startWidth = parseFloat(col.style.width) || th.getBoundingClientRect().width;
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('mdr-col-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  grip.addEventListener('click', (e) => e.stopPropagation());
  // Double-click the grip to auto-fit this column to its widest cell.
  grip.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onAutoFit?.();
    onLayoutChange?.();
  });
}

function addRowResizer(
  row: HTMLTableRowElement,
  firstCell: HTMLElement,
  onLayoutChange?: () => void
): void {
  const grip = document.createElement('span');
  grip.className = 'mdr-row-resizer';
  grip.setAttribute('aria-hidden', 'true');
  firstCell.appendChild(grip);

  let startY = 0;
  let startHeight = 0;

  const onMove = (e: PointerEvent): void => {
    const dy = e.clientY - startY;
    const next = Math.max(MIN_ROW_HEIGHT, startHeight + dy);
    row.style.setProperty('height', `${next}px`);
    onLayoutChange?.();
  };
  const onUp = (e: PointerEvent): void => {
    grip.releasePointerCapture(e.pointerId);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.body.classList.remove('mdr-row-resizing');
  };
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startY = e.clientY;
    startHeight = row.getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('mdr-row-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  grip.addEventListener('click', (e) => e.stopPropagation());
}
