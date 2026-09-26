import { parse } from 'java-parser';
import { matchesAny, compileGlobs } from './glob.js';
import { ParseError } from './json.js';
import { computeStats } from './stats.js';
import type { Change, ComparisonResult, CompareOptions, FileInput, Impact } from './types.js';

/* ---------- CST helpers ---------- */

interface Tok {
  image: string;
  startOffset: number;
  endOffset: number;
}
interface Node {
  name: string;
  children: Record<string, (Node | Tok)[]>;
  location: { startOffset: number; endOffset: number };
}
const isTok = (n: Node | Tok): n is Tok => 'image' in n;
const start = (n: Node | Tok) => (isTok(n) ? n.startOffset : n.location.startOffset);
const end = (n: Node | Tok) => (isTok(n) ? n.endOffset : n.location.endOffset);

const kids = (n: Node): (Node | Tok)[] =>
  Object.values(n.children)
    .flat()
    .sort((a, b) => start(a) - start(b));
const nodeKids = (n: Node): Node[] => kids(n).filter((k): k is Node => !isTok(k));

function first(n: Node, name: string): Node | undefined {
  for (const k of nodeKids(n)) {
    if (k.name === name) return k;
    const r = first(k, name);
    if (r) return r;
  }
  return undefined;
}
function all(n: Node, name: string, out: Node[] = []): Node[] {
  for (const k of nodeKids(n)) {
    if (k.name === name) out.push(k);
    else all(k, name, out);
  }
  return out;
}
function tokens(n: Node, out: Tok[] = []): Tok[] {
  for (const k of kids(n)) {
    if (isTok(k)) out.push(k);
    else tokens(k, out);
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/* ---------- Model ---------- */

interface Fact {
  base: string; // e.g. `call driver.findElement`, `if`, `assign timeout`
  value: string; // compared for equality
  show: string; // shown to the user
  impact?: Impact;
  reason?: string;
}
interface JMethod {
  key: string;
  name: string;
  sig: string;
  isPublic: boolean;
  annos: string[];
  facts: Fact[];
}
interface JField {
  name: string;
  decl: string;
  annos: string[];
}
interface JType {
  qname: string;
  header: string;
  annos: string[];
  isPublic: boolean;
  fields: Map<string, JField>;
  methods: Map<string, JMethod>;
}
interface JModel {
  pkg?: string;
  imports: string[];
  types: Map<string, JType>;
}

const TYPE_NODES: Record<string, string> = {
  normalClassDeclaration: 'class',
  enumDeclaration: 'enum',
  normalInterfaceDeclaration: 'interface',
  annotationInterfaceDeclaration: '@interface',
  recordDeclaration: 'record',
};
const BODY_NODES = ['classBody', 'enumBody', 'interfaceBody', 'recordBody', 'annotationInterfaceBody'];

/* ---------- Body facts ---------- */

const NOT_CALLS = new Set([
  'if', 'while', 'for', 'switch', 'catch', 'synchronized', 'return', 'throw', 'new', 'else', 'do', 'try', 'assert',
]);
const IDENT = /^[A-Za-z_$][\w$]*$/;
const LOGGING = /^(log|logger|LOG|LOGGER|System\.out|System\.err)\b|\.(debug|info|trace|warn|println|printf|print)$/;

function extractFacts(body: Node | undefined, src: string): Fact[] {
  if (!body) return [];
  const T = tokens(body).sort((a, b) => a.startOffset - b.startOffset);
  const facts: Fact[] = [];
  const slice = (a: number, b: number) => norm(src.slice(a, b));

  const closeOf = (open: number): number => {
    let depth = 0;
    for (let j = open; j < T.length; j++) {
      if (T[j]!.image === '(') depth++;
      else if (T[j]!.image === ')' && --depth === 0) return j;
    }
    return -1;
  };
  // index of the token ending an expression that starts at `from`
  const exprEnd = (from: number): number => {
    let depth = 0;
    for (let j = from; j < T.length; j++) {
      const t = T[j]!.image;
      if (t === '(' || t === '[' || t === '{') depth++;
      else if (t === ')' || t === ']' || t === '}') {
        if (depth === 0) return j - 1;
        depth--;
      } else if (depth === 0 && (t === ';' || t === ',')) return j - 1;
    }
    return T.length - 1;
  };

  for (let i = 0; i < T.length; i++) {
    const t = T[i]!.image;
    const next = T[i + 1]?.image;

    if ((t === 'if' || t === 'while' || t === 'for' || t === 'switch' || t === 'catch') && next === '(') {
      const c = closeOf(i + 1);
      if (c < 0) continue;
      const inner = slice(T[i + 1]!.endOffset + 1, T[c]!.startOffset);
      const isCatch = t === 'catch';
      facts.push({
        base: isCatch ? 'catch' : `${t}`,
        value: inner,
        show: `${t} (${inner})`,
        impact: 'medium',
        reason: isCatch ? 'Exception handling changed.' : 'Control-flow condition changed; behaviour may differ.',
      });
    } else if (t === 'throw') {
      const e = exprEnd(i + 1);
      const v = slice(T[i + 1]!.startOffset, T[Math.max(e, i + 1)]!.endOffset + 1);
      facts.push({ base: 'throw', value: v, show: `throw ${v}`, impact: 'medium', reason: 'Exception handling changed.' });
    } else if (t === 'finally') {
      facts.push({ base: 'finally', value: '', show: 'finally', impact: 'medium', reason: 'Exception handling changed.' });
    } else if (t === 'return' && next !== ';') {
      const e = exprEnd(i + 1);
      const v = slice(T[i + 1]!.startOffset, T[Math.max(e, i + 1)]!.endOffset + 1);
      facts.push({ base: 'return', value: v, show: `return ${v}`, impact: 'medium', reason: 'Returned value changed.' });
    } else if (IDENT.test(t) && !NOT_CALLS.has(t) && next === '(') {
      const c = closeOf(i + 1);
      if (c < 0) continue;
      const args = slice(T[i + 1]!.endOffset + 1, T[c]!.startOffset);
      let callee = t;
      if (T[i - 1]?.image === 'new') callee = `new ${t}`;
      else {
        let j = i;
        while (T[j - 1]?.image === '.' && IDENT.test(T[j - 2]?.image ?? '')) {
          callee = `${T[j - 2]!.image}.${callee}`;
          j -= 2;
        }
        if (T[j - 1]?.image === '.' && T[j - 2]?.image === ')') callee = `.${callee}`;
      }
      const logging = LOGGING.test(callee);
      facts.push({
        base: `call ${callee}`,
        value: args,
        show: `${callee}(${args})`,
        impact: logging ? 'low' : 'medium',
        reason: logging ? 'Logging/output call changed.' : 'Method call changed; behaviour may differ.',
      });
    } else if (t === '=' && IDENT.test(T[i - 1]?.image ?? '')) {
      let lhs = T[i - 1]!.image;
      let j = i - 1;
      while (T[j - 1]?.image === '.' && IDENT.test(T[j - 2]?.image ?? '')) {
        lhs = `${T[j - 2]!.image}.${lhs}`;
        j -= 2;
      }
      const e = exprEnd(i + 1);
      if (e >= i + 1) {
        const v = slice(T[i + 1]!.startOffset, T[e]!.endOffset + 1);
        // impact left unset: keyword rules classify by variable name
        facts.push({ base: `assign ${lhs}`, value: v, show: `${lhs} = ${v}` });
      }
    }
  }
  return facts;
}

/* ---------- Model building ---------- */

function modifiers(n: Node, extra?: Node): { mods: string[]; annos: string[] } {
  const mods: string[] = [];
  const annos: string[] = [];
  for (const holder of extra ? [extra, n] : [n]) {
    for (const k of nodeKids(holder)) {
      if (!/Modifier$/.test(k.name) || k.name === 'variableModifier') continue;
      const a = first(k, 'annotation');
      if (a) annos.push(sliceText(a));
      else mods.push(sliceText(k));
    }
  }
  return { mods, annos };
}

let SRC = '';
const sliceText = (n: Node | Tok) => norm(SRC.slice(start(n), end(n) + 1));

function buildModel(input: FileInput): JModel {
  let cst: Node;
  try {
    cst = parse(input.content) as unknown as Node;
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0] ?? 'syntax error';
    throw new ParseError(`${input.name}: ${msg}`);
  }
  SRC = input.content;
  const model: JModel = { imports: [], types: new Map() };

  const visit = (n: Node, parent: Node | undefined, cur: JType | undefined): void => {
    const typeKind = TYPE_NODES[n.name];
    if (typeKind) {
      const id = first(n, 'typeIdentifier');
      const name = id ? sliceText(id) : '?';
      const qname = cur ? `${cur.qname}.${name}` : name;
      const { mods, annos } = modifiers(n, parent);
      const body = nodeKids(n).find((k) => BODY_NODES.includes(k.name));
      const headerEnd = body ? start(body) : end(n) + 1;
      const header = `${mods.join(' ')} ${norm(SRC.slice(start(n), headerEnd))}`.trim();
      const t: JType = {
        qname,
        header,
        annos,
        isPublic: mods.includes('public'),
        fields: new Map(),
        methods: new Map(),
      };
      model.types.set(qname, t);
      for (const k of nodeKids(n)) visit(k, n, t);
      return;
    }
    switch (n.name) {
      case 'packageDeclaration':
        model.pkg = sliceText(n).replace(/^package\s+/, '').replace(/;$/, '').trim();
        return;
      case 'importDeclaration':
        model.imports.push(sliceText(n).replace(/^import\s+/, '').replace(/;$/, '').trim());
        return;
      case 'methodDeclaration':
      case 'interfaceMethodDeclaration':
      case 'constructorDeclaration':
        if (cur) addMethod(n, cur);
        return;
      case 'fieldDeclaration':
      case 'constantDeclaration':
        if (cur) addFields(n, cur);
        return;
      case 'enumConstant':
        if (cur) {
          const nm = tokens(n).find((k) => IDENT.test(k.image))?.image ?? '?';
          cur.fields.set(nm, { name: nm, decl: `enum constant ${sliceText(n)}`, annos: [] });
        }
        return;
    }
    for (const k of nodeKids(n)) visit(k, n, cur);
  };

  const addMethod = (n: Node, t: JType) => {
    const isCtor = n.name === 'constructorDeclaration';
    const { mods, annos } = modifiers(n);
    const declarator = first(n, isCtor ? 'constructorDeclarator' : 'methodDeclarator');
    if (!declarator) return;
    const name = isCtor
      ? sliceText(first(declarator, 'simpleTypeName') ?? declarator)
      : (tokens(declarator).find((k) => IDENT.test(k.image))?.image ?? '?');
    const plist = first(declarator, 'formalParameterList');
    const types = plist
      ? all(plist, 'formalParameter').map((p) => {
          const ty = first(p, 'unannType');
          const arity = first(p, 'variableArityParameter') ? '...' : '';
          return (ty ? sliceText(ty).replace(/\s+/g, '') : '?') + arity;
        })
      : [];
    const key = `${isCtor ? '<init>' : name}(${types.join(',')})`;
    const header = first(n, 'methodHeader');
    const result = header ? first(header, 'result') : undefined;
    const typeParams = header ? nodeKids(header).find((k) => k.name === 'typeParameters') : undefined;
    const thr = first(n, 'throws');
    const sig = norm(
      [
        mods.join(' '),
        typeParams ? sliceText(typeParams) : '',
        result ? sliceText(result) : '',
        `${name}(${plist ? sliceText(plist) : ''})`,
        thr ? sliceText(thr) : '',
      ].join(' '),
    );
    const body = first(n, isCtor ? 'constructorBody' : 'methodBody');
    t.methods.set(key, {
      key,
      name,
      sig,
      isPublic: mods.includes('public') || mods.includes('protected') || t.header.startsWith('interface') && !mods.includes('private'),
      annos,
      facts: extractFacts(body, SRC),
    });
  };

  const addFields = (n: Node, t: JType) => {
    const { mods, annos } = modifiers(n);
    const ty = first(n, 'unannType');
    const typeText = ty ? sliceText(ty) : '?';
    for (const d of all(n, 'variableDeclarator')) {
      const id = first(d, 'variableDeclaratorId');
      const name = id ? sliceText(id) : '?';
      const init = first(d, 'variableInitializer');
      t.fields.set(name, {
        name,
        decl: norm(`${mods.join(' ')} ${typeText} ${name}${init ? ` = ${sliceText(init)}` : ''}`),
        annos,
      });
    }
  };

  visit(cst, undefined, undefined);
  return model;
}

/* ---------- Diff ---------- */

const annoName = (a: string) => /^@\s*([\w.$]+)/.exec(a)?.[1] ?? a;

function diffAnnotations(path: string, l: string[], r: string[], out: Change[]): void {
  const lm = new Map(l.map((a) => [annoName(a), a]));
  const rm = new Map(r.map((a) => [annoName(a), a]));
  for (const [n, a] of lm) {
    const b = rm.get(n);
    if (b === undefined) {
      out.push({ path: `${path} › @${n}`, kind: 'removed', before: a, evidence: 'fact', impact: 'medium', reason: 'Annotation removed; framework behaviour may change.' });
    } else if (a !== b) {
      out.push({ path: `${path} › @${n}`, kind: 'modified', before: a, after: b, evidence: 'fact', impact: 'medium', reason: 'Annotation arguments changed.' });
    }
  }
  for (const [n, b] of rm) {
    if (!lm.has(n)) out.push({ path: `${path} › @${n}`, kind: 'added', after: b, evidence: 'fact', impact: 'low', reason: 'Annotation added.' });
  }
}

function diffFacts(path: string, l: Fact[], r: Fact[], out: Change[]): void {
  const bases: string[] = [];
  for (const f of [...l, ...r]) if (!bases.includes(f.base)) bases.push(f.base);
  for (const base of bases) {
    const L = l.filter((f) => f.base === base);
    const R = r.filter((f) => f.base === base);
    for (let i = L.length - 1; i >= 0; i--) {
      const j = R.findIndex((x) => x.value === L[i]!.value);
      if (j >= 0) {
        L.splice(i, 1);
        R.splice(j, 1);
      }
    }
    const paired = Math.min(L.length, R.length);
    const meta = (f: Fact) => ({ evidence: 'fact' as const, ...(f.impact && { impact: f.impact, reason: f.reason }) });
    const p = `${path} › ${base}`;
    for (let k = 0; k < paired; k++) {
      out.push({ path: p, kind: 'modified', before: L[k]!.show, after: R[k]!.show, ...meta(R[k]!) });
    }
    for (const f of L.slice(paired)) out.push({ path: p, kind: 'removed', before: f.show, ...meta(f) });
    for (const f of R.slice(paired)) out.push({ path: p, kind: 'added', after: f.show, ...meta(f) });
  }
}

function diffMethod(path: string, a: JMethod, b: JMethod, out: Change[]): void {
  const before = out.length;
  if (a.sig !== b.sig) {
    out.push({
      path,
      kind: 'modified',
      before: a.sig,
      after: b.sig,
      evidence: 'fact',
      impact: b.isPublic || a.isPublic ? 'high' : 'medium',
      reason: 'Method signature changed; callers may be affected.',
    });
  }
  diffAnnotations(path, a.annos, b.annos, out);
  diffFacts(path, a.facts, b.facts, out);
  if (out.length === before) out.push({ path, kind: 'unchanged', before: a.sig, after: b.sig, evidence: 'fact' });
}

function diffModels(a: JModel, b: JModel): Change[] {
  const out: Change[] = [];
  if (a.pkg !== b.pkg) {
    out.push({ path: 'package', kind: 'modified', before: a.pkg, after: b.pkg, evidence: 'fact', impact: 'high', reason: 'Package changed; all references to this class are affected.' });
  }
  for (const i of a.imports) {
    if (!b.imports.includes(i)) out.push({ path: `imports › ${i}`, kind: 'removed', before: i, evidence: 'fact', impact: 'informational', reason: 'Import removed.' });
  }
  for (const i of b.imports) {
    if (!a.imports.includes(i)) out.push({ path: `imports › ${i}`, kind: 'added', after: i, evidence: 'fact', impact: 'informational', reason: 'Import added.' });
  }

  for (const [q, ta] of a.types) {
    const tb = b.types.get(q);
    if (!tb) {
      out.push({ path: q, kind: 'removed', before: ta.header, evidence: 'fact', impact: ta.isPublic ? 'high' : 'medium', reason: 'Type removed; dependants may break.' });
      continue;
    }
    const start = out.length;
    if (ta.header !== tb.header) {
      out.push({ path: q, kind: 'modified', before: ta.header, after: tb.header, evidence: 'fact', impact: 'high', reason: 'Type declaration (modifiers, supertypes or kind) changed.' });
    }
    diffAnnotations(q, ta.annos, tb.annos, out);

    for (const [n, fa] of ta.fields) {
      const fb = tb.fields.get(n);
      const p = `${q}.${n}`;
      if (!fb) out.push({ path: p, kind: 'removed', before: fa.decl, evidence: 'fact', impact: 'medium', reason: 'Field removed.' });
      else if (fa.decl !== fb.decl) out.push({ path: p, kind: 'modified', before: fa.decl, after: fb.decl, evidence: 'fact' });
      else out.push({ path: p, kind: 'unchanged', before: fa.decl, after: fb.decl, evidence: 'fact' });
      if (fb) diffAnnotations(p, fa.annos, fb.annos, out);
    }
    for (const [n, fb] of tb.fields) {
      if (!ta.fields.has(n)) out.push({ path: `${q}.${n}`, kind: 'added', after: fb.decl, evidence: 'fact', impact: 'low', reason: 'Field added.' });
    }

    // Methods: match by name+parameter types, then pair leftovers by name (signature change).
    const remA = [...ta.methods.values()].filter((m) => !tb.methods.has(m.key));
    const remB = [...tb.methods.values()].filter((m) => !ta.methods.has(m.key));
    for (const [k, ma] of ta.methods) {
      const mb = tb.methods.get(k);
      if (mb) diffMethod(`${q}.${k}`, ma, mb, out);
    }
    for (const ma of remA) {
      const idx = remB.findIndex((m) => m.name === ma.name);
      if (idx >= 0) {
        const mb = remB.splice(idx, 1)[0]!;
        diffMethod(`${q}.${mb.key}`, ma, mb, out);
      } else {
        out.push({ path: `${q}.${ma.key}`, kind: 'removed', before: ma.sig, evidence: 'fact', impact: ma.isPublic ? 'high' : 'medium', reason: 'Method removed; callers may break.' });
      }
    }
    for (const mb of remB) {
      out.push({ path: `${q}.${mb.key}`, kind: 'added', after: mb.sig, evidence: 'fact', impact: 'low', reason: 'Method added.' });
    }
    if (out.length === start) out.push({ path: q, kind: 'unchanged', before: ta.header, after: tb.header, evidence: 'fact' });
  }
  for (const [q, tb] of b.types) {
    if (!a.types.has(q)) out.push({ path: q, kind: 'added', after: tb.header, evidence: 'fact', impact: 'low', reason: 'Type added.' });
  }
  return out;
}

export function compareJava(
  left: FileInput,
  right: FileInput,
  options: CompareOptions = {},
): ComparisonResult {
  const a = buildModel(left);
  const b = buildModel(right);
  let changes = diffModels(a, b);
  if (options.ignorePaths?.length) {
    const ig = compileGlobs(options.ignorePaths);
    changes = changes.filter((c) => !matchesAny(c.path, ig));
  }
  return {
    format: 'java',
    left: left.name,
    right: right.name,
    changes,
    stats: computeStats(changes),
    warnings: [],
  };
}
