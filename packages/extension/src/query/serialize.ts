import type { QueryResult } from '@dbw/core';
import type { GridResult } from './protocol';

export function toGrid(result: QueryResult, maxRows: number): GridResult {
  return {
    columns: result.columns,
    rows: result.rows.slice(0, maxRows).map((row) => row.map(cell)),
    affected: result.affected,
    command: result.command,
    durationMs: result.durationMs,
    totalRows: result.rows.length,
  };
}

/** One value, as something JSON can carry and a person can read. */
export function cell(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return isNaN(v.getTime()) ? 'invalid date' : v.toISOString();
  if (v instanceof Uint8Array) return `0x${Buffer.from(v).toString('hex').slice(0, 64)}${v.length > 32 ? '…' : ''} (${v.length} bytes)`;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
