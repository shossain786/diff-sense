// Regenerates conformance/cases.json from the TypeScript core (the reference implementation).
// Run after `npm run build`:  node conformance/generate.mjs
import { writeFileSync } from 'node:fs';
import { compare, renderMarkdown, renderSummary } from '../packages/core/dist/index.js';
import { cases } from './inputs.mjs';
import { normalize } from './normalize.mjs';

const out = cases.map((c) => {
  const result = compare(c.left, c.right, c.options);
  return {
    ...c,
    expected: normalize(result),
    summary: renderSummary(result),
    markdown: renderMarkdown(result),
  };
});
const names = new Set(out.map((c) => c.name));
if (names.size !== out.length) throw new Error('duplicate case names');
writeFileSync(new URL('./cases.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.length} cases`);
