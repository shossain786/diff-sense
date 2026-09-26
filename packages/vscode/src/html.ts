import type { Change, ComparisonResult } from '@diffsense/core';
import { formatValue } from '@diffsense/core';

const MAX_ROWS = 500;

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

function row(c: Change): string {
  const badge = c.impact && c.impact !== 'informational'
    ? ` <span class="badge ${escapeHtml(c.impact)}" title="${escapeHtml(c.reason ?? '')}">${escapeHtml(c.impact)}</span>`
    : '';
  const path = `<span class="path">${escapeHtml(c.path)}</span>${badge}`;
  switch (c.kind) {
    case 'modified':
      return `<li class="mod"><span class="icon">⚠</span>${path}<div class="vals"><del>${escapeHtml(formatValue(c.before))}</del> → <ins>${escapeHtml(formatValue(c.after))}</ins></div></li>`;
    case 'added':
      return `<li class="add"><span class="icon">+</span>${path}<div class="vals"><ins>${escapeHtml(formatValue(c.after))}</ins></div></li>`;
    default:
      return `<li class="rem"><span class="icon">−</span>${path}<div class="vals"><del>${escapeHtml(formatValue(c.before))}</del></div></li>`;
  }
}

/** Summary panel body. All file-derived text is escaped; script is nonce-gated. */
export function renderPanelHtml(result: ComparisonResult, nonce: string, cspSource: string): string {
  const { added, removed, modified, unchanged } = result.stats;
  const total = added + removed + modified;
  const changed = result.changes.filter((c) => c.kind !== 'unchanged');
  const shown = changed.slice(0, MAX_ROWS).map(row).join('');
  const more = changed.length > MAX_ROWS ? `<p class="muted">…and ${changed.length - MAX_ROWS} more (export to see all).</p>` : '';
  const warnings = result.warnings.map((w) => `<p class="warn">${escapeHtml(w)}</p>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px 16px}
h1{font-size:1.2em;margin:0 0 4px}.muted{color:var(--vscode-descriptionForeground)}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.stat{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:6px 12px;min-width:64px}
.stat b{display:block;font-size:1.4em}
ul{list-style:none;padding:0;margin:0}li{padding:6px 0;border-bottom:1px solid var(--vscode-panel-border)}
.icon{display:inline-block;width:1.4em}.path{font-family:var(--vscode-editor-font-family);font-weight:600}
.vals{margin:2px 0 0 1.4em;font-family:var(--vscode-editor-font-family);word-break:break-all}
ins{text-decoration:none;color:var(--vscode-gitDecoration-addedResourceForeground)}
del{color:var(--vscode-gitDecoration-deletedResourceForeground)}
.badge{font-size:.75em;padding:0 6px;border-radius:8px;border:1px solid var(--vscode-panel-border);text-transform:uppercase}
.badge.medium{color:var(--vscode-editorWarning-foreground)}.badge.high,.badge.critical{color:var(--vscode-editorError-foreground)}
.warn{color:var(--vscode-editorWarning-foreground)}
.actions{margin:12px 0;display:flex;gap:8px;flex-wrap:wrap}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;padding:6px 12px;border-radius:3px;cursor:pointer}
button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
</style></head><body>
<h1>DiffSense</h1>
<div class="muted">${escapeHtml(base(result.left))} ↔ ${escapeHtml(base(result.right))} · ${escapeHtml(result.format)}</div>
<div class="muted">Before (left): <b>${escapeHtml(base(result.left))}</b> · After (right): <b>${escapeHtml(base(result.right))}</b></div>
<div class="stats">
<div class="stat"><b>${total}</b>changes</div>
<div class="stat"><b>${modified}</b>⚠ modified</div>
<div class="stat"><b>${added}</b>+ added</div>
<div class="stat"><b>${removed}</b>− removed</div>
<div class="stat"><b>${unchanged}</b>✓ unchanged</div>
</div>
${warnings}
<div class="actions">
<button class="primary" data-cmd="openDiff">Open Diff</button>
<button data-cmd="swap" title="Treat the right file as the old version and the left as the new one">Swap sides</button>
<button data-cmd="copyMarkdown">Copy as Markdown</button>
<button data-cmd="exportMarkdown">Export Markdown…</button>
</div>
${total === 0 ? '<p>No differences found.</p>' : `<ul>${shown}</ul>${more}`}
${result.impact ? `<p class="muted">Potential impact (estimate): <b>${escapeHtml(result.impact)}</b></p>` : ''}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.querySelectorAll('button[data-cmd]').forEach(b => b.addEventListener('click', () => vscode.postMessage({ cmd: b.dataset.cmd })));
</script>
</body></html>`;
}
