import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

/**
 * Turns text typed or pasted into an input box into an absolute path: strips
 * surrounding quotes (Explorer's "Copy as path"), expands `~`, and resolves
 * relative paths against `baseDir`.
 */
export function resolveTypedPath(input: string, baseDir: string, home: string = homedir()): string | undefined {
  let p = input.trim();
  if (p.length >= 2 && /^(["'])(.*)\1$/.test(p)) p = p.slice(1, -1).trim();
  if (!p) return undefined;
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) p = resolve(home, p.slice(2));
  return isAbsolute(p) ? resolve(p) : resolve(baseDir, p);
}
