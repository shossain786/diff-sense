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
    const r = compare({ name: 'a.java', content: '<a/>' }, { name: 'b.java', content: '<b/>' });
    expect(r.warnings[0]).toMatch(/No structural comparator for java/);
    expect(r.changes).toHaveLength(1);
  });
});

describe('text alignment (Myers)', () => {
  const N = 20000;
  const gen = (d: number) =>
    Array.from({ length: N }, (_, i) => 'line ' + (i % 500 === 0 ? `${i}x${d}` : i)).join('\n');
  it('scales with the number of edits, not file size', () => {
    const t0 = Date.now();
    const r = t(gen(0), gen(1));
    expect(r.warnings).toEqual([]);
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 40, unchanged: N - 40 });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('is a valid edit script for shuffled/edited input', () => {
    const rnd = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
    const r = rnd(7);
    for (let round = 0; round < 50; round++) {
      const a = Array.from({ length: 30 }, () => String(Math.floor(r() * 6)));
      const b = Array.from({ length: 30 }, () => String(Math.floor(r() * 6)));
      const res = t(a.join('\n'), b.join('\n'));
      const { added, removed, modified, unchanged } = res.stats;
      expect(unchanged + removed + modified).toBe(a.length);
      expect(unchanged + added + modified).toBe(b.length);
    }
  });
  it('gives up gracefully on totally different large inputs', () => {
    const a = Array.from({ length: 5000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 5000 }, (_, i) => `b${i}`).join('\n');
    const r = t(a, b);
    expect(r.warnings[0]).toMatch(/differ too much/);
    expect(r.stats.modified).toBe(5000);
  });
});
