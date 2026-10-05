import { compare } from './compare.js';
import { detectFormat } from './detect.js';
import { resolveOptions, type DiffSenseConfig } from './config.js';
import { IMPACT_ORDER, maxImpact } from './impact.js';
import { formatValue } from './summary.js';
import type { Change, ComparisonResult, Impact } from './types.js';

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed';

/** One file in a multi-file change set (a commit, branch, or working tree). */
export interface ChangeSetEntry {
  path: string;
  status: FileStatus;
  /** Previous path; only for renames. */
  oldPath?: string;
  /** Content before / after. Absent for the missing side of an added or deleted file. */
  before?: string;
  after?: string;
  binary?: boolean;
}

export interface FileChange {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  /** Set when both sides exist and were compared. */
  result?: ComparisonResult;
  /** True when the file differs textually but has no meaningful change (formatting only). */
  formattingOnly: boolean;
  impact?: Impact;
  reason?: string;
}

export interface ChangeSetStats {
  files: number;
  added: number;
  deleted: number;
  modified: number;
  renamed: number;
  formattingOnly: number;
  binary: number;
}

export interface ChangeSetResult {
  label: string;
  files: FileChange[];
  stats: ChangeSetStats;
  impact?: Impact;
}

const sig = (r: ComparisonResult) => r.stats.added + r.stats.removed + r.stats.modified;

function analyze(e: ChangeSetEntry, config: DiffSenseConfig): FileChange {
  const base = { path: e.path, oldPath: e.oldPath, status: e.status, binary: !!e.binary, formattingOnly: false };
  if (e.binary) return { ...base, impact: 'low', reason: 'Binary file; contents are not compared.' };
  if (e.status === 'added') return { ...base, impact: 'low', reason: 'New file.' };
  if (e.status === 'deleted') return { ...base, impact: 'medium', reason: 'File removed; anything depending on it may break.' };

  const format = detectFormat(e.path);
  const result = compare(
    { name: e.oldPath ?? e.path, content: e.before ?? '' },
    { name: e.path, content: e.after ?? '' },
    resolveOptions(config, format),
  );
  if (sig(result) === 0) {
    const renamed = e.status === 'renamed';
    return {
      ...base,
      result,
      formattingOnly: e.before !== e.after,
      impact: renamed ? 'informational' : undefined,
      reason: renamed ? 'Renamed with no content changes.' : undefined,
    };
  }
  // Free text has no impact estimate; treat it as low so it still shows up in the roll-up.
  return { ...base, result, impact: result.impact ?? 'low' };
}

/**
 * Compares every entry of a change set and rolls the results up. Pure: the
 * caller (CLI, IDE plugin) is responsible for reading git and the file system.
 */
export function compareChangeSet(entries: ChangeSetEntry[], config: DiffSenseConfig = {}, label = ''): ChangeSetResult {
  const files = entries.map((e) => analyze(e, config));
  const stats: ChangeSetStats = { files: files.length, added: 0, deleted: 0, modified: 0, renamed: 0, formattingOnly: 0, binary: 0 };
  for (const f of files) {
    stats[f.status]++;
    if (f.formattingOnly) stats.formattingOnly++;
    if (f.binary) stats.binary++;
  }
  const impact = files.reduce<Impact | undefined>(
    (acc, f) => (f.impact ? (acc ? maxImpact(acc, f.impact) : f.impact) : acc),
    undefined,
  );
  return { label, files, stats, impact };
}

/** Most severe first, then by path, so the important files lead the report. */
function ordered(files: FileChange[]): FileChange[] {
  const rank = (f: FileChange) => (f.impact ? IMPACT_ORDER.indexOf(f.impact) : -1);
  return [...files].sort((a, b) => rank(b) - rank(a) || a.path.localeCompare(b.path));
}

const ICON: Record<FileStatus, string> = { added: '+', deleted: '-', modified: '⚠', renamed: '→' };

const fileTitle = (f: FileChange) => (f.oldPath ? `${f.oldPath} → ${f.path}` : f.path);

function fileNote(f: FileChange): string {
  if (f.binary) return 'binary';
  if (f.formattingOnly) return 'formatting only';
  if (f.result && sig(f.result) > 0) {
    const { added, removed, modified } = f.result.stats;
    return [added && `${added} added`, removed && `${removed} removed`, modified && `${modified} modified`].filter(Boolean).join(', ');
  }
  return f.status === 'renamed' ? 'no content changes' : f.status;
}

const changedOf = (f: FileChange): Change[] => f.result?.changes.filter((c) => c.kind !== 'unchanged') ?? [];

function statsLine(s: ChangeSetStats): string {
  const parts = [`${s.files} file${s.files === 1 ? '' : 's'} changed`];
  for (const k of ['added', 'deleted', 'modified', 'renamed'] as const) if (s[k]) parts.push(`${s[k]} ${k}`);
  if (s.formattingOnly) parts.push(`${s.formattingOnly} formatting only`);
  return parts.join(', ');
}

const MAX_DETAILS = 8;

/** Plain-text multi-file summary. */
export function renderChangeSet(r: ChangeSetResult): string {
  const out = ['DiffSense — Change Set Summary', ''];
  if (r.label) out.push(`Comparing: ${r.label}`);
  out.push(statsLine(r.stats), '');
  if (r.files.length === 0) out.push('No differences found.');
  for (const f of ordered(r.files)) {
    const impact = f.impact && f.impact !== 'informational' ? `  [${f.impact.toUpperCase()}]` : '';
    out.push(`${ICON[f.status]} ${fileTitle(f)}  (${fileNote(f)})${impact}`);
    const changes = changedOf(f);
    for (const c of changes.slice(0, MAX_DETAILS)) {
      const v = c.kind === 'modified' ? `${formatValue(c.before)} → ${formatValue(c.after)}` : formatValue(c.kind === 'added' ? c.after : c.before);
      out.push(`    ${c.kind === 'added' ? '+' : c.kind === 'removed' ? '-' : '⚠'} ${c.path}: ${v}`);
    }
    if (changes.length > MAX_DETAILS) out.push(`    … and ${changes.length - MAX_DETAILS} more`);
    if (!f.result && f.reason) out.push(`    ${f.reason}`);
  }
  if (r.impact) out.push('', `Potential impact (estimate): ${r.impact}`);
  return out.join('\n').trimEnd() + '\n';
}

const html = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const code = (v: string) => '`' + v.replace(/`/g, "'").replace(/\n/g, ' ').replace(/\|/g, '\\|') + '`';

/** Markdown multi-file summary, suitable for a PR description or CI step summary. */
export function renderChangeSetMarkdown(r: ChangeSetResult): string {
  const out = ['# DiffSense — Change Set Summary', ''];
  if (r.label) out.push(`**Comparing:** ${code(r.label)}`, '');
  out.push(`**${statsLine(r.stats)}**`, '');
  if (r.files.length === 0) out.push('No differences found.', '');
  else {
    out.push('| File | Status | Changes | Impact |', '|---|---|---|---|');
    for (const f of ordered(r.files)) out.push(`| ${code(fileTitle(f))} | ${f.status} | ${fileNote(f)} | ${f.impact ?? '—'} |`);
    out.push('');
    for (const f of ordered(r.files).filter((x) => changedOf(x).length > 0)) {
      out.push(`<details><summary><code>${html(f.path)}</code></summary>`, '');
      const changes = changedOf(f);
      for (const c of changes.slice(0, MAX_DETAILS * 4)) {
        if (c.kind === 'modified') out.push(`- ⚠ ${code(c.path)}: ${code(formatValue(c.before))} → ${code(formatValue(c.after))}`);
        else if (c.kind === 'added') out.push(`- + ${code(c.path)}: ${code(formatValue(c.after))}`);
        else out.push(`- − ${code(c.path)}: ${code(formatValue(c.before))}`);
      }
      if (changes.length > MAX_DETAILS * 4) out.push(`- … and ${changes.length - MAX_DETAILS * 4} more`);
      out.push('', '</details>', '');
    }
  }
  if (r.impact) out.push(`**Potential impact (estimate):** ${r.impact}`, '');
  return out.join('\n').trimEnd() + '\n';
}
