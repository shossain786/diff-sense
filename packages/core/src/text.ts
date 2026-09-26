import { computeStats } from './stats.js';
import type { Change, ComparisonResult, CompareOptions, FileInput } from './types.js';

/** Give up aligning past this many edits (memory grows with edits²). */
const MAX_EDITS = 6000;

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


/**
 * Myers O(ND) shortest edit script. Returns ops as [type, i, j] where i/j are
 * indexes into `a`/`b` (for `add`, i is unused; for `del`, j is unused), or
 * null when the edit distance exceeds MAX_EDITS.
 */
function myers(a: string[], b: string[]): ['eq' | 'del' | 'add', number, number][] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  const max = Math.min(n + m, MAX_EDITS);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  const ops: ['eq' | 'del' | 'add', number, number][] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const t = trace[d]!; // snapshot of v before round d, indexed from k = -(d) - 1
    const at = (k: number) => t[k + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push(['eq', x, y]);
    }
    if (x === prevX) {
      y--;
      ops.push(['add', x, y]);
    } else {
      x--;
      ops.push(['del', x, y]);
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push(['eq', x, y]);
  }
  return ops.reverse();
}

/** Line-level diff (Myers). Path of a change is `L<n>` (1-based line number). */
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

  const mid = myers(na.slice(start, endA), nb.slice(start, endB));
  if (mid === null) {
    warnings.push('Files differ too much for line alignment; middle section reported as replaced');
    for (let i = start; i < endA; i++) ops.push({ t: 'del', line: a[i]!, l: i + 1, r: 0 });
    for (let j = start; j < endB; j++) ops.push({ t: 'add', line: b[j]!, l: 0, r: j + 1 });
  } else {
    for (const [t, i, j] of mid) {
      if (t === 'eq') ops.push({ t, line: a[start + i]!, l: start + i + 1, r: start + j + 1 });
      else if (t === 'del') ops.push({ t, line: a[start + i]!, l: start + i + 1, r: 0 });
      else ops.push({ t, line: b[start + j]!, l: 0, r: start + j + 1 });
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
