import { parseAllDocuments } from 'yaml';
import { diffValues, ParseError } from './json.js';
import { computeStats } from './stats.js';
import type { ComparisonResult, CompareOptions, FileInput } from './types.js';

/**
 * Parses YAML with anchors/aliases/merge keys resolved. A file with several
 * documents (`---`) becomes an array of documents, so paths read `[0].key`.
 */
export function parseYaml(input: FileInput): unknown {
  const docs = parseAllDocuments(input.content, { merge: true });
  for (const d of docs) {
    if (d.errors.length > 0) {
      throw new ParseError(`${input.name}: ${d.errors[0]!.message.split('\n')[0]}`);
    }
  }
  const values = docs.map((d) => d.toJS());
  return values.length <= 1 ? (values[0] ?? null) : values;
}

export function compareYaml(
  left: FileInput,
  right: FileInput,
  options: CompareOptions = {},
): ComparisonResult {
  const changes = diffValues(parseYaml(left), parseYaml(right), options);
  return {
    format: 'yaml',
    left: left.name,
    right: right.name,
    changes,
    stats: computeStats(changes),
    warnings: [],
  };
}
