import { describe, expect, it } from 'vitest';
import { genericDialect } from '@dbw/core';
import { statementAt } from './statements.js';

describe('statementAt', () => {
  const split = genericDialect.split;
  it('finds the statement under the cursor, or the one just before', () => {
    const text = 'select 1;\n\nselect 2\nfrom t;\n';
    expect(statementAt(text, 3, split)?.text).toBe('select 1');
    expect(statementAt(text, 9, split)?.text).toBe('select 1');
    expect(statementAt(text, 10, split)?.text).toBe('select 1');
    expect(statementAt(text, 15, split)?.text).toBe('select 2\nfrom t');
    expect(statementAt(text, text.length, split)?.text).toBe('select 2\nfrom t');
  });
  it('takes the first statement when the cursor is before all of them', () => {
    expect(statementAt('\n\nselect 1', 0, split)?.text).toBe('select 1');
    expect(statementAt('', 0, split)).toBeUndefined();
  });
});
