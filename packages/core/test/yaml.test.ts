import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, type CompareOptions } from '../src/index.js';

const fx = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8');
const y = (a: string, b: string, o: CompareOptions = {}) =>
  compare({ name: 'a.yaml', content: a }, { name: 'b.yml', content: b }, o);
const summary = (r: ReturnType<typeof y>) =>
  r.changes.filter((c) => c.kind !== 'unchanged').map((c) => `${c.kind}:${c.path}`);

describe('YAML', () => {
  it('matches PRD example', () => {
    const r = y(fx('yaml/config-a.yaml'), fx('yaml/config-b.yaml'));
    const got = r.changes.map(({ path, kind, before, after }) => ({ path, kind, before, after }));
    expect(got).toEqual(JSON.parse(fx('yaml/expected.json')));
    expect(r.format).toBe('yaml');
  });
  it('ignores comments, formatting and key order', () => {
    expect(
      summary(y('# c\na: 1\nb: [1, 2]\n', 'b:\n  - 1\n  - 2\na: 1 # note\n')),
    ).toEqual([]);
  });
  it('resolves anchors, aliases and merge keys', () => {
    const a = 'base: &b {x: 1}\nsvc:\n  <<: *b\n  y: 2\n';
    const b = 'base: {x: 1}\nsvc: {x: 1, y: 2}\n';
    expect(summary(y(a, b))).toEqual([]);
    expect(summary(y(a, 'base: {x: 1}\nsvc: {x: 9, y: 2}\n'))).toEqual(['modified:svc.x']);
  });
  it('supports multi-document files', () => {
    expect(summary(y('a: 1\n---\nb: 2\n', 'a: 1\n---\nb: 3\n'))).toEqual(['modified:[1].b']);
  });
  it('detects nested and list changes; shared options apply', () => {
    expect(summary(y('s:\n  - {n: a}\n  - {n: b}\n', 's:\n  - {n: a}\n'))).toEqual(['removed:s[1]']);
    expect(summary(y('t: [1,2]\n', 't: [2,1]\n', { ignoreArrayOrder: true }))).toEqual([]);
    expect(summary(y('a: 1\nts: 5\n', 'a: 1\nts: 6\n', { ignorePaths: ['ts'] }))).toEqual([]);
  });
  it('empty documents compare equal', () => {
    expect(summary(y('', '# only a comment\n'))).toEqual([]);
  });
  it('invalid YAML falls back to text with a warning', () => {
    const r = y('a: [1, 2\n', 'a: 1\n');
    expect(r.format).toBe('text');
    expect(r.warnings[0]).toMatch(/Invalid YAML/);
  });
});
