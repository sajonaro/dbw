import { describe, expect, it } from 'vitest';
import sqlite, { dialect } from './index.js';

describe('sqlite driver', () => {
  it('runs a batch, returns rows and affected counts, and lists what it made', async () => {
    const conn = await sqlite.connect({ file: ':memory:' });
    const results = await conn.query(`
      create table people (id integer primary key, name text not null);
      insert into people (name) values ('ann'), ('bob');
      select id, name from people order by id;
    `);
    expect(results).toHaveLength(3);
    expect(results[1].affected).toBe(2);
    expect(results[2].columns.map((c) => c.name)).toEqual(['id', 'name']);
    expect(results[2].rows).toEqual([[1, 'ann'], [2, 'bob']]);

    const tables = await conn.children((await conn.roots())[0]);
    expect(tables.map((t) => t.name)).toEqual(['people']);
    expect((await conn.children(tables[0])).map((c) => [c.name, c.detail])).toEqual([['id', 'INTEGER'], ['name', 'TEXT']]);
    const objects = await conn.objects();
    expect(objects[0].columns.map((c) => c.name)).toEqual(['id', 'name']);
    expect(dialect.selectFrom(objects[0], 100)).toBe('SELECT * FROM "people" LIMIT 100');
    await conn.close();
  });

  it('reports a bad statement as an error', async () => {
    const conn = await sqlite.connect({ file: ':memory:' });
    await expect(conn.query('select * from nowhere')).rejects.toThrow(/no such table/);
    await conn.close();
  });
});
