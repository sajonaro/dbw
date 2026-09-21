import { describe, expect, it } from 'vitest';
import type { TableInfo } from '@dbw/core';
import { analyze, membersOf, scopeOf } from './analyze.js';

const objects: TableInfo[] = [
  { schema: 'public', name: 'users', kind: 'table', columns: [{ name: 'id', type: 'int' }, { name: 'email', type: 'text' }] },
  { schema: 'public', name: 'posts', kind: 'table', columns: [{ name: 'id' }, { name: 'user_id' }, { name: 'title' }] },
  { schema: 'analytics', name: 'page_views', kind: 'view', columns: [{ name: 'url' }] },
];

const at = (sql: string) => {
  const offset = sql.indexOf('|');
  return analyze(sql.replace('|', ''), offset, objects);
};

describe('scope', () => {
  it('finds tables and aliases in FROM, JOIN, UPDATE and INTO', () => {
    const scope = scopeOf('select * from users u join public.posts as p on p.user_id = u.id', objects);
    expect(scope.map((s) => [s.raw, s.alias, s.table?.name])).toEqual([['users', 'u', 'users'], ['public.posts', 'p', 'posts']]);
    expect(scopeOf('update users set email = 1', objects)[0].alias).toBeUndefined();
    expect(scopeOf('insert into posts (title) values (1)', objects)[0].table?.name).toBe('posts');
  });
  it('does not take a keyword for an alias, nor read inside strings', () => {
    expect(scopeOf("select * from users where email = 'from nowhere n'", objects).map((s) => s.raw)).toEqual(['users']);
    expect(scopeOf('select * from users where', objects)[0].alias).toBeUndefined();
  });
  it('resolves quoted and schema-qualified names', () => {
    expect(scopeOf('select * from "analytics"."page_views" pv', objects)[0].table?.name).toBe('page_views');
    expect(scopeOf('select * from [users]', objects)[0].table?.name).toBe('users');
  });
});

describe('context', () => {
  it('offers tables after FROM and JOIN, and after a comma in FROM', () => {
    expect(at('select * from |').kind).toBe('table');
    expect(at('select * from us|').word).toBe('us');
    expect(at('select * from users u join |').kind).toBe('table');
    expect(at('select * from users, |').kind).toBe('table');
    expect(at('update |').kind).toBe('table');
    expect(at('insert into |').kind).toBe('table');
  });
  it('offers columns in SELECT, WHERE, ON, SET, ORDER BY and inside INSERT (', () => {
    expect(at('select | from users').kind).toBe('column');
    expect(at('select id, | from users').kind).toBe('column');
    expect(at('select * from users where |').kind).toBe('column');
    expect(at('select * from users where id = 1 and |').kind).toBe('column');
    expect(at('select * from users u join posts p on |').kind).toBe('column');
    expect(at('update users set |').kind).toBe('column');
    expect(at('select * from users order by |').kind).toBe('column');
    expect(at('insert into posts (|').kind).toBe('column');
  });
  it('resolves members through aliases, table names and schemas', () => {
    const c = at('select u.| from users u');
    expect(c.kind).toBe('member');
    if (c.kind !== 'member') return;
    expect(membersOf(c.owner, c.scope, objects).columns?.name).toBe('users');
    const byName = at('select users.| from users');
    if (byName.kind === 'member') expect(membersOf(byName.owner, byName.scope, objects).columns?.name).toBe('users');
    const schema = at('select * from analytics.|');
    if (schema.kind === 'member') expect(membersOf(schema.owner, schema.scope, objects).tables?.map((t) => t.name)).toEqual(['page_views']);
  });
  it('is not fooled by a keyword-looking alias position', () => {
    expect(at('select * from users u |').kind).toBe('any');
    expect(at('|').kind).toBe('any');
  });
});
