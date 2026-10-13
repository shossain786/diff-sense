import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { resolveTypedPath } from '../src/paths.js';

describe('resolveTypedPath', () => {
  const base = resolve('/work/proj');
  const home = resolve('/home/me');
  it('resolves relative paths against the base directory', () => {
    expect(resolveTypedPath('a/b.json', base, home)).toBe(resolve(base, 'a/b.json'));
    expect(resolveTypedPath('../x.json', base, home)).toBe(resolve('/work/x.json'));
  });
  it('keeps absolute paths and expands ~', () => {
    expect(resolveTypedPath(resolve('/etc/a.json'), base, home)).toBe(resolve('/etc/a.json'));
    expect(resolveTypedPath('~/a.json', base, home)).toBe(resolve(home, 'a.json'));
    expect(resolveTypedPath('~', base, home)).toBe(home);
  });
  it('strips quotes and whitespace; empty input is undefined', () => {
    expect(resolveTypedPath('  "a b/c.json" ', base, home)).toBe(resolve(base, 'a b/c.json'));
    expect(resolveTypedPath("'c.json'", base, home)).toBe(resolve(base, 'c.json'));
    expect(resolveTypedPath('   ', base, home)).toBeUndefined();
    expect(resolveTypedPath('""', base, home)).toBeUndefined();
  });
});
