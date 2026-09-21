import * as vscode from 'vscode';
import type { Dbw, Feature } from '../dbw';
import { Explorer, type Element } from '../explorer';

/** The object explorer view and what its nodes offer. */
export const explorerFeature: Feature = (dbw) => {
  const explorer = new Explorer(dbw.registry, dbw.profiles, dbw.sessions);
  const view = vscode.window.createTreeView('dbw.explorer', { treeDataProvider: explorer, showCollapseAll: true });

  const nameOf = (e: Element): string | undefined => {
    if (e.type !== 'node') return undefined;
    const dialect = dbw.registry.dialectFor(e.profile);
    if (e.node.table && dialect) return dialect.qualify(e.node.table);
    return e.node.name;
  };

  return vscode.Disposable.from(
    view,
    explorer,
    vscode.commands.registerCommand('dbw.refresh', (e?: Element) => {
      if (e && e.type !== 'error') void dbw.sessions.schema(e.profile, true).catch(() => {});
      explorer.refresh(e && e.type === 'profile' ? e : undefined);
    }),
    vscode.commands.registerCommand('dbw.newQuery', async (e?: Element) => {
      const profile = e && e.type !== 'error' ? e.profile : await dbw.binding.choose(await untitledSql(''));
      if (!profile) return;
      const doc = e ? await untitledSql('') : vscode.window.activeTextEditor!.document;
      await dbw.binding.set(doc, profile);
    }),
    vscode.commands.registerCommand('dbw.selectTop', async (e?: Element) => {
      if (!e || e.type !== 'node' || !e.node.table) return;
      const dialect = dbw.registry.dialectFor(e.profile);
      if (!dialect) return;
      const limit = vscode.workspace.getConfiguration('dbw').get<number>('selectTopLimit', 100);
      const doc = await untitledSql(dialect.selectFrom(e.node.table, limit) + '\n');
      await dbw.binding.set(doc, e.profile);
      await vscode.commands.executeCommand('dbw.runAll');
    }),
    vscode.commands.registerCommand('dbw.copyName', async (e?: Element) => {
      const name = e && nameOf(e);
      if (name) await vscode.env.clipboard.writeText(name);
    }),
    vscode.commands.registerCommand('dbw.insertName', async (e?: Element) => {
      const name = e && nameOf(e);
      const editor = vscode.window.activeTextEditor;
      if (name && editor) await editor.edit((b) => b.insert(editor.selection.active, name));
    }),
  );
};

async function untitledSql(content: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument({ language: 'sql', content });
  await vscode.window.showTextDocument(doc, { preview: false });
  return doc;
}
