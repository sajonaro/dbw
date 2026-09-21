import * as vscode from 'vscode';
import type { Profile, ProfileStore } from './connections/store';

const KEY = 'dbw.bindings';

/**
 * Which connection each SQL editor talks to.  Shown in the status bar,
 * chosen from there or with Ctrl+Alt+C, remembered per file across
 * sessions; an untitled editor is bound only for as long as it lives.
 */
export class Binding implements vscode.Disposable {
  private readonly bound = new Map<string, string>();
  private readonly item: vscode.StatusBarItem;
  private readonly changed = new vscode.EventEmitter<vscode.TextDocument>();
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly store: ProfileStore, private readonly state: vscode.Memento, private readonly isQuery: (doc: vscode.TextDocument) => boolean) {
    for (const [uri, id] of Object.entries(state.get<Record<string, string>>(KEY, {}))) this.bound.set(uri, id);
    this.item = vscode.window.createStatusBarItem('dbw.connection', vscode.StatusBarAlignment.Left, 50);
    this.item.command = 'dbw.chooseConnection';
    this.item.name = 'dbw connection';
    this.subscriptions = [
      this.item,
      this.changed,
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.workspace.onDidCloseTextDocument((doc) => { if (doc.isUntitled) this.bound.delete(doc.uri.toString()); }),
      store.onDidChange(() => this.update()),
    ];
    this.update();
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
  }

  get(doc: vscode.TextDocument): Profile | undefined {
    const id = this.bound.get(doc.uri.toString());
    return id ? this.store.get(id) : undefined;
  }

  async set(doc: vscode.TextDocument, profile: Profile | undefined): Promise<void> {
    const key = doc.uri.toString();
    if (profile) this.bound.set(key, profile.id); else this.bound.delete(key);
    if (!doc.isUntitled) {
      const persisted = this.state.get<Record<string, string>>(KEY, {});
      if (profile) persisted[key] = profile.id; else delete persisted[key];
      await this.state.update(KEY, persisted);
    }
    this.update();
    this.changed.fire(doc);
  }

  /** The editor's connection, asking for one if it has none. */
  async ensure(doc: vscode.TextDocument): Promise<Profile | undefined> {
    return this.get(doc) ?? this.choose(doc);
  }

  async choose(doc: vscode.TextDocument): Promise<Profile | undefined> {
    const profiles = this.store.list();
    const current = this.get(doc);
    type Item = vscode.QuickPickItem & { profile?: Profile; add?: boolean };
    const items: Item[] = profiles.map((p) => ({ label: p.name, description: p.driver, picked: p.id === current?.id, profile: p }));
    items.push({ label: '$(add) Add connection…', add: true });
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Connection for this editor' });
    if (!picked) return undefined;
    if (picked.add) {
      await vscode.commands.executeCommand('dbw.addConnection');
      const added = this.store.list().find((p) => !profiles.some((q) => q.id === p.id));
      if (!added) return undefined;
      await this.set(doc, added);
      return added;
    }
    await this.set(doc, picked.profile);
    return picked.profile;
  }

  private update(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isQuery(editor.document)) { this.item.hide(); return; }
    const profile = this.get(editor.document);
    this.item.text = profile ? `$(database) ${profile.name}` : '$(database) dbw: no connection';
    this.item.tooltip = profile ? `Queries in this editor run on ${profile.name}. Click to change.` : 'Click to choose a connection for this editor';
    this.item.show();
  }
}
