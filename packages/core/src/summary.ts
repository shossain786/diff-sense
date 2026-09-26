import { apiMismatches } from './api.js';
import type { Change, ComparisonResult } from './types.js';

/** Unchanged QA concerns (locator / wait strategy / assertion) worth calling out. */
export function qaUnchangedPaths(changes: Change[]): string[] {
  return changes
    .filter((c) => c.kind === 'unchanged' && / › (locator|wait strategy|assertion)$/.test(c.path))
    .map((c) => c.path);
}

export function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined) return '';
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? '' : /(ch|s|x)$/.test(word) ? 'es' : 's'}`;

const impactLine = (c: Change) =>
  c.impact && c.impact !== 'informational' ? `\n  Impact: ${c.impact.toUpperCase()}` : '';

const line = (c: Change): string => line0(c) + impactLine(c);

const line0 = (c: Change): string => {
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
const apiPath = (p: string) => (p.startsWith('body.') ? p.slice(5) : p);

function apiLine(c: Change): string {
  const p = apiPath(c.path);
  if (c.kind === 'unchanged') return `${p}:\n  ${formatValue(c.before)} → ${formatValue(c.after)} ✓`;
  if (c.kind === 'removed') return `${p}:\n  ${formatValue(c.before)} → (missing) ❌`;
  if (c.kind === 'added') return `${p}:\n  (not expected) → ${formatValue(c.after)} ❌`;
  return `${p}:\n  ${formatValue(c.before)} → ${formatValue(c.after)} ❌`;
}

/** PRD §15 expected-vs-actual report. */
function renderApiReport(result: ResultLike): string {
  const bad = apiMismatches(result);
  const out = ['DiffSense — API Response Comparison', '', `Expected: ${result.left}`, `Actual:   ${result.right}`, ''];
  for (const c of result.changes) out.push(apiLine(c), '');
  out.push(bad === 0 ? 'Result: PASS — actual matches expected' : `Result: FAIL — ${plural(bad, 'mismatch')}`);
  for (const w of result.warnings) out.push(`Note: ${w}`);
  return out.join('\n').trimEnd() + '\n';
}

export function renderSummary(result: ResultLike): string {
  if (result.format === 'api') return renderApiReport(result);
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
    const same = qaUnchangedPaths(result.changes);
    if (same.length > 0) out.push('Unchanged:', ...same.map((p) => `✓ ${p}`), '');
  }
  if (result.impact) out.push(`Potential impact (estimate): ${result.impact}`);
  for (const w of result.warnings) out.push(`Note: ${w}`);
  return out.join('\n').trimEnd() + '\n';
}

type ResultLike = Pick<ComparisonResult, 'format' | 'left' | 'right' | 'changes' | 'stats' | 'impact' | 'warnings'>;

const mdCode = (v: string) => '`' + v.replace(/`/g, "'").replace(/\n/g, ' ') + '`';

/** Markdown change summary, suitable for export or pasting into a PR. */
export function renderMarkdown(result: ResultLike): string {
  if (result.format === 'api') {
    const bad = apiMismatches(result);
    const out = [
      '# DiffSense — API Response Comparison',
      '',
      `**Expected:** ${mdCode(result.left)}  `,
      `**Actual:** ${mdCode(result.right)}`,
      '',
      `**Result:** ${bad === 0 ? 'PASS' : `FAIL (${plural(bad, 'mismatch')})`}`,
      '',
      '| Field | Expected | Actual | |',
      '|---|---|---|:-:|',
    ];
    const cell = (v: unknown) => mdCode(formatValue(v)).replace(/\|/g, '\\|');
    for (const c of result.changes) {
      const exp = c.kind === 'added' ? '_(not expected)_' : cell(c.before);
      const act = c.kind === 'removed' ? '_(missing)_' : cell(c.after);
      out.push(`| ${mdCode(apiPath(c.path))} | ${exp} | ${act} | ${c.kind === 'unchanged' ? '✓' : '❌'} |`);
    }
    for (const w of result.warnings) out.push('', `> Note: ${w}`);
    return out.join('\n') + '\n';
  }
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
  const same = qaUnchangedPaths(result.changes);
  if (same.length > 0) out.push('## Unchanged', '', ...same.map((p) => `- ✓ ${mdCode(p)}`), '');
  if (result.impact) out.push(`**Potential impact (estimate):** ${result.impact}`, '');
  for (const w of result.warnings) out.push(`> Note: ${w}`, '');
  return out.join('\n').trimEnd() + '\n';
}
