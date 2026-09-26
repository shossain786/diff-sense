import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, computeStats, detectFormat } from '../src/index.js';

const fx = (p: string) =>
  readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8');

describe('detectFormat', () => {
  it.each([
    ['a.json', 'json'],
    ['a.XML', 'xml'],
    ['a.yml', 'yaml'],
    ['a.yaml', 'yaml'],
    ['A.java', 'java'],
    ['notes.txt', 'text'],
    ['Makefile', 'text'],
  ])('%s -> %s', (name, format) => {
    expect(detectFormat(name)).toBe(format);
  });
});

describe('computeStats', () => {
  it('counts each kind', () => {
    const s = computeStats([
      { path: 'a', kind: 'added', evidence: 'fact' },
      { path: 'b', kind: 'modified', evidence: 'fact' },
      { path: 'c', kind: 'modified', evidence: 'fact' },
    ]);
    expect(s).toEqual({ added: 1, removed: 0, modified: 2, unchanged: 0 });
  });
});

describe('compare', () => {
  it('returns a well-formed result', () => {
    const r = compare(
      { name: 'a.json', content: fx('json/config-a.json') },
      { name: 'b.json', content: fx('json/config-b.json') },
    );
    expect(r.format).toBe('json');
    expect(r.left).toBe('a.json');
  });
});

// Golden expectations for Phase 1 comparators. Enabled as each lands.
describe.skip('golden fixtures (Phase 1)', () => {
  it.each([
    ['xml', 'user-a.xml', 'user-b.xml'],
    ['yaml', 'config-a.yaml', 'config-b.yaml'],
  ])('%s', (dir, a, b) => {
    const r = compare(
      { name: a, content: fx(`${dir}/${a}`) },
      { name: b, content: fx(`${dir}/${b}`) },
    );
    const expected = JSON.parse(fx(`${dir}/expected.json`));
    expect(
      r.changes.map(({ path, kind, before, after }) => ({ path, kind, before, after })),
    ).toEqual(expected);
  });
});
