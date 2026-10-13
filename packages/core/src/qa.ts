import type { Change } from './types.js';

/**
 * QA / test-automation rule pack for Java changes.
 *
 * Works on the changes the Java analyzer already produced. Raw call changes
 * that belong to a QA concern (locators, waits, assertions) are replaced by
 * one semantic change each, so the summary reads "Locator changed" rather
 * than three unrelated call diffs. Observed facts stay `fact`; the Page
 * Object heuristic is the only `inferred` result and says so.
 */

export type Category = 'locator' | 'wait' | 'assertion';

const LOCATOR = /^By\.\w+$|\.(findElements?)$|^new (?:By\.\w+)$/;
const WAIT =
  /(^|\.)(sleep|implicitlyWait|pageLoadTimeout|setScriptTimeout|pollingEvery|withTimeout|ignoring)$|^Duration\.of\w+$|^new WebDriverWait$|^new FluentWait$|^TimeUnit\.\w+\.sleep$/;
const ASSERTION =
  /^(Assert|Assertions|Assumptions)\.\w+$|^assert\w+$|^assertThat$|^verify\w*$|^expect$|^\.(isEqualTo|isNotEqualTo|isTrue|isFalse|isNull|isNotNull|hasSize|contains|containsExactly|isEmpty|isNotEmpty|shouldBe|shouldHave)$/;

export const QA_LABEL: Record<Category, string> = { locator: 'locator', wait: 'wait strategy', assertion: 'assertion' };

const TEST_ANNOTATION =
  /^(Test|Ignore|Disabled|Before|After|BeforeEach|AfterEach|BeforeAll|AfterAll|BeforeClass|AfterClass|BeforeMethod|AfterMethod|BeforeSuite|AfterSuite|ParameterizedTest|RepeatedTest|DataProvider|Given|When|Then)$/;
const DISABLING = /^(Ignore|Disabled)$/;

/** The argument text of a disabling annotation, e.g. `"Broken in Chrome 142"` from `@Disabled("Broken in Chrome 142")`. */
const skipReason = (v: unknown): string | undefined => /\(\s*([^)]+?)\s*\)\s*$/.exec(String(v ?? ''))?.[1];

const CALL = / › call (.+)$/;
const ANNO = / › @([\w.$]+)$/;

export function categoryOf(callee: string): Category | undefined {
  if (ASSERTION.test(callee)) return 'assertion';
  if (LOCATOR.test(callee)) return 'locator';
  if (WAIT.test(callee)) return 'wait';
  return undefined;
}

/** Imports that make a Java file look like an automated test. */
export function looksLikeTest(imports: string[]): boolean {
  return imports.some((i) =>
    /^(org\.openqa\.selenium|org\.junit|org\.testng|io\.cucumber|com\.microsoft\.playwright|io\.restassured|org\.assertj)\b/.test(i),
  );
}

interface Item {
  idx: number;
  callee: string;
  change: Change;
}

const SEMANTIC: Record<Category, { modified: string; removed: string; added: string; impact: Record<string, Change['impact']> }> = {
  locator: {
    modified: 'Locator changed; element lookup may behave differently and test stability may be affected.',
    removed: 'Locator no longer appears in this method; it may have moved elsewhere (for example into a page object).',
    added: 'Locator added.',
    impact: { modified: 'medium', removed: 'medium', added: 'low' },
  },
  wait: {
    modified: 'Wait strategy or duration changed; timing and test stability may be affected.',
    removed: 'Wait removed; the test may become flaky if the page is not ready.',
    added: 'Wait added; the test may run slower or become more stable.',
    impact: { modified: 'medium', removed: 'medium', added: 'low' },
  },
  assertion: {
    modified: 'Assertion changed; the test now checks a different outcome.',
    removed: 'Assertion removed; the test may no longer verify this behaviour.',
    added: 'Assertion added.',
    impact: { modified: 'high', removed: 'high', added: 'low' },
  },
};

const BY_EXPR = /\bBy\.\w+\((?:"(?:[^"\\]|\\.)*"|[^()"])*\)/g;
const byExprs = (v: unknown): string[] => String(v ?? '').match(BY_EXPR) ?? [];

/** Lower is sturdier: ids survive layout changes; xpath and class names tend not to. */
const STRATEGY_RANK: Record<string, number> = { id: 0, name: 1, cssSelector: 2, className: 3, linkText: 3, partialLinkText: 3, tagName: 3, xpath: 4 };
const strategyOf = (expr: string): string | undefined => /^By\.(\w+)\(/.exec(expr)?.[1];
/** Absolute or index-based xpath breaks on any layout change. */
const POSITIONAL = /^By\.xpath\(\s*"(?:\/html|\/\/[\w*]+\[\d+\])|\[\d+\]/;

/** How the lookup strategy moved, as a short sentence; also nudges the impact when it clearly got worse or better. */
function strategyShift(before: string, after: string): { note: string; impact?: Change['impact'] } | undefined {
  const sb = strategyOf(before);
  const sa = strategyOf(after);
  if (!sb || !sa) return undefined;
  if (POSITIONAL.test(after) && !POSITIONAL.test(before)) {
    return { note: ' The new locator is position-based and breaks on layout changes.', impact: 'high' };
  }
  const rb = STRATEGY_RANK[sb];
  const ra = STRATEGY_RANK[sa];
  if (rb === undefined || ra === undefined || sb === sa) return undefined;
  if (ra > rb) return { note: ` Moved from ${sb} to ${sa}, which is usually less stable.` };
  return { note: ` Moved from ${sb} to ${sa}, which is usually more stable.`, impact: 'low' };
}

function locatorChange(path: string, kind: 'modified' | 'removed' | 'added', before?: string, after?: string): Change {
  const sem = SEMANTIC.locator;
  const shift = kind === 'modified' ? strategyShift(before!, after!) : undefined;
  return {
    path,
    kind,
    ...(before !== undefined && { before }),
    ...(after !== undefined && { after }),
    evidence: 'fact',
    impact: shift?.impact ?? sem.impact[kind],
    reason: sem[kind] + (shift?.note ?? ''),
  };
}

const FIND_BY = /^(FindBy|FindAll|FindBys)$/;

/** `@FindBy(xpath = "//a")` as `By.xpath("//a")`, so annotation locators compare like code locators. */
function findByAsBy(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const text = String(v);
  const parts = [...text.matchAll(/\b(id|name|xpath|css|className|linkText|partialLinkText|tagName)\s*=\s*("(?:[^"\\]|\\.)*")/g)];
  if (parts.length === 0) return text;
  return parts.map((m) => `By.${m[1] === 'css' ? 'cssSelector' : m[1]}(${m[2]})`).join(' | ');
}

/** Drop entries that merely contain another entry (a parent call whose arguments changed). */
function dropParents(items: string[]): string[] {
  return items.filter((s, i) => !items.some((o, j) => j !== i && o.length < s.length && s.includes(o)));
}

export function applyQaPack(changes: Change[]): Change[] {
  // Group call changes by owning method path.
  const groups = new Map<string, Map<Category, Item[]>>();
  changes.forEach((change, idx) => {
    const m = CALL.exec(change.path);
    if (!m || change.kind === 'unchanged') return;
    const cat = categoryOf(m[1]!);
    if (!cat) return;
    const method = change.path.slice(0, m.index);
    const byCat = groups.get(method) ?? new Map<Category, Item[]>();
    const list = byCat.get(cat) ?? [];
    list.push({ idx, callee: m[1]!, change });
    byCat.set(cat, list);
    groups.set(method, byCat);
  });

  const consumed = new Set<number>();
  const additions: { at: number; change: Change }[] = [];

  for (const [method, byCat] of groups) {
    for (const [cat, items] of byCat) {
      const sem = SEMANTIC[cat];
      const at = Math.min(...items.map((i) => i.idx));
      const path = `${method} › ${QA_LABEL[cat]}`;
      items.forEach((i) => consumed.add(i.idx));

      const removed = dropParents(items.filter((i) => i.change.kind === 'removed').map((i) => String(i.change.before)));
      const added = dropParents(items.filter((i) => i.change.kind === 'added').map((i) => String(i.change.after)));
      const paired = Math.min(removed.length, added.length);
      const pairs: (readonly [string, string])[] = [
        ...items.filter((i) => i.change.kind === 'modified').map((i) => [String(i.change.before), String(i.change.after)] as const),
        ...removed.slice(0, paired).map((r, k) => [r, added[k]!] as const),
      ];
      // A wrapper call (e.g. findElement(By.id(..))) changes only because its argument did.
      const leafPairs = pairs.filter(
        ([b, a], i) => !pairs.some(([ob, oa], j) => j !== i && ob.length < b.length && b.includes(ob) && a.includes(oa)),
      );

      const emit = (kind: Change['kind'], before?: string, after?: string) =>
        additions.push({
          at,
          change:
            cat === 'locator' && kind !== 'unchanged'
              ? locatorChange(path, kind as 'modified' | 'removed' | 'added', before, after)
              : {
            path,
            kind,
            ...(before !== undefined && { before }),
            ...(after !== undefined && { after }),
            evidence: 'fact',
            impact: sem.impact[kind],
            reason: sem[kind as 'modified' | 'removed' | 'added'],
          },
        });
      for (const [b, a] of leafPairs) emit('modified', b, a);
      for (const r of removed.slice(paired)) emit('removed', r);
      for (const a of added.slice(paired)) emit('added', undefined, a);
    }
  }

  // Inferred: direct Selenium interaction replaced by a page-object style call.
  for (const [method, byCat] of groups) {
    const locators = byCat.get('locator') ?? [];
    const direct = locators.some((i) => i.change.kind === 'removed' && /^\w*\.?findElements?$|\.findElements?$/.test(i.callee));
    const pageCall = changes.find(
      (c) => c.kind === 'added' && c.path.startsWith(`${method} › call `) && /^\w*[Pp]age\w*\.\w+$/.test(c.path.slice(`${method} › call `.length)),
    );
    if (direct && pageCall) {
      additions.push({
        at: Math.min(...locators.map((i) => i.idx)),
        change: {
          path: `${method} › implementation`,
          kind: 'modified',
          before: 'Direct Selenium interaction',
          after: 'Page Object abstraction',
          evidence: 'inferred',
          impact: 'medium',
          reason:
            'Possible intent: improved test abstraction (inferred, not observed). The Page Object implementation should be reviewed to confirm equivalent behaviour.',
        },
      });
    }
  }

  // Disabling a test also adds the annotation's import; that is one change, not two.
  const disabledImports = new Set<string>();
  for (const c of changes) {
    const an = ANNO.exec(c.path);
    const name = an?.[1]?.split('.').pop();
    if (c.kind === 'added' && name && DISABLING.test(name)) {
      const imp = changes.find((i) => i.kind === 'added' && i.path.startsWith('imports › ') && i.path.endsWith(`.${name}`));
      if (imp) disabledImports.add(imp.path);
    }
  }

  // Test lifecycle annotations matter more than ordinary annotations.
  const out: Change[] = [];
  const byAt = new Map<number, Change[]>();
  for (const a of additions) byAt.set(a.at, [...(byAt.get(a.at) ?? []), a.change]);
  changes.forEach((c, idx) => {
    const extra = byAt.get(idx);
    if (extra) out.push(...extra);
    if (consumed.has(idx) || disabledImports.has(c.path)) return;
    const an = ANNO.exec(c.path);
    const name = an?.[1]?.split('.').pop();
    if (c.kind !== 'unchanged' && name && FIND_BY.test(name)) {
      out.push(locatorChange(c.path.replace(ANNO, ' › locator'), c.kind, findByAsBy(c.before), findByAsBy(c.after)));
      return;
    }
    // A locator declared as a field (page objects) is still a locator.
    if (c.kind !== 'unchanged' && !c.path.includes(' › ')) {
      const l = byExprs(c.before);
      const r = byExprs(c.after);
      if (c.kind === 'modified' && l.length + r.length > 0 && l.join('\n') !== r.join('\n')) {
        const paired = Math.min(l.length, r.length);
        for (let k = 0; k < paired; k++) if (l[k] !== r[k]) out.push(locatorChange(`${c.path} › locator`, 'modified', l[k], r[k]));
        for (const x of l.slice(paired)) out.push(locatorChange(`${c.path} › locator`, 'removed', x));
        for (const x of r.slice(paired)) out.push(locatorChange(`${c.path} › locator`, 'added', undefined, x));
        return;
      }
      if (c.kind === 'added' && r.length > 0) {
        for (const x of r) out.push(locatorChange(`${c.path} › locator`, 'added', undefined, x));
        return;
      }
      if (c.kind === 'removed' && l.length > 0) {
        for (const x of l) out.push(locatorChange(`${c.path} › locator`, 'removed', x));
        return;
      }
    }
    if (name && TEST_ANNOTATION.test(name) && c.kind !== 'unchanged') {
      if (c.kind === 'removed') {
        out.push({ ...c, impact: 'high', reason: 'Test lifecycle annotation removed; the method may no longer run as a test or fixture.' });
        return;
      }
      if (c.kind === 'added' && DISABLING.test(name)) {
        const why = skipReason(c.after);
        out.push({ ...c, impact: 'high', reason: `Test disabled; it will no longer run.${why ? ` Reason given: ${why}.` : ''}` });
        return;
      }
      if (c.kind === 'modified' && DISABLING.test(name) && !skipReason(c.before) && skipReason(c.after)) {
        out.push({ ...c, impact: 'low', reason: `Skip reason documented (${skipReason(c.after)}); the test remains disabled.` });
        return;
      }
    }
    out.push(c);
  });
  return out;
}
