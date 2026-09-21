import * as vscode from 'vscode';
import type { Dbw, Feature } from '../dbw';
import { firstLine, type HistoryItem } from '../history';

/** The history view, and getting a past query back into an editor. */
export const historyFeature: Feature = (dbw) => vscode.Disposable.from(
  vscode.window.createTreeView('dbw.history', { treeDataProvider: dbw.history }),
  vscode.commands.registerCommand('dbw.clearHistory', () => dbw.history.clear()),
  vscode.commands.registerCommand('dbw.rerunHistory', (h: HistoryItem) => reopen(dbw, h)),
  vscode.commands.registerCommand('dbw.showHistory', async () => {
    const picked = await vscode.window.showQuickPick(
      dbw.history.list().map((h) => ({ label: firstLine(h.sql), description: h.profileName, detail: new Date(h.at).toLocaleString(), h })),
      { placeHolder: 'A query you ran', matchOnDetail: true },
    );
    if (picked) await reopen(dbw, picked.h);
  }),
);

async function reopen(dbw: Dbw, h: HistoryItem): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: h.sql + '\n' });
  await vscode.window.showTextDocument(doc, { preview: false });
  const profile = dbw.profiles.get(h.profileId);
  if (profile) await dbw.binding.set(doc, profile);
}
