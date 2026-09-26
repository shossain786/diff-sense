// Shared by the generator and the TypeScript test. The Kotlin test applies the same rules.
// Parser error details differ between engines, so they are masked.
export function normalize(result) {
  return JSON.parse(
    JSON.stringify({
      format: result.format,
      stats: result.stats,
      impact: result.impact,
      warnings: result.warnings.map((w) => w.replace(/\(.*\)\.?$/s, '(…)')),
      changes: result.changes.map((c) => ({
        path: c.path,
        kind: c.kind,
        before: c.before,
        after: c.after,
        evidence: c.evidence,
        impact: c.impact,
        reason: c.reason,
      })),
    }),
  );
}
