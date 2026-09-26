import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs shared with the Kotlin engine's test suite
import { normalize } from '../../../conformance/normalize.mjs';
import { compare } from '../src/index.js';

interface Case {
  name: string;
  left: { name: string; content: string };
  right: { name: string; content: string };
  options: Parameters<typeof compare>[2];
  expected: unknown;
}

// cases.json is generated from this engine (`node conformance/generate.mjs`); the Kotlin plugin engine
// must produce the same results. This test fails when behaviour changes without regenerating.
const cases: Case[] = JSON.parse(
  readFileSync(new URL('../../../conformance/cases.json', import.meta.url), 'utf8'),
);

describe('conformance cases', () => {
  it('has cases', () => expect(cases.length).toBeGreaterThan(90));
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(normalize(compare(c.left, c.right, c.options))).toEqual(c.expected);
  });
});
