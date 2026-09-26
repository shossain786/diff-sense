#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { detectFormat, compare, parseConfig, renderSummary, resolveOptions } from '@diffsense/core';
import type { CompareOptions } from '@diffsense/core';

const USAGE = `Usage: diffsense compare <fileA> <fileB> [options]

Options:
  --json                 print the full result as JSON
  --config <file>        config file (default: ./.diffsense.json if present)
  --ignore-whitespace    --ignore-case    --ignore-array-order
  --ignore <glob>        ignore a path (repeatable)

Exit codes: 0 no differences, 1 differences found, 2 usage/error`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const args = process.argv.slice(2);
const files: string[] = [];
const flags: CompareOptions = {};
let asJson = false;
let configPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--json') asJson = true;
  else if (a === '--ignore-whitespace') flags.ignoreWhitespace = true;
  else if (a === '--ignore-case') flags.ignoreCase = true;
  else if (a === '--ignore-array-order') flags.ignoreArrayOrder = true;
  else if (a === '--ignore') (flags.ignorePaths ??= []).push(args[++i] ?? fail('--ignore needs a value'));
  else if (a === '--config') configPath = args[++i] ?? fail('--config needs a value');
  else if (a.startsWith('--')) fail(`Unknown option ${a}\n\n${USAGE}`);
  else files.push(a);
}
if (files[0] !== 'compare' || files.length !== 3) fail(USAGE);
const [, a, b] = files as [string, string, string];

let config = {};
const cfgFile = configPath ?? (existsSync('.diffsense.json') ? '.diffsense.json' : undefined);
if (cfgFile) {
  const parsed = parseConfig(readFileSync(cfgFile, 'utf8'));
  for (const e of parsed.errors) console.error(`${cfgFile}: ${e}`);
  config = parsed.config;
}

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch (e) {
    return fail(`Cannot read ${p}: ${(e as Error).message}`);
  }
};
const options = resolveOptions(config, detectFormat(a), flags);
const result = compare({ name: a, content: read(a) }, { name: b, content: read(b) }, options);
console.log(asJson ? JSON.stringify(result, null, 2) : renderSummary(result));
const { added, removed, modified } = result.stats;
process.exit(added + removed + modified > 0 ? 1 : 0);
