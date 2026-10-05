import { XMLValidator } from 'fast-xml-parser';
import { parseAllDocuments } from 'yaml';
import { detectFormat } from './detect.js';
import { formatEdifact, looksLikeEdifact } from './edifact.js';
import { ParseError } from './json.js';
import type { FileInput, Format } from './types.js';

export interface FormatOptions {
  /** Spaces per level for JSON, XML and YAML. Default 2. */
  indent?: number;
  /** Force a format instead of detecting it from the file name or content. */
  format?: Format;
}

export const FORMATTABLE: Format[] = ['json', 'xml', 'yaml', 'edifact'];

/** Re-indents JSON without touching values: strings, numbers and key order are kept exactly. */
function formatJson(input: FileInput, indent: number): string {
  const src = input.content.replace(/^﻿/, '');
  try {
    JSON.parse(src);
  } catch (e) {
    throw new ParseError(`${input.name}: invalid JSON (${(e as Error).message})`);
  }
  const pad = (n: number) => ' '.repeat(indent * n);
  let out = '';
  let depth = 0;
  let i = 0;
  const skipWs = (from: number) => {
    let j = from;
    while (j < src.length && /\s/.test(src[j]!)) j++;
    return j;
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) i++;
    else if (ch === '"') {
      let j = i + 1;
      while (src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '{' || ch === '[') {
      const next = skipWs(i + 1);
      if (src[next] === (ch === '{' ? '}' : ']')) {
        out += ch + src[next]!;
        i = next + 1;
      } else {
        depth++;
        out += `${ch}\n${pad(depth)}`;
        i++;
      }
    } else if (ch === '}' || ch === ']') {
      depth--;
      out += `\n${pad(depth)}${ch}`;
      i++;
    } else if (ch === ',') {
      out += `,\n${pad(depth)}`;
      i++;
    } else if (ch === ':') {
      out += ': ';
      i++;
    } else {
      let j = i;
      while (j < src.length && !/[\s,\]}:]/.test(src[j]!)) j++;
      out += src.slice(i, j);
      i = j;
    }
  }
  return out + '\n';
}

interface XNode {
  kind: 'el' | 'text' | 'misc';
  /** Start tag, or the whole token for text/misc. */
  open: string;
  close?: string;
  children: XNode[];
  /** Original text between the start and end tag. */
  inner?: string;
  selfClosing?: boolean;
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>[]|\[[\s\S]*?\])*>|<\/[^>]+>|<(?:[^>"']|"[^"]*"|'[^']*')+>|[^<]+/g;

/**
 * Re-indents XML. Element content is only re-flowed between elements: text is
 * never trimmed or re-wrapped, so an element that holds text keeps its content
 * exactly as written.
 */
function formatXml(input: FileInput, indent: number): string {
  const src = input.content.replace(/^﻿/, '');
  const valid = XMLValidator.validate(src);
  if (valid !== true) throw new ParseError(`${input.name}: invalid XML (${valid.err.msg})`);

  const root: XNode = { kind: 'el', open: '', children: [] };
  const stack: { node: XNode; innerStart: number }[] = [{ node: root, innerStart: 0 }];
  for (const m of src.matchAll(TOKEN)) {
    const tok = m[0];
    const top = stack[stack.length - 1]!;
    if (tok.startsWith('</')) {
      top.node.inner = src.slice(top.innerStart, m.index);
      top.node.close = tok;
      stack.pop();
    } else if (tok.startsWith('<') && !/^<(!|\?)/.test(tok)) {
      const node: XNode = { kind: 'el', open: tok, children: [], selfClosing: tok.endsWith('/>') };
      top.node.children.push(node);
      if (!node.selfClosing) stack.push({ node, innerStart: m.index + tok.length });
    } else {
      top.node.children.push({ kind: tok.startsWith('<') ? 'misc' : 'text', open: tok, children: [] });
    }
  }

  const lines: string[] = [];
  const emit = (n: XNode, depth: number) => {
    const pad = ' '.repeat(indent * depth);
    if (n.kind === 'misc') return void lines.push(pad + n.open);
    if (n.kind === 'text') return;
    if (n.selfClosing) return void lines.push(pad + n.open);
    const hasText = n.children.some((c) => c.kind === 'text' && c.open.trim() !== '' || c.open.startsWith('<![CDATA['));
    const kids = n.children.filter((c) => !(c.kind === 'text' && c.open.trim() === ''));
    if (hasText || kids.length === 0) {
      const inner = kids.length === 0 ? '' : n.inner!;
      return void lines.push(pad + n.open + inner + n.close!);
    }
    lines.push(pad + n.open);
    for (const c of kids) emit(c, depth + 1);
    lines.push(pad + n.close!);
  };
  for (const c of root.children) emit(c, 0);
  return lines.join('\n') + '\n';
}

function formatYaml(input: FileInput, indent: number): string {
  const docs = parseAllDocuments(input.content.replace(/^﻿/, ''), { merge: true });
  for (const d of docs) {
    if (d.errors.length > 0) throw new ParseError(`${input.name}: invalid YAML (${d.errors[0]!.message.split('\n')[0]})`);
  }
  return docs.map((d) => d.toString({ indent })).join('---\n');
}

/**
 * Reformats a file for readability: indented JSON/XML/YAML, or one EDIFACT
 * segment per line. Throws a ParseError when the content is not valid for its
 * format (nothing is guessed or repaired).
 */
export function formatContent(input: FileInput, options: FormatOptions = {}): string {
  const indent = options.indent ?? 2;
  let format = options.format ?? detectFormat(input.name);
  if (format === 'text' && !options.format && looksLikeEdifact(input.content)) format = 'edifact';
  if (format === 'json') return formatJson(input, indent);
  if (format === 'xml') return formatXml(input, indent);
  if (format === 'yaml') return formatYaml(input, indent);
  if (format === 'edifact') return formatEdifact(input);
  throw new ParseError(`${input.name}: formatting supports ${FORMATTABLE.join(', ')} files`);
}
