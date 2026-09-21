import type { Statement } from '@dbw/core';

/**
 * The statement the cursor is in, by the dialect's own splitting.  A
 * cursor in the blank after a statement belongs to that statement, which
 * is what a person who just typed a semicolon and pressed Ctrl+Enter means;
 * only before the first statement does it mean the one ahead.
 */
export function statementAt(text: string, offset: number, split: (text: string) => Statement[]): Statement | undefined {
  const all = split(text);
  if (all.length === 0) return undefined;
  const inside = all.find((s) => offset >= s.start && offset <= s.end);
  if (inside) return inside;
  const before = [...all].reverse().find((s) => s.end < offset);
  return before ?? all.find((s) => s.start > offset);
}
