import { detectFormat } from './detect.js';
import { compareJson, ParseError } from './json.js';
import { compareText } from './text.js';
import type { CompareOptions, ComparisonResult, FileInput } from './types.js';

/**
 * Entry point. Dispatches by format; anything without a structural
 * comparator (or that fails to parse) falls back to a line diff.
 */
export function compare(
  left: FileInput,
  right: FileInput,
  options: CompareOptions = {},
): ComparisonResult {
  const format = options.format ?? detectFormat(left.name);
  try {
    if (format === 'json') return compareJson(left, right, options);
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    return compareText(left, right, options, 'text', [
      `Invalid JSON, fell back to text comparison (${e.message})`,
    ]);
  }
  const warnings =
    format === 'text' ? [] : [`No structural comparator for ${format} yet; used text comparison`];
  return compareText(left, right, options, 'text', warnings);
}
