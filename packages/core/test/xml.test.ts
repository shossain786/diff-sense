import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, type CompareOptions } from '../src/index.js';

const fx = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8');
const x = (a: string, b: string, o: CompareOptions = {}) =>
  compare({ name: 'a.xml', content: a }, { name: 'b.xml', content: b }, o);
const summary = (r: ReturnType<typeof x>) =>
  r.changes.filter((c) => c.kind !== 'unchanged').map((c) => `${c.kind}:${c.path}`);

describe('XML', () => {
  it('matches PRD example', () => {
    const r = x(fx('xml/user-a.xml'), fx('xml/user-b.xml'));
    const got = r.changes.map(({ path, kind, before, after }) => ({ path, kind, before, after }));
    expect(got).toEqual(JSON.parse(fx('xml/expected.json')));
    expect(r.format).toBe('xml');
  });
  it('ignores indentation and comments', () => {
    expect(summary(x('<a><b>1</b></a>', '<a>\n  <!-- hi -->\n  <b>1</b>\n</a>'))).toEqual([]);
  });
  it('detects attribute changes; attribute order is irrelevant', () => {
    expect(summary(x('<a x="1" y="2"/>', '<a y="2" x="1"/>'))).toEqual([]);
    expect(summary(x('<a x="1"/>', '<a x="2" z="3"/>'))).toEqual(['modified:a.@x', 'added:a.@z']);
  });
  it('handles repeated elements as indexed paths', () => {
    expect(summary(x('<l><i>1</i><i>2</i></l>', '<l><i>1</i><i>3</i><i>4</i></l>'))).toEqual([
      'modified:l.i[1]',
      'added:l.i[2]',
    ]);
    expect(
      summary(x('<l><i>1</i><i>2</i></l>', '<l><i>2</i><i>1</i></l>', { ignoreArrayOrder: true })),
    ).toEqual([]);
  });
  it('detects added/removed elements', () => {
    expect(summary(x('<a><b/><c/></a>', '<a><b/><d/></a>'))).toEqual(['removed:a.c', 'added:a.d']);
  });
  it('mixed content keeps text under #text', () => {
    expect(summary(x('<a k="1">hi</a>', '<a k="1">bye</a>'))).toEqual(['modified:a.#text']);
  });
  it('treats CDATA as text', () => {
    expect(summary(x('<a><![CDATA[x<y]]></a>', '<a>x&lt;y</a>'))).toEqual([]);
  });
  it('ignoreAttributes', () => {
    expect(summary(x('<a id="1" v="x"/>', '<a id="2" v="x"/>', { ignoreAttributes: ['id'] }))).toEqual(
      [],
    );
  });
  it('namespaces: prefixes matter unless ignoreNamespaces', () => {
    const a = '<r xmlns:p="u"><p:i>1</p:i></r>';
    const b = '<r xmlns:q="u"><q:i>1</q:i></r>';
    expect(summary(x(a, b))).not.toEqual([]);
    expect(summary(x(a, b, { ignoreNamespaces: true }))).toEqual([]);
  });
  it('XML declaration compared unless ignored', () => {
    const a = '<?xml version="1.0" encoding="UTF-8"?><a/>';
    const b = '<a/>';
    expect(summary(x(a, b))).toEqual(['removed:?xml']);
    expect(summary(x(a, b, { ignoreXmlDeclaration: true }))).toEqual([]);
  });
  it('ignoreWhitespace collapses text whitespace', () => {
    expect(summary(x('<a>x  y</a>', '<a>x y</a>'))).toEqual(['modified:a']);
    expect(summary(x('<a>x  y</a>', '<a>x y</a>', { ignoreWhitespace: true }))).toEqual([]);
  });
  it('malformed XML falls back to text with a warning', () => {
    const r = x('<a><b></a>', '<a/>');
    expect(r.format).toBe('text');
    expect(r.warnings[0]).toMatch(/Invalid XML/);
  });
});
