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

type Category = 'locator' | 'wait' | 'assertion';

const LOCATOR = /^By\.\w+$|\.(findElements?)$|^new (?:By\.\w+)$/;
const WAIT =
  /(^|\.)(sleep|implicitlyWait|pageLoadTimeout|setScriptTimeout|pollingEvery|withTimeout|ignoring)$|^Duration\.of\w+$|^new WebDriverWait$|^new FluentWait$|^TimeUnit\.\w+\.sleep$/;
const ASSERTION =
  /^(Assert|Assertions|Assumptions)\.\w+$|^assert\w+$|^assertThat$|^verify\w*$|^expect$|^\.(isEqualTo|isNotEqualTo|isTrue|isFalse|isNull|isNotNull|hasSize|contains|containsExactly|isEmpty|isNotEmpty|shouldBe|shouldHave)$/;

const LABEL: Record<Category, string> = { locator: 'locator', wait: 'wait strategy', assertion: 'assertion' };

const TEST_ANNOTATION =
  /^(Test|Ignore|Disabled|Before|After|BeforeEach|AfterEach|BeforeAll|AfterAll|BeforeClass|AfterClass|BeforeMethod|AfterMethod|BeforeSuite|AfterSuite|ParameterizedTest|RepeatedTest|DataProvider|Given|When|Then)$/;
const DISABLING = /^(Ignore|Disabled)$/;

const CALL = / › call (.+)$/;
const ANNO = / › @([\w.$]+)$/;

function categoryOf(callee: string): Category | undefined {
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
      const path = `${method} › ${LABEL[cat]}`;
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
          change: {
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

  // Test lifecycle annotations matter more than ordinary annotations.
  const out: Change[] = [];
  const byAt = new Map<number, Change[]>();
  for (const a of additions) byAt.set(a.at, [...(byAt.get(a.at) ?? []), a.change]);
  changes.forEach((c, idx) => {
    const extra = byAt.get(idx);
    if (extra) out.push(...extra);
    if (consumed.has(idx)) return;
    const an = ANNO.exec(c.path);
    const name = an?.[1]?.split('.').pop();
    if (name && TEST_ANNOTATION.test(name) && c.kind !== 'unchanged') {
      if (c.kind === 'removed') {
        out.push({ ...c, impact: 'high', reason: 'Test lifecycle annotation removed; the method may no longer run as a test or fixture.' });
        return;
      }
      if (c.kind === 'added' && DISABLING.test(name)) {
        out.push({ ...c, impact: 'high', reason: 'Test disabled; it will no longer run.' });
        return;
      }
    }
    out.push(c);
  });
  return out;
}
