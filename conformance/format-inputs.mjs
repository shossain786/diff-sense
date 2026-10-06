// Inputs for the formatter conformance cases. `expected` is generated from the TypeScript core.
const f = (name, content) => ({ name, content });
const fc = (name, input, indent) => ({ name, input, indent });

export const formatCases = [
  fc('json/one-line', f('a.json', '{"b":[1,2,{"c":"x,y:{z}"}],"1":12345678901234567890,"e":{},"f":[],"a":"q\\"uote"}')),
  fc('json/pretty-already', f('a.json', '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n')),
  fc('json/indent-4', f('a.json', '[1,{"a":null}]'), 4),
  fc('json/scalar', f('a.json', '  42  ')),
  fc('json/bom', f('a.json', '﻿{"a":true}')),
  fc('json/unicode-escapes', f('a.json', '{"k":"\\u00e9\\n","emoji":"😀"}')),
  fc('json/empty-with-space', f('a.json', '{ "a": { }, "b": [ ] }')),
  fc('json/invalid', f('a.json', '{"a":')),
  fc('xml/one-line', f('a.xml', '<?xml version="1.0"?><r a="x>y"><!-- c --><a x="1">t</a><b><c/><d>  keep \n this </d></b><e></e></r>')),
  fc('xml/already-pretty', f('a.xml', '<r>\n  <a>1</a>\n  <b>\n    <c/>\n  </b>\n</r>\n')),
  fc('xml/indent-4', f('a.xml', '<r><a><b>1</b></a></r>'), 4),
  fc('xml/cdata-and-pi', f('a.xml', '<r><?pi go?><a><![CDATA[<x>]]></a><b>text</b></r>')),
  fc('xml/mixed-content', f('a.xml', '<p>Hello <b>world</b>!</p>')),
  fc('xml/invalid', f('a.xml', '<a><b></a>')),
  fc('edifact/one-line', f('a.edi', "UNB+X+A+B+1'FTX+AAI+++text'UNZ+1+1'")),
  fc('edifact/una', f('a.edi', "UNA:+.? *UNB+X+A+B+1*FTX+AAI*")),
  fc('edifact/by-content', f('a.txt', "UNB+X+A+B+1'FTX+AAI'")),
  fc('edifact/crlf', f('a.edi', "UNB+X+A+B+1'\r\nFTX+AAI'\r\n")),
  fc('edifact/invalid', f('a.edi', "UNB+X+A+B+1'FTX+AAI")),
  fc('unsupported/text', f('a.txt', 'hello')),
  fc('unsupported/java', f('a.java', 'class A {}')),
];
