import { computeStats } from './stats.js';
import type { Change, ComparisonResult, CompareOptions, FileInput } from './types.js';

const MAX_DP_CELLS = 40_000_000;

type Op = { t: 'eq' | 'del' | 'add'; line: string; l: number; r: number };

function normalizer(options: CompareOptions) {
  return (line: string): string => {
    let s = line.replace(/\r$/, '');
    if (options.ignoreWhitespace) s = s.trim().replace(/\s+/g, ' ');
    if (options.ignoreCase) s = s.toLowerCase();
    return s;
  };
}

function splitLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Line-level LCS diff. Path of a change is `L<n>` (1-based line number). */
export function compareText(
  left: FileInput,
  right: FileInput,
  options: CompareOptions = {},
  format: ComparisonResult['format'] = 'text',
  warnings: string[] = [],
): ComparisonResult {
  const norm = normalizer(options);
  const a = splitLines(left.content);
  const b = splitLines(right.content);
  const na = a.map(norm);
  const nb = b.map(norm);

  let start = 0;
  while (start < na.length && start < nb.length && na[start] === nb[start]) start++;
  let endA = na.length;
  let endB = nb.length;
  while (endA > start && endB > start && na[endA - 1] === nb[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ t: 'eq', line: a[i]!, l: i + 1, r: i + 1 });

  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_DP_CELLS) {
    warnings.push('Files too large for line alignment; middle section reported as replaced');
    for (let i = start; i < endA; i++) ops.push({ t: 'del', line: a[i]!, l: i + 1, r: 0 });
    for (let j = start; j < endB; j++) ops.push({ t: 'add', line: b[j]!, l: 0, r: j + 1 });
  } else {
    // lcs[i][j] = LCS length of na[start+i..endA) and nb[start+j..endB)
    const lcs: Uint32Array[] = [];
    for (let i = 0; i <= n; i++) lcs.push(new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i]![j] =
          na[start + i] === nb[start + j]
            ? lcs[i + 1]![j + 1]! + 1
            : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && na[start + i] === nb[start + j]) {
        ops.push({ t: 'eq', line: a[start + i]!, l: start + i + 1, r: start + j + 1 });
        i++;
        j++;
      } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
        ops.push({ t: 'del', line: a[start + i]!, l: start + i + 1, r: 0 });
        i++;
      } else {
        ops.push({ t: 'add', line: b[start + j]!, l: 0, r: start + j + 1 });
        j++;
      }
    }
  }
  for (let k = 0; endA + k < na.length; k++) {
    ops.push({ t: 'eq', line: a[endA + k]!, l: endA + k + 1, r: endB + k + 1 });
  }

  // Pair adjacent removed/added runs into "modified" lines.
  const changes: Change[] = [];
  let unchanged = 0;
  for (let k = 0; k < ops.length; ) {
    if (ops[k]!.t === 'eq') {
      unchanged++;
      k++;
      continue;
    }
    const dels: Op[] = [];
    const adds: Op[] = [];
    while (k < ops.length && ops[k]!.t !== 'eq') {
      (ops[k]!.t === 'del' ? dels : adds).push(ops[k]!);
      k++;
    }
    const paired = Math.min(dels.length, adds.length);
    for (let p = 0; p < paired; p++) {
      changes.push({
        path: `L${dels[p]!.l}`,
        kind: 'modified',
        before: dels[p]!.line,
        after: adds[p]!.line,
        evidence: 'fact',
      });
    }
    for (const d of dels.slice(paired)) {
      changes.push({ path: `L${d.l}`, kind: 'removed', before: d.line, evidence: 'fact' });
    }
    for (const x of adds.slice(paired)) {
      changes.push({ path: `L${x.r}`, kind: 'added', after: x.line, evidence: 'fact' });
    }
  }

  return {
    format,
    left: left.name,
    right: right.name,
    changes,
    stats: { ...computeStats(changes), unchanged },
    warnings,
  };
}
