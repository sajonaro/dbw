import * as vscode from 'vscode';
import type { Registry } from '../registry';
import type { Sessions } from '../connections/sessions';
import type { Binding } from '../binding';
import type { History } from '../history';
import type { Results } from './results';
import { statementAt } from './statements';

export interface RunDeps {
  registry: Registry;
  sessions: Sessions;
  binding: Binding;
  history: History;
  results: Results;
}

/**
 * Run what the editor means: the selection if there is one; otherwise
 * the statement under the cursor (Ctrl+Enter) or the whole document (F5).
 */
export async function run(mode: 'statement' | 'all', deps: RunDeps, editor = vscode.window.activeTextEditor): Promise<void> {
  if (!editor || !deps.registry.isQueryDocument(editor.document)) {
    vscode.window.showInformationMessage('dbw: open a SQL (or PRQL) editor to run a query.');
    return;
  }
  const doc = editor.document;
  const profile = await deps.binding.ensure(doc);
  if (!profile) return;
  const dialect = deps.registry.dialectFor(profile);
  if (!dialect) {
    vscode.window.showErrorMessage(`dbw: no driver '${profile.driver}' is registered for ${profile.name}.`);
    return;
  }

  const language = deps.registry.language(doc.languageId);
  let sql: string;
  if (!editor.selection.isEmpty) {
    sql = doc.getText(editor.selection);
  } else if (mode === 'all' || (language && !language.split)) {
    sql = doc.getText();
  } else {
    const found = statementAt(doc.getText(), doc.offsetAt(editor.selection.active), language?.split ?? dialect.split);
    if (!found) { vscode.window.showInformationMessage('dbw: nothing to run here.'); return; }
    sql = found.text;
    // Show what is about to run, briefly, as a selection would.
    const range = new vscode.Range(doc.positionAt(found.start), doc.positionAt(found.end));
    const flash = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground') });
    editor.setDecorations(flash, [range]);
    setTimeout(() => flash.dispose(), 600);
  }
  if (!sql.trim()) { vscode.window.showInformationMessage('dbw: nothing to run.'); return; }

  const panel = deps.results.for(doc);
  // Another language is compiled into the dialect first; what runs, and what
  // the history keeps, is the SQL.
  if (language) {
    try {
      sql = language.compile(sql, dialect);
    } catch (err) {
      const message = (err as Error).message;
      panel.error(sql, message, profile.name);
      vscode.window.setStatusBarMessage(`dbw: ${message}`, 8000);
      return;
    }
  }
  panel.running(sql);
  const started = performance.now();
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `dbw: running on ${profile.name}` }, async () => {
    try {
      const conn = await deps.sessions.get(profile);
      const results = await conn.query(sql);
      const durationMs = performance.now() - started;
      panel.show(sql, results, profile.name);
      const rows = results.reduce((n, r) => n + r.rows.length, 0);
      const affected = results.reduce((n, r) => n + (r.affected ?? 0), 0);
      vscode.window.setStatusBarMessage(`dbw: ${results.length === 1 && results[0].columns.length === 0 ? `${affected} rows affected` : `${rows} rows`} in ${Math.round(durationMs)} ms`, 5000);
      await deps.history.add({ sql, profileId: profile.id, profileName: profile.name, ok: true, durationMs, rows });
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      panel.error(sql, message, profile.name);
      vscode.window.setStatusBarMessage(`dbw: error: ${message}`, 8000);
      await deps.history.add({ sql, profileId: profile.id, profileName: profile.name, ok: false, durationMs: performance.now() - started, error: message });
    }
  });
}
