import * as vscode from 'vscode';
import { genericDialect } from '@dbw/core';
import type { Feature } from '../dbw';
import { run } from '../query/run';

/**
 * The SQL documents that Show Compiled SQL opens, and the PRQL each came
 * from.  They are untitled, so they can be edited and run; their name ends
 * in `.prql.sql`, which is what puts the way-back icon on their title bar.
 * Compiling the same PRQL again refreshes its document instead of opening
 * another.
 */
class CompiledDocuments implements vscode.Disposable {
  private readonly sources = new Map<vscode.TextDocument, vscode.TextDocument>();
  private readonly closed = vscode.workspace.onDidCloseTextDocument((doc) => {
    this.sources.delete(doc);
    for (const [sql, prql] of this.sources) if (prql === doc) this.sources.delete(sql);
  });

  async open(prql: vscode.TextDocument, sql: string): Promise<vscode.TextDocument> {
    let doc = [...this.sources].find(([, src]) => src === prql)?.[0];
    if (!doc) {
      const base = prql.uri.path.split('/').pop()?.replace(/\.prql$/, '') || 'query';
      doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`untitled:${base}.prql.sql`));
      this.sources.set(doc, prql);
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), sql);
    await vscode.workspace.applyEdit(edit);
    return doc;
  }

  sourceOf(sql: vscode.TextDocument): vscode.TextDocument | undefined {
    return this.sources.get(sql);
  }

  dispose() { this.closed.dispose(); this.sources.clear(); }
}

/** Running SQL from an editor, and the results beside it. */
export const queryFeature: Feature = (dbw) => queryCommands(dbw, new CompiledDocuments());

const queryCommands = (dbw: Parameters<Feature>[0], compiled: CompiledDocuments) => vscode.Disposable.from(
  vscode.commands.registerCommand('dbw.runStatement', () => run('statement', dbw)),
  vscode.commands.registerCommand('dbw.runAll', () => run('all', dbw)),
  vscode.commands.registerCommand('dbw.chooseConnection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) await dbw.binding.choose(editor.document);
  }),
  vscode.commands.registerCommand('dbw.showCompiledSql', async () => {
    const editor = vscode.window.activeTextEditor;
    const language = editor && dbw.registry.language(editor.document.languageId);
    if (!editor || !language) { vscode.window.showInformationMessage('dbw: this editor is already SQL.'); return; }
    const profile = await dbw.binding.ensure(editor.document);
    if (!profile) return;
    const dialect = dbw.registry.dialectFor(profile) ?? genericDialect;
    const source = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
    let sql: string;
    try { sql = language.compile(source, dialect); } catch (err) { vscode.window.showErrorMessage(`dbw: ${(err as Error).message}`); return; }
    const doc = await compiled.open(editor.document, sql + '\n');
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    await dbw.binding.set(doc, profile);
  }),
  vscode.commands.registerCommand('dbw.showPrqlSource', async () => {
    const editor = vscode.window.activeTextEditor;
    const source = editor && compiled.sourceOf(editor.document);
    if (!source) { vscode.window.showInformationMessage('dbw: this SQL was not compiled from an open PRQL editor.'); return; }
    const shown = vscode.window.visibleTextEditors.find((e) => e.document === source);
    await vscode.window.showTextDocument(source, { viewColumn: shown?.viewColumn ?? vscode.ViewColumn.Beside });
  }),
  compiled,
  vscode.commands.registerCommand('dbw.showResults', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) dbw.results.existing(editor.document)?.reveal();
  }),
);
