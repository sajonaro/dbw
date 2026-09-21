import { DatabaseSync } from 'node:sqlite';
import { defineDialect, definePlugin } from '@dbw/core';
import type { Connection, QueryResult, SchemaNode, TableInfo } from '@dbw/core';

export const dialect = defineDialect({
  id: 'sqlite',
  name: 'SQLite',
  splitter: 'sqlite',
  formatter: 'sqlite',
  quote: 'double',
  limit: 'limit',
  keywords: ['AUTOINCREMENT', 'PRAGMA', 'VACUUM', 'ATTACH', 'DETACH', 'REPLACE', 'GLOB', 'REGEXP', 'WITHOUT', 'ROWID', 'RETURNING'],
  functions: ['DATE', 'DATETIME', 'STRFTIME', 'JULIANDAY', 'TYPEOF', 'RANDOM', 'GROUP_CONCAT', 'INSTR', 'PRINTF', 'JSON', 'JSON_EXTRACT', 'IIF', 'TOTAL'],
});

function open(file: string): Connection {
  const db = new DatabaseSync(file);

  const tables = (kind: 'table' | 'view') =>
    (db.prepare(`select name from sqlite_master where type = ? and name not like 'sqlite_%' order by name`).all(kind) as { name: string }[])
      .map((r) => r.name);

  const columns = (table: string) =>
    (db.prepare(`pragma table_info(${dialect.quoteIdentifier(table)})`).all() as { name: string; type: string }[])
      .map((c) => ({ name: c.name, type: c.type || undefined }));

  return {
    async query(sql): Promise<QueryResult[]> {
      const results: QueryResult[] = [];
      for (const statement of dialect.split(sql)) {
        const started = performance.now();
        const stmt = db.prepare(statement.text);
        const cols = stmt.columns();
        if (cols.length > 0) {
          const rows = (stmt.all() as Record<string, unknown>[]).map((r) => cols.map((c) => r[c.name]));
          results.push({ columns: cols.map((c) => ({ name: c.name, type: c.type ?? undefined })), rows, durationMs: performance.now() - started });
        } else {
          const info = stmt.run();
          results.push({ columns: [], rows: [], affected: Number(info.changes), durationMs: performance.now() - started });
        }
      }
      return results;
    },
    async roots(): Promise<SchemaNode[]> {
      return [
        { id: 'tables', kind: 'folder', name: 'Tables', hasChildren: true },
        { id: 'views', kind: 'folder', name: 'Views', hasChildren: true },
      ];
    },
    async children(node): Promise<SchemaNode[]> {
      if (node.id === 'tables' || node.id === 'views') {
        const kind = node.id === 'tables' ? 'table' : 'view';
        return tables(kind).map((name) => ({ id: `${kind}:${name}`, kind, name, hasChildren: true, table: { name, kind } }));
      }
      if (node.table) {
        return columns(node.table.name).map((c) => ({ id: `column:${node.table!.name}.${c.name}`, kind: 'column', name: c.name, hasChildren: false, detail: c.type }));
      }
      return [];
    },
    async objects(): Promise<TableInfo[]> {
      const all: TableInfo[] = [];
      for (const kind of ['table', 'view'] as const) for (const name of tables(kind)) all.push({ name, kind, columns: columns(name) });
      return all;
    },
    async close() {
      db.close();
    },
  };
}

export default definePlugin({
  id: 'sqlite',
  name: 'SQLite',
  description: "A file, or :memory:. Uses Node's built-in SQLite.",
  dialect,
  connectionSchema: {
    type: 'object',
    properties: { file: { type: 'string', title: 'Database file', format: 'file', description: 'A path, or :memory:' } },
    required: ['file'],
  },
  async connect(config) {
    return open(String(config.file ?? ':memory:'));
  },
});
