import type { ChangeSetResult, FileChange } from './changeset.js';
import { formatValue } from './summary.js';
import type { Change, ComparisonResult } from './types.js';

/**
 * Optional AI explanations. The AI never computes the diff: it only phrases the
 * structured changes the deterministic engines already found. Only the compact
 * text built by `buildExplainPrompt` is sent, never whole files.
 */

export interface ExplainPrompt {
  system: string;
  user: string;
}

export interface ExplainOptions {
  /** Longest before/after value sent, in characters. */
  maxValueChars?: number;
  /** Most changes sent per file. */
  maxChangesPerFile?: number;
  /** Most files sent. */
  maxFiles?: number;
}

const SYSTEM = [
  'You explain code and data changes to a developer reviewing them.',
  'You are given a list of structured changes that a deterministic tool already found. Do not question or recompute them, and do not invent changes that are not listed.',
  'Write a short plain-text summary: first what changed overall in one or two sentences, then the changes most likely to matter (behaviour, compatibility, test stability, risk), most important first.',
  'Impact labels are estimates from the tool; say "likely" when you build on them. If something cannot be known from the data (for example intent), say so rather than guessing.',
  'Be concise: no preamble, no restating every change, under 200 words.',
].join(' ');

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}… [${s.length - max} more characters]` : s);

function changeLine(c: Change, o: Required<ExplainOptions>): string {
  const v = (x: unknown) => clip(formatValue(x).replace(/\s+/g, ' '), o.maxValueChars);
  const what = c.kind === 'modified' ? `${v(c.before)} -> ${v(c.after)}` : v(c.kind === 'added' ? c.after : c.before);
  const impact = c.impact && c.impact !== 'informational' ? ` [${c.impact}${c.reason ? `: ${c.reason}` : ''}]` : '';
  return `- ${c.kind} ${c.path}: ${what}${impact}`;
}

function changesBlock(changes: Change[], o: Required<ExplainOptions>): string[] {
  const real = changes.filter((c) => c.kind !== 'unchanged');
  const out = real.slice(0, o.maxChangesPerFile).map((c) => changeLine(c, o));
  if (real.length > o.maxChangesPerFile) out.push(`- … and ${real.length - o.maxChangesPerFile} more changes not shown`);
  return out;
}

const isChangeSet = (x: ComparisonResult | ChangeSetResult): x is ChangeSetResult => 'files' in x;

function fileBlock(f: FileChange, o: Required<ExplainOptions>): string[] {
  const head = `## ${f.oldPath ? `${f.oldPath} -> ${f.path}` : f.path} (${f.status}${f.formattingOnly ? ', formatting only' : ''}${f.impact ? `, impact ${f.impact}` : ''})`;
  if (!f.result) return [head, f.reason ? `- ${f.reason}` : ''];
  return [head, ...changesBlock(f.result.changes, o)];
}

/** Builds the prompt from structured changes. Pure; this is exactly what leaves the machine. */
export function buildExplainPrompt(input: ComparisonResult | ChangeSetResult, options: ExplainOptions = {}): ExplainPrompt {
  const o = { maxValueChars: 120, maxChangesPerFile: 40, maxFiles: 30, ...options };
  const lines: string[] = [];
  if (isChangeSet(input)) {
    lines.push(`Change set: ${input.label || '(unnamed)'}`, `Overall estimated impact: ${input.impact ?? 'none'}`, '');
    const files = input.files.filter((f) => f.result ? f.result.changes.some((c) => c.kind !== 'unchanged') : !f.formattingOnly);
    for (const f of files.slice(0, o.maxFiles)) lines.push(...fileBlock(f, o), '');
    if (files.length > o.maxFiles) lines.push(`… and ${files.length - o.maxFiles} more files not shown`);
  } else {
    lines.push(`Comparison: ${input.left} vs ${input.right} (${input.format})`, `Overall estimated impact: ${input.impact ?? 'none'}`, '', ...changesBlock(input.changes, o));
  }
  return { system: SYSTEM, user: lines.join('\n').trimEnd() };
}

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  /** Override for tests, proxies and gateways. */
  baseUrl?: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export const DEFAULT_MODEL = 'claude-haiku-5-5';

/** Asks the Anthropic Messages API to explain the prompt. Throws an Error with a user-facing message. */
export async function explainWithAnthropic(prompt: ExplainPrompt, opts: AnthropicOptions): Promise<string> {
  if (!opts.apiKey) throw new Error('No Anthropic API key set');
  const doFetch = opts.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? 600,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach the AI service: ${(e as Error).message}`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* body was not JSON */
    }
    const hint = res.status === 401 ? ' (check the API key)' : res.status === 429 ? ' (rate limited, try again shortly)' : '';
    throw new Error(`AI service returned ${res.status}${hint}${detail ? `: ${detail}` : ''}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  if (!text) throw new Error('AI service returned an empty explanation');
  return text;
}

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

/** Asks the Gemini API to explain the prompt. Throws an Error with a user-facing message. */
export async function explainWithGemini(prompt: ExplainPrompt, opts: GeminiOptions): Promise<string> {
  if (!opts.apiKey) throw new Error('No Gemini API key set');
  const doFetch = opts.fetch ?? globalThis.fetch;
  const model = opts.model ?? DEFAULT_GEMINI_MODEL;
  let res: Response;
  try {
    res = await doFetch(`${opts.baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        generationConfig: { maxOutputTokens: opts.maxTokens ?? 1200 },
      }),
    });
  } catch (e) {
    throw new Error(`Could not reach the AI service: ${(e as Error).message}`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* body was not JSON */
    }
    const hint = res.status === 400 || res.status === 403 ? ' (check the API key and model name)' : res.status === 429 ? ' (rate limited, try again shortly)' : '';
    throw new Error(`AI service returned ${res.status}${hint}${detail ? `: ${detail}` : ''}`);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error('AI service returned an empty explanation');
  return text;
}
