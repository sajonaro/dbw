/**
 * The results page: a grid per result set and a messages tab, in the
 * webview beside the editor.  It receives plain data and knows nothing
 * about databases; what it knows about is showing a table well.
 */
import { AllCommunityModule, ModuleRegistry, createGrid, themeQuartz, type GridOptions } from 'ag-grid-community';
import type { FromWebview, GridResult, ToWebview } from '../src/query/protocol';

ModuleRegistry.registerModules([AllCommunityModule]);

type Result = GridResult;

declare function acquireVsCodeApi(): { postMessage(m: FromWebview): void };
const vscode = acquireVsCodeApi();

/**
 * A view of a run: something with a tab, that can mount into the main
 * area and tear itself down.  The grid and the messages are two; a chart
 * would be a third, added to `viewsFor` and nowhere else.
 */
interface View {
  label: string;
  count?: string;
  /** Actions for the toolbar while this view is shown. */
  actions: { label: string; run: () => void }[];
  /** Mounts into `el` and writes the status line; returns the teardown. */
  mount(el: HTMLElement, status: HTMLElement): () => void;
}

const theme = themeQuartz.withParams({
  backgroundColor: 'var(--vscode-editor-background)',
  foregroundColor: 'var(--vscode-editor-foreground)',
  headerBackgroundColor: 'var(--vscode-editorWidget-background)',
  headerTextColor: 'var(--vscode-editor-foreground)',
  borderColor: 'var(--vscode-panel-border, #444)',
  rowHoverColor: 'var(--vscode-list-hoverBackground)',
  selectedRowBackgroundColor: 'var(--vscode-list-activeSelectionBackground)',
  rangeSelectionBorderColor: 'var(--vscode-focusBorder)',
  accentColor: 'var(--vscode-focusBorder)',
  fontFamily: 'var(--vscode-editor-font-family)',
  fontSize: 12,
  rowHeight: 24,
  headerHeight: 26,
  spacing: 4,
  wrapperBorderRadius: 0,
});

const style = document.createElement('style');
style.textContent = `
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  #app { display: flex; flex-direction: column; height: 100%; }
  .bar { flex: none; display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border, #444); background: var(--vscode-editorWidget-background); }
  .tab { padding: 3px 10px; border: 1px solid transparent; border-radius: 3px; cursor: pointer; color: var(--vscode-descriptionForeground); }
  .tab.active { color: var(--vscode-foreground); background: var(--vscode-editor-background); border-color: var(--vscode-panel-border, #444); }
  .tab .n { opacity: 0.7; margin-left: 4px; }
  .spacer { flex: 1; }
  button { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; border-radius: 3px; padding: 3px 10px; cursor: pointer; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .main { flex: 1; min-height: 0; position: relative; }
  .grid { position: absolute; inset: 0; }
  .messages { position: absolute; inset: 0; overflow: auto; padding: 8px 12px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre-wrap; }
  .messages .err { color: var(--vscode-errorForeground); }
  .messages .sql { opacity: 0.7; margin-bottom: 8px; }
  .status { flex: none; display: flex; gap: 16px; padding: 3px 10px; border-top: 1px solid var(--vscode-panel-border, #444); color: var(--vscode-descriptionForeground); }
  .null { color: var(--vscode-descriptionForeground); font-style: italic; }
  .empty { display: flex; height: 100%; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); }
`;
document.head.appendChild(style);

const app = document.getElementById('app')!;
app.innerHTML = `
  <div class="bar" id="tabs"></div>
  <div class="main" id="main"><div class="empty">Run a query with Ctrl+Enter (statement) or F5 (all).</div></div>
  <div class="status" id="status"></div>
`;
const tabsEl = document.getElementById('tabs')!;
const mainEl = document.getElementById('main')!;
const statusEl = document.getElementById('status')!;

let current: ToWebview | undefined;
let views: View[] = [];
let active = 0;
let teardown: (() => void) | undefined;

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  current = e.data;
  views = viewsFor(current);
  active = current.type === 'error' ? views.length - 1 : 0;
  render();
});

/** The views a run has: one grid per result set, then the messages. */
function viewsFor(m: ToWebview): View[] {
  if (m.type === 'running') return [runningView(m.sql)];
  const grids = m.type === 'results' ? m.results.filter((r) => r.columns.length > 0).map((r, i) => gridView(r, i, m.connection)) : [];
  return [...grids, messagesView(m)];
}

function render(): void {
  teardown?.();
  teardown = undefined;
  tabsEl.innerHTML = '';
  mainEl.innerHTML = '';
  statusEl.textContent = '';
  if (views.length === 0) return;
  views.forEach((v, i) => {
    const el = document.createElement('span');
    el.className = 'tab' + (i === active ? ' active' : '');
    el.innerHTML = escape(v.label) + (v.count !== undefined ? `<span class="n">${escape(v.count)}</span>` : '');
    el.addEventListener('click', () => { active = i; render(); });
    tabsEl.appendChild(el);
  });
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  tabsEl.appendChild(spacer);
  const view = views[active];
  for (const a of view.actions) tabsEl.appendChild(button(a.label, a.run));
  teardown = view.mount(mainEl, statusEl);
}

function runningView(sql: string): View {
  return {
    label: 'Running…', actions: [],
    mount(el, status) { el.innerHTML = '<div class="empty">Running…</div>'; status.textContent = firstLine(sql); return () => {}; },
  };
}

function gridView(r: Result, index: number, connection: string): View {
  return {
    label: `Result ${index + 1}`,
    count: String(r.totalRows),
    actions: [
      { label: 'Copy as JSON', run: () => copyJson(r) },
      { label: 'Export CSV', run: () => exportCsv(r, index) },
    ],
    mount(el, status) {
      const div = document.createElement('div');
      div.className = 'grid';
      el.appendChild(div);
      const options: GridOptions = {
        theme,
        columnDefs: r.columns.map((c, i) => ({
          headerName: c.name || `column ${i + 1}`,
          headerTooltip: c.type,
          colId: String(i),
          valueGetter: (p) => (p.data as unknown[])[i],
          cellRenderer: (p: { value: unknown }) => (p.value === null ? '<span class="null">NULL</span>' : escape(String(p.value))),
          tooltipValueGetter: (p) => (p.value === null ? 'NULL' : String(p.value)),
        })),
        rowData: r.rows,
        defaultColDef: { resizable: true, sortable: true, filter: true, minWidth: 60, maxWidth: 600 },
        enableCellTextSelection: true,
        ensureDomOrder: true,
        animateRows: false,
        rowSelection: { mode: 'multiRow', checkboxes: false, headerCheckbox: false, enableClickSelection: true },
        onCellKeyDown: (e) => {
          const ev = e.event as KeyboardEvent | undefined;
          if (ev && (ev.ctrlKey || ev.metaKey) && ev.key === 'c') {
            const selected = e.api.getSelectedRows() as unknown[][];
            const text = selected.length > 1 ? selected.map((row) => row.map(csvCell).join('\t')).join('\n') : String((e as { value?: unknown }).value ?? '');
            vscode.postMessage({ type: 'copy', text });
          }
        },
        onGridReady: (e) => { e.api.autoSizeAllColumns(); },
      };
      const grid = createGrid(div, options);
      const shown = r.rows.length === r.totalRows ? `${r.totalRows} rows` : `${r.rows.length} of ${r.totalRows} rows shown`;
      status.innerHTML = `<span>${shown}</span><span>${Math.round(r.durationMs)} ms</span><span>${escape(connection)}</span><span class="spacer"></span><span>Ctrl+C copies the cell, or the selected rows</span>`;
      return () => grid.destroy();
    },
  };
}

function messagesView(m: ToWebview & { type: 'results' | 'error' }): View {
  return {
    label: 'Messages', actions: [],
    mount(el, status) {
      const div = document.createElement('div');
      div.className = 'messages';
      const lines: string[] = [`<div class="sql">${escape(firstLine(m.sql))}</div>`];
      if (m.type === 'error') {
        lines.push(`<div class="err">${escape(m.message)}</div>`);
      } else {
        let n = 0;
        for (const r of m.results) {
          if (r.columns.length > 0) { n++; lines.push(`<div>Result ${n}: ${r.totalRows} rows, ${r.columns.length} columns (${Math.round(r.durationMs)} ms)</div>`); }
          else lines.push(`<div>${escape(r.command ? r.command + ': ' : '')}${r.affected ?? 0} rows affected (${Math.round(r.durationMs)} ms)</div>`);
        }
        if (m.results.length === 0) lines.push('<div>Done. No results.</div>');
      }
      div.innerHTML = lines.join('');
      el.appendChild(div);
      status.innerHTML = `<span>${escape(m.connection)}</span>`;
      return () => {};
    },
  };
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function copyJson(r: Result): void {
  const objects = r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]])));
  vscode.postMessage({ type: 'copy', text: JSON.stringify(objects, null, 2) });
}

function exportCsv(r: Result, index: number): void {
  const lines = [r.columns.map((c) => csvCell(c.name)).join(',')];
  for (const row of r.rows) lines.push(row.map(csvCell).join(','));
  vscode.postMessage({ type: 'save', name: `result-${index + 1}.csv`, text: lines.join('\n') + '\n' });
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r\t]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function firstLine(sql: string): string {
  const line = sql.trim().split(/\r?\n/).find((l) => l.trim()) ?? '';
  return line.length > 120 ? line.slice(0, 117) + '…' : line;
}

vscode.postMessage({ type: 'ready' });
