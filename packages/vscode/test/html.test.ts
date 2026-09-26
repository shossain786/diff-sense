import { describe, expect, it } from 'vitest';
import { compare } from '@diffsense/core';
import { escapeHtml, renderPanelHtml } from '../src/html.js';

describe('panel html', () => {
  it('escapes file-derived content (no script injection)', () => {
    const r = compare(
      { name: '<img src=x>.json', content: '{"<b>k</b>":"<script>alert(1)</script>"}' },
      { name: 'b.json', content: '{"<b>k</b>":"\\"\'&"}' },
    );
    const html = renderPanelHtml(r, 'N0NCE', 'vscode-resource:');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain("script-src 'nonce-N0NCE'");
  });
  it('shows stats and the no-difference message', () => {
    const same = compare({ name: 'a.json', content: '{}' }, { name: 'b.json', content: '{}' });
    expect(renderPanelHtml(same, 'n', 'x')).toContain('No differences found.');
    const diff = compare({ name: 'a.json', content: '{"a":1}' }, { name: 'b.json', content: '{"a":2}' });
    const html = renderPanelHtml(diff, 'n', 'x');
    expect(html).toContain('<b>1</b>⚠ modified');
    expect(html).toContain('<del>1</del> → <ins>2</ins>');
  });
  it('caps very long change lists', () => {
    const big = (d: number) => JSON.stringify(Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`k${i}`, i + d])));
    const r = compare({ name: 'a.json', content: big(0) }, { name: 'b.json', content: big(1) });
    expect(renderPanelHtml(r, 'n', 'x')).toContain('…and 200 more');
  });
  it('shows impact badges with an escaped reason', () => {
    const r = compare({ name: 'a.json', content: '{"port":1}' }, { name: 'b.json', content: '{"port":2}' });
    const html = renderPanelHtml(r, 'n', 'x');
    expect(html).toContain('badge high');
    expect(html).toContain('Potential impact (estimate): <b>high</b>');
  });
  it('labels before/after sides and offers a swap', () => {
    const r = compare({ name: 'old.json', content: '{"a":1}' }, { name: 'new.json', content: '{"a":2}' });
    const html = renderPanelHtml(r, 'n', 'x');
    expect(html).toContain('Before (left): <b>old.json</b> · After (right): <b>new.json</b>');
    expect(html).toContain('data-cmd="swap"');
  });
  it('escapeHtml handles all special chars', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('API panel', () => {
  it('lists matches and mismatches with a verdict, escaped', () => {
    const r = compare(
      { name: 'expected.json', content: '{"status":200,"body":{"amount":100,"n":"<b>"}}' },
      { name: 'actual.json', content: '{"status":200,"body":{"amount":120,"n":"<b>"}}' },
      { format: 'api' },
    );
    const html = renderPanelHtml(r, 'n', 'x');
    expect(html).toContain('API Response Comparison');
    expect(html).toContain('<b>FAIL</b> — 1 mismatch');
    expect(html).toContain('Expected (left)');
    expect(html).toContain('<del>100</del> → <ins>120</ins>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b></b>');
    expect(html).toContain('❌ mismatched');
  });
});
