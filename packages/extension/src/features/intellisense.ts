import * as vscode from 'vscode';
import type { Feature } from '../dbw';
import { CompletionProvider, FormattingProvider, HoverProvider } from '../intellisense/providers';

/** Completion, hover and formatting for SQL editors, from the bound connection's dialect and schema. */
export const intellisenseFeature: Feature = (dbw) => {
  let registered: vscode.Disposable[] = [];
  const register = () => {
    for (const d of registered) d.dispose();
    const selector = dbw.registry.editorLanguages().map((language) => ({ language }));
    // Formatting: every dialect's language, and the query languages that can.
    const formattable = [...new Set(['sql', ...dbw.registry.allDialects().map((d) => d.language), ...dbw.registry.allLanguages().filter((l) => l.format).map((l) => l.id)])].map((language) => ({ language }));
    registered = [
      vscode.languages.registerCompletionItemProvider(selector, new CompletionProvider(dbw), '.', ' '),
      vscode.languages.registerHoverProvider(selector, new HoverProvider(dbw)),
      vscode.languages.registerDocumentFormattingEditProvider(formattable, new FormattingProvider(dbw)),
      vscode.languages.registerDocumentRangeFormattingEditProvider(formattable, new FormattingProvider(dbw)),
    ];
  };
  register();
  const onChange = dbw.registry.onDidChange(register);

  // A bound editor warms the schema cache, so the first completion is not the one that waits.
  const warm = (doc: vscode.TextDocument) => {
    const profile = dbw.binding.get(doc);
    if (profile) void dbw.sessions.schema(profile).catch(() => {});
  };
  const onBind = dbw.binding.onDidChange(warm);
  const onEditor = vscode.window.onDidChangeActiveTextEditor((e) => { if (e) warm(e.document); });

  return vscode.Disposable.from(
    onChange, onBind, onEditor,
    { dispose: () => { for (const d of registered) d.dispose(); } },
    vscode.commands.registerCommand('dbw.refreshSchemaCache', async () => {
      const editor = vscode.window.activeTextEditor;
      const profile = editor && dbw.binding.get(editor.document);
      if (!profile) { vscode.window.showInformationMessage('dbw: bind this editor to a connection first.'); return; }
      const tables = await dbw.sessions.schema(profile, true);
      vscode.window.setStatusBarMessage(`dbw: ${tables.length} tables and views known for ${profile.name}`, 4000);
    }),
  );
};
