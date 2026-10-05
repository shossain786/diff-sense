#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  detectFormat,
  compare,
  formatContent,
  compareChangeSet,
  IMPACT_ORDER,
  parseConfig,
  renderChangeSet,
  renderChangeSetMarkdown,
  renderSummary,
  resolveOptions,
} from '@diffsense/core';
import type { CompareOptions, Impact } from '@diffsense/core';
import { collectChangeSet } from './git.js';

const USAGE = `Usage: diffsense compare <fileA> <fileB> [options]
       diffsense api <expected> <actual> [options]     compare API responses (pass/fail)
       diffsense git [<rev> | <base>..<head> | <base>...<head>] [options]
                                                       summarize a git change set

       diffsense format <file> [--write] [--indent <n>]
                                                       reformat JSON/XML/YAML, or split EDIFACT into one segment per line

git ranges: no argument = working tree vs HEAD; <rev> = <rev> vs working tree;
            A..B = A vs B; A...B = merge-base of A and B vs B (PR-style)

Options:
  --json                 print the full result as JSON
  --config <file>        config file (default: ./.diffsense.json if present)
  --ignore-whitespace    --ignore-case    --ignore-array-order
  --ignore <glob>        ignore a path (repeatable)
  --ignore-extra         api: ignore fields only present in the actual response
  --ignore-header <name> api: never compare this header (repeatable)
  --write                format: rewrite the file in place instead of printing
  --indent <n>           format: spaces per level (default 2)
  --markdown             git: print a Markdown summary (PR / CI step summary)
  --fail-on <impact>     git: exit 1 if overall impact >= informational|low|medium|high|critical

Exit codes: 0 no differences / PASS, 1 differences / FAIL, 2 usage/error
            (git: 0 unless --fail-on is set and met)`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const args = process.argv.slice(2);
const files: string[] = [];
const flags: CompareOptions = {};
let asJson = false;
let configPath: string | undefined;
let markdown = false;
let write = false;
let indent = 2;
let failOn: Impact | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--json') asJson = true;
  else if (a === '--ignore-whitespace') flags.ignoreWhitespace = true;
  else if (a === '--ignore-case') flags.ignoreCase = true;
  else if (a === '--ignore-array-order') flags.ignoreArrayOrder = true;
  else if (a === '--ignore-extra') flags.ignoreExtraFields = true;
  else if (a === '--ignore-header') (flags.ignoreHeaders ??= []).push(args[++i] ?? fail('--ignore-header needs a value'));
  else if (a === '--ignore') (flags.ignorePaths ??= []).push(args[++i] ?? fail('--ignore needs a value'));
  else if (a === '--markdown') markdown = true;
  else if (a === '--write') write = true;
  else if (a === '--indent') {
    indent = Number(args[++i]);
    if (!Number.isInteger(indent) || indent < 1 || indent > 8) fail('--indent must be a whole number from 1 to 8');
  }
  else if (a === '--fail-on') {
    const v = args[++i] ?? fail('--fail-on needs a value');
    if (!IMPACT_ORDER.includes(v as Impact)) fail(`--fail-on must be one of ${IMPACT_ORDER.join(', ')}`);
    failOn = v as Impact;
  } else if (a === '--config') configPath = args[++i] ?? fail('--config needs a value');
  else if (a.startsWith('--')) fail(`Unknown option ${a}\n\n${USAGE}`);
  else files.push(a);
}
if (files[0] === 'format') {
  if (files.length !== 2) fail(USAGE);
  const path = files[1]!;
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
    const out = formatContent({ name: path, content }, { indent });
    if (write) writeFileSync(path, out);
    else process.stdout.write(out);
  } catch (e) {
    fail(`Cannot format ${path}: ${(e as Error).message}`);
  }
  process.exit(0);
}
const isGit = files[0] === 'git';
if (isGit ? files.length > 2 : (files[0] !== 'compare' && files[0] !== 'api') || files.length !== 3) fail(USAGE);

let config = {};
const cfgFile = configPath ?? (existsSync('.diffsense.json') ? '.diffsense.json' : undefined);
if (cfgFile) {
  const parsed = parseConfig(readFileSync(cfgFile, 'utf8'));
  for (const e of parsed.errors) console.error(`${cfgFile}: ${e}`);
  config = parsed.config;
}

if (isGit) {
  let set;
  try {
    set = collectChangeSet(files[1]);
  } catch (e) {
    fail((e as Error).message);
  }
  const result = compareChangeSet(set.entries, config, set.label);
  console.log(asJson ? JSON.stringify(result, null, 2) : markdown ? renderChangeSetMarkdown(result) : renderChangeSet(result));
  const met = failOn && result.impact && IMPACT_ORDER.indexOf(result.impact) >= IMPACT_ORDER.indexOf(failOn);
  process.exit(met ? 1 : 0);
}
const [cmd, a, b] = files as [string, string, string];
const isApi = cmd === 'api';

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch (e) {
    return fail(`Cannot read ${p}: ${(e as Error).message}`);
  }
};
const options = resolveOptions(config, isApi ? 'api' : detectFormat(a), isApi ? { ...flags, format: 'api' } : flags);
const result = compare({ name: a, content: read(a) }, { name: b, content: read(b) }, options);
console.log(asJson ? JSON.stringify(result, null, 2) : renderSummary(result));
const { added, removed, modified } = result.stats;
process.exit(added + removed + modified > 0 ? 1 : 0);
