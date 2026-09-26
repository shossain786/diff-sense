import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { diffValues, ParseError } from './json.js';
import { computeStats } from './stats.js';
import type { ComparisonResult, CompareOptions, FileInput } from './types.js';

type Node = Record<string, unknown>;
type Attrs = Record<string, string>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: false,
});

const stripPrefix = (name: string) => name.slice(name.indexOf(':') + 1);

/**
 * Converts XML into a plain value tree so the shared structural differ can
 * be reused: attributes become `@name`, mixed text `#text`, repeated sibling
 * elements an array, and a leaf element without attributes just its text.
 * Paths therefore read like `user.age`, `item[1].name`, `user.@id`.
 * Comments are ignored; CDATA is treated as text.
 */
export function parseXml(input: FileInput, options: CompareOptions): unknown {
  const valid = XMLValidator.validate(input.content);
  if (valid !== true) throw new ParseError(`${input.name}: ${valid.err.msg}`);
  const tree = parser.parse(input.content) as Node[];

  const skipAttrs = new Set(options.ignoreAttributes ?? []);
  const name = (n: string) => (options.ignoreNamespaces ? stripPrefix(n) : n);

  const attrsOf = (node: Node): Attrs => {
    const out: Attrs = {};
    for (const [k, v] of Object.entries((node[':@'] as Attrs | undefined) ?? {})) {
      const raw = k.slice(1);
      if (options.ignoreNamespaces && (raw === 'xmlns' || raw.startsWith('xmlns:'))) continue;
      const n = name(raw);
      if (skipAttrs.has(raw) || skipAttrs.has(n)) continue;
      out[`@${n}`] = v;
    }
    return out;
  };

  const convert = (children: Node[], attrs: Attrs): unknown => {
    const out: Record<string, unknown> = { ...attrs };
    const counts = new Map<string, number>();
    const elements: [string, unknown][] = [];
    let text = '';
    for (const child of children) {
      const tag = Object.keys(child).find((k) => k !== ':@')!;
      if (tag === '#text') text += child['#text'] as string;
      else {
        elements.push([name(tag), convert(child[tag] as Node[], attrsOf(child))]);
        counts.set(name(tag), (counts.get(name(tag)) ?? 0) + 1);
      }
    }
    if (elements.length > 0 && text.trim() === '') text = '';
    if (text !== '') out['#text'] = text;
    for (const [tag, value] of elements) {
      if (counts.get(tag)! > 1) ((out[tag] ??= []) as unknown[]).push(value);
      else out[tag] = value;
    }
    const keys = Object.keys(out);
    if (keys.length === 0) return '';
    return keys.length === 1 && keys[0] === '#text' ? out['#text'] : out;
  };

  const root: Record<string, unknown> = {};
  for (const node of tree) {
    const tag = Object.keys(node).find((k) => k !== ':@')!;
    if (tag === '#text') continue;
    if (tag === '?xml') {
      if (!options.ignoreXmlDeclaration) root['?xml'] = attrsOf(node);
      continue;
    }
    root[name(tag)] = convert(node[tag] as Node[], attrsOf(node));
  }
  return root;
}

export function compareXml(
  left: FileInput,
  right: FileInput,
  options: CompareOptions = {},
): ComparisonResult {
  const changes = diffValues(parseXml(left, options), parseXml(right, options), options);
  return {
    format: 'xml',
    left: left.name,
    right: right.name,
    changes,
    stats: computeStats(changes),
    warnings: [],
  };
}
