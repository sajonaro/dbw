import pg from 'pg';
import { defineDialect, definePlugin } from '@dbw/core';
import type { Connection, QueryResult, SchemaNode, TableInfo } from '@dbw/core';

export const dialect = defineDialect({
  id: 'postgres',
  name: 'PostgreSQL',
  formatter: 'postgresql',
  splitter: 'postgres',
  quote: 'double',
  limit: 'limit',
  keywords: ['ILIKE', 'RETURNING', 'SERIAL', 'BIGSERIAL', 'LATERAL', 'MATERIALIZED', 'RECURSIVE', 'CONFLICT', 'DO', 'NOTHING', 'ARRAY', 'ANY', 'SOME', 'EXPLAIN', 'ANALYZE', 'VACUUM', 'SCHEMA', 'EXTENSION', 'FUNCTION', 'RETURNS', 'LANGUAGE', 'PLPGSQL', 'WINDOW', 'OVER', 'PARTITION', 'FILTER', 'TABLESAMPLE', 'ISNULL', 'NOTNULL'],
  functions: ['NOW', 'DATE_TRUNC', 'DATE_PART', 'EXTRACT', 'TO_CHAR', 'TO_DATE', 'TO_TIMESTAMP', 'AGE', 'ARRAY_AGG', 'STRING_AGG', 'JSONB_BUILD_OBJECT', 'JSONB_AGG', 'JSON_AGG', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'GENERATE_SERIES', 'UNNEST', 'REGEXP_REPLACE', 'SPLIT_PART', 'LEFT', 'RIGHT', 'POSITION', 'GREATEST', 'LEAST', 'PG_TYPEOF', 'GEN_RANDOM_UUID', 'MD5', 'RANDOM'],
});

/** The type names people expect to see, for the OIDs that come up. */
const typeNames: Record<number, string> = {
  16: 'bool', 17: 'bytea', 20: 'int8', 21: 'int2', 23: 'int4', 25: 'text', 114: 'json', 700: 'float4',
  701: 'float8', 1042: 'char', 1043: 'varchar', 1082: 'date', 1083: 'time', 1114: 'timestamp',
  1184: 'timestamptz', 1186: 'interval', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb', 1007: 'int4[]', 1009: 'text[]',
};

function wrap(client: pg.Client): Connection {
  const rows = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) => (await client.query<T>(text, values)).rows;

  return {
    async query(sql): Promise<QueryResult[]> {
      const started = performance.now();
      const res = await client.query({ text: sql, rowMode: 'array' });
      const list = Array.isArray(res) ? res : [res];
      const durationMs = performance.now() - started;
      return list.map((r) => ({
        columns: (r.fields ?? []).map((f: pg.FieldDef) => ({ name: f.name, type: typeNames[f.dataTypeID] ?? `oid ${f.dataTypeID}` })),
        rows: (r.rows ?? []) as unknown[][],
        affected: r.fields?.length ? undefined : r.rowCount ?? undefined,
        command: r.command,
        durationMs,
      }));
    },

    async roots(): Promise<SchemaNode[]> {
      const schemas = await rows<{ schema_name: string }>(
        `select schema_name from information_schema.schemata
         where schema_name not in ('pg_catalog', 'information_schema') and schema_name not like 'pg_toast%'
         order by schema_name`);
      return schemas.map((s) => ({ id: `schema:${s.schema_name}`, kind: 'schema', name: s.schema_name, hasChildren: true }));
    },

    async children(node): Promise<SchemaNode[]> {
      if (node.kind === 'schema') {
        const schema = node.name;
        return [
          { id: `tables:${schema}`, kind: 'folder', name: 'Tables', hasChildren: true },
          { id: `views:${schema}`, kind: 'folder', name: 'Views', hasChildren: true },
          { id: `routines:${schema}`, kind: 'folder', name: 'Functions', hasChildren: true },
        ];
      }
      const [what, schema] = node.id.split(':', 2);
      if (what === 'tables' || what === 'views') {
        const kind = what === 'tables' ? 'table' : 'view';
        const list = await rows<{ table_name: string }>(
          `select table_name from information_schema.tables where table_schema = $1 and table_type = $2 order by table_name`,
          [schema, kind === 'table' ? 'BASE TABLE' : 'VIEW']);
        return list.map((t) => ({ id: `${kind}:${schema}:${t.table_name}`, kind, name: t.table_name, hasChildren: true, table: { schema, name: t.table_name, kind } }));
      }
      if (what === 'routines') {
        const list = await rows<{ routine_name: string; routine_type: string }>(
          `select routine_name, routine_type from information_schema.routines where specific_schema = $1 order by routine_name`, [schema]);
        return list.map((r) => ({ id: `routine:${schema}:${r.routine_name}`, kind: 'routine', name: r.routine_name, hasChildren: false, detail: r.routine_type.toLowerCase() }));
      }
      if (node.table) {
        const cols = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
          `select column_name, data_type, is_nullable from information_schema.columns
           where table_schema = $1 and table_name = $2 order by ordinal_position`, [node.table.schema, node.table.name]);
        return cols.map((c) => ({ id: `column:${node.id}:${c.column_name}`, kind: 'column', name: c.column_name, hasChildren: false, detail: c.data_type + (c.is_nullable === 'NO' ? ', not null' : '') }));
      }
      return [];
    },

    async objects(): Promise<TableInfo[]> {
      const cols = await rows<{ table_schema: string; table_name: string; table_type: string; column_name: string; data_type: string }>(
        `select t.table_schema, t.table_name, t.table_type, c.column_name, c.data_type
         from information_schema.tables t
         join information_schema.columns c on c.table_schema = t.table_schema and c.table_name = t.table_name
         where t.table_schema not in ('pg_catalog', 'information_schema')
         order by t.table_schema, t.table_name, c.ordinal_position`);
      const byTable = new Map<string, TableInfo>();
      for (const c of cols) {
        const key = `${c.table_schema}.${c.table_name}`;
        let t = byTable.get(key);
        if (!t) {
          t = { schema: c.table_schema, name: c.table_name, kind: c.table_type === 'VIEW' ? 'view' : 'table', columns: [] };
          byTable.set(key, t);
        }
        t.columns.push({ name: c.column_name, type: c.data_type });
      }
      return [...byTable.values()];
    },

    async close() {
      await client.end();
    },
  };
}

export default definePlugin({
  id: 'postgres',
  name: 'PostgreSQL',
  dialect,
  connectionSchema: {
    type: 'object',
    properties: {
      host: { type: 'string', title: 'Host', default: 'localhost' },
      port: { type: 'integer', title: 'Port', default: 5432 },
      database: { type: 'string', title: 'Database', default: 'postgres' },
      user: { type: 'string', title: 'User' },
      password: { type: 'string', title: 'Password', format: 'password' },
      ssl: { type: 'boolean', title: 'SSL', default: false },
    },
    required: ['host', 'port', 'database', 'user'],
  },
  async connect(config) {
    const client = new pg.Client({
      host: String(config.host ?? 'localhost'),
      port: Number(config.port ?? 5432),
      database: String(config.database ?? 'postgres'),
      user: String(config.user ?? ''),
      password: String(config.password ?? ''),
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    });
    await client.connect();
    return wrap(client);
  },
});
