import type { Change, ComparisonResult, Impact } from './types.js';

export const IMPACT_ORDER: Impact[] = ['informational', 'low', 'medium', 'high', 'critical'];

export const maxImpact = (a: Impact, b: Impact): Impact =>
  IMPACT_ORDER.indexOf(a) >= IMPACT_ORDER.indexOf(b) ? a : b;

interface Rule {
  re: RegExp;
  impact: Impact;
  reason: string;
}

/**
 * Keyword rules on the change path. First match wins, so the most severe
 * rules come first. These are heuristics: results are estimates only.
 */
const RULES: Rule[] = [
  {
    re: /(password|passwd|secret|token|api[-_]?key|private[-_]?key|credential)/,
    impact: 'critical',
    reason: 'Name suggests credentials or secrets; a change may break authentication or expose access.',
  },
  {
    re: /(url|uri|endpoint|host|domain|port|jdbc|database|db[-_]?name|connection|auth|permission|role|scope|encrypt|ssl|tls|cert)/,
    impact: 'high',
    reason: 'Name suggests a connection target or security setting; requests may reach a different service or be handled differently.',
  },
  {
    re: /(timeout|retry|retries|limit|max|min|threshold|delay|wait|interval|ttl|expir|cache|enabled|disabled|feature|flag|mode|version|size|count|batch|pool|thread)/,
    impact: 'medium',
    reason: 'Name suggests a behaviour or tuning setting; runtime behaviour may differ.',
  },
];

const FALLBACK: Rule = {
  re: /$^/,
  impact: 'low',
  reason: 'No known behaviour-related name; likely a data or descriptive value.',
};

/** Estimate the impact of a single structural (JSON/YAML/XML) change. */
export function classifyChange(change: Change): Change {
  if (change.kind === 'unchanged' || change.impact) return change;
  const path = change.path.toLowerCase();
  const rule = RULES.find((r) => r.re.test(path)) ?? FALLBACK;
  return { ...change, impact: rule.impact, reason: rule.reason };
}

/**
 * Fills in impact/reason on every change that lacks one and sets the overall
 * estimate. Free text has no structure to reason about, so it is left alone.
 */
export function applyImpact(result: ComparisonResult): ComparisonResult {
  if (result.format === 'text') return result;
  const changes = result.changes.map(classifyChange);
  const changed = changes.filter((c) => c.kind !== 'unchanged');
  const impact = changed.reduce<Impact | undefined>(
    (acc, c) => (c.impact ? (acc ? maxImpact(acc, c.impact) : c.impact) : acc),
    undefined,
  );
  return { ...result, changes, impact };
}
