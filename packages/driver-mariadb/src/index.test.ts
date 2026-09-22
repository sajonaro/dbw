import { describe, expect, it } from 'vitest';
import mariadb, { dialect, resultsOf, typeName } from './index.js';

// Needs a server: DBW_MARIADB="host:port:user:password" (for example the
// container from `docker run -e MARIADB_ROOT_PASSWORD=root -p 3306:3306 mariadb`).
const target = process.env.DBW_MARIADB?.split(':');
const config = target && { host: target[0], port: Number(target[1]), user: target[2], password: target[3] };

describe('mariadb dialect', () => {
  it('quotes with backticks and limits with LIMIT', () => {
    expect(dialect.selectFrom({ schema: 'demo', name: 'people' }, 100)).toBe('SELECT * FROM `demo`.`people` LIMIT 100');
    expect(dialect.split('select 1; select 2').map((s) => s.text)).toEqual(['select 1', 'select 2']);
  });
});

describe('mariadb result shapes', () => {
  const rows = (meta: unknown[] = []) => Object.assign([[1]], { meta }) as never;
  const ok = { affectedRows: 3, insertId: 0, warningStatus: 0 } as never;

  it('sees one result set, one OK packet, or a list of either', () => {
    expect(resultsOf(rows())).toHaveLength(1);
    expect(resultsOf(ok)).toEqual([ok]);
    expect(resultsOf([rows(), ok, rows()])).toHaveLength(3);
    expect(resultsOf([])).toEqual([]);
  });

  it('names types the way DDL spells them, and tells binary from text', () => {
    const f = (type: string, collation = 45, dataTypeName?: string) => ({ type, collation: { index: collation }, dataTypeName }) as never;
    expect(typeName(f('VAR_STRING'))).toBe('varchar');
    expect(typeName(f('VAR_STRING', 63))).toBe('varbinary');
    expect(typeName(f('STRING', 63))).toBe('binary');
    expect(typeName(f('LONG_BLOB'))).toBe('longtext');
    expect(typeName(f('LONG_BLOB', 63))).toBe('longblob');
    expect(typeName(f('NEWDECIMAL'))).toBe('decimal');
    expect(typeName(f('LONG_BLOB', 45, 'json'))).toBe('json');
  });
});

describe.skipIf(!config)('mariadb driver', () => {
  it('runs a batch, returns rows and affected counts, and lists what it made', async () => {
    const conn = await mariadb.connect(config!);
    const results = await conn.query(`
      create database if not exists dbw_test;
      create table dbw_test.people (id int auto_increment primary key, name varchar(20) not null, note text);
      insert into dbw_test.people (name) values ('ann'), ('bob');
      select id, name from dbw_test.people order by id;
    `);
    expect(results).toHaveLength(4);
    expect(results[2].affected).toBe(2);
    expect(results[3].columns).toEqual([{ name: 'id', type: 'int' }, { name: 'name', type: 'varchar' }]);
    expect(results[3].rows).toEqual([[1, 'ann'], [2, 'bob']]);

    const schema = (await conn.roots()).find((s) => s.name === 'dbw_test')!;
    const tables = await conn.children((await conn.children(schema))[0]);
    expect(tables.map((t) => t.name)).toEqual(['people']);
    expect((await conn.children(tables[0])).map((c) => [c.name, c.detail])).toEqual([
      ['id', 'int(11), not null'], ['name', 'varchar(20), not null'], ['note', 'text']]);
    const people = (await conn.objects()).find((t) => t.schema === 'dbw_test' && t.name === 'people')!;
    expect(people.columns.map((c) => c.name)).toEqual(['id', 'name', 'note']);

    await conn.query('drop database dbw_test');
    await conn.close();
  });

  it('reports a bad statement as an error', async () => {
    const conn = await mariadb.connect(config!);
    await expect(conn.query('select * from nowhere.nothing')).rejects.toThrow(/doesn't exist/);
    await conn.close();
  });
});
