import * as vscode from 'vscode';
import { genericDialect } from '@dbw/core';
import type { Feature } from '../dbw';
import { run } from '../query/run';

/** Running SQL from an editor, and the results beside it. */
export const queryFeature: Feature = (dbw) => vscode.Disposable.from(
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
    const doc = await vscode.workspace.openTextDocument({ language: dialect.language, content: sql + '\n' });
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    await dbw.binding.set(doc, profile);
  }),
  vscode.commands.registerCommand('dbw.showResults', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) dbw.results.existing(editor.document)?.reveal();
  }),
);
