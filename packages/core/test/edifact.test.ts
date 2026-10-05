import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, formatEdifact, parseEdifact, type CompareOptions } from '../src/index.js';

const sample = `UNB+UNOA:3+SENDER+RECEIVER+20261006:1200+000000001'
UNH+1+BOOKING:D:93A:UN'
BGM+270+OB20261006+9'
DTM+137:20261006:102'
RFF+BN:OB20261006'
NAD+BY+CARRIER01::172'
NAD+CZ+CUSTOMER01::172'
LOC+7+USLAX::5'
LOC+11+SGSIN::5'
EQD+CN+TEU123456+22G1'
MEA+AAE+G+KGM:12000'
FTX+AAI++OCEAN BOOKING CONFIRMED FOR EXPORT SHIPMENT'
UNT+12+1'
UNZ+1+000000001'
`;
const full = readFileSync(new URL('../../../samples/ocean-booking.edi', import.meta.url), 'utf8');
const oneLine = sample.replace(/\r?\n/g, '');
const cmp = (a: string, b: string, o: CompareOptions = {}) =>
  compare({ name: 'a.edi', content: a }, { name: 'b.edi', content: b }, o);

describe('EDIFACT parsing', () => {
  it('reads the same segments from a one-liner and a multi-line file', () => {
    const a = parseEdifact({ name: 'a', content: oneLine });
    const b = parseEdifact({ name: 'b', content: sample });
    expect(a.segments.length).toBe(14);
    expect(a.segments.map((s) => s.raw)).toEqual(b.segments.map((s) => s.raw));
    expect(a.segments[9]).toMatchObject({ tag: 'EQD', elements: [['CN'], ['TEU123456'], ['22G1']] });
  });
  it('honours the release character and a custom UNA', () => {
    const d = parseEdifact({ name: 'a', content: "UNA:+.? 'UNB+X+A?+B+1'FTX+AAI+++it?'s 5?+5'" });
    expect(d.segments[0]!.elements[1]).toEqual(['A+B']);
    expect(d.segments[1]!.elements[3]).toEqual(["it's 5+5"]);
    const custom = parseEdifact({ name: 'a', content: 'UNA:+.? *UNB+X+A+B+1*FTX+AAI*' });
    expect(custom.segments).toHaveLength(2);
  });
  it('rejects things that are not EDIFACT', () => {
    expect(() => parseEdifact({ name: 'a', content: 'hello world' })).toThrow();
    expect(() => parseEdifact({ name: 'a', content: "UNB+X'BGM+1" })).toThrow(/not terminated/);
  });
});

describe('formatEdifact', () => {
  it('splits a one-liner into one segment per line', () => {
    expect(formatEdifact({ name: 'a', content: oneLine })).toBe(sample);
  });
  it('keeps the UNA line and custom terminator', () => {
    expect(formatEdifact({ name: 'a', content: 'UNA:+.? *UNB+X+A+B+1*FTX+AAI*' })).toBe('UNA:+.? *\nUNB+X+A+B+1*\nFTX+AAI*\n');
  });
});

describe('EDIFACT comparison', () => {
  it('layout does not matter', () => {
    const r = cmp(oneLine, sample);
    expect(r.format).toBe('edifact');
    expect(r.stats).toMatchObject({ added: 0, removed: 0, modified: 0 });
  });
  it('is detected by content even without an .edi extension', () => {
    const r = compare({ name: 'a.txt', content: oneLine }, { name: 'b.txt', content: sample });
    expect(r.format).toBe('edifact');
  });
  it('reports element-level changes with impact', () => {
    const r = cmp(sample, sample.replace('USLAX', 'USOAK').replace('KGM:12000', 'KGM:13000').replace('+9\'', "+5'"));
    const by = Object.fromEntries(r.changes.filter((c) => c.kind !== 'unchanged').map((c) => [c.path, c]));
    expect(by['LOC[7].2.1']).toMatchObject({ kind: 'modified', before: 'USLAX', after: 'USOAK', impact: 'high' });
    expect(by['MEA[AAE,G].3.2']).toMatchObject({ before: '12000', after: '13000', impact: 'medium' });
    expect(by['BGM.3']).toMatchObject({ before: '9', after: '5' });
    expect(r.impact).toBe('high');
  });
  it('treats envelope churn as informational', () => {
    const r = cmp(sample, sample.replace('20261006:1200+000000001', '20261007:0900+000000002').replace('UNZ+1+000000001', 'UNZ+1+000000002'));
    expect(r.stats.modified).toBeGreaterThan(0);
    expect(r.impact).toBe('informational');
  });
  it('matches segments by qualifier so an inserted segment does not shift the rest', () => {
    const r = cmp(sample, sample.replace("LOC+7+USLAX::5'", "LOC+9+USLAX::5'LOC+7+USLAX::5'"));
    const changed = r.changes.filter((c) => c.kind !== 'unchanged');
    expect(changed.map((c) => [c.path, c.kind])).toEqual([['LOC[9]', 'added']]);
  });
  it('supports ignore paths', () => {
    const r = cmp(sample, sample.replace('+000000001\'', "+000000002'"), { ignorePaths: ['UN*.*'] });
    expect(r.stats.modified).toBe(0);
  });
});

describe('the full sample booking', () => {
  it('parses, formats idempotently and tells repeated MEA segments apart', () => {
    const doc = parseEdifact({ name: 'a', content: full });
    expect(doc.segments.length).toBeGreaterThan(30);
    const flat = full.replace(/\r?\n/g, '');
    expect(formatEdifact({ name: 'a', content: flat })).toBe(full);
    const changed = full.replace('MEA+AAE+L+CM:600', 'MEA+AAE+L+CM:700');
    const r = cmp(full, changed);
    expect(r.changes.filter((c) => c.kind !== 'unchanged').map((c) => c.path)).toEqual(['MEA[AAE,L].3.2']);
    expect(cmp(flat, full).stats.modified).toBe(0);
  });
});
