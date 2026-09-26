import { detectFormat } from './detect.js';
import { computeStats } from './stats.js';
import type { CompareOptions, ComparisonResult, FileInput } from './types.js';

/**
 * Entry point. Phase 0: stub that only detects the format.
 * Comparators are added per format in Phase 1.
 */
export function compare(
  left: FileInput,
  right: FileInput,
  options: CompareOptions = {},
): ComparisonResult {
  const format = options.format ?? detectFormat(left.name);
  return {
    format,
    left: left.name,
    right: right.name,
    changes: [],
    stats: computeStats([]),
    warnings: ['No comparator implemented yet'],
  };
}
