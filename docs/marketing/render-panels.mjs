// Renders the extension's real summary-panel HTML (packages/vscode/src/html.ts) for the
// sample files, with VS Code Dark+ style theme variables, into docs/marketing/panels/*.html.
// Run after `npm run build`:  node docs/marketing/render-panels.mjs   (any working directory)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compare } from '../../packages/core/dist/index.js';

const out = new URL('./panels/', import.meta.url);
mkdirSync(out, { recursive: true });
const bundle = new URL('./panels/html.bundle.cjs', import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL('../../packages/vscode/src/html.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle.pathname,
});
const { renderPanelHtml } = createRequire(import.meta.url)(bundle.pathname);

const THEME = `:root{
--vscode-font-family:"Ubuntu","Segoe UI",sans-serif;--vscode-editor-font-family:"DejaVu Sans Mono",Consolas,monospace;
--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-panel-border:#80808059;
--vscode-gitDecoration-addedResourceForeground:#81b88b;--vscode-gitDecoration-deletedResourceForeground:#c74e39;
--vscode-editorWarning-foreground:#cca700;--vscode-editorError-foreground:#f14c4c;
--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;
--vscode-button-secondaryBackground:transparent;--vscode-button-secondaryForeground:#ccc}
body{background:#181818;margin:0;width:620px}`;

const read = (p) => readFileSync(new URL(`../../samples/${p}`, import.meta.url), 'utf8');
const cases = {
  'api': [['api-expected.json', 'api-actual.json'], { format: 'api' }],
  'json': [['config-a.json', 'config-b.json'], {}],
  'xml': [['user-a.xml', 'user-b.xml'], {}],
};
for (const [name, [[a, b], opts]] of Object.entries(cases)) {
  const r = compare({ name: a, content: read(a) }, { name: b, content: read(b) }, opts);
  const html = renderPanelHtml(r, 'n', 'x').replace('</head>', `<style nonce="n">${THEME}</style></head>`);
  writeFileSync(new URL(`${name}.html`, out), html);
  console.log(name, JSON.stringify(r.stats));
}
