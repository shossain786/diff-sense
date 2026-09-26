import { describe, expect, it } from 'vitest';
import { compare, IMPACT_ORDER, renderSummary } from '../src/index.js';

const j = (a: unknown, b: unknown) =>
  compare({ name: 'a.json', content: JSON.stringify(a) }, { name: 'b.json', content: JSON.stringify(b) });
const impactOf = (r: ReturnType<typeof j>, path: string) => r.changes.find((c) => c.path === path)?.impact;

describe('impact classification', () => {
  it('classifies by key name and reports the overall maximum', () => {
    const r = j(
      { timeout: 30, baseUrl: 'a', title: 'x', apiKey: '1', same: 1 },
      { timeout: 45, baseUrl: 'b', title: 'y', apiKey: '2', same: 1 },
    );
    expect(impactOf(r, 'timeout')).toBe('medium');
    expect(impactOf(r, 'baseUrl')).toBe('high');
    expect(impactOf(r, 'title')).toBe('low');
    expect(impactOf(r, 'apiKey')).toBe('critical');
    expect(r.impact).toBe('critical');
    expect(r.changes.find((c) => c.path === 'baseUrl')?.reason).toMatch(/connection target/);
  });
  it('PRD example: timeout and retryCount give medium overall', () => {
    const r = j({ timeout: 30000, retryCount: 3, enabled: true }, { timeout: 45000, retryCount: 5, enabled: true });
    expect(r.impact).toBe('medium');
    expect(impactOf(r, 'enabled')).toBeUndefined(); // unchanged entries carry no impact
  });
  it('no differences means no impact estimate; text is never estimated', () => {
    expect(j({ a: 1 }, { a: 1 }).impact).toBeUndefined();
    const t = compare({ name: 'a.txt', content: 'a' }, { name: 'b.txt', content: 'b' });
    expect(t.impact).toBeUndefined();
  });
  it('impact levels are ordered', () => {
    expect(IMPACT_ORDER).toEqual(['informational', 'low', 'medium', 'high', 'critical']);
  });
  it('summary shows per-change and overall impact as an estimate', () => {
    const s = renderSummary(j({ port: 1 }, { port: 2 }));
    expect(s).toContain('Impact: HIGH');
    expect(s).toContain('Potential impact (estimate): high');
  });
});
