import { describe, expect, it } from 'vitest';
import { compare, formatContent } from '../src/index.js';

const fmt = (name: string, content: string, indent?: number) => formatContent({ name, content }, { indent });

describe('formatContent', () => {
  it('indents JSON and preserves values, key order and big numbers', () => {
    const src = '{"b":[1,2,{"c":"x,y:{z}"}],"1":12345678901234567890,"e":{},"f":[],"a":"q\\"uote"}';
    const out = fmt('a.json', src);
    expect(out).toBe(
      '{\n  "b": [\n    1,\n    2,\n    {\n      "c": "x,y:{z}"\n    }\n  ],\n  "1": 12345678901234567890,\n  "e": {},\n  "f": [],\n  "a": "q\\"uote"\n}\n',
    );
    expect(JSON.parse(out)).toEqual(JSON.parse(src));
    expect(fmt('a.json', '[1]', 4)).toBe('[\n    1\n]\n');
  });
  it('is idempotent', () => {
    const once = fmt('a.json', '{"a":[1,{"b":2}]}');
    expect(fmt('a.json', once)).toBe(once);
  });
  it('indents XML between elements and keeps text content verbatim', () => {
    const src = '<?xml version="1.0"?><r a="x>y"><!-- c --><a x="1">t</a><b><c/><d>  keep \n this </d></b><e></e></r>';
    expect(fmt('a.xml', src)).toBe(
      '<?xml version="1.0"?>\n<r a="x>y">\n  <!-- c -->\n  <a x="1">t</a>\n  <b>\n    <c/>\n    <d>  keep \n this </d>\n  </b>\n  <e></e>\n</r>\n',
    );
  });
  it('formats XML without changing what the comparison sees', () => {
    const src = '<r><a>1</a><b><c x="2"/></b></r>';
    const r = compare({ name: 'a.xml', content: src }, { name: 'b.xml', content: fmt('b.xml', src) });
    expect(r.stats.modified + r.stats.added + r.stats.removed).toBe(0);
  });
  it('formats YAML and keeps comments', () => {
    expect(fmt('a.yaml', 'a:   1\n# note\nb:\n    - x\n    - y\n')).toBe('a: 1\n# note\nb:\n  - x\n  - y\n');
  });
  it('splits EDIFACT into segments', () => {
    expect(fmt('a.txt', "UNB+X+A+B+1'FTX+AAI'")).toBe("UNB+X+A+B+1'\nFTX+AAI'\n");
  });
  it('refuses invalid input and unsupported formats', () => {
    expect(() => fmt('a.json', '{"a":')).toThrow(/invalid JSON/);
    expect(() => fmt('a.xml', '<a><b></a>')).toThrow(/invalid XML/);
    expect(() => fmt('a.java', 'class A {}')).toThrow(/supports/);
  });
});
