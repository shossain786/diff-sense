import { compileGlobs, matchesAny } from './glob.js';
import { ParseError } from './json.js';
import { computeStats } from './stats.js';
import type { Change, ComparisonResult, CompareOptions, FileInput, Impact } from './types.js';

export interface EdifactSegment {
  tag: string;
  /** Data elements after the tag; each is a list of components. */
  elements: string[][];
  /** The segment exactly as written (terminator excluded, line breaks removed). */
  raw: string;
}

export interface EdifactDocument {
  /** The `UNA` service string advice, when present. */
  una?: string;
  segments: EdifactSegment[];
}

interface Delimiters {
  component: string;
  element: string;
  release: string;
  terminator: string;
}

const DEFAULTS: Delimiters = { component: ':', element: '+', release: '?', terminator: "'" };

/** True when the text looks like an EDIFACT interchange (starts with UNA or UNB). */
export const looksLikeEdifact = (content: string): boolean => /^\s*(UNA.{6}\s*)?UNB\+/.test(content.replace(/^﻿/, ''));

/**
 * Parses an EDIFACT interchange. Delimiters come from the `UNA` header when
 * present. Line breaks are not significant (files arrive as one line or one
 * segment per line), unless escaped with the release character.
 */
export function parseEdifact(input: FileInput): EdifactDocument {
  let text = input.content.replace(/^﻿/, '').replace(/^\s+/, '');
  const d = { ...DEFAULTS };
  let una: string | undefined;
  if (text.startsWith('UNA')) {
    if (text.length < 9) throw new ParseError(`${input.name}: truncated UNA service string advice`);
    una = text.slice(0, 9);
    d.component = una[3]!;
    d.element = una[4]!;
    d.release = una[6]!;
    d.terminator = una[8]!;
    text = text.slice(9);
  }

  const segments: EdifactSegment[] = [];
  let raw = '';
  let elements: string[][] = [[]];
  let value = '';
  const endComponent = () => {
    elements[elements.length - 1]!.push(value);
    value = '';
  };
  const endSegment = () => {
    endComponent();
    const tag = elements[0]![0]!.trim();
    if (!/^[A-Z]{3}$/.test(tag)) throw new ParseError(`${input.name}: "${tag.slice(0, 12)}" is not a valid segment tag`);
    // elements[0] holds the tag (and nothing else for a well-formed segment).
    segments.push({ tag, elements: elements.slice(1), raw: raw.trim() });
    raw = '';
    elements = [[]];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === d.release && i + 1 < text.length) {
      value += text[++i]!;
      raw += ch + text[i]!;
    } else if (ch === '\r' || ch === '\n') {
      continue;
    } else if (ch === d.terminator) {
      endSegment();
    } else {
      raw += ch;
      if (ch === d.element) {
        endComponent();
        elements.push([]);
      } else if (ch === d.component) endComponent();
      else value += ch;
    }
  }
  if (raw.trim() !== '' || value.trim() !== '') {
    throw new ParseError(`${input.name}: last segment is not terminated with ${d.terminator}`);
  }
  if (segments.length === 0) throw new ParseError(`${input.name}: no EDIFACT segments found`);
  return { una, segments };
}

/** One segment per line, keeping the file's own delimiters. */
export function formatEdifact(input: FileInput): string {
  const doc = parseEdifact(input);
  const term = doc.una ? doc.una[8]! : DEFAULTS.terminator;
  const lines = doc.segments.map((s) => s.raw + term);
  return (doc.una ? [doc.una, ...lines] : lines).join('\n') + '\n';
}

/** Segments identified by tag plus qualifier (`NAD+BY` is `NAD[BY]`) so inserts do not shift neighbours. */
const QUALIFIED = new Set([
  'NAD', 'LOC', 'DTM', 'RFF', 'MEA', 'FTX', 'DOC', 'TDT', 'CNI', 'QTY', 'MOA', 'PRI', 'CUX', 'PIA', 'IMD',
  'GIN', 'PCI', 'EQD', 'SEL', 'TMD', 'TOD', 'PAT', 'PAC', 'DGS', 'CTA', 'COM', 'ALI', 'FII', 'LIN', 'TAX', 'ALC',
]);
/** Segments that open a group; the segments after them are keyed within it (`LIN[1]/QTY[21]`). */
const SCOPE_OPEN = new Set(['LIN']);
const SCOPE_CLOSE = new Set(['UNS', 'UNH', 'UNT']);

function keyed(doc: EdifactDocument): Map<string, EdifactSegment> {
  const out = new Map<string, EdifactSegment>();
  let scope = '';
  for (const s of doc.segments) {
    const q = QUALIFIED.has(s.tag) ? s.elements[0]?.[0] : undefined;
    // MEA repeats under one qualifier (AAE) and is told apart by the dimension (G, L, W, H).
    const q2 = s.tag === 'MEA' ? s.elements[1]?.[0] : undefined;
    let key = q ? `${s.tag}[${q2 ? `${q},${q2}` : q}]` : s.tag;
    if (SCOPE_CLOSE.has(s.tag)) scope = '';
    const full = SCOPE_OPEN.has(s.tag) ? key : scope + key;
    let unique = full;
    for (let n = 2; out.has(unique); n++) unique = `${full}#${n}`;
    out.set(unique, s);
    if (SCOPE_OPEN.has(s.tag)) scope = `${unique}/`;
  }
  return out;
}

interface Rule {
  impact: Impact;
  reason: string;
}

const ENVELOPE: Rule = { impact: 'informational', reason: 'Envelope metadata or control total; normally differs on every transmission.' };
const BY_TAG: Record<string, Rule> = {
  NAD: { impact: 'high', reason: 'A party (buyer, carrier, consignee...) changed; the document may go to or concern a different business partner.' },
  CTA: { impact: 'medium', reason: 'Contact details changed.' },
  FII: { impact: 'high', reason: 'Financial institution or account changed.' },
  LOC: { impact: 'high', reason: 'A location (port, place, country) changed; routing or delivery may differ.' },
  TDT: { impact: 'high', reason: 'Transport details (mode, carrier, vessel) changed.' },
  MOA: { impact: 'high', reason: 'A monetary amount changed.' },
  PRI: { impact: 'high', reason: 'A price changed.' },
  CUX: { impact: 'high', reason: 'Currency or exchange rate changed.' },
  PAT: { impact: 'high', reason: 'Payment terms changed.' },
  TAX: { impact: 'high', reason: 'Tax details changed.' },
  ALC: { impact: 'medium', reason: 'Allowance or charge changed.' },
  QTY: { impact: 'medium', reason: 'A quantity changed.' },
  MEA: { impact: 'medium', reason: 'A measurement (weight, volume...) changed.' },
  EQD: { impact: 'medium', reason: 'Equipment details changed.' },
  PAC: { impact: 'medium', reason: 'Packaging details changed.' },
  GIN: { impact: 'medium', reason: 'Goods identity numbers changed.' },
  SEL: { impact: 'medium', reason: 'Seal numbers changed.' },
  DGS: { impact: 'high', reason: 'Dangerous goods information changed.' },
  BGM: { impact: 'medium', reason: 'Document type or number changed.' },
  RFF: { impact: 'medium', reason: 'A reference number changed.' },
  DOC: { impact: 'medium', reason: 'A document reference changed.' },
  DTM: { impact: 'medium', reason: 'A date or time changed.' },
  LIN: { impact: 'medium', reason: 'A line item changed.' },
  PIA: { impact: 'medium', reason: 'Product identification changed.' },
  FTX: { impact: 'low', reason: 'Free text changed.' },
  IMD: { impact: 'low', reason: 'Item description changed.' },
  COM: { impact: 'low', reason: 'Communication contact changed.' },
};
const FALLBACK: Rule = { impact: 'low', reason: 'No known business meaning for this segment; likely descriptive.' };

function ruleFor(tag: string, element: number | undefined): Rule {
  if (tag === 'UNZ' || tag === 'UNT') return ENVELOPE;
  if (tag === 'UNB') {
    return element === 1 || element === 2
      ? { impact: 'high', reason: 'Interchange sender or recipient changed; routing may differ.' }
      : ENVELOPE;
  }
  if (tag === 'UNH') {
    return element === 1
      ? { impact: 'high', reason: 'Message type or version changed.' }
      : ENVELOPE;
  }
  return BY_TAG[tag] ?? FALLBACK;
}

const norm = (v: string | undefined, o: CompareOptions): string => {
  let s = v ?? '';
  if (o.ignoreWhitespace) s = s.trim().replace(/\s+/g, ' ');
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
};

const same = (a: string | undefined, b: string | undefined, o: CompareOptions): boolean => {
  const x = norm(a, o);
  const y = norm(b, o);
  if (x === y) return true;
  if (o.numericEquality && x !== '' && y !== '') {
    const m = Number(x.replace(',', '.'));
    const n = Number(y.replace(',', '.'));
    return !Number.isNaN(m) && !Number.isNaN(n) && m === n;
  }
  return false;
};

export function compareEdifact(left: FileInput, right: FileInput, options: CompareOptions = {}): ComparisonResult {
  const a = keyed(parseEdifact(left));
  const b = keyed(parseEdifact(right));
  const ignores = compileGlobs(options.ignorePaths);
  const changes: Change[] = [];
  const emit = (c: Change) => {
    if (!matchesAny(c.path, ignores)) changes.push(c);
  };

  const keys = [...a.keys(), ...[...b.keys()].filter((k) => !a.has(k))];
  for (const key of keys) {
    const l = a.get(key);
    const r = b.get(key);
    const tag = (l ?? r)!.tag;
    if (!l || !r) {
      const rule = ruleFor(tag, undefined);
      const impact = rule.impact === 'informational' ? rule.impact : maxMedium(rule.impact);
      emit({
        path: key,
        kind: l ? 'removed' : 'added',
        ...(l ? { before: l.raw } : { after: r!.raw }),
        evidence: 'fact',
        impact,
        reason: `Segment ${l ? 'removed' : 'added'}. ${rule.reason}`,
      });
      continue;
    }
    const n = Math.max(l.elements.length, r.elements.length);
    for (let e = 0; e < n; e++) {
      const le = l.elements[e] ?? [];
      const re = r.elements[e] ?? [];
      const composite = le.length > 1 || re.length > 1;
      const m = composite ? Math.max(le.length, re.length) : 1;
      for (let c = 0; c < m; c++) {
        const before = le[c];
        const after = re[c];
        if ((before ?? '') === '' && (after ?? '') === '') continue;
        const path = composite ? `${key}.${e + 1}.${c + 1}` : `${key}.${e + 1}`;
        if (same(before, after, options)) {
          emit({ path, kind: 'unchanged', before, after, evidence: 'fact' });
          continue;
        }
        const rule = ruleFor(tag, e);
        const empty = (before ?? '') === '';
        const gone = (after ?? '') === '';
        emit({
          path,
          kind: empty ? 'added' : gone ? 'removed' : 'modified',
          ...(empty ? {} : { before }),
          ...(gone ? {} : { after }),
          evidence: 'fact',
          impact: rule.impact,
          reason: rule.reason,
        });
      }
    }
  }
  return { format: 'edifact', left: left.name, right: right.name, changes, stats: computeStats(changes), warnings: [] };
}

const maxMedium = (i: Impact): Impact => (i === 'low' || i === 'informational' ? 'medium' : i);
