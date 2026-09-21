import * as vscode from 'vscode';
import type { DriverPlugin } from '@dbw/core';

/** A saved connection: everything but its secrets, which live in secret storage. */
export interface Profile {
  id: string;
  name: string;
  driver: string;
  config: Record<string, unknown>;
}

const SECTION = 'dbw';
const KEY = 'connections';

/**
 * Connections live in user settings, so they sync and can be edited by
 * hand; passwords live in VS Code's secret storage, keyed by connection
 * and field, so they never land in settings.json.
 */
export class ProfileStore implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[] = [this.changed];

  constructor(private readonly secrets: vscode.SecretStorage) {
    this.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${SECTION}.${KEY}`)) this.changed.fire();
    }));
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
  }

  list(): Profile[] {
    const raw = vscode.workspace.getConfiguration(SECTION).get<unknown[]>(KEY, []);
    return raw.filter(isProfile);
  }

  get(id: string): Profile | undefined {
    return this.list().find((p) => p.id === id);
  }

  async save(profile: Profile, secrets: Record<string, string>): Promise<void> {
    const list = this.list().filter((p) => p.id !== profile.id);
    list.push(profile);
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const [field, value] of Object.entries(secrets)) {
      if (value) await this.secrets.store(secretKey(profile.id, field), value);
      else await this.secrets.delete(secretKey(profile.id, field));
    }
    await vscode.workspace.getConfiguration(SECTION).update(KEY, list, vscode.ConfigurationTarget.Global);
    this.changed.fire();
  }

  async remove(profile: Profile, driver: DriverPlugin | undefined): Promise<void> {
    const list = this.list().filter((p) => p.id !== profile.id);
    for (const field of secretFields(driver)) await this.secrets.delete(secretKey(profile.id, field));
    await vscode.workspace.getConfiguration(SECTION).update(KEY, list, vscode.ConfigurationTarget.Global);
    this.changed.fire();
  }

  /** The config with its secrets back in, for a driver to connect with. */
  async resolve(profile: Profile, driver: DriverPlugin): Promise<Record<string, unknown>> {
    const config = { ...profile.config };
    for (const field of secretFields(driver)) {
      const value = await this.secrets.get(secretKey(profile.id, field));
      if (value !== undefined) config[field] = value;
    }
    return config;
  }

  async secret(profile: Profile, field: string): Promise<string | undefined> {
    return this.secrets.get(secretKey(profile.id, field));
  }
}

export function secretFields(driver: DriverPlugin | undefined): string[] {
  if (!driver) return [];
  return Object.entries(driver.connectionSchema.properties)
    .filter(([, p]) => p.format === 'password')
    .map(([name]) => name);
}

const secretKey = (id: string, field: string) => `dbw.${id}.${field}`;

function isProfile(x: unknown): x is Profile {
  return typeof x === 'object' && x !== null &&
    typeof (x as Profile).id === 'string' && typeof (x as Profile).name === 'string' &&
    typeof (x as Profile).driver === 'string' && typeof (x as Profile).config === 'object';
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
