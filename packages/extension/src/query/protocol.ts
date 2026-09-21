/**
 * What crosses between the extension and the results page.  Both sides
 * import these types, so a change to one is a compile error in the other.
 */

export interface GridColumn {
  name: string;
  type?: string;
}

/** One result set, JSON-safe, capped for the grid but with the true count. */
export interface GridResult {
  columns: GridColumn[];
  rows: unknown[][];
  affected?: number;
  command?: string;
  durationMs: number;
  totalRows: number;
}

export type ToWebview =
  | { type: 'running'; sql: string }
  | { type: 'results'; sql: string; results: GridResult[]; connection: string }
  | { type: 'error'; sql: string; message: string; connection: string };

export type FromWebview =
  | { type: 'ready' }
  | { type: 'copy'; text: string }
  | { type: 'save'; name: string; text: string };
