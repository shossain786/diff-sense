import { describe, expect, it } from 'vitest';
import { compare, parseConfig, renderSummary, resolveOptions } from '../src/index.js';

describe('config', () => {
  it('parses a valid config', () => {
    const { config, errors } = parseConfig(
      JSON.stringify({
        defaults: { ignoreWhitespace: true, ignorePaths: ['meta.*'] },
        formats: { json: { ignoreArrayOrder: true } },
      }),
    );
    expect(errors).toEqual([]);
    expect(resolveOptions(config, 'json')).toEqual({
      ignoreWhitespace: true,
      ignorePaths: ['meta.*'],
      ignoreArrayOrder: true,
    });
    expect(resolveOptions(config, 'xml', { ignoreWhitespace: false }).ignoreWhitespace).toBe(false);
  });
  it('reports problems without throwing', () => {
    expect(parseConfig('{').errors[0]).toMatch(/Invalid JSON/);
    const { errors } = parseConfig(
      JSON.stringify({ defaults: { ignoreCase: 'yes', bogus: 1 }, formats: { cobol: {} }, x: 1 }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'x: unknown key',
        'defaults.ignoreCase: expected boolean',
        'defaults.bogus: unknown option',
        'formats.cobol: unknown format',
      ]),
    );
  });
});

describe('summary', () => {
  it('renders the PRD-style summary', () => {
    const r = compare(
      { name: 'old.json', content: '{"timeout":30,"retryCount":3,"gone":1,"same":true}' },
      { name: 'new.json', content: '{"timeout":45,"retryCount":5,"new":"x","same":true}' },
    );
    const s = renderSummary(r);
    expect(s).toContain('DiffSense — Change Summary');
    expect(s).toContain('⚠ 2 items modified');
    expect(s).toContain('+ 1 item added');
    expect(s).toContain('⚠ timeout\n  30 → 45');
    expect(s).toContain('- gone');
    expect(s).toContain('✓ 1 unchanged');
  });
  it('says so when nothing differs', () => {
    const r = compare({ name: 'a.json', content: '{}' }, { name: 'b.json', content: '{}' });
    expect(renderSummary(r)).toContain('No differences found.');
  });
});
