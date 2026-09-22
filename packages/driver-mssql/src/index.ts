import sql from 'mssql';
import { defineDialect, definePlugin, groupColumns } from '@dbw/core';
import type { Connection, QueryResult, SchemaNode, TableInfo } from '@dbw/core';

export const dialect = defineDialect({
  id: 'mssql',
  name: 'Transact-SQL',
  formatter: 'transactsql',
  splitter: 'mssql',
  quote: 'bracket',
  limit: 'top',
  keywords: ['TOP', 'GO', 'DECLARE', 'EXEC', 'EXECUTE', 'PROCEDURE', 'PROC', 'IDENTITY', 'NVARCHAR', 'VARCHAR', 'DATETIME2', 'BIT', 'UNIQUEIDENTIFIER', 'OUTPUT', 'MERGE', 'MATCHED', 'PIVOT', 'UNPIVOT', 'APPLY', 'OVER', 'PARTITION', 'WHILE', 'IF', 'PRINT', 'RAISERROR', 'THROW', 'TRY', 'CATCH', 'TRANSACTION', 'TRAN', 'NOLOCK', 'WITH', 'CTE', 'OFFSET', 'FETCH', 'PERCENT', 'TIES'],
  functions: ['GETDATE', 'SYSDATETIME', 'GETUTCDATE', 'DATEADD', 'DATEDIFF', 'DATEPART', 'DATENAME', 'CONVERT', 'TRY_CONVERT', 'TRY_CAST', 'ISNULL', 'LEN', 'CHARINDEX', 'PATINDEX', 'STUFF', 'STRING_AGG', 'STRING_SPLIT', 'FORMAT', 'NEWID', 'NEWSEQUENTIALID', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'IIF', 'CHOOSE', 'OBJECT_ID', 'DB_NAME', 'SCHEMA_NAME', 'SUSER_SNAME', 'LEFT', 'RIGHT', 'LTRIM', 'RTRIM', 'JSON_VALUE', 'JSON_QUERY', 'OPENJSON', 'SCOPE_IDENTITY'],
});

function wrap(pool: sql.ConnectionPool): Connection {
  const rows = async <T,>(text: string, params: Record<string, unknown> = {}) => {
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) req.input(k, v);
    return (await req.query<T>(text)).recordset;
  };

  return {
    async query(text): Promise<QueryResult[]> {
      const started = performance.now();
      const req = pool.request();
      req.arrayRowMode = true;
      const res = await req.query(text);
      const durationMs = performance.now() - started;
      const results: QueryResult[] = [];
      for (const recordset of res.recordsets as unknown as sql.IRecordSet<unknown[]>[]) {
        const cols = Object.values(recordset.columns).sort((a, b) => a.index - b.index);
        results.push({ columns: cols.map((c) => ({ name: c.name, type: typeName(c) })), rows: recordset as unknown as unknown[][], durationMs });
      }
      if (results.length === 0) {
        results.push({ columns: [], rows: [], affected: (res.rowsAffected ?? []).reduce((a, b) => a + b, 0), durationMs });
      }
      return results;
    },

    async roots(): Promise<SchemaNode[]> {
      const schemas = await rows<{ name: string }>(
        `select name from sys.schemas where schema_id < 16384 and name not in ('sys', 'INFORMATION_SCHEMA') order by name`);
      return schemas.map((s) => ({ id: `schema:${s.name}`, kind: 'schema', name: s.name, hasChildren: true }));
    },

    async children(node): Promise<SchemaNode[]> {
      if (node.kind === 'schema') {
        const schema = node.name;
        return [
          { id: `tables:${schema}`, kind: 'folder', name: 'Tables', hasChildren: true },
          { id: `views:${schema}`, kind: 'folder', name: 'Views', hasChildren: true },
          { id: `procedures:${schema}`, kind: 'folder', name: 'Stored Procedures', hasChildren: true },
        ];
      }
      const [what, schema] = node.id.split(':', 2);
      if (what === 'tables' || what === 'views') {
        const kind = what === 'tables' ? 'table' : 'view';
        const list = await rows<{ name: string }>(
          `select o.name from sys.objects o join sys.schemas s on s.schema_id = o.schema_id
           where s.name = @schema and o.type = @type order by o.name`, { schema, type: kind === 'table' ? 'U' : 'V' });
        return list.map((t) => ({ id: `${kind}:${schema}:${t.name}`, kind, name: t.name, hasChildren: true, table: { schema, name: t.name, kind } }));
      }
      if (what === 'procedures') {
        const list = await rows<{ name: string }>(
          `select p.name from sys.procedures p join sys.schemas s on s.schema_id = p.schema_id where s.name = @schema order by p.name`, { schema });
        return list.map((p) => ({ id: `procedure:${schema}:${p.name}`, kind: 'routine', name: p.name, hasChildren: false }));
      }
      if (node.table) {
        const cols = await rows<{ name: string; type: string; is_nullable: boolean }>(
          `select c.name, type_name(c.user_type_id) as type, c.is_nullable
           from sys.columns c join sys.objects o on o.object_id = c.object_id join sys.schemas s on s.schema_id = o.schema_id
           where s.name = @schema and o.name = @name order by c.column_id`, { schema: node.table.schema, name: node.table.name });
        return cols.map((c) => ({ id: `column:${node.id}:${c.name}`, kind: 'column', name: c.name, hasChildren: false, detail: c.type + (c.is_nullable ? '' : ', not null') }));
      }
      return [];
    },

    async objects(): Promise<TableInfo[]> {
      const cols = await rows<{ schema_name: string; name: string; type: string; column: string; column_type: string }>(
        `select s.name as schema_name, o.name, o.type, c.name as [column], type_name(c.user_type_id) as column_type
         from sys.objects o join sys.schemas s on s.schema_id = o.schema_id join sys.columns c on c.object_id = o.object_id
         where o.type in ('U', 'V') order by s.name, o.name, c.column_id`);
      return groupColumns(cols.map((c) => ({ schema: c.schema_name, name: c.name, kind: c.type.trim() === 'V' ? 'view' : 'table', column: { name: c.column, type: c.column_type } })));
    },

    async close() {
      await pool.close();
    },
  };
}

function typeName(column: sql.IColumnMetadata[string]): string | undefined {
  const t = column.type as unknown as { declaration?: string; name?: string } | undefined;
  return t?.declaration ?? t?.name;
}

export default definePlugin({
  id: 'mssql',
  name: 'SQL Server',
  dialect,
  connectionSchema: {
    type: 'object',
    properties: {
      server: { type: 'string', title: 'Server', default: 'localhost' },
      port: { type: 'integer', title: 'Port', default: 1433 },
      database: { type: 'string', title: 'Database', default: 'master' },
      user: { type: 'string', title: 'User' },
      password: { type: 'string', title: 'Password', format: 'password' },
      encrypt: { type: 'boolean', title: 'Encrypt', default: false },
      trustServerCertificate: { type: 'boolean', title: 'Trust server certificate', default: true },
    },
    required: ['server', 'port', 'database', 'user'],
  },
  async connect(config) {
    const pool = new sql.ConnectionPool({
      server: String(config.server ?? 'localhost'),
      port: Number(config.port ?? 1433),
      database: String(config.database ?? 'master'),
      user: String(config.user ?? ''),
      password: String(config.password ?? ''),
      options: { encrypt: Boolean(config.encrypt), trustServerCertificate: config.trustServerCertificate !== false },
    });
    await pool.connect();
    return wrap(pool);
  },
});
