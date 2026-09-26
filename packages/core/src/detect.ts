import type { Format } from './types.js';

const BY_EXTENSION: Record<string, Format> = {
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  java: 'java',
};

/** Detect format from the file name; falls back to plain text. */
export function detectFormat(name: string): Format {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? 'text';
}
