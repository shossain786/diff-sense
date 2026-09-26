import type { Change, ComparisonResult } from './types.js';

export function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined) return '';
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const line = (c: Change): string => {
  switch (c.kind) {
    case 'modified':
      return `⚠ ${c.path}\n  ${formatValue(c.before)} → ${formatValue(c.after)}`;
    case 'added':
      return `+ ${c.path}\n  ${formatValue(c.after)}`;
    case 'removed':
      return `- ${c.path}\n  ${formatValue(c.before)}`;
    default:
      return `✓ ${c.path}\n  unchanged`;
  }
};

/** Plain-text change summary (PRD §9). Unchanged entries are counted, not listed. */
export function renderSummary(result: ResultLike): string {
  const { added, removed, modified, unchanged } = result.stats;
  const total = added + removed + modified;
  const out = ['DiffSense — Change Summary', '', 'Files:', result.left, result.right, ''];
  if (total === 0) {
    out.push('No differences found.');
  } else {
    out.push('Changes:');
    if (added) out.push(`+ ${plural(added, 'item')} added`);
    if (removed) out.push(`- ${plural(removed, 'item')} removed`);
    if (modified) out.push(`⚠ ${plural(modified, 'item')} modified`);
    if (unchanged) out.push(`✓ ${unchanged} unchanged`);
    out.push('', 'Details:', '────────────────────────────');
    for (const c of result.changes.filter((x) => x.kind !== 'unchanged')) out.push(line(c), '');
  }
  if (result.impact) out.push(`Potential impact (estimate): ${result.impact}`);
  for (const w of result.warnings) out.push(`Note: ${w}`);
  return out.join('\n').trimEnd() + '\n';
}

type ResultLike = Pick<ComparisonResult, 'left' | 'right' | 'changes' | 'stats' | 'impact' | 'warnings'>;

const mdCode = (v: string) => '`' + v.replace(/`/g, "'").replace(/\n/g, ' ') + '`';

/** Markdown change summary, suitable for export or pasting into a PR. */
export function renderMarkdown(result: ResultLike): string {
  const { added, removed, modified, unchanged } = result.stats;
  const out = [
    '# DiffSense — Change Summary',
    '',
    `**Files:** ${mdCode(result.left)} ↔ ${mdCode(result.right)}`,
    '',
    '| Added | Removed | Modified | Unchanged |',
    '|---:|---:|---:|---:|',
    `| ${added} | ${removed} | ${modified} | ${unchanged} |`,
    '',
  ];
  const changed = result.changes.filter((c) => c.kind !== 'unchanged');
  if (changed.length === 0) out.push('No differences found.', '');
  else {
    out.push('## Changes', '');
    for (const c of changed) {
      if (c.kind === 'modified') {
        out.push(`- ⚠ ${mdCode(c.path)}: ${mdCode(formatValue(c.before))} → ${mdCode(formatValue(c.after))}`);
      } else if (c.kind === 'added') out.push(`- + ${mdCode(c.path)}: ${mdCode(formatValue(c.after))}`);
      else out.push(`- − ${mdCode(c.path)}: ${mdCode(formatValue(c.before))}`);
    }
    out.push('');
  }
  if (result.impact) out.push(`**Potential impact (estimate):** ${result.impact}`, '');
  for (const w of result.warnings) out.push(`> Note: ${w}`, '');
  return out.join('\n').trimEnd() + '\n';
}
