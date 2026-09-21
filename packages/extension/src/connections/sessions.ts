import * as vscode from 'vscode';
import type { Connection, TableInfo } from '@dbw/core';
import type { Registry } from '../registry';
import type { Profile, ProfileStore } from './store';

/**
 * The open connections, one per profile, opened on first use and kept
 * until disconnected.  Also the schema each one has, cached for
 * completion, because asking a database for every table on every
 * keystroke is not IntelliSense.
 */
export class Sessions {
  private readonly open = new Map<string, Promise<Connection>>();
  private readonly schemas = new Map<string, Promise<TableInfo[]>>();
  private readonly known = new Map<string, TableInfo[]>();
  private readonly changed = new vscode.EventEmitter<string>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly registry: Registry, private readonly store: ProfileStore) {}

  isOpen(profileId: string): boolean {
    return this.open.has(profileId);
  }

  async get(profile: Profile): Promise<Connection> {
    let pending = this.open.get(profile.id);
    if (!pending) {
      const driver = this.registry.driver(profile.driver);
      if (!driver) throw new Error(`No driver '${profile.driver}' is registered; is its extension installed?`);
      pending = (async () => {
        const config = await this.store.resolve(profile, driver);
        return driver.connect(config);
      })();
      this.open.set(profile.id, pending);
      pending.then(() => this.changed.fire(profile.id), () => { this.open.delete(profile.id); });
    }
    return pending;
  }

  /** Every table and view the connection has, cached; `refresh` asks again. */
  async schema(profile: Profile, refresh = false): Promise<TableInfo[]> {
    if (refresh) this.schemas.delete(profile.id);
    let pending = this.schemas.get(profile.id);
    if (!pending) {
      pending = this.get(profile).then((c) => c.objects());
      this.schemas.set(profile.id, pending);
      pending.then((v) => this.known.set(profile.id, v), () => this.schemas.delete(profile.id));
    }
    return pending;
  }

  /** What has already arrived, for a completion that cannot wait. */
  cachedSchema(profileId: string): TableInfo[] | undefined {
    return this.known.get(profileId);
  }

  async close(profileId: string): Promise<void> {
    const pending = this.open.get(profileId);
    this.open.delete(profileId);
    this.schemas.delete(profileId);
    this.known.delete(profileId);
    if (pending) {
      try { await (await pending).close(); } catch { /* it was going anyway */ }
    }
    this.changed.fire(profileId);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.open.keys()].map((id) => this.close(id)));
  }
}
