import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, type CompareOptions } from '../src/index.js';

const fx = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8');
const j = (name: string, v: unknown) => ({ name, content: JSON.stringify(v) });
const run = (a: unknown, b: unknown, o: CompareOptions = {}) =>
  compare(j('a.json', a), j('b.json', b), o);
const summary = (r: ReturnType<typeof run>) =>
  r.changes.filter((c) => c.kind !== 'unchanged').map((c) => `${c.kind}:${c.path}`);

describe('JSON golden', () => {
  it('matches PRD example', () => {
    const r = compare(
      { name: 'a.json', content: fx('json/config-a.json') },
      { name: 'b.json', content: fx('json/config-b.json') },
    );
    const got = r.changes.map(({ path, kind, before, after }) => ({ path, kind, before, after }));
    expect(got).toEqual(JSON.parse(fx('json/expected.json')));
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 2, unchanged: 1 });
  });
});

describe('JSON structural diff', () => {
  it('identical input has no changes', () => {
    const v = { a: [1, { b: 2 }], c: 'x' };
    expect(summary(run(v, v))).toEqual([]);
  });
  it('detects added, removed, and nested changes', () => {
    const r = run({ a: 1, n: { x: 1 } }, { b: 2, n: { x: 2 } });
    expect(summary(r)).toEqual(['removed:a', 'modified:n.x', 'added:b']);
  });
  it('reports type changes as modified', () => {
    expect(summary(run({ a: 1 }, { a: '1' }))).toEqual(['modified:a']);
    expect(summary(run({ a: {} }, { a: [] }))).toEqual(['modified:a']);
  });
  it('is symmetric (added <-> removed)', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1, z: 3 };
    expect(summary(run(a, b))).toEqual(['removed:y', 'added:z']);
    expect(summary(run(b, a))).toEqual(['removed:z', 'added:y']);
  });
  it('handles array length changes with index paths', () => {
    expect(summary(run({ l: [1, 2] }, { l: [1, 2, 3] }))).toEqual(['added:l[2]']);
    expect(summary(run({ l: [1, 2, 3] }, { l: [1] }))).toEqual(['removed:l[1]', 'removed:l[2]']);
  });
});

describe('JSON options', () => {
  it('key order is ignored by default, reported when ignoreOrdering=false', () => {
    const a = JSON.parse('{"a":1,"b":2}');
    const b = JSON.parse('{"b":2,"a":1}');
    expect(summary(run(a, b))).toEqual([]);
    expect(summary(run(a, b, { ignoreOrdering: false }))).toEqual(['modified:$']);
  });
  it('ignoreArrayOrder', () => {
    expect(summary(run({ t: [1, 2, 3] }, { t: [3, 1, 2] }))).not.toEqual([]);
    expect(summary(run({ t: [1, 2, 3] }, { t: [3, 1, 2] }, { ignoreArrayOrder: true }))).toEqual([]);
    expect(summary(run({ t: [1, 2] }, { t: [2, 1, 9] }, { ignoreArrayOrder: true }))).toEqual([
      'added:t[2]',
    ]);
  });
  it('ignorePaths with globs', () => {
    const a = { id: 1, meta: { ts: 1, by: 'x' }, l: [{ ts: 1 }] };
    const b = { id: 1, meta: { ts: 2, by: 'y' }, l: [{ ts: 9 }] };
    expect(summary(run(a, b, { ignorePaths: ['meta'] }))).toEqual(['modified:l[0].ts']);
    expect(summary(run(a, b, { ignorePaths: ['meta.*', 'l[*].ts'] }))).toEqual([]);
    expect(summary(run(a, b, { ignorePaths: ['**.ts'] }))).toEqual(['modified:meta.by']);
  });
  it('ignoreCase and ignoreWhitespace apply to strings', () => {
    expect(summary(run({ s: 'Hello  World' }, { s: 'hello world' }))).toEqual(['modified:s']);
    expect(
      summary(run({ s: 'Hello  World' }, { s: 'hello world' }, { ignoreCase: true, ignoreWhitespace: true })),
    ).toEqual([]);
  });
  it('numericEquality compares numeric strings to numbers', () => {
    expect(summary(run({ n: '30' }, { n: 30 }))).toEqual(['modified:n']);
    expect(summary(run({ n: '30.0' }, { n: 30 }, { numericEquality: true }))).toEqual([]);
  });
});

describe('fallback', () => {
  it('invalid JSON falls back to text with a warning', () => {
    const r = compare({ name: 'a.json', content: '{oops' }, { name: 'b.json', content: '{}' });
    expect(r.format).toBe('text');
    expect(r.warnings[0]).toMatch(/Invalid JSON/);
  });
});
