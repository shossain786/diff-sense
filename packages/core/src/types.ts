/**
 * Shared data model. The core must stay independent of VS Code:
 * no `vscode` imports, no I/O, pure functions only.
 */

export type Format = 'text' | 'json' | 'xml' | 'yaml' | 'java' | 'api';

export type ChangeKind = 'added' | 'removed' | 'modified' | 'unchanged';

/** Impact is an estimate, never a guarantee. */
export type Impact = 'informational' | 'low' | 'medium' | 'high' | 'critical';

/** Observed facts are kept separate from inferred intent. */
export type Evidence = 'fact' | 'inferred';

export interface Change {
  /** Dotted/structural path, e.g. `user.age` or `servers[0].host`. */
  path: string;
  kind: ChangeKind;
  before?: unknown;
  after?: unknown;
  evidence: Evidence;
  impact?: Impact;
  /** Human-readable reason for the impact estimate. */
  reason?: string;
}

export interface ChangeStats {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

export interface FileInput {
  /** Display name or path; used only for labels and format detection. */
  name: string;
  content: string;
}

export interface CompareOptions {
  /** Force a format instead of detecting it. */
  format?: Format;
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
  /** JSON/YAML/XML: ignore object key or attribute ordering. */
  ignoreOrdering?: boolean;
  /** Arrays whose element order does not matter. */
  ignoreArrayOrder?: boolean;
  /** Path globs to exclude, e.g. `metadata.*`, `**.timestamp`. */
  ignorePaths?: string[];
  /** Treat numerically equal values (30 vs 30.0) as equal. */
  numericEquality?: boolean;
  /** XML specifics. */
  ignoreXmlDeclaration?: boolean;
  ignoreAttributes?: string[];
  ignoreNamespaces?: boolean;
  /** API responses: ignore fields present in the actual response but not in the expected one. */
  ignoreExtraFields?: boolean;
  /** API responses: header names (case-insensitive) that are never compared. */
  ignoreHeaders?: string[];
  /** Java: apply test-automation rules. Undefined = auto-detect from imports. */
  qaMode?: boolean;
}

export interface ComparisonResult {
  format: Format;
  left: string;
  right: string;
  changes: Change[];
  stats: ChangeStats;
  /** Overall estimate; undefined until the impact classifier exists. */
  impact?: Impact;
  /** Set when a structured parse failed and the text fallback was used. */
  warnings: string[];
}

export type Comparator = (
  left: FileInput,
  right: FileInput,
  options: CompareOptions,
) => ComparisonResult;
