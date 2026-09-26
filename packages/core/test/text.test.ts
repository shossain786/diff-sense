import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare } from '../src/index.js';

const t = (a: string, b: string, o = {}) =>
  compare({ name: 'a.txt', content: a }, { name: 'b.txt', content: b }, o);

describe('text comparison', () => {
  it('PRD-style fixture: one modified line', () => {
    const fx = (p: string) => readFileSync(new URL(`../fixtures/text/${p}`, import.meta.url), 'utf8');
    const r = t(fx('a.txt'), fx('b.txt'));
    expect(r.changes).toEqual([
      { path: 'L2', kind: 'modified', before: 'world', after: 'there', evidence: 'fact' },
    ]);
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 1, unchanged: 1 });
  });
  it('identical, empty, and trailing newline', () => {
    expect(t('a\nb\n', 'a\nb\n').changes).toEqual([]);
    expect(t('', '').changes).toEqual([]);
    expect(t('a\nb', 'a\nb\n').changes).toEqual([]);
  });
  it('added and removed lines', () => {
    const r = t('a\nb\nc\n', 'a\nc\nd\n');
    expect(r.changes.map((c) => `${c.kind}:${c.path}`)).toEqual(['removed:L2', 'added:L3']);
  });
  it('ignoreWhitespace / ignoreCase / CRLF', () => {
    expect(t('a  b\n', 'a b\n').changes).toHaveLength(1);
    expect(t('a  b\n', ' a b \n', { ignoreWhitespace: true }).changes).toEqual([]);
    expect(t('Hello\n', 'hello\n', { ignoreCase: true }).changes).toEqual([]);
    expect(t('a\r\nb\r\n', 'a\nb\n').changes).toEqual([]);
  });
  it('non-implemented structural formats fall back with a warning', () => {
    const r = compare({ name: 'a.xml', content: '<a/>' }, { name: 'b.xml', content: '<b/>' });
    expect(r.warnings[0]).toMatch(/No structural comparator for xml/);
    expect(r.changes).toHaveLength(1);
  });
});
