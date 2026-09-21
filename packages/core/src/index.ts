/**
 * The contract between dbw and its plugins.
 *
 * Three kinds of plugin exist, and they are separate on purpose:
 *
 *  - A `Dialect` is a way of spelling SQL: how identifiers are quoted, how
 *    rows are limited, which keywords and functions the editor should know,
 *    which formatter and statement splitter to use.  A dialect has no
 *    network code, so it can be registered by anyone, for any database.
 *
 *  - A `DriverPlugin` is a way of reaching a database: what a connection
 *    needs, how to open one, how to run SQL on it and how to list what is
 *    in it.  A driver names the dialect it speaks.  A generic driver such
 *    as ODBC can let the connection choose its dialect.
 *
 *  - A `QueryLanguage` is something other than SQL that an editor can hold,
 *    compiled into the connection's dialect before it runs.  PRQL is one.
 *
 * dbw itself knows no SQL.  Everything the explorer, the editor, the
 * completion and the results grid do is asked of these objects.
 */

// ----------------------------------------------------------------- dialect

import { format as formatSql } from 'sql-formatter';
import { splitQuery, mssqlSplitterOptions, mysqlSplitterOptions, postgreSplitterOptions, sqliteSplitterOptions, oracleSplitterOptions } from 'dbgate-query-splitter';

export interface TableRef {
  schema?: string;
  name: string;
  kind: 'table' | 'view';
}

/** One statement of a script, and where it is in the text. */
export interface Statement {
  text: string;
  start: number;
  end: number;
}

/**
 * A way of spelling SQL.  Everything is behaviour, so a dialect that
 * splits, formats, quotes or limits differently from any other supplies a
 * function and needs no change anywhere else.  `defineDialect` fills the
 * common cases in from a few facts.
 */
export interface Dialect {
  /** Short and stable: what a driver, or a connection, refers to. */
  id: string;
  name: string;
  /** The VS Code language id for editors in this dialect; `sql` unless a plugin contributes its own. */
  language: string;
  keywords: string[];
  functions: string[];
  quoteIdentifier(name: string): string;
  /** A table's name as this dialect writes it in a query. */
  qualify(table: TableRef): string;
  /** A query showing the first `limit` rows of a table. */
  selectFrom(table: TableRef, limit: number): string;
  /** A script as its statements, with positions: what Ctrl+Enter runs, and what completion reads. */
  split(text: string): Statement[];
  /** The same SQL, laid out. */
  format(sql: string): string;
}

/** The splitting rules `defineDialect` knows by name: `mssql` knows GO, `postgres` knows $$. */
export type SplitterFlavour = 'generic' | 'mysql' | 'mssql' | 'postgres' | 'sqlite' | 'oracle';

export interface DialectSpec {
  id: string;
  name: string;
  language?: string;
  keywords?: string[];
  functions?: string[];
  /** How identifiers are quoted, by name or by function. */
  quote?: 'double' | 'bracket' | 'backtick' | ((name: string) => string);
  /** How a SELECT is limited, by name or by function. */
  limit?: 'limit' | 'top' | 'fetch' | ((table: TableRef, limit: number, qualify: (t: TableRef) => string) => string);
  /** A splitter flavour, or a splitter. */
  splitter?: SplitterFlavour | ((text: string) => Statement[]);
  /** A sql-formatter language (sqlite, postgresql, transactsql, mysql, ...), or a formatter. */
  formatter?: string | ((sql: string) => string);
}

/** A dialect from a few facts, with the ANSI keyword set underneath. */
export function defineDialect(spec: DialectSpec): Dialect {
  const quoteIdentifier =
    typeof spec.quote === 'function' ? spec.quote
    : spec.quote === 'bracket' ? (s: string) => '[' + s.replaceAll(']', ']]') + ']'
    : spec.quote === 'backtick' ? (s: string) => '`' + s.replaceAll('`', '``') + '`'
    : (s: string) => '"' + s.replaceAll('"', '""') + '"';
  const qualify = (t: TableRef) => (t.schema ? quoteIdentifier(t.schema) + '.' : '') + quoteIdentifier(t.name);
  const limit = spec.limit ?? 'limit';
  const selectFrom =
    typeof limit === 'function' ? (t: TableRef, n: number) => limit(t, n, qualify)
    : limit === 'top' ? (t: TableRef, n: number) => `SELECT TOP ${n} * FROM ${qualify(t)}`
    : limit === 'fetch' ? (t: TableRef, n: number) => `SELECT * FROM ${qualify(t)} FETCH FIRST ${n} ROWS ONLY`
    : (t: TableRef, n: number) => `SELECT * FROM ${qualify(t)} LIMIT ${n}`;
  const split = typeof spec.splitter === 'function' ? spec.splitter : splitter(spec.splitter ?? 'generic');
  const format = typeof spec.formatter === 'function' ? spec.formatter : formatter(spec.formatter ?? 'sql');
  return {
    id: spec.id,
    name: spec.name,
    language: spec.language ?? 'sql',
    keywords: unique([...ansiKeywords, ...(spec.keywords ?? [])]),
    functions: unique([...ansiFunctions, ...(spec.functions ?? [])]),
    quoteIdentifier,
    qualify,
    selectFrom,
    split,
    format,
  };
}

interface RichItem {
  text: string;
  start: { position: number };
  end: { position: number };
  trimStart?: { position: number };
  trimEnd?: { position: number };
}

/** A splitter over dbgate-query-splitter, by flavour. */
export function splitter(flavour: SplitterFlavour): (text: string) => Statement[] {
  const options =
    flavour === 'mssql' ? mssqlSplitterOptions
    : flavour === 'mysql' ? mysqlSplitterOptions
    : flavour === 'postgres' ? postgreSplitterOptions
    : flavour === 'sqlite' ? sqliteSplitterOptions
    : flavour === 'oracle' ? oracleSplitterOptions
    : { ...mysqlSplitterOptions, allowGoDelimiter: false, allowDollarDollarString: true };
  return (text) => {
    const items = splitQuery(text, { ...options, returnRichInfo: true }) as unknown as RichItem[];
    return items
      .map((it) => {
        const start = it.trimStart?.position ?? it.start.position;
        const end = it.trimEnd?.position ?? it.end.position;
        return { text: text.slice(start, end), start, end };
      })
      .filter((s) => s.text.trim().length > 0);
  };
}

/** A formatter over sql-formatter, by language. */
export function formatter(language: string): (sql: string) => string {
  return (sql) => formatSql(sql, { language: language as never, keywordCase: 'upper', tabWidth: 2 });
}

const unique = (list: string[]) => [...new Set(list)];

export const ansiKeywords = [
  'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'AS', 'ASC', 'BEGIN', 'BETWEEN', 'BY', 'CASCADE', 'CASE', 'CHECK', 'COLUMN',
  'COMMIT', 'CONSTRAINT', 'CREATE', 'CROSS', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'DEFAULT',
  'DELETE', 'DESC', 'DISTINCT', 'DROP', 'ELSE', 'END', 'ESCAPE', 'EXCEPT', 'EXISTS', 'FALSE', 'FETCH', 'FIRST',
  'FOREIGN', 'FROM', 'FULL', 'GROUP', 'HAVING', 'IN', 'INDEX', 'INNER', 'INSERT', 'INTERSECT', 'INTO', 'IS',
  'JOIN', 'KEY', 'LEFT', 'LIKE', 'LIMIT', 'NATURAL', 'NEXT', 'NOT', 'NULL', 'OFFSET', 'ON', 'ONLY', 'OR', 'ORDER',
  'OUTER', 'PRIMARY', 'REFERENCES', 'RIGHT', 'ROLLBACK', 'ROW', 'ROWS', 'SELECT', 'SET', 'TABLE', 'THEN', 'TRUE',
  'TRUNCATE', 'UNION', 'UNIQUE', 'UPDATE', 'USING', 'VALUES', 'VIEW', 'WHEN', 'WHERE', 'WITH',
];

export const ansiFunctions = [
  'ABS', 'AVG', 'CAST', 'CEIL', 'COALESCE', 'CONCAT', 'COUNT', 'FLOOR', 'LENGTH', 'LOWER', 'MAX', 'MIN', 'NULLIF',
  'POWER', 'REPLACE', 'ROUND', 'SUBSTRING', 'SUM', 'TRIM', 'UPPER',
];

// ------------------------------------------------------------------ driver

/** The subset of JSON Schema a connection form is described in. */
export interface ConnectionSchema {
  type: 'object';
  properties: Record<string, PropertySchema>;
  required?: string[];
}

export interface PropertySchema {
  type: 'string' | 'number' | 'integer' | 'boolean';
  title?: string;
  description?: string;
  default?: string | number | boolean;
  /**
   * `password` is kept in secret storage and never written to settings;
   * `file` opens a file picker.  Any other format is shown as text.
   */
  format?: 'password' | 'file' | (string & {});
  enum?: string[];
}

/** The node kinds the explorer has icons for; a driver may use any other name and supply its own icon. */
export type NodeKind =
  | 'database' | 'schema' | 'folder' | 'table' | 'view' | 'column' | 'routine' | 'index' | 'other' | (string & {});

/** One node of the object explorer.  `id` is the plugin's own locator. */
export interface SchemaNode {
  id: string;
  kind: NodeKind;
  name: string;
  hasChildren: boolean;
  /** Shown dimmed after the name: a type, a count. */
  detail?: string;
  /** A VS Code codicon name, when the kind's own icon is not the right one. */
  icon?: string;
  /** Set on table and view nodes, so the UI can ask the dialect for a SELECT. */
  table?: TableRef;
}

export interface ColumnInfo {
  name: string;
  type?: string;
}

/** A table with its columns, for completion. */
export interface TableInfo extends TableRef {
  columns: ColumnInfo[];
}

/** One result set, or the outcome of a statement that returned none. */
export interface QueryResult {
  columns: ColumnInfo[];
  rows: unknown[][];
  /** Rows changed by a statement that returned no rows. */
  affected?: number;
  /** What the statement was, when the driver says: SELECT, UPDATE, CREATE TABLE. */
  command?: string;
  durationMs: number;
}

export interface Connection {
  /** Runs everything in `sql` and returns one result per statement that had one. */
  query(sql: string): Promise<QueryResult[]>;
  /** The top of the object explorer for this connection. */
  roots(): Promise<SchemaNode[]>;
  children(node: SchemaNode): Promise<SchemaNode[]>;
  /** Every table and view with its columns, for completion. */
  objects(): Promise<TableInfo[]>;
  close(): Promise<void>;
}

export interface DriverPlugin {
  /** Short and stable: what a saved connection refers to. */
  id: string;
  name: string;
  description?: string;
  /** The dialect this driver speaks, or, for a generic driver, the one a connection picked. */
  dialect: Dialect;
  dialectFor?(config: Record<string, unknown>): Dialect;
  connectionSchema: ConnectionSchema;
  connect(config: Record<string, unknown>): Promise<Connection>;
}

export function definePlugin(plugin: DriverPlugin): DriverPlugin {
  return plugin;
}

// ---------------------------------------------------------------- language

/**
 * A query language that is not SQL.  An editor in this language runs on
 * any connection: dbw asks the language for the SQL, in the connection's
 * dialect, and runs that.
 */
export interface QueryLanguage {
  /** The VS Code language id of the editors this applies to. */
  id: string;
  name: string;
  /** The SQL the database receives, in the target dialect.  Throws with a readable message. */
  compile(text: string, target: Dialect): string;
  /** The runnable pieces of a document; the whole document when absent. */
  split?(text: string): Statement[];
  /** The same text, laid out; no formatting when absent. */
  format?(text: string): string;
  keywords?: string[];
  functions?: string[];
}

/** What the dbw extension exports, for other extensions to register with. */
export interface DbwApi {
  version: string;
  registerDriver(plugin: DriverPlugin): { dispose(): void };
  registerDialect(dialect: Dialect): { dispose(): void };
  registerLanguage(language: QueryLanguage): { dispose(): void };
}

/** For an editor bound to nothing: ANSI keywords, double quotes, semicolons. */
export const genericDialect: Dialect = defineDialect({ id: 'generic', name: 'SQL' });
