import * as vscode from 'vscode';
import {
  compare,
  detectFormat,
  formatContent,
  parseConfig,
  renderMarkdown,
  resolveOptions,
  type CompareOptions,
  type ComparisonResult,
  type DiffSenseConfig,
} from '@diffsense/core';
import { randomBytes } from 'node:crypto';
import { renderPanelHtml } from './html.js';

const SCHEME = 'diffsense';

/** In-memory documents for clipboard/selection comparisons (never written to disk). */
class VirtualDocs implements vscode.TextDocumentContentProvider {
  private docs = new Map<string, string>();
  private n = 0;
  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.path) ?? '';
  }
  add(label: string, fileName: string, content: string): vscode.Uri {
    const path = `/${label}-${++this.n}/${fileName}`;
    this.docs.set(path, content);
    return vscode.Uri.from({ scheme: SCHEME, path });
  }
}

const virtualDocs = new VirtualDocs();
let panel: vscode.WebviewPanel | undefined;
let last: { result: ComparisonResult; left: vscode.Uri; right: vscode.Uri; forced: CompareOptions } | undefined;
let pendingSelection: { text: string; fileName: string } | undefined;

const fileName = (uri: vscode.Uri) => uri.path.split('/').pop() ?? uri.path;

async function loadConfig(): Promise<DiffSenseConfig> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return {};
  const file = vscode.Uri.joinPath(root, '.diffsense.json');
  let text: string;
  try {
    text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
  } catch {
    return {}; // no config file
  }
  const { config, errors } = parseConfig(text);
  if (errors.length > 0) {
    void vscode.window.showWarningMessage(`DiffSense: problems in .diffsense.json — ${errors[0]}`);
  }
  return config;
}

function settingsOptions(): CompareOptions {
  const c = vscode.workspace.getConfiguration('diffsense');
  const o: CompareOptions = {};
  for (const k of ['ignoreWhitespace', 'ignoreCase', 'ignoreArrayOrder', 'numericEquality', 'ignoreNamespaces', 'ignoreXmlDeclaration', 'ignoreExtraFields'] as const) {
    if (c.get<boolean>(k)) o[k] = true;
  }
  const qa = c.get<string>('qaMode');
  if (qa === 'on') o.qaMode = true;
  else if (qa === 'off') o.qaMode = false;
  for (const k of ['ignorePaths', 'ignoreAttributes', 'ignoreHeaders'] as const) {
    const v = c.get<string[]>(k) ?? [];
    if (v.length > 0) o[k] = v;
  }
  return o;
}

async function readText(uri: vscode.Uri): Promise<string> {
  if (uri.scheme === 'file') {
    const max = (vscode.workspace.getConfiguration('diffsense').get<number>('maxFileSizeMB') ?? 10) * 1024 * 1024;
    const { size } = await vscode.workspace.fs.stat(uri);
    if (size > max) throw new Error(`${fileName(uri)} is larger than the ${max / 1048576} MB limit (diffsense.maxFileSizeMB)`);
  }
  try {
    return (await vscode.workspace.openTextDocument(uri)).getText();
  } catch {
    throw new Error(`${fileName(uri)} cannot be read as text`);
  }
}

async function analyze(left: vscode.Uri, right: vscode.Uri, openDiff: boolean, forced: CompareOptions = {}): Promise<void> {
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DiffSense: analyzing…' },
      async () => {
        const [a, b] = await Promise.all([readText(left), readText(right)]);
        // Workspace file config wins over user settings; both are local-only.
        const format = forced.format ?? detectFormat(fileName(left));
        const options = { ...settingsOptions(), ...resolveOptions(await loadConfig(), format), ...forced };
        const result = compare({ name: fileName(left), content: a }, { name: fileName(right), content: b }, options);
        last = { result, left, right, forced };
        if (openDiff) await openNativeDiff();
        showPanel(result);
      },
    );
  } catch (e) {
    void vscode.window.showErrorMessage(`DiffSense: ${(e as Error).message}`);
  }
}

async function openNativeDiff(): Promise<void> {
  if (!last) return;
  await vscode.commands.executeCommand(
    'vscode.diff',
    last.left,
    last.right,
    `${fileName(last.left)} ↔ ${fileName(last.right)}`,
    { preview: true },
  );
}

function showPanel(result: ComparisonResult): void {
  if (!panel) {
    panel = vscode.window.createWebviewPanel('diffsense.summary', 'DiffSense', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
    panel.onDidDispose(() => (panel = undefined));
    panel.webview.onDidReceiveMessage(onPanelMessage);
  } else panel.reveal(undefined, true);
  panel.title = `DiffSense: ${fileName(vscode.Uri.file(result.left))} ↔ ${fileName(vscode.Uri.file(result.right))}`;
  panel.webview.html = renderPanelHtml(result, randomBytes(16).toString('hex'), panel.webview.cspSource);
}

async function onPanelMessage(msg: { cmd?: string }): Promise<void> {
  if (!last) return;
  if (msg.cmd === 'openDiff') await openNativeDiff();
  else if (msg.cmd === 'swap') await analyze(last.right, last.left, true, last.forced);
  else if (msg.cmd === 'copyMarkdown') {
    await vscode.env.clipboard.writeText(renderMarkdown(last.result));
    void vscode.window.setStatusBarMessage('DiffSense: summary copied as Markdown', 3000);
  } else if (msg.cmd === 'exportMarkdown') {
    const dir = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(process.cwd());
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(dir, 'diffsense-summary.md'),
      filters: { Markdown: ['md'] },
    });
    if (target) {
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(renderMarkdown(last.result)));
      void vscode.window.showInformationMessage(`DiffSense: saved ${fileName(target)}`);
    }
  }
}

async function pickFile(title: string, near?: vscode.Uri): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Compare',
    title,
    defaultUri: near ? vscode.Uri.joinPath(near, '..') : undefined,
  });
  return picked?.[0];
}

async function compareFiles(clicked?: vscode.Uri, selected?: vscode.Uri[], forced: CompareOptions = {}): Promise<void> {
  if (selected && selected.length === 2) return analyze(selected[0]!, selected[1]!, true, forced);
  const left = clicked ?? vscode.window.activeTextEditor?.document.uri ?? (await pickFile('Select the first file'));
  if (!left) return;
  const right = await pickFile(`Compare ${fileName(left)} with…`, left);
  if (right) await analyze(left, right, true, forced);
}

/** Expected (current file) vs actual (picked file), reported as pass/fail. */
const compareApiResponses = (clicked?: vscode.Uri, selected?: vscode.Uri[]) =>
  compareFiles(clicked, selected, { format: 'api' });

async function compareClipboard(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return void vscode.window.showInformationMessage('DiffSense: open a file to compare with the clipboard.');
  const clip = await vscode.env.clipboard.readText();
  const name = fileName(editor.document.uri);
  const left = editor.selection.isEmpty
    ? editor.document.uri
    : virtualDocs.add('selection', name, editor.document.getText(editor.selection));
  await analyze(left, virtualDocs.add('clipboard', name, clip), true);
}

async function compareSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return void vscode.window.showInformationMessage('DiffSense: select some text first.');
  }
  const text = editor.document.getText(editor.selection);
  const name = fileName(editor.document.uri);
  if (!pendingSelection) {
    pendingSelection = { text, fileName: name };
    void vscode.window.setStatusBarMessage('DiffSense: first selection saved — select the second and run again', 6000);
    return;
  }
  const first = pendingSelection;
  pendingSelection = undefined;
  await analyze(
    virtualDocs.add('selection-a', first.fileName, first.text),
    virtualDocs.add('selection-b', name, text),
    true,
  );
}

async function analyzeCurrentDiff(): Promise<void> {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputTextDiff) return analyze(input.original, input.modified, false);
  void vscode.window.showInformationMessage('DiffSense: open a diff editor first (or use "Compare Files").');
}

/** Reformats a file in the editor (one undo step): indented JSON/XML/YAML, or one EDIFACT segment per line. */
async function formatFile(clicked?: vscode.Uri): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(clicked ?? vscode.window.activeTextEditor?.document.uri ?? (() => { throw new Error('open a file to format first'); })());
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    const tab = editor?.options.tabSize;
    const formatted = formatContent({ name: fileName(doc.uri), content: doc.getText() }, { indent: typeof tab === 'number' && tab > 0 ? tab : 2 });
    if (formatted === doc.getText()) return void vscode.window.setStatusBarMessage('DiffSense: already formatted', 3000);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), formatted);
    await vscode.workspace.applyEdit(edit);
    if (!editor) await vscode.window.showTextDocument(doc, { preview: false });
    void vscode.window.setStatusBarMessage(`DiffSense: formatted ${fileName(doc.uri)} (not saved)`, 4000);
  } catch (e) {
    void vscode.window.showErrorMessage(`DiffSense: ${(e as Error).message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, virtualDocs),
    vscode.commands.registerCommand('diffsense.compareFiles', (u?: vscode.Uri, s?: vscode.Uri[]) => compareFiles(u, s)),
    vscode.commands.registerCommand('diffsense.compareApiResponses', compareApiResponses),
    vscode.commands.registerCommand('diffsense.compareClipboard', compareClipboard),
    vscode.commands.registerCommand('diffsense.compareSelection', compareSelection),
    vscode.commands.registerCommand('diffsense.formatFile', formatFile),
    vscode.commands.registerCommand('diffsense.analyzeCurrentDiff', analyzeCurrentDiff),
    vscode.commands.registerCommand('diffsense.explainChanges', () =>
      vscode.window.showInformationMessage('DiffSense: AI explanations are planned for a later release. The deterministic summary is available via "Analyze Current Diff".'),
    ),
  );
}

export function deactivate(): void {}
