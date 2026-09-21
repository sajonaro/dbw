import type { TableInfo } from '@dbw/core';

/**
 * What the cursor is looking at, from the statement's own text.
 *
 * No parser: SQL has too many dialects for one, and completion needs an
 * answer while the statement is still half typed, when no parser would
 * accept it.  What it reads is the shape people actually type -- the
 * clause the cursor is in, the tables the statement has named and what
 * it calls them -- which is right most of the time, and what matters most
 * of the time.
 */

export interface ScopeTable {
  /** As written in the statement, quotes and schema included. */
  raw: string;
  alias?: string;
  table?: TableInfo;
}

export type Context =
  /** After `alias.` or `table.` or `schema.`: the members of that thing. */
  | { kind: 'member'; owner: string; word: string; scope: ScopeTable[] }
  /** Where a table name goes: after FROM, JOIN, UPDATE, INTO, TABLE. */
  | { kind: 'table'; word: string; scope: ScopeTable[] }
  /** Where a column goes: SELECT, WHERE, ON, SET, GROUP BY, ORDER BY, HAVING. */
  | { kind: 'column'; word: string; scope: ScopeTable[] }
  /** Anywhere else, or nowhere in particular. */
  | { kind: 'any'; word: string; scope: ScopeTable[] };

const TABLE_KEYWORDS = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO', 'TABLE', 'TRUNCATE', 'DESCRIBE', 'DESC', 'EXISTS']);
const CLAUSE_KEYWORDS = new Set(['SELECT', 'FROM', 'JOIN', 'WHERE', 'SET', 'ON', 'BY', 'HAVING', 'VALUES', 'UPDATE', 'INTO', 'TABLE', 'RETURNING', 'USING', 'TOP', 'LIMIT', 'DELETE', 'INSERT', 'WITH', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NULL', 'DISTINCT', 'ORDER', 'GROUP', 'OVER', 'PARTITION']);
const COLUMN_CLAUSES = new Set(['SELECT', 'WHERE', 'SET', 'ON', 'BY', 'HAVING', 'RETURNING', 'AND', 'OR', 'WHEN', 'THEN', 'ELSE', 'CASE', 'IN', 'LIKE', 'IS', 'NOT', 'BETWEEN', 'DISTINCT', 'PARTITION', 'OVER', 'TOP', 'USING']);
const NOT_AN_ALIAS = new Set(['ON', 'WHERE', 'SET', 'VALUES', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'JOIN', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'UNION', 'SELECT', 'NATURAL', 'FULL', 'USING', 'RETURNING', 'WITH', 'AS', 'OFFSET', 'FETCH', 'FOR', 'EXCEPT', 'INTERSECT', 'WHEN', 'THEN', 'ELSE', 'END', 'AND', 'OR', 'NOT', 'IN', 'IS', 'LIKE', 'BETWEEN', 'EXISTS', 'TABLESAMPLE', 'LATERAL', 'TOP', 'DO']);

const IDENT = String.raw`(?:"[^"]+"|\[[^\]]+\]|` + '`[^`]+`' + String.raw`|[A-Za-z_][\w$]*)`;
const TABLE_REF = new RegExp(String.raw`\b(from|join|update|into|table)\s+(${IDENT}(?:\.${IDENT}){0,2})(?:\s+(?:as\s+)?(${IDENT}))?`, 'gi');

/** Strip the quoting a dialect puts around an identifier. */
export function unquote(s: string): string {
  return s.replace(/^["\[\`]|["\]\`]$/g, '');
}

/** The tables a statement names, with their aliases, resolved against the schema when they can be. */
export function scopeOf(statement: string, objects: TableInfo[]): ScopeTable[] {
  const scope: ScopeTable[] = [];
  const text = stripStringsAndComments(statement);
  for (const m of text.matchAll(TABLE_REF)) {
    const raw = m[2];
    let alias: string | undefined = m[3] ? unquote(m[3]) : undefined;
    if (alias && NOT_AN_ALIAS.has(alias.toUpperCase())) alias = undefined;
    if (scope.some((s) => s.raw.toLowerCase() === raw.toLowerCase() && s.alias === alias)) continue;
    scope.push({ raw, alias, table: resolve(raw, objects) });
  }
  return scope;
}

/** The table a name refers to: `schema.name` exactly, or `name` in any schema. */
export function resolve(raw: string, objects: TableInfo[]): TableInfo | undefined {
  const parts = raw.split('.').map(unquote);
  const name = parts[parts.length - 1].toLowerCase();
  const schema = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : undefined;
  return objects.find((t) => t.name.toLowerCase() === name && (!schema || t.schema?.toLowerCase() === schema))
    ?? (schema ? undefined : objects.find((t) => t.name.toLowerCase() === name));
}

/** What to offer at `offset` in `statement`. */
export function analyze(statement: string, offset: number, objects: TableInfo[]): Context {
  const scope = scopeOf(statement, objects);
  const before = statement.slice(0, offset);
  const wordMatch = /([A-Za-z_][\w$]*)?$/.exec(before);
  const word = wordMatch?.[1] ?? '';
  const beforeWord = before.slice(0, before.length - word.length);

  const memberMatch = new RegExp(String.raw`(${IDENT}(?:\.${IDENT})?)\.$`).exec(beforeWord);
  if (memberMatch) return { kind: 'member', owner: memberMatch[1], word, scope };

  const tokens = stripStringsAndComments(beforeWord).match(/[A-Za-z_][\w$]*|[(),=<>*]/g) ?? [];
  const last = tokens[tokens.length - 1]?.toUpperCase();
  if (last !== undefined && TABLE_KEYWORDS.has(last)) return { kind: 'table', word, scope };

  // Which clause is the cursor in?  The last clause keyword before it decides.
  let clause: string | undefined;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].toUpperCase();
    if (CLAUSE_KEYWORDS.has(t)) { clause = t; break; }
  }
  if (clause === undefined) return { kind: 'any', word, scope };
  // `INSERT INTO t (|`: the column list of the table just named.
  if (last === '(' && clause === 'INTO') return { kind: 'column', word, scope };
  if (last === ',' && (clause === 'FROM' || clause === 'JOIN')) return { kind: 'table', word, scope };
  if (COLUMN_CLAUSES.has(clause)) return { kind: 'column', word, scope };
  if ((clause === 'FROM' || clause === 'JOIN') && last !== undefined && /^[A-Za-z_]/.test(last) && !NOT_AN_ALIAS.has(last)) {
    // `FROM users u |`: an alias has been given; what comes next is a keyword, not a table.
    return { kind: 'any', word, scope };
  }
  return { kind: 'any', word, scope };
}

/** The same text with string literals and comments blanked, so their contents are not read as SQL. */
export function stripStringsAndComments(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
}

/** Columns for a member access: `alias.` or `table.`; or tables for `schema.`. */
export function membersOf(owner: string, scope: ScopeTable[], objects: TableInfo[]): { columns?: TableInfo; tables?: TableInfo[] } {
  const name = unquote(owner.split('.').pop() ?? owner).toLowerCase();
  const aliased = scope.find((s) => s.alias?.toLowerCase() === name);
  if (aliased?.table) return { columns: aliased.table };
  const named = scope.find((s) => unquote(s.raw.split('.').pop() ?? s.raw).toLowerCase() === name);
  if (named?.table) return { columns: named.table };
  const direct = resolve(owner, objects);
  if (direct) return { columns: direct };
  const inSchema = objects.filter((t) => t.schema?.toLowerCase() === name);
  if (inSchema.length) return { tables: inSchema };
  return {};
}
