import type { ChangeSetEntry } from './changeset.js';

/** A file found while walking a directory. Paths are relative to the directory and use `/`. */
export interface DirFile {
  path: string;
  /** Text content; absent for binary or oversized files. */
  content?: string;
  /** True when the file is binary or was too large to read as text. */
  binary?: boolean;
  /** Fingerprint of the raw bytes (size plus a hash is fine); equal values mean identical files. */
  signature: string;
}

export interface DirectoryOptions {
  /** `path` pairs files by relative path. `name` also pairs leftovers whose file name is unique on both sides. */
  match?: 'path' | 'name';
  /** Relative-path globs to leave out, e.g. `**\/*.log`. `.git` and `node_modules` are always skipped. */
  exclude?: string[];
}

export interface DirectoryComparison {
  entries: ChangeSetEntry[];
  /** Files present on both sides with identical content; not listed. */
  identical: number;
}

const ALWAYS_EXCLUDED = ['.git/**', '**/.git/**', 'node_modules/**', '**/node_modules/**'];

/** `*` stays inside one path segment, `**` crosses segments (`**\/` also matches no directory at all). */
export function compilePathGlob(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/**
 * Pairs the files of two directories and turns them into a change set (left is "before", right is "after").
 * Pure: the caller walks the directories and reads the files. Compare the result with `compareChangeSet`.
 */
export function pairDirectories(left: DirFile[], right: DirFile[], options: DirectoryOptions = {}): DirectoryComparison {
  const skip = [...ALWAYS_EXCLUDED, ...(options.exclude ?? [])].map(compilePathGlob);
  const keep = (f: DirFile) => !skip.some((r) => r.test(f.path));
  const l = new Map(left.filter(keep).map((f) => [f.path, f]));
  const r = new Map(right.filter(keep).map((f) => [f.path, f]));

  const entries: ChangeSetEntry[] = [];
  let identical = 0;
  const pair = (a: DirFile, b: DirFile) => {
    if (a.signature === b.signature) {
      identical++;
      return;
    }
    const renamed = a.path !== b.path;
    entries.push({
      path: b.path,
      ...(renamed ? { oldPath: a.path } : {}),
      status: renamed ? 'renamed' : 'modified',
      binary: !!(a.binary || b.binary),
      before: a.content,
      after: b.content,
    });
  };

  const onlyLeft: DirFile[] = [];
  for (const [path, a] of l) {
    const b = r.get(path);
    if (b) {
      pair(a, b);
      r.delete(path);
    } else onlyLeft.push(a);
  }
  const onlyRight = [...r.values()];

  if (options.match === 'name') {
    const count = (fs: DirFile[]) => {
      const m = new Map<string, DirFile[]>();
      for (const f of fs) m.set(baseName(f.path), [...(m.get(baseName(f.path)) ?? []), f]);
      return m;
    };
    const lb = count(onlyLeft);
    const rb = count(onlyRight);
    const paired = new Set<DirFile>();
    for (const [name, [a, ...restA]] of lb) {
      const [b, ...restB] = rb.get(name) ?? [];
      if (a && b && restA.length === 0 && restB.length === 0) {
        pair(a, b);
        paired.add(a);
        paired.add(b);
      }
    }
    for (const f of paired) {
      const i = onlyLeft.indexOf(f);
      if (i >= 0) onlyLeft.splice(i, 1);
      const j = onlyRight.indexOf(f);
      if (j >= 0) onlyRight.splice(j, 1);
    }
  }

  for (const a of onlyLeft) entries.push({ path: a.path, status: 'deleted', binary: !!a.binary, before: a.content });
  for (const b of onlyRight) entries.push({ path: b.path, status: 'added', binary: !!b.binary, after: b.content });
  entries.sort((x, y) => x.path.localeCompare(y.path));
  return { entries, identical };
}
