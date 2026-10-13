import { describe, expect, it } from 'vitest';
import { compare, renderSummary, type CompareOptions } from '../src/index.js';

const jv = (a: string, b: string, o: CompareOptions = {}) =>
  compare({ name: 'LoginTest.java', content: a }, { name: 'LoginTest.java', content: b }, o);
const view = (r: ReturnType<typeof jv>) =>
  r.changes.filter((c) => c.kind !== 'unchanged').map((c) => `${c.kind}:${c.path.replace('LoginTest.login() › ', '')}`);

const src = (locator: string, wait: string, extra = '', anno = '@Test') => `
import org.openqa.selenium.By;
import org.junit.jupiter.api.Test;
public class LoginTest {
  ${anno}
  void login() {
    driver.findElement(${locator}).click();
    new WebDriverWait(driver, Duration.ofSeconds(${wait})).until(ready);
    assertEquals("Home", driver.getTitle());${extra}
  }
}`;
const A = src('By.id("login")', '10');

describe('QA rule pack', () => {
  it('PRD example: locator and wait strategy changes, assertion unchanged', () => {
    const r = jv(A, src('By.cssSelector(".login-button")', '20'));
    expect(view(r).sort()).toEqual(['modified:locator', 'modified:wait strategy']);
    const loc = r.changes.find((c) => c.path.endsWith('› locator'))!;
    expect(loc.before).toBe('By.id("login")');
    expect(loc.after).toBe('By.cssSelector(".login-button")');
    expect(loc.impact).toBe('medium');
    const wait = r.changes.find((c) => c.path.endsWith('› wait strategy'))!;
    expect(wait.before).toBe('Duration.ofSeconds(10)');
    expect(wait.after).toBe('Duration.ofSeconds(20)');
    expect(r.impact).toBe('medium');
    expect(renderSummary(r)).toContain('By.id("login") → By.cssSelector(".login-button")');
  });

  it('assertion changes are high impact', () => {
    const r = jv(A, A.replace('"Home"', '"Dashboard"'));
    expect(view(r)).toEqual(['modified:assertion']);
    expect(r.changes.find((c) => c.path.endsWith('› assertion'))?.impact).toBe('high');
    expect(jv(A, A.replace(/\s*assertEquals[^\n]*/, '')).changes.find((c) => c.kind === 'removed')?.reason).toMatch(
      /no longer verify/,
    );
  });

  it('Selenium -> page object: facts stay facts, intent is labelled inferred', () => {
    const b = A.replace('driver.findElement(By.id("login")).click();', 'loginPage.clickLogin();');
    const r = jv(A, b);
    const inferred = r.changes.filter((c) => c.evidence === 'inferred');
    expect(inferred).toHaveLength(1);
    expect(inferred[0]).toMatchObject({
      before: 'Direct Selenium interaction',
      after: 'Page Object abstraction',
      impact: 'medium',
    });
    expect(inferred[0]!.reason).toMatch(/inferred, not observed/);
    expect(r.changes.some((c) => c.evidence === 'fact' && c.kind === 'removed' && c.path.endsWith('› locator'))).toBe(true);
    expect(r.changes.some((c) => c.path.endsWith('› call loginPage.clickLogin') && c.kind === 'added')).toBe(true);
  });

  it('no false positives when only unrelated code changes', () => {
    const r = jv(A, src('By.id("login")', '10', '\n    log.info("done");'));
    expect(view(r)).toEqual(['added:call log.info']);
    expect(r.changes.some((c) => c.evidence === 'inferred')).toBe(false);
  });

  it('test lifecycle annotations: removal and disabling are high impact', () => {
    const removed = jv(A, src('By.id("login")', '10', '', ''));
    expect(removed.changes.find((c) => c.path.endsWith('@Test'))).toMatchObject({ kind: 'removed', impact: 'high' });
    const disabled = jv(A, src('By.id("login")', '10', '', '@Test @Disabled'));
    expect(disabled.changes.find((c) => c.path.endsWith('@Disabled'))).toMatchObject({ kind: 'added', impact: 'high' });
  });

  it('disabling a test is one change: the matching import is not reported separately', () => {
    const base = 'import org.junit.jupiter.api.Test;\nclass T { @Test void a() { assertEquals(1, x()); } }';
    const off = 'import org.junit.jupiter.api.Test;\nimport org.junit.jupiter.api.Disabled;\nclass T { @Test @Disabled("Broken in Chrome 142") void a() { assertEquals(1, x()); } }';
    const r = jv(base, off);
    expect(r.changes.some((c) => c.path.startsWith('imports ›'))).toBe(false);
    const d = r.changes.find((c) => c.path.endsWith('@Disabled'))!;
    expect(d).toMatchObject({ kind: 'added', impact: 'high' });
    expect(d.reason).toContain('"Broken in Chrome 142"');
    // unrelated import changes stay
    const other = jv(base, off.replace('import org.junit.jupiter.api.Disabled;', 'import java.util.List;'));
    expect(other.changes.some((c) => c.path === 'imports › java.util.List')).toBe(true);
  });

  it('adding a skip reason to an already disabled test is low impact', () => {
    const a = 'import org.junit.Ignore;\nimport org.junit.Test;\nclass T { @Test @Ignore void a() {} }';
    const b = a.replace('@Ignore void', '@Ignore("flaky on CI") void');
    const c = jv(a, b).changes.find((x) => x.path.endsWith('@Ignore'))!;
    expect(c).toMatchObject({ kind: 'modified', impact: 'low' });
  });

  it('locators declared as page-object fields are locator changes', () => {
    const page = (f: string) => `import org.openqa.selenium.By;\nclass LoginPage {\n  ${f}\n}`;
    const r = jv(page('private Query q = new Query(By.id("q"));'), page('private Query q = new Query(By.xpath("/html/body/div[2]/input"));'));
    const loc = r.changes.find((c) => c.path === 'LoginPage.q › locator')!;
    expect(loc).toMatchObject({ kind: 'modified', before: 'By.id("q")', after: 'By.xpath("/html/body/div[2]/input")', impact: 'high' });
    expect(loc.reason).toContain('position-based');
    // wrapper-only change: the locator itself is the same, so no locator change is reported
    const wrapped = jv(page('Query q = new Query(By.name("q"));'), page('Query q = new Query().defaultLocator(By.name("q"));'));
    expect(wrapped.changes.some((c) => c.path.endsWith('› locator'))).toBe(false);
    const added = jv(page(''), page('By b = By.id("x");'));
    expect(added.changes.find((c) => c.path === 'LoginPage.b › locator')).toMatchObject({ kind: 'added', impact: 'low' });
  });

  it('@FindBy changes are locator changes; moving to a sturdier strategy is lower impact', () => {
    const page = (a: string) => `import org.openqa.selenium.support.FindBy;\nclass P {\n  ${a}\n  WebElement q;\n}`;
    const r = jv(page('@FindBy(xpath = "//input[@name=\'q\']")'), page('@FindBy(id = "q")'));
    const loc = r.changes.find((c) => c.path === 'P.q › locator')!;
    expect(loc).toMatchObject({ kind: 'modified', impact: 'low' });
    expect(loc.reason).toContain('more stable');
  });

  it('auto-detect: off for non-test files, forceable with qaMode', () => {
    const plain = 'class C { void m() { driver.findElement(By.id("a")).click(); } }';
    const changed = plain.replace('"a"', '"b"');
    expect(jv(plain, changed).changes.some((c) => c.path.endsWith('› locator'))).toBe(false);
    expect(jv(plain, changed, { qaMode: true }).changes.some((c) => c.path.endsWith('› locator'))).toBe(true);
    expect(jv(A, A.replace('"login"', '"x"'), { qaMode: false }).changes.some((c) => c.path.endsWith('› locator'))).toBe(false);
  });
});

describe('QA unchanged reporting', () => {
  it('lists concerns that stayed the same (PRD: "Assertion unchanged")', () => {
    const r = jv(A, src('By.cssSelector(".login-button")', '20'));
    const same = r.changes.filter((c) => c.kind === 'unchanged').map((c) => c.path);
    expect(same).toContain('LoginTest.login() › assertion');
    expect(same).not.toContain('LoginTest.login() › locator');
    const s = renderSummary(r);
    expect(s).toContain('Unchanged:\n✓ LoginTest.login() › assertion');
    expect(r.stats.unchanged).toBeGreaterThan(0);
  });
  it('does not claim a concern is unchanged when it changed', () => {
    const r = jv(A, A.replace('"Home"', '"Dashboard"'));
    expect(r.changes.filter((c) => c.kind === 'unchanged').map((c) => c.path)).not.toContain('LoginTest.login() › assertion');
  });
});
