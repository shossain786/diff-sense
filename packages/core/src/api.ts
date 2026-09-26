import { diffValues } from './json.js';
import { computeStats } from './stats.js';
import type { Change, ComparisonResult, CompareOptions, FileInput } from './types.js';

/** Headers that differ on every request and are never worth comparing. */
const VOLATILE_HEADERS = new Set([
  'date', 'server', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'age', 'via',
  'x-request-id', 'x-correlation-id', 'x-trace-id', 'x-amzn-trace-id', 'x-cloud-trace-context',
]);

export interface ParsedResponse {
  status?: number;
  headers: Record<string, string>;
  body: unknown;
}

const tryJson = (s: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function lowerHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(h)) for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

/**
 * Accepts, in order of detection:
 *  1. a raw HTTP response (`HTTP/1.1 200 OK`, headers, blank line, body)
 *  2. a JSON envelope `{ status | statusCode, headers?, body | data }`
 *  3. anything else, treated as just the body (JSON if it parses, else text)
 */
export function parseApiResponse(input: FileInput): ParsedResponse {
  const text = input.content.replace(/^﻿/, '');

  const m = /^HTTP\/[\d.]+\s+(\d{3})[^\n]*\r?\n/.exec(text);
  if (m) {
    const rest = text.slice(m[0].length);
    const noHeaders = /^\r?\n/.exec(rest); // status line straight into the blank line
    const split = noHeaders ? undefined : /\r?\n\r?\n/.exec(rest);
    const headText = noHeaders ? '' : split ? rest.slice(0, split.index) : rest;
    const bodyText = noHeaders ? rest.slice(noHeaders[0].length) : split ? rest.slice(split.index + split[0].length) : '';
    const headers: Record<string, string> = {};
    for (const line of headText.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    const j = tryJson(bodyText.trim());
    return { status: Number(m[1]), headers, body: j.ok ? j.value : bodyText.trim() };
  }

  const j = tryJson(text.trim());
  if (j.ok && isObj(j.value)) {
    const v = j.value;
    const status = typeof v.status === 'number' ? v.status : typeof v.statusCode === 'number' ? v.statusCode : undefined;
    const hasBodyKey = 'body' in v || 'data' in v;
    if (status !== undefined && (hasBodyKey || 'headers' in v)) {
      let body: unknown = 'body' in v ? v.body : v.data;
      if (typeof body === 'string') {
        const inner = tryJson(body);
        if (inner.ok) body = inner.value;
      }
      return { status, headers: lowerHeaders(v.headers), body };
    }
  }
  return { headers: {}, body: j.ok ? j.value : text.trim() };
}

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Expected (left) vs actual (right). A "mismatch" is anything that is not
 * unchanged: a differing value, a field missing from the actual response, or
 * (unless `ignoreExtraFields`) an unexpected extra field.
 */
export function compareApi(
  expected: FileInput,
  actual: FileInput,
  options: CompareOptions = {},
): ComparisonResult {
  const e = parseApiResponse(expected);
  const a = parseApiResponse(actual);
  const changes: Change[] = [];
  const warnings: string[] = [];

  if (e.status !== undefined && a.status !== undefined) {
    changes.push(
      e.status === a.status
        ? { path: 'status', kind: 'unchanged', before: e.status, after: a.status, evidence: 'fact' }
        : {
            path: 'status',
            kind: 'modified',
            before: e.status,
            after: a.status,
            evidence: 'fact',
            impact: 'high',
            reason: 'Status code differs; the response class (success vs error) may have changed.',
          },
    );
  } else if (e.status !== undefined || a.status !== undefined) {
    warnings.push('Status code is present in only one input, so it was not compared.');
  }

  const skip = new Set([...VOLATILE_HEADERS, ...(options.ignoreHeaders ?? []).map((h) => h.toLowerCase())]);
  for (const [name, ev] of Object.entries(e.headers)) {
    if (skip.has(name)) continue;
    const av = a.headers[name];
    const path = `headers.${name}`;
    if (av === undefined) changes.push({ path, kind: 'removed', before: ev, evidence: 'fact' });
    else if (av === ev) changes.push({ path, kind: 'unchanged', before: ev, after: av, evidence: 'fact' });
    else changes.push({ path, kind: 'modified', before: ev, after: av, evidence: 'fact' });
  }

  const composite = (v: unknown) => typeof v === 'object' && v !== null;
  if (composite(e.body) && composite(a.body)) {
    for (const c of diffValues(e.body, a.body, options)) {
      if (c.kind === 'added' && options.ignoreExtraFields) continue;
      changes.push({ ...c, path: c.path === '$' ? 'body' : `body.${c.path}` });
    }
  } else if (e.body !== undefined || a.body !== undefined) {
    const same = show(e.body) === show(a.body);
    changes.push({
      path: 'body',
      kind: same ? 'unchanged' : 'modified',
      before: e.body,
      after: a.body,
      evidence: 'fact',
    });
  }

  return {
    format: 'api',
    left: expected.name,
    right: actual.name,
    changes,
    stats: computeStats(changes),
    warnings,
  };
}

/** Number of things that do not match the expectation. */
export const apiMismatches = (r: Pick<ComparisonResult, 'stats'>): number =>
  r.stats.added + r.stats.removed + r.stats.modified;
