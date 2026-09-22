import * as vscode from 'vscode';
import type { DbwApi, Dialect, DriverPlugin, QueryLanguage } from '@dbw/core';
import type { Profile } from './connections/store';

/**
 * Every driver and dialect dbw knows about, built in or registered by
 * another extension.  The explorer, the editor and the runner ask this and
 * nothing else, so a database added by a plugin is a database everywhere.
 */
export class Registry {
  private readonly drivers = new Map<string, DriverPlugin>();
  private readonly dialects = new Map<string, Dialect>();
  private readonly languages = new Map<string, QueryLanguage>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  registerDriver(plugin: DriverPlugin): vscode.Disposable {
    this.drivers.set(plugin.id, plugin);
    if (!this.dialects.has(plugin.dialect.id)) this.dialects.set(plugin.dialect.id, plugin.dialect);
    this.changed.fire();
    return new vscode.Disposable(() => {
      if (this.drivers.get(plugin.id) === plugin) this.drivers.delete(plugin.id);
      this.changed.fire();
    });
  }

  registerDialect(dialect: Dialect): vscode.Disposable {
    this.dialects.set(dialect.id, dialect);
    this.changed.fire();
    return new vscode.Disposable(() => {
      if (this.dialects.get(dialect.id) === dialect) this.dialects.delete(dialect.id);
      this.changed.fire();
    });
  }

  registerLanguage(language: QueryLanguage): vscode.Disposable {
    this.languages.set(language.id, language);
    this.changed.fire();
    return new vscode.Disposable(() => {
      if (this.languages.get(language.id) === language) this.languages.delete(language.id);
      this.changed.fire();
    });
  }

  /** The query language of an editor, when it is not SQL. */
  language(languageId: string): QueryLanguage | undefined {
    return this.languages.get(languageId);
  }

  allLanguages(): QueryLanguage[] {
    return [...this.languages.values()];
  }

  /** The VS Code language ids dbw runs: every dialect's, and every query language's. */
  editorLanguages(): string[] {
    return [...new Set(['sql', ...this.allDialects().map((d) => d.language), ...this.allLanguages().map((l) => l.id)])];
  }

  isQueryDocument(doc: vscode.TextDocument): boolean {
    return this.editorLanguages().includes(doc.languageId);
  }

  driver(id: string): DriverPlugin | undefined {
    return this.drivers.get(id);
  }

  allDrivers(): DriverPlugin[] {
    return [...this.drivers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  allDialects(): Dialect[] {
    return [...this.dialects.values()];
  }

  /** The dialect a connection speaks: the one it chose, or its driver's. */
  dialectFor(profile: Profile): Dialect | undefined {
    const driver = this.drivers.get(profile.driver);
    if (!driver) return undefined;
    const chosen = profile.config.dialect;
    if (typeof chosen === 'string' && this.dialects.has(chosen)) return this.dialects.get(chosen);
    return driver.dialectFor?.(profile.config) ?? driver.dialect;
  }

  /** What other extensions get from `extensions.getExtension('sajonaro.dbw-workbench').exports`. */
  api(version: string): DbwApi {
    return {
      version,
      registerDriver: (plugin) => this.registerDriver(plugin),
      registerDialect: (dialect) => this.registerDialect(dialect),
      registerLanguage: (language) => this.registerLanguage(language),
    };
  }
}
