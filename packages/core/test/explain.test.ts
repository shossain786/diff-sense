import { describe, expect, it, vi } from 'vitest';
import { buildExplainPrompt, compare, compareChangeSet, explainWithAnthropic, explainWithGemini } from '../src/index.js';

const json = (l: string, r: string) => compare({ name: 'a.json', content: l }, { name: 'b.json', content: r }, {});

describe('buildExplainPrompt', () => {
  it('sends structured changes, not file contents', () => {
    const p = buildExplainPrompt(json('{"a":1,"keep":"UNCHANGED-SECRET"}', '{"a":2,"keep":"UNCHANGED-SECRET"}'));
    expect(p.user).toContain('modified a: 1 -> 2');
    expect(p.user).not.toContain('UNCHANGED-SECRET');
  });
  it('clips long values and caps the number of changes', () => {
    const big = 'x'.repeat(500);
    const p = buildExplainPrompt(json('{"a":"1"}', JSON.stringify({ a: big })), { maxValueChars: 20 });
    expect(p.user).not.toContain(big);
    expect(p.user).toContain('more characters');
    const many = (v: number) => JSON.stringify(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, v])));
    expect(buildExplainPrompt(json(many(1), many(2)), { maxChangesPerFile: 3 }).user).toContain('7 more changes not shown');
  });
  it('describes a change set per file and skips formatting-only files', () => {
    const set = compareChangeSet([
      { path: 'a.json', status: 'modified', before: '{"a":1}', after: '{"a":2}' },
      { path: 'b.json', status: 'modified', before: '{"a":1}', after: '{ "a": 1 }' },
    ], {}, 'HEAD ↔ working tree');
    const p = buildExplainPrompt(set);
    expect(p.user).toContain('## a.json');
    expect(p.user).not.toContain('b.json');
  });
});

describe('explainWithAnthropic', () => {
  const prompt = { system: 's', user: 'u' };
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  it('returns the text and sends the key and prompt', async () => {
    const f = reply(200, { content: [{ type: 'text', text: ' Hello ' }] });
    expect(await explainWithAnthropic(prompt, { apiKey: 'k', fetch: f as never })).toBe('Hello');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(JSON.parse(init.body as string).messages[0].content).toBe('u');
  });
  it('turns failures into readable errors', async () => {
    await expect(explainWithAnthropic(prompt, { apiKey: '' })).rejects.toThrow('No Anthropic API key');
    await expect(explainWithAnthropic(prompt, { apiKey: 'k', fetch: reply(401, { error: { message: 'bad' } }) as never })).rejects.toThrow(/401.*API key.*bad/);
    await expect(explainWithAnthropic(prompt, { apiKey: 'k', fetch: reply(200, { content: [] }) as never })).rejects.toThrow('empty');
    await expect(explainWithAnthropic(prompt, { apiKey: 'k', fetch: (async () => { throw new Error('offline'); }) as never })).rejects.toThrow('offline');
  });
});

describe('explainWithGemini', () => {
  const prompt = { system: 's', user: 'u' };
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
  it('returns the text and sends the key in a header, not the URL', async () => {
    const f = reply(200, { candidates: [{ content: { parts: [{ text: ' Hi ' }, { text: 'there' }] } }] });
    expect(await explainWithGemini(prompt, { apiKey: 'k', model: 'm', fetch: f as never })).toBe('Hi there');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(JSON.parse(init.body as string).contents[0].parts[0].text).toBe('u');
  });
  it('turns failures into readable errors', async () => {
    await expect(explainWithGemini(prompt, { apiKey: '' })).rejects.toThrow('No Gemini API key');
    await expect(explainWithGemini(prompt, { apiKey: 'k', fetch: reply(404, { error: { message: 'gone' } }) as never })).rejects.toThrow(/404.*gone/);
    await expect(explainWithGemini(prompt, { apiKey: 'k', fetch: reply(200, { candidates: [] }) as never })).rejects.toThrow('empty');
  });
});
