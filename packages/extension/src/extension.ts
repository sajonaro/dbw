import * as vscode from 'vscode';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DbwApi, DriverPlugin } from '@dbw/core';
import sqlite from '@dbw/driver-sqlite';
import postgres from '@dbw/driver-postgres';
import mssql from '@dbw/driver-mssql';
import mariadb from '@dbw/driver-mariadb';
import { createPrql, type PrqlModule } from '@dbw/language-prql';
import { Registry } from './registry';
import { ProfileStore } from './connections/store';
import { Sessions } from './connections/sessions';
import { Binding } from './binding';
import { History } from './history';
import { Results } from './query/results';
import type { Dbw, Feature } from './dbw';
import { connectionsFeature } from './features/connections';
import { explorerFeature } from './features/explorer';
import { historyFeature } from './features/history';
import { queryFeature } from './features/query';
import { intellisenseFeature } from './features/intellisense';

/**
 * The composition root, and the only file that knows every part.
 *
 * Open for extension, closed for modification, at three seams:
 *
 *  - Databases: a `DriverPlugin`, registered here as the built-in four
 *    are, from `dbw.driverModules` in settings, or by another extension
 *    through the exported API.  Nothing else in dbw names a database.
 *  - Dialects: a `Dialect`, the same three ways.  Nothing else in dbw
 *    knows how a dialect quotes, limits or splits.
 *  - Query languages: a `QueryLanguage`, compiled into the connection's
 *    dialect before it runs.  PRQL is built in; its compiler is prqlc as
 *    WebAssembly, shipped in dist/prql and loaded on first use.
 *  - Features: each is one module that takes the shared services and
 *    returns a Disposable.  Adding a feature is adding a line to the
 *    list below; no feature imports another.
 */
const features: Feature[] = [connectionsFeature, explorerFeature, historyFeature, queryFeature, intellisenseFeature];

export function activate(context: vscode.ExtensionContext): DbwApi {
  const registry = new Registry();
  const profiles = new ProfileStore(context.secrets);
  const sessions = new Sessions(registry, profiles);
  const binding = new Binding(profiles, context.workspaceState, (doc) => registry.isQueryDocument(doc));
  const history = new History(context.globalState);
  const results = new Results(context.extensionUri);
  const dbw: Dbw = { extensionUri: context.extensionUri, registry, profiles, sessions, binding, history, results };
  context.subscriptions.push(profiles, binding, results, { dispose: () => void sessions.closeAll() });

  for (const plugin of [sqlite, postgres, mssql, mariadb]) context.subscriptions.push(registry.registerDriver(plugin));
  const require = createRequire(__filename);
  context.subscriptions.push(registry.registerLanguage(createPrql(() => require(join(__dirname, 'prql', 'prql_js.js')) as PrqlModule)));
  context.subscriptions.push(loadDriverModules(registry));
  for (const feature of features) context.subscriptions.push(feature(dbw));

  const version = (context.extension.packageJSON as { version: string }).version;
  return registry.api(version);
}

export function deactivate(): void {}

/** Drivers from `dbw.driverModules`: plain modules on disk whose default export is a DriverPlugin. */
function loadDriverModules(registry: Registry): vscode.Disposable {
  const loaded: vscode.Disposable[] = [];
  const load = () => {
    for (const d of loaded) d.dispose();
    loaded.length = 0;
    const paths = vscode.workspace.getConfiguration('dbw').get<string[]>('driverModules', []);
    const require = createRequire(__filename);
    for (const p of paths) {
      try {
        const mod = require(p) as { default?: DriverPlugin } & DriverPlugin;
        const plugin = mod.default ?? mod;
        if (!plugin?.id || !plugin.connect || !plugin.dialect) throw new Error('the module does not export a DriverPlugin');
        loaded.push(registry.registerDriver(plugin));
      } catch (err) {
        vscode.window.showErrorMessage(`dbw: could not load driver module ${p}: ${(err as Error).message}`);
      }
    }
  };
  load();
  const watch = vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('dbw.driverModules')) load(); });
  return vscode.Disposable.from(watch, { dispose: () => { for (const d of loaded) d.dispose(); } });
}
