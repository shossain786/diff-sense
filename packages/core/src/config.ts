import type { CompareOptions, Format } from './types.js';

/**
 * Shape of `.diffsense.json` (and the VS Code settings). `defaults` apply to
 * every format; `formats.<name>` overrides them for that format only.
 */
export interface DiffSenseConfig {
  defaults?: CompareOptions;
  formats?: Partial<Record<Format, CompareOptions>>;
}

const BOOLEANS = [
  'ignoreWhitespace',
  'ignoreCase',
  'ignoreOrdering',
  'ignoreArrayOrder',
  'numericEquality',
  'ignoreXmlDeclaration',
  'ignoreNamespaces',
  'qaMode',
  'ignoreExtraFields',
] as const;
const LISTS = ['ignorePaths', 'ignoreAttributes', 'ignoreHeaders'] as const;
const FORMATS: Format[] = ['text', 'json', 'xml', 'yaml', 'java', 'api'];

/** Validates untrusted option input; returns cleaned options and problems. */
export function sanitizeOptions(raw: unknown, where = 'options'): { options: CompareOptions; errors: string[] } {
  const options: Record<string, unknown> = {};
  const errors: string[] = [];
  if (raw === undefined) return { options, errors };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { options, errors: [`${where}: expected an object`] };
  }
  for (const [k, v] of Object.entries(raw)) {
    if ((BOOLEANS as readonly string[]).includes(k)) {
      if (typeof v === 'boolean') options[k] = v;
      else errors.push(`${where}.${k}: expected boolean`);
    } else if ((LISTS as readonly string[]).includes(k)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) options[k] = v;
      else errors.push(`${where}.${k}: expected array of strings`);
    } else if (k === 'format') {
      if (FORMATS.includes(v as Format)) options[k] = v;
      else errors.push(`${where}.format: expected one of ${FORMATS.join(', ')}`);
    } else errors.push(`${where}.${k}: unknown option`);
  }
  return { options: options as CompareOptions, errors };
}

/** Parses the text of a `.diffsense.json` file. */
export function parseConfig(text: string): { config: DiffSenseConfig; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { config: {}, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { config: {}, errors: ['Config must be a JSON object'] };
  }
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];
  const config: DiffSenseConfig = {};
  for (const k of Object.keys(r)) {
    if (k !== 'defaults' && k !== 'formats') errors.push(`${k}: unknown key`);
  }
  const d = sanitizeOptions(r.defaults, 'defaults');
  errors.push(...d.errors);
  config.defaults = d.options;
  if (r.formats !== undefined) {
    if (typeof r.formats !== 'object' || r.formats === null || Array.isArray(r.formats)) {
      errors.push('formats: expected an object');
    } else {
      config.formats = {};
      for (const [f, v] of Object.entries(r.formats)) {
        if (!FORMATS.includes(f as Format)) {
          errors.push(`formats.${f}: unknown format`);
          continue;
        }
        const s = sanitizeOptions(v, `formats.${f}`);
        errors.push(...s.errors);
        config.formats[f as Format] = s.options;
      }
    }
  }
  return { config, errors };
}

/**
 * Effective options for a format: defaults, then per-format overrides, then
 * explicit call-site overrides. List options are replaced, not merged.
 */
export function resolveOptions(
  config: DiffSenseConfig,
  format: Format,
  overrides: CompareOptions = {},
): CompareOptions {
  return { ...config.defaults, ...config.formats?.[format], ...overrides };
}
