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

  it('auto-detect: off for non-test files, forceable with qaMode', () => {
    const plain = 'class C { void m() { driver.findElement(By.id("a")).click(); } }';
    const changed = plain.replace('"a"', '"b"');
    expect(jv(plain, changed).changes.some((c) => c.path.endsWith('› locator'))).toBe(false);
    expect(jv(plain, changed, { qaMode: true }).changes.some((c) => c.path.endsWith('› locator'))).toBe(true);
    expect(jv(A, A.replace('"login"', '"x"'), { qaMode: false }).changes.some((c) => c.path.endsWith('› locator'))).toBe(false);
  });
});
