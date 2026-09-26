import { describe, expect, it } from 'vitest';
import { apiMismatches, compare, parseApiResponse, renderMarkdown, renderSummary, type CompareOptions } from '../src/index.js';

const api = (e: string, a: string, o: CompareOptions = {}) =>
  compare({ name: 'expected.json', content: e }, { name: 'actual.json', content: a }, { format: 'api', ...o });

const env = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  JSON.stringify({ status, headers, body });

describe('parseApiResponse', () => {
  it('parses raw HTTP responses', () => {
    const p = parseApiResponse({
      name: 'r.http',
      content: 'HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-A: 1\r\n\r\n{"id":5}',
    });
    expect(p).toEqual({ status: 201, headers: { 'content-type': 'application/json', 'x-a': '1' }, body: { id: 5 } });
  });
  it('parses envelopes (including stringified bodies) and body-only JSON', () => {
    expect(parseApiResponse({ name: 'a', content: '{"statusCode":200,"body":"{\\"a\\":1}"}' })).toMatchObject({ status: 200, body: { a: 1 } });
    expect(parseApiResponse({ name: 'a', content: '{"status":"ok","data":1}' }).status).toBeUndefined();
    expect(parseApiResponse({ name: 'a', content: '{"user":{"id":1}}' })).toEqual({ headers: {}, body: { user: { id: 1 } } });
    expect(parseApiResponse({ name: 'a', content: 'plain text' }).body).toBe('plain text');
  });
});

describe('API response comparison', () => {
  const expected = env(200, { user: { id: 123, name: 'John' }, amount: 100, currency: 'INR' });

  it('PRD example: only amount mismatches', () => {
    const r = api(expected, env(200, { user: { id: 123, name: 'John' }, amount: 120, currency: 'INR' }));
    expect(apiMismatches(r)).toBe(1);
    const s = renderSummary(r);
    expect(s).toContain('status:\n  200 → 200 ✓');
    expect(s).toContain('user.id:\n  123 → 123 ✓');
    expect(s).toContain('amount:\n  100 → 120 ❌');
    expect(s).toContain('currency:\n  INR → INR ✓');
    expect(s).toContain('Result: FAIL — 1 mismatch');
  });

  it('passes when everything matches (headers ordering, volatile headers ignored)', () => {
    const e = env(200, { a: 1 }, { 'Content-Type': 'application/json', Date: 'x' });
    const a = env(200, { a: 1 }, { 'content-type': 'application/json', date: 'y', 'X-Extra': '1' });
    const r = api(e, a);
    expect(apiMismatches(r)).toBe(0);
    expect(renderSummary(r)).toContain('Result: PASS');
  });

  it('flags status differences as high impact and header mismatches', () => {
    const r = api(env(200, {}, { 'content-type': 'a' }), env(500, {}, { 'content-type': 'b' }));
    expect(r.changes.find((c) => c.path === 'status')).toMatchObject({ kind: 'modified', impact: 'high' });
    expect(r.changes.find((c) => c.path === 'headers.content-type')?.kind).toBe('modified');
    expect(api(env(200, {}, { 'x-a': '1' }), env(200, {})).changes.find((c) => c.path === 'headers.x-a')?.kind).toBe('removed');
  });

  it('missing and unexpected fields; ignoreExtraFields; ignorePaths', () => {
    const a = env(200, { user: { id: 123 }, amount: 100, extra: true });
    const r = api(expected, a);
    expect(r.changes.filter((c) => c.kind !== 'unchanged').map((c) => `${c.kind}:${c.path}`).sort()).toEqual([
      'added:body.extra', 'removed:body.currency', 'removed:body.user.name',
    ]);
    expect(renderSummary(r)).toContain('extra:\n  (not expected) → true ❌');
    expect(renderSummary(r)).toContain('currency:\n  INR → (missing) ❌');
    expect(apiMismatches(api(expected, a, { ignoreExtraFields: true }))).toBe(2);
    expect(apiMismatches(api(expected, a, { ignoreExtraFields: true, ignorePaths: ['currency', 'user.name'] }))).toBe(0);
  });

  it('works on body-only files and array order option', () => {
    expect(apiMismatches(api('{"ids":[1,2]}', '{"ids":[2,1]}'))).toBeGreaterThan(0);
    expect(apiMismatches(api('{"ids":[1,2]}', '{"ids":[2,1]}', { ignoreArrayOrder: true }))).toBe(0);
  });

  it('non-JSON bodies compare as text; mixed status presence warns', () => {
    const r = api('HTTP/1.1 200 OK\n\nhello', 'HTTP/1.1 200 OK\n\nbye');
    expect(r.changes.find((c) => c.path === 'body')).toMatchObject({ kind: 'modified', before: 'hello', after: 'bye' });
    const w = api(env(200, { a: 1 }), '{"a":1}');
    expect(w.warnings[0]).toMatch(/only one input/);
    expect(apiMismatches(w)).toBe(0);
  });

  it('pluralises the verdict correctly', () => {
    const two = api('{"a":1,"b":1}', '{"a":2,"b":2}');
    expect(renderSummary(two)).toContain('Result: FAIL — 2 mismatches');
    expect(renderMarkdown(two)).toContain('FAIL (2 mismatches)');
  });

  it('markdown report is a table with a verdict', () => {
    const md = renderMarkdown(api(expected, env(200, { user: { id: 123, name: 'John' }, amount: 120, currency: 'INR' })));
    expect(md).toContain('**Result:** FAIL (1 mismatch)');
    expect(md).toContain('| `amount` | `100` | `120` | ❌ |');
    expect(md).toContain('| `status` | `200` | `200` | ✓ |');
  });

  it('does not add an impact estimate (pass/fail instead)', () => {
    expect(api(expected, env(500, {})).impact).toBeUndefined();
  });
});
