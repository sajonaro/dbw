import * as vscode from 'vscode';
import type { Registry } from './registry';
import type { ProfileStore } from './connections/store';
import type { Sessions } from './connections/sessions';
import type { Binding } from './binding';
import type { History } from './history';
import type { Results } from './query/results';

/**
 * What every feature is given: the shared services, and nothing else.
 *
 * Features do not know about each other.  They talk through these
 * services and through VS Code commands, which is what lets one be added
 * or removed without touching the others.
 */
export interface Dbw {
  readonly extensionUri: vscode.Uri;
  readonly registry: Registry;
  readonly profiles: ProfileStore;
  readonly sessions: Sessions;
  readonly binding: Binding;
  readonly history: History;
  readonly results: Results;
}

/** A feature: something that registers commands, views or providers, and can be disposed. */
export type Feature = (dbw: Dbw) => vscode.Disposable;
