import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { defineDialect, genericDialect } from '@dbw/core';
import { createPrql, type PrqlModule } from './index.js';

const require = createRequire(import.meta.url);
const prql = createPrql(() => require('prql-js') as PrqlModule);

describe('PRQL', () => {
  it('compiles to the target dialect', () => {
    const sqlite = defineDialect({ id: 'sqlite', name: 'SQLite', splitter: 'sqlite' });
    const mssql = defineDialect({ id: 'mssql', name: 'T-SQL', quote: 'bracket', limit: 'top' });
    const src = 'from users | filter id > 1 | select {id, name} | take 10';
    expect(prql.compile(src, sqlite)).toMatch(/SELECT\s+id,\s+name\s+FROM\s+users\s+WHERE\s+id > 1\s+LIMIT\s+10/);
    expect(prql.compile(src, mssql)).toMatch(/FETCH\s+FIRST\s+10\s+ROWS\s+ONLY|TOP\s+10/);
    expect(prql.compile('from t | take 1', genericDialect)).toContain('LIMIT');
    const mariadb = defineDialect({ id: 'mariadb', name: 'MariaDB', quote: 'backtick' });
    expect(prql.compile('from t | select {`my col`} | take 1', mariadb)).toMatch(/`my col`/);
  });
  it('turns compiler errors into one readable line', () => {
    expect(() => prql.compile('from users | filtre x', genericDialect)).toThrow(/PRQL: Unknown name `filtre`/);
  });
  it('formats', () => {
    expect(prql.format!('from users|select {id}').trim()).toBe('from users\nselect {id}');
  });
});
