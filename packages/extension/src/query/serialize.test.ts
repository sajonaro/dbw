import { describe, expect, it } from 'vitest';
import { cell, toGrid } from './serialize.js';

describe('serialize', () => {
  it('makes values JSON-safe and readable', () => {
    expect(cell(null)).toBeNull();
    expect(cell(undefined)).toBeNull();
    expect(cell(10n)).toBe('10');
    expect(cell(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(cell(new Uint8Array([1, 255]))).toBe('0x01ff (2 bytes)');
    expect(cell({ a: 1 })).toBe('{"a":1}');
    expect(cell('x')).toBe('x');
  });
  it('caps rows but reports the total', () => {
    const g = toGrid({ columns: [{ name: 'n' }], rows: [[1], [2], [3]], durationMs: 1 }, 2);
    expect(g.rows).toEqual([[1], [2]]);
    expect(g.totalRows).toBe(3);
  });
});
