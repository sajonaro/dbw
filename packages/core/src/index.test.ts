import { describe, expect, it } from 'vitest';
import { defineDialect, genericDialect, groupColumns } from './index.js';

describe('defineDialect', () => {
  it('splits by flavour, with positions', () => {
    const mssql = defineDialect({ id: 't', name: 't', splitter: 'mssql', quote: 'bracket', limit: 'top' });
    expect(mssql.split('select 1\nGO\nselect 2').map((s) => s.text)).toEqual(['select 1', 'select 2']);
    const pg = defineDialect({ id: 'p', name: 'p', splitter: 'postgres' });
    expect(pg.split('select $$a;b$$; select 2').map((s) => [s.text, s.start, s.end])).toEqual([['select $$a;b$$', 0, 14], ['select 2', 16, 24]]);
    expect(genericDialect.split('select 1;\nselect 2;').map((s) => s.text)).toEqual(['select 1', 'select 2']);
  });
  it('quotes, qualifies and limits by name', () => {
    const mssql = defineDialect({ id: 't', name: 't', quote: 'bracket', limit: 'top' });
    expect(mssql.selectFrom({ schema: 'dbo', name: 'a]b', kind: 'table' }, 5)).toBe('SELECT TOP 5 * FROM [dbo].[a]]b]');
    expect(genericDialect.selectFrom({ name: 'x', kind: 'view' }, 10)).toBe('SELECT * FROM "x" LIMIT 10');
  });
  it('takes functions for anything unusual', () => {
    const odd = defineDialect({
      id: 'o', name: 'o',
      quote: (s) => `<${s}>`,
      limit: (t, n, q) => `FIRST ${n} OF ${q(t)}`,
      splitter: (text) => text.split('|').map((t, i) => ({ text: t, start: i, end: i })),
      formatter: (sql) => sql.toUpperCase(),
    });
    expect(odd.selectFrom({ name: 't', kind: 'table' }, 3)).toBe('FIRST 3 OF <t>');
    expect(odd.split('a|b').map((s) => s.text)).toEqual(['a', 'b']);
    expect(odd.format('select')).toBe('SELECT');
  });
  it('formats with the dialect', () => {
    expect(genericDialect.format('select a,b from t where x=1')).toBe('SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1');
  });
});

describe('groupColumns', () => {
  it('folds one row per column into one entry per table, keeping column order', () => {
    const rows = [
      { schema: 'public', name: 'people', kind: 'table' as const, column: { name: 'id', type: 'int' } },
      { schema: 'public', name: 'people', kind: 'table' as const, column: { name: 'name', type: 'text' } },
      { schema: 'public', name: 'adults', kind: 'view' as const, column: { name: 'id' } },
      { name: 'loose', kind: 'table' as const, column: { name: 'x' } },
    ];
    expect(groupColumns(rows)).toEqual([
      { schema: 'public', name: 'people', kind: 'table', columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'text' }] },
      { schema: 'public', name: 'adults', kind: 'view', columns: [{ name: 'id' }] },
      { schema: undefined, name: 'loose', kind: 'table', columns: [{ name: 'x' }] },
    ]);
  });
});
