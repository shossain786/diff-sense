import { describe, expect, it } from 'vitest';
import { compareChangeSet, compilePathGlob, pairDirectories, type DirFile } from '../src/index.js';

const f = (path: string, content: string): DirFile => ({ path, content, signature: `${content.length}:${content}` });

describe('pairDirectories', () => {
  const left = [f('a.json', '{"url":"a"}'), f('same.txt', 'x'), f('only-left.txt', 'l'), f('sub/c.xml', '<a>1</a>')];
  const right = [f('a.json', '{"url":"b"}'), f('same.txt', 'x'), f('only-right.txt', 'r'), f('sub/c.xml', '<a>1</a>')];

  it('pairs by relative path, skips identical files and reports adds/removes', () => {
    const { entries, identical } = pairDirectories(left, right);
    expect(identical).toBe(2);
    expect(entries.map((e) => [e.path, e.status])).toEqual([
      ['a.json', 'modified'],
      ['only-left.txt', 'deleted'],
      ['only-right.txt', 'added'],
    ]);
  });
  it('feeds the change-set engine', () => {
    const r = compareChangeSet(pairDirectories(left, right).entries);
    expect(r.impact).toBe('high');
    expect(r.stats).toMatchObject({ files: 3, modified: 1, added: 1, deleted: 1 });
  });
  it('pairs by unique file name when asked, as renames', () => {
    const l = [f('target/classes/app.json', '{"a":1}'), f('target/dup.txt', '1'), f('src/dup.txt', '2')];
    const r = [f('src/main/resources/app.json', '{"a":2}'), f('x/dup.txt', '1'), f('y/dup.txt', '3')];
    const byPath = pairDirectories(l, r);
    expect(byPath.entries.every((e) => e.status !== 'renamed')).toBe(true);
    const byName = pairDirectories(l, r, { match: 'name' });
    const e = byName.entries.find((x) => x.status === 'renamed')!;
    expect(e).toMatchObject({ path: 'src/main/resources/app.json', oldPath: 'target/classes/app.json' });
    // dup.txt is ambiguous (two files per side), so it stays unpaired
    expect(byName.entries.filter((x) => x.path.endsWith('dup.txt')).map((x) => x.status).sort()).toEqual(['added', 'added', 'deleted', 'deleted']);
  });
  it('excludes by glob and always skips .git and node_modules', () => {
    const { entries } = pairDirectories(
      [f('a.log', '1'), f('keep.txt', '1'), f('.git/HEAD', '1'), f('node_modules/x/i.js', '1')],
      [f('a.log', '2'), f('keep.txt', '2'), f('.git/HEAD', '2'), f('node_modules/x/i.js', '2')],
      { exclude: ['**/*.log'] },
    );
    expect(entries.map((e) => e.path)).toEqual(['keep.txt']);
  });
  it('compilePathGlob', () => {
    expect(compilePathGlob('**/*.log').test('a.log')).toBe(true);
    expect(compilePathGlob('**/*.log').test('x/y/a.log')).toBe(true);
    expect(compilePathGlob('*.log').test('x/a.log')).toBe(false);
    expect(compilePathGlob('build/**').test('build/a/b')).toBe(true);
  });
});
