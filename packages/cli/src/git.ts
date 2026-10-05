import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ChangeSetEntry, FileStatus } from '@diffsense/core';

const git = (args: string[], cwd?: string): Buffer =>
  execFileSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** Where each side of the comparison comes from: a git revision or the working tree. */
type Side = { rev: string } | { worktree: true };

const isBinary = (b: Buffer) => b.subarray(0, 8000).includes(0);

function readSide(side: Side, path: string, root: string): Buffer | undefined {
  try {
    return 'rev' in side ? git(['show', `${side.rev}:${path}`], root) : readFileSync(`${root}/${path}`);
  } catch {
    return undefined;
  }
}

function parseRange(range: string | undefined, root: string): { from: Side; to: Side; label: string; diffArgs: string[] } {
  if (!range) return { from: { rev: 'HEAD' }, to: { worktree: true }, label: 'HEAD ↔ working tree', diffArgs: ['HEAD'] };
  const three = range.indexOf('...');
  const two = range.indexOf('..');
  if (three > 0 || two > 0) {
    const [l, r] = range.split(three > 0 ? '...' : '..');
    const base = l || 'HEAD';
    const head = r || 'HEAD';
    const from = three > 0 ? git(['merge-base', base, head], root).toString().trim() : base;
    return { from: { rev: from }, to: { rev: head }, label: range, diffArgs: [from, head] };
  }
  return { from: { rev: range }, to: { worktree: true }, label: `${range} ↔ working tree`, diffArgs: [range] };
}

const STATUS: Record<string, FileStatus> = { A: 'added', D: 'deleted', M: 'modified', R: 'renamed', C: 'added', T: 'modified' };

/** Reads a change set out of git. Throws an Error with a user-facing message on failure. */
export function collectChangeSet(range: string | undefined): { entries: ChangeSetEntry[]; label: string } {
  let root: string;
  try {
    root = git(['rev-parse', '--show-toplevel']).toString().trim();
  } catch {
    throw new Error('Not inside a git repository');
  }
  let spec;
  let raw: string;
  try {
    spec = parseRange(range, root);
    raw = git(['diff', '--name-status', '-z', '-M', ...spec.diffArgs, '--'], root).toString('utf8');
  } catch (e) {
    const msg = ((e as { stderr?: Buffer }).stderr?.toString() || (e as Error).message).trim();
    throw new Error(`git failed: ${msg}`);
  }
  const parts = raw.split('\0').filter((p) => p !== '');
  const entries: ChangeSetEntry[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++]!;
    const status = STATUS[code[0]!];
    const renamed = code[0] === 'R' || code[0] === 'C';
    const first = parts[i++]!;
    const path = renamed ? parts[i++]! : first;
    if (!status) continue;
    const oldPath = code[0] === 'R' ? first : undefined;
    const before = status === 'added' ? undefined : readSide(spec.from, oldPath ?? path, root);
    const after = status === 'deleted' ? undefined : readSide(spec.to, path, root);
    const binary = (before && isBinary(before)) || (after && isBinary(after)) || false;
    entries.push({
      path,
      oldPath,
      status,
      binary,
      before: binary ? undefined : before?.toString('utf8'),
      after: binary ? undefined : after?.toString('utf8'),
    });
  }
  return { entries, label: spec.label };
}
