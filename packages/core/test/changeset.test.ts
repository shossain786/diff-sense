import { describe, expect, it } from 'vitest';
import { compareChangeSet, renderChangeSet, renderChangeSetMarkdown } from '../src/index.js';

describe('compareChangeSet', () => {
  const entries = [
    { path: 'a.json', status: 'modified' as const, before: '{"x":1,"url":"a"}', after: '{"url":"b","x":1}' },
    { path: 'b.json', status: 'modified' as const, before: '{"p":1,"q":2}', after: '{\n  "q": 2,\n  "p": 1\n}' },
    { path: 'gone.txt', status: 'deleted' as const, before: 'hi' },
    { path: 'new.txt', status: 'added' as const, after: 'hi' },
    { path: 'img.png', status: 'modified' as const, binary: true },
    { path: 'n.json', status: 'renamed' as const, oldPath: 'o.json', before: '{"a":1}', after: '{"a":1}' },
  ];
  const r = compareChangeSet(entries, {}, 'main..HEAD');

  it('classifies files and rolls up stats and impact', () => {
    expect(r.stats).toMatchObject({ files: 6, added: 1, deleted: 1, modified: 3, renamed: 1, binary: 1, formattingOnly: 1 });
    expect(r.files[0]!.impact).toBe('high');
    expect(r.impact).toBe('high');
  });
  it('detects formatting-only changes', () => {
    expect(r.files[1]!.formattingOnly).toBe(true);
  });
  it('renders text and markdown, most severe first', () => {
    const t = renderChangeSet(r);
    expect(t).toContain('main..HEAD');
    expect(t.indexOf('a.json')).toBeLessThan(t.indexOf('gone.txt'));
    expect(t).toContain('formatting only');
    expect(renderChangeSetMarkdown(r)).toContain('| `a.json` | modified |');
    expect(renderChangeSetMarkdown(r)).toContain('<summary><code>a.json</code></summary>');
  });
  it('reports the same change across sibling files once', () => {
    const mk = (n: string) => ({
      path: `src/${n}Test.java`,
      status: 'modified' as const,
      before: `import org.junit.jupiter.api.Test;\nclass ${n}Test { @Test void a() {} }`,
      after: `import org.junit.jupiter.api.Test;\nimport org.junit.jupiter.api.Disabled;\nclass ${n}Test { @Test @Disabled("Broken") void a() {} }`,
    });
    const set = compareChangeSet([mk('A'), mk('B'), mk('C')], {}, 'x');
    const t = renderChangeSet(set);
    expect(t).toContain('3 files with the same change');
    expect(t).toContain('src/BTest.java');
    expect(t).not.toContain('imports ›');
    expect(t).toContain('Test disabled; it will no longer run.');
    expect(t.split('\n').filter((l) => l.includes('@Disabled')).length).toBe(1);
    expect(renderChangeSetMarkdown(set)).toContain('3 files with the same change');
  });
  it('handles an empty change set', () => {
    expect(renderChangeSet(compareChangeSet([]))).toContain('No differences found.');
  });
});
