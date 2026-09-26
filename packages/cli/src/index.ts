#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { compare } from '@diffsense/core';

const [cmd, a, b] = process.argv.slice(2);
if (cmd !== 'compare' || !a || !b) {
  console.error('Usage: diffsense compare <fileA> <fileB>');
  process.exit(2);
}
const result = compare(
  { name: a, content: readFileSync(a, 'utf8') },
  { name: b, content: readFileSync(b, 'utf8') },
);
console.log(JSON.stringify(result, null, 2));
