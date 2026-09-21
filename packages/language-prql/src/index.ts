import type { Dialect, QueryLanguage } from '@dbw/core';

/**
 * PRQL, as a dbw query language.  The compiler is prqlc, compiled to
 * WebAssembly and published as prql-js; it is loaded on first use by a
 * function the host supplies, because where the .wasm lives is the host's
 * business (the extension ships it inside its own dist).
 */

/** The part of prql-js this needs. */
export interface PrqlModule {
  compile(text: string, options: PrqlOptions): string;
  prql_to_pl(text: string): string;
  pl_to_prql(pl: string): string;
  get_targets(): string[];
  CompileOptions: new () => PrqlOptions;
}

export interface PrqlOptions {
  target: string;
  format: boolean;
  signature_comment: boolean;
}

/** prqlc's name for each dialect dbw ships; anything else compiles as generic SQL. */
const targets: Record<string, string> = {
  sqlite: 'sql.sqlite',
  postgres: 'sql.postgres',
  mssql: 'sql.mssql',
  mysql: 'sql.mysql',
  duckdb: 'sql.duckdb',
  bigquery: 'sql.bigquery',
  clickhouse: 'sql.clickhouse',
  snowflake: 'sql.snowflake',
};

export const keywords = [
  'from', 'derive', 'select', 'filter', 'sort', 'take', 'join', 'group', 'aggregate', 'window', 'append', 'remove',
  'intersect', 'loop', 'let', 'into', 'prql', 'func', 'case', 'null', 'true', 'false', 'this', 'that', 'side', 'left', 'right', 'full', 'inner',
];

export const functions = [
  'min', 'max', 'sum', 'average', 'count', 'count_distinct', 'stddev', 'every', 'any', 'concat_array', 'all',
  'lag', 'lead', 'first', 'last', 'rank', 'rank_dense', 'row_number', 'round', 'lower', 'upper', 'length', 'trim',
  'date.to_text', 'text.replace', 'text.contains', 'text.starts_with', 'text.ends_with', 'math.abs', 'math.floor', 'math.ceil',
];

/** prqlc reports errors as JSON; the reader wants the sentence. */
function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(text) as { inner?: { reason?: string; span?: string }[] };
    const first = parsed.inner?.[0];
    if (first?.reason) return first.span ? `${first.reason} (at ${first.span})` : first.reason;
  } catch { /* not JSON, then */ }
  return text;
}

export function createPrql(load: () => PrqlModule): QueryLanguage {
  let mod: PrqlModule | undefined;
  const prql = () => (mod ??= load());
  return {
    id: 'prql',
    name: 'PRQL',
    keywords,
    functions,
    compile(text: string, target: Dialect): string {
      const p = prql();
      const options = new p.CompileOptions();
      options.target = targets[target.id] ?? 'sql.generic';
      options.format = true;
      options.signature_comment = false;
      try {
        return p.compile(text, options);
      } catch (err) {
        throw new Error(`PRQL: ${message(err)}`);
      }
    },
    format(text: string): string {
      const p = prql();
      try {
        return p.pl_to_prql(p.prql_to_pl(text));
      } catch (err) {
        throw new Error(`PRQL: ${message(err)}`);
      }
    },
  };
}
