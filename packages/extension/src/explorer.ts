import * as vscode from 'vscode';
import type { NodeKind, SchemaNode } from '@dbw/core';
import type { Registry } from './registry';
import type { Sessions } from './connections/sessions';
import type { Profile, ProfileStore } from './connections/store';

export type Element =
  | { type: 'profile'; profile: Profile }
  | { type: 'node'; profile: Profile; node: SchemaNode }
  | { type: 'error'; profile: Profile; message: string };

/**
 * The object explorer: saved connections at the top, and under each the
 * tree its driver describes.  Expanding a connection opens it.
 */
export class Explorer implements vscode.TreeDataProvider<Element>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Element | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly registry: Registry, private readonly store: ProfileStore, private readonly sessions: Sessions) {
    this.subscriptions = [
      this.changed,
      store.onDidChange(() => this.refresh()),
      sessions.onDidChange(() => this.refresh()),
      registry.onDidChange(() => this.refresh()),
    ];
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
  }

  refresh(element?: Element): void {
    this.changed.fire(element);
  }

  getTreeItem(e: Element): vscode.TreeItem {
    if (e.type === 'profile') {
      const open = this.sessions.isOpen(e.profile.id);
      const driver = this.registry.driver(e.profile.driver);
      const item = new vscode.TreeItem(e.profile.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `profile:${e.profile.id}`;
      item.contextValue = open ? 'connection-open' : 'connection';
      item.description = driver ? driver.name : `${e.profile.driver} (no driver)`;
      item.iconPath = new vscode.ThemeIcon(open ? 'database' : 'circle-large-outline', open ? new vscode.ThemeColor('charts.green') : undefined);
      item.tooltip = describe(e.profile);
      return item;
    }
    if (e.type === 'error') {
      const item = new vscode.TreeItem(e.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      item.contextValue = 'error';
      item.tooltip = e.message;
      return item;
    }
    const item = new vscode.TreeItem(e.node.name, e.node.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = `node:${e.profile.id}:${e.node.id}`;
    item.description = e.node.detail;
    item.contextValue = e.node.kind;
    item.iconPath = new vscode.ThemeIcon(e.node.icon ?? icon(e.node.kind));
    item.tooltip = e.node.detail ? `${e.node.name}  ${e.node.detail}` : e.node.name;
    if (e.node.table) {
      item.command = { command: 'dbw.selectTop', title: 'Select Top Rows', arguments: [e] };
    }
    return item;
  }

  async getChildren(e?: Element): Promise<Element[]> {
    if (!e) return this.store.list().map((profile) => ({ type: 'profile', profile }));
    if (e.type === 'error') return [];
    try {
      const conn = await this.sessions.get(e.profile);
      const nodes = e.type === 'profile' ? await conn.roots() : await conn.children(e.node);
      return nodes.map((node) => ({ type: 'node', profile: e.profile, node }));
    } catch (err) {
      return [{ type: 'error', profile: e.profile, message: (err as Error).message }];
    }
  }
}

/** The codicon for the kinds dbw knows; a driver's own kind brings its own `icon`. */
const icons: Record<string, string> = {
  database: 'database', schema: 'symbol-namespace', folder: 'folder', table: 'table', view: 'eye',
  column: 'symbol-field', routine: 'symbol-method', index: 'list-ordered',
};

function icon(kind: NodeKind): string {
  return icons[kind] ?? 'symbol-misc';
}

function describe(profile: Profile): string {
  const parts = Object.entries(profile.config).map(([k, v]) => `${k}: ${String(v)}`);
  return [profile.name, ...parts].join('\n');
}
