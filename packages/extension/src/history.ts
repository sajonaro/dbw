import * as vscode from 'vscode';

export interface HistoryItem {
  id: string;
  sql: string;
  profileId: string;
  profileName: string;
  at: string;
  ok: boolean;
  durationMs: number;
  rows?: number;
  error?: string;
}

const KEY = 'dbw.history';

/** What was run, most recent first, kept across sessions in global state. */
export class History implements vscode.TreeDataProvider<HistoryItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly state: vscode.Memento) {}

  list(): HistoryItem[] {
    return this.state.get<HistoryItem[]>(KEY, []);
  }

  async add(item: Omit<HistoryItem, 'id' | 'at'>): Promise<void> {
    const limit = vscode.workspace.getConfiguration('dbw').get<number>('history.limit', 200);
    const list = [{ ...item, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString() }, ...this.list()];
    await this.state.update(KEY, list.slice(0, limit));
    this.changed.fire();
  }

  async clear(): Promise<void> {
    await this.state.update(KEY, []);
    this.changed.fire();
  }

  getTreeItem(h: HistoryItem): vscode.TreeItem {
    const item = new vscode.TreeItem(firstLine(h.sql), vscode.TreeItemCollapsibleState.None);
    item.id = h.id;
    item.description = `${when(h.at)} · ${h.profileName}` + (h.rows !== undefined ? ` · ${h.rows} rows` : '');
    item.tooltip = new vscode.MarkdownString().appendCodeblock(h.sql, 'sql').appendText(h.error ? `\n${h.error}` : `\n${Math.round(h.durationMs)} ms`);
    item.iconPath = new vscode.ThemeIcon(h.ok ? 'check' : 'error', new vscode.ThemeColor(h.ok ? 'charts.green' : 'errorForeground'));
    item.contextValue = 'history';
    item.command = { command: 'dbw.rerunHistory', title: 'Open in New Query', arguments: [h] };
    return item;
  }

  getChildren(): HistoryItem[] {
    return this.list();
  }
}

export function firstLine(sql: string): string {
  const line = sql.trim().split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('--')) ?? sql.trim();
  return line.length > 80 ? line.slice(0, 77) + '…' : line;
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}
