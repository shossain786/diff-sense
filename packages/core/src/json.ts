import { compileGlobs, matchesAny } from './glob.js';
import { computeStats } from './stats.js';
import type { Change, ComparisonResult, CompareOptions, FileInput } from './types.js';

type Json = unknown;

const isObj = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural comparison of two already-parsed values. Reused by YAML/XML. */
export function diffValues(left: Json, right: Json, options: CompareOptions): Change[] {
  const ignores = compileGlobs(options.ignorePaths);
  const out: Change[] = [];
  walk(left, right, '', options, ignores, out);
  return out;
}

function childPath(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`;
}

function scalarEqual(a: Json, b: Json, o: CompareOptions): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    let x = a;
    let y = b;
    if (o.ignoreWhitespace) {
      x = x.trim().replace(/\s+/g, ' ');
      y = y.trim().replace(/\s+/g, ' ');
    }
    if (o.ignoreCase) {
      x = x.toLowerCase();
      y = y.toLowerCase();
    }
    return x === y;
  }
  if (o.numericEquality) {
    const num = (v: Json) =>
      typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    const x = num(a);
    const y = num(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x === y;
  }
  return Object.is(a, b) || a === b;
}

function hasChanges(a: Json, b: Json, path: string, o: CompareOptions, ig: RegExp[]): boolean {
  const tmp: Change[] = [];
  walk(a, b, path, o, ig, tmp);
  return tmp.some((c) => c.kind !== 'unchanged');
}

function walk(
  a: Json,
  b: Json,
  path: string,
  o: CompareOptions,
  ig: RegExp[],
  out: Change[],
): void {
  const p = path === '' ? '$' : path;
  if (path !== '' && matchesAny(path, ig)) return;

  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    for (const k of ka) {
      const cp = childPath(path, k);
      if (matchesAny(cp, ig)) continue;
      if (k in b) walk(a[k], b[k], cp, o, ig, out);
      else out.push({ path: cp, kind: 'removed', before: a[k], evidence: 'fact' });
    }
    for (const k of kb) {
      const cp = childPath(path, k);
      if (!(k in a) && !matchesAny(cp, ig)) {
        out.push({ path: cp, kind: 'added', after: b[k], evidence: 'fact' });
      }
    }
    if (o.ignoreOrdering === false) {
      const common = (ks: string[], other: string[]) => ks.filter((k) => other.includes(k));
      const ca = common(ka, kb);
      const cb = common(kb, ka);
      if (ca.join('\0') !== cb.join('\0')) {
        out.push({
          path: p,
          kind: 'modified',
          before: 'key order: ' + ca.join(', '),
          after: 'key order: ' + cb.join(', '),
          evidence: 'fact',
        });
      }
    }
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (o.ignoreArrayOrder) return walkUnorderedArrays(a, b, path, o, ig, out);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const cp = `${path}[${i}]`;
      if (matchesAny(cp, ig)) continue;
      if (i >= b.length) out.push({ path: cp, kind: 'removed', before: a[i], evidence: 'fact' });
      else if (i >= a.length) out.push({ path: cp, kind: 'added', after: b[i], evidence: 'fact' });
      else walk(a[i], b[i], cp, o, ig, out);
    }
    return;
  }

  // Scalars, or a type change (object vs array vs scalar).
  const composite = (v: Json) => typeof v === 'object' && v !== null;
  if (!composite(a) && !composite(b) && scalarEqual(a, b, o)) {
    out.push({ path: p, kind: 'unchanged', before: a, after: b, evidence: 'fact' });
  } else {
    out.push({ path: p, kind: 'modified', before: a, after: b, evidence: 'fact' });
  }
}

function walkUnorderedArrays(
  a: Json[],
  b: Json[],
  path: string,
  o: CompareOptions,
  ig: RegExp[],
  out: Change[],
): void {
  const usedB = new Set<number>();
  const unmatchedA: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const cp = `${path}[${i}]`;
    if (matchesAny(cp, ig)) continue;
    let found = -1;
    for (let j = 0; j < b.length; j++) {
      if (!usedB.has(j) && !hasChanges(a[i], b[j], cp, o, ig)) {
        found = j;
        break;
      }
    }
    if (found >= 0) {
      usedB.add(found);
      walk(a[i], b[found], cp, o, ig, out);
    } else unmatchedA.push(i);
  }
  const unmatchedB = b.map((_, j) => j).filter((j) => !usedB.has(j));
  const paired = Math.min(unmatchedA.length, unmatchedB.length);
  for (let k = 0; k < paired; k++) {
    walk(a[unmatchedA[k]!], b[unmatchedB[k]!], `${path}[${unmatchedA[k]}]`, o, ig, out);
  }
  for (const i of unmatchedA.slice(paired)) {
    out.push({ path: `${path}[${i}]`, kind: 'removed', before: a[i], evidence: 'fact' });
  }
  for (const j of unmatchedB.slice(paired)) {
    out.push({ path: `${path}[${j}]`, kind: 'added', after: b[j], evidence: 'fact' });
  }
}

export class ParseError extends Error {}

export function parseJson(input: FileInput): Json {
  try {
    return JSON.parse(input.content.replace(/^\uFEFF/, '')); // editors on Windows often save a BOM
  } catch (e) {
    throw new ParseError(`${input.name}: ${(e as Error).message}`);
  }
}

export function compareJson(
  left: FileInput,
  right: FileInput,
  options: CompareOptions = {},
): ComparisonResult {
  const changes = diffValues(parseJson(left), parseJson(right), options);
  return {
    format: 'json',
    left: left.name,
    right: right.name,
    changes,
    stats: computeStats(changes),
    warnings: [],
  };
}
