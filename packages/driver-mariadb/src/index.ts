import mariadb from 'mariadb';
import type { Connection as MariaConnection, FieldInfo, UpsertResult } from 'mariadb';
import { defineDialect, definePlugin, groupColumns } from '@dbw/core';
import type { Connection, QueryResult, SchemaNode, TableInfo } from '@dbw/core';

export const dialect = defineDialect({
  id: 'mariadb',
  name: 'MariaDB',
  formatter: 'mariadb',
  splitter: 'mysql',
  quote: 'backtick',
  limit: 'limit',
  keywords: ['DATABASE', 'DATABASES', 'SCHEMA', 'ENGINE', 'AUTO_INCREMENT', 'UNSIGNED', 'ZEROFILL', 'CHARSET', 'COLLATE', 'IF', 'IFNULL', 'REPLACE', 'IGNORE', 'DUPLICATE', 'KEY', 'STRAIGHT_JOIN', 'EXPLAIN', 'DESCRIBE', 'SHOW', 'TABLES', 'COLUMNS', 'PROCESSLIST', 'VARIABLES', 'STATUS', 'USE', 'LOCK', 'UNLOCK', 'DELIMITER', 'PROCEDURE', 'FUNCTION', 'RETURNS', 'DETERMINISTIC', 'BEGIN', 'END', 'DECLARE', 'REGEXP', 'RLIKE', 'XOR', 'DIV', 'MOD', 'BINARY', 'RETURNING', 'WINDOW', 'OVER', 'PARTITION', 'RECURSIVE'],
  functions: ['NOW', 'CURDATE', 'CURTIME', 'DATE_FORMAT', 'STR_TO_DATE', 'DATE_ADD', 'DATE_SUB', 'DATEDIFF', 'TIMESTAMPDIFF', 'UNIX_TIMESTAMP', 'FROM_UNIXTIME', 'YEAR', 'MONTH', 'DAY', 'IFNULL', 'NULLIF', 'COALESCE', 'GREATEST', 'LEAST', 'CONCAT', 'CONCAT_WS', 'GROUP_CONCAT', 'SUBSTRING', 'SUBSTRING_INDEX', 'LOCATE', 'INSTR', 'LPAD', 'RPAD', 'TRIM', 'REPLACE', 'REGEXP_REPLACE', 'REGEXP_SUBSTR', 'JSON_EXTRACT', 'JSON_OBJECT', 'JSON_ARRAY', 'JSON_ARRAYAGG', 'JSON_OBJECTAGG', 'JSON_VALUE', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'LAST_INSERT_ID', 'UUID', 'RAND', 'MD5', 'SHA2', 'FOUND_ROWS', 'ROW_COUNT'],
});

/** Everything that arrives as a result set carries this. */
type Rows = unknown[][] & { meta: FieldInfo[] };

const systemSchemas = `('information_schema', 'mysql', 'performance_schema', 'sys')`;

/** The connector's type names, in the spelling people write in DDL. */
const typeNames: Partial<Record<string, string>> = {
  TINY: 'tinyint', SHORT: 'smallint', INT24: 'mediumint', INT: 'int', BIGINT: 'bigint', FLOAT: 'float', DOUBLE: 'double',
  NEWDECIMAL: 'decimal', DECIMAL: 'decimal', VAR_STRING: 'varchar', STRING: 'char', TINY_BLOB: 'tinytext',
  BLOB: 'text', MEDIUM_BLOB: 'mediumtext', LONG_BLOB: 'longtext', DATETIME: 'datetime', TIMESTAMP: 'timestamp',
  DATE: 'date', TIME: 'time', YEAR: 'year', JSON: 'json', BIT: 'bit', ENUM: 'enum', SET: 'set', GEOMETRY: 'geometry', NULL: 'null',
};

/** The binary collation (63) is how the server tells blobs from text and binary from char. */
const binaryNames: Partial<Record<string, string>> = { varchar: 'varbinary', char: 'binary' };

export function typeName(f: Pick<FieldInfo, 'type' | 'dataTypeName'> & { collation?: { index: number } }): string {
  if (f.dataTypeName) return f.dataTypeName;
  const name = typeNames[f.type] ?? String(f.type).toLowerCase();
  if (f.collation?.index !== 63) return name;
  return binaryNames[name] ?? (name.endsWith('text') ? name.replace('text', 'blob') : name);
}

function isRows(r: unknown): r is Rows {
  return Array.isArray(r) && 'meta' in r;
}

/** One statement or many: the connector hands back one result, or a plain array of them. */
export function resultsOf(res: unknown): (Rows | UpsertResult)[] {
  if (isRows(res) || !Array.isArray(res)) return [res as Rows | UpsertResult];
  return res as (Rows | UpsertResult)[];
}

function wrap(conn: MariaConnection, database: string | undefined): Connection {
  const rows = async <T>(sql: string, values: unknown[] = []) => (await conn.query(sql, values)) as T[];

  return {
    async query(sql): Promise<QueryResult[]> {
      const started = performance.now();
      const res = await conn.query({ sql, rowsAsArray: true });
      const durationMs = performance.now() - started;
      return resultsOf(res).map((r) =>
        isRows(r)
          ? { columns: r.meta.map((f) => ({ name: f.name(), type: typeName(f) })), rows: r as unknown[][], durationMs }
          : { columns: [], rows: [], affected: r.affectedRows, durationMs });
    },

    async roots(): Promise<SchemaNode[]> {
      const schemas = await rows<{ schema_name: string }>(
        `select schema_name as schema_name from information_schema.schemata where schema_name not in ${systemSchemas} order by schema_name`);
      return schemas.map((s) => ({ id: `schema:${s.schema_name}`, kind: 'schema', name: s.schema_name, hasChildren: true }));
    },

    async children(node): Promise<SchemaNode[]> {
      if (node.kind === 'schema') {
        const schema = node.name;
        return [
          { id: `tables:${schema}`, kind: 'folder', name: 'Tables', hasChildren: true },
          { id: `views:${schema}`, kind: 'folder', name: 'Views', hasChildren: true },
          { id: `routines:${schema}`, kind: 'folder', name: 'Routines', hasChildren: true },
        ];
      }
      const [what, schema] = node.id.split(':', 2);
      if (what === 'tables' || what === 'views') {
        const kind = what === 'tables' ? 'table' : 'view';
        const list = await rows<{ table_name: string }>(
          `select table_name as table_name from information_schema.tables where table_schema = ? and table_type = ? order by table_name`,
          [schema, kind === 'table' ? 'BASE TABLE' : 'VIEW']);
        return list.map((t) => ({ id: `${kind}:${schema}:${t.table_name}`, kind, name: t.table_name, hasChildren: true, table: { schema, name: t.table_name, kind } }));
      }
      if (what === 'routines') {
        const list = await rows<{ routine_name: string; routine_type: string }>(
          `select routine_name as routine_name, routine_type as routine_type from information_schema.routines where routine_schema = ? order by routine_name`, [schema]);
        return list.map((r) => ({ id: `routine:${schema}:${r.routine_name}`, kind: 'routine', name: r.routine_name, hasChildren: false, detail: r.routine_type.toLowerCase() }));
      }
      if (node.table) {
        const cols = await rows<{ column_name: string; column_type: string; is_nullable: string }>(
          `select column_name as column_name, column_type as column_type, is_nullable as is_nullable from information_schema.columns
           where table_schema = ? and table_name = ? order by ordinal_position`, [node.table.schema, node.table.name]);
        return cols.map((c) => ({ id: `column:${node.id}:${c.column_name}`, kind: 'column', name: c.column_name, hasChildren: false, detail: c.column_type + (c.is_nullable === 'NO' ? ', not null' : '') }));
      }
      return [];
    },

    async objects(): Promise<TableInfo[]> {
      // Completion covers the connection's database when it has one, else every database the explorer shows.
      const cols = await rows<{ table_schema: string; table_name: string; table_type: string; column_name: string; column_type: string }>(
        `select t.table_schema as table_schema, t.table_name as table_name, t.table_type as table_type,
                c.column_name as column_name, c.column_type as column_type
         from information_schema.tables t
         join information_schema.columns c on c.table_schema = t.table_schema and c.table_name = t.table_name
         where ${database ? 't.table_schema = ?' : `t.table_schema not in ${systemSchemas}`}
         order by t.table_schema, t.table_name, c.ordinal_position`, database ? [database] : []);
      return groupColumns(cols.map((c) => ({ schema: c.table_schema, name: c.table_name, kind: c.table_type === 'VIEW' ? 'view' : 'table', column: { name: c.column_name, type: c.column_type } })));
    },

    async close() {
      await conn.end();
    },
  };
}

export default definePlugin({
  id: 'mariadb',
  name: 'MariaDB / MySQL',
  dialect,
  connectionSchema: {
    type: 'object',
    properties: {
      host: { type: 'string', title: 'Host', default: 'localhost' },
      port: { type: 'integer', title: 'Port', default: 3306 },
      database: { type: 'string', title: 'Database', description: 'Optional; the explorer shows every database you can see' },
      user: { type: 'string', title: 'User', default: 'root' },
      password: { type: 'string', title: 'Password', format: 'password' },
      ssl: { type: 'boolean', title: 'SSL', default: false },
      allowPublicKeyRetrieval: { type: 'boolean', title: 'Allow public key retrieval', default: false, description: 'MySQL 8 with caching_sha2_password and no SSL needs this; it trusts whatever server answers with the password' },
    },
    required: ['host', 'port', 'user'],
  },
  async connect(config) {
    const conn = await mariadb.createConnection({
      host: String(config.host ?? 'localhost'),
      port: Number(config.port ?? 3306),
      database: config.database ? String(config.database) : undefined,
      user: String(config.user ?? 'root'),
      password: String(config.password ?? ''),
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      multipleStatements: true,
      allowPublicKeyRetrieval: Boolean(config.allowPublicKeyRetrieval),
    });
    return wrap(conn, config.database ? String(config.database) : undefined);
  },
});
