import { describe, expect, it } from 'vitest';
import { compare, renderSummary, type CompareOptions } from '../src/index.js';

const jv = (a: string, b: string, o: CompareOptions = {}) =>
  compare({ name: 'A.java', content: a }, { name: 'A.java', content: b }, o);
const changed = (r: ReturnType<typeof jv>) =>
  r.changes.filter((c) => c.kind !== 'unchanged').map((c) => `${c.kind}:${c.path}`);

const base = `package p;
import java.util.List;
@Test
public class LoginTest extends Base {
  private int timeout = 30;
  private String name;
  @Test(enabled = true)
  public void login(String user, int n) throws IOException {
    if (n > 3) { driver.findElement(By.id("login")).click(); }
    try { run(); } catch (IOException e) { log.error("x"); }
  }
  private void helper() { }
}`;

describe('Java analyzer', () => {
  it('identical source (formatting/comments aside) has no changes', () => {
    const reformatted = base.replace(/\n {2}/g, '\n\n      ').replace('int n)', 'int   n) /* c */');
    const r = jv(base, reformatted);
    expect(r.format).toBe('java');
    expect(changed(r)).toEqual([]);
    expect(r.stats.unchanged).toBeGreaterThan(0);
  });

  it('detects field value change and classifies by name', () => {
    const r = jv(base, base.replace('timeout = 30', 'timeout = 45'));
    expect(changed(r)).toEqual(['modified:LoginTest.timeout']);
    const c = r.changes.find((x) => x.kind === 'modified')!;
    expect(c.before).toBe('private int timeout = 30');
    expect(c.after).toBe('private int timeout = 45');
    expect(c.impact).toBe('medium');
  });

  it('detects added/removed fields, methods, imports', () => {
    const b = base
      .replace('import java.util.List;', 'import java.util.Map;')
      .replace('private String name;', 'private long id;')
      .replace('private void helper() { }', 'public void extra() { }');
    expect(changed(jv(base, b)).sort()).toEqual(
      [
        'removed:imports › java.util.List',
        'added:imports › java.util.Map',
        'removed:LoginTest.name',
        'added:LoginTest.id',
        'removed:LoginTest.helper()',
        'added:LoginTest.extra()',
      ].sort(),
    );
  });

  it('detects signature changes (same name, different params)', () => {
    const r = jv(base, base.replace('login(String user, int n)', 'login(String user, int n, boolean x)'));
    const sig = r.changes.find((c) => c.path === 'LoginTest.login(String,int,boolean)');
    expect(sig?.kind).toBe('modified');
    expect(sig?.impact).toBe('high');
    expect(sig?.before).toContain('login(String user, int n)');
    expect(changed(r)).not.toContain('removed:LoginTest.login(String,int)');
  });

  it('PRD example: direct Selenium call replaced by page-object call', () => {
    const b = base.replace('driver.findElement(By.id("login")).click();', 'loginPage.clickLogin();');
    const r = jv(base, b);
    const paths = changed(r);
    expect(paths).toContain('removed:LoginTest.login(String,int) › call driver.findElement');
    expect(paths).toContain('removed:LoginTest.login(String,int) › call .click');
    expect(paths).toContain('added:LoginTest.login(String,int) › call loginPage.clickLogin');
    expect(r.impact).toBe('medium');
    expect(r.changes.every((c) => c.evidence === 'fact')).toBe(true);
  });

  it('detects condition, exception-handling and annotation changes', () => {
    const b = base
      .replace('n > 3', 'n > 5')
      .replace('catch (IOException e)', 'catch (Exception e)')
      .replace('enabled = true', 'enabled = false');
    expect(changed(jv(base, b)).sort()).toEqual(
      [
        'modified:LoginTest.login(String,int) › if',
        'modified:LoginTest.login(String,int) › catch',
        'modified:LoginTest.login(String,int) › @Test',
      ].sort(),
    );
  });

  it('literal/assignment changes inside methods are keyed by variable', () => {
    const a = 'class C { void m() { int retryCount = 3; } }';
    const r = jv(a, a.replace('= 3', '= 5'));
    expect(r.changes.filter((c) => c.kind !== 'unchanged')).toMatchObject([
      { path: 'C.m() › assign retryCount', kind: 'modified', before: 'retryCount = 3', after: 'retryCount = 5', impact: 'medium' },
    ]);
  });

  it('handles reordering of members and duplicate calls', () => {
    const a = 'class C { void a() {} void b() {} void m() { f(1); f(2); } }';
    const b = 'class C { void m() { f(2); f(1); } void b() {} void a() {} }';
    expect(changed(jv(a, b))).toEqual([]);
    expect(changed(jv(a, a.replace('f(2)', 'f(3)')))).toEqual(['modified:C.m() › call f']);
  });

  it('detects type-level changes: removed class, changed supertypes, nested types', () => {
    const a = 'public class A extends B { static class In { int f; } } class Gone {}';
    const b = 'public class A extends C { static class In { int f; long g; } }';
    expect(changed(jv(a, b)).sort()).toEqual(
      ['modified:A', 'added:A.In.g', 'removed:Gone'].sort(),
    );
  });

  it('interfaces, enums, constructors and generics', () => {
    const a = 'interface I { int w(int a); } enum E { X, Y; } class G<T> { G(int a) { init(a); } <U> U id(U u) { return u; } }';
    const b = 'interface I { int w(int a); default void q() {} } enum E { X, Z; } class G<T> { G(int a) { init(a + 1); } <U> U id(U u) { return u; } }';
    expect(changed(jv(a, b)).sort()).toEqual(
      ['added:I.q()', 'removed:E.Y', 'added:E.Z', 'modified:G.<init>(int) › call init'].sort(),
    );
  });

  it('logging call changes are low impact', () => {
    const a = 'class C { void m() { log.info("a"); } }';
    const r = jv(a, a.replace('"a"', '"b"'));
    expect(r.changes.find((c) => c.kind === 'modified')?.impact).toBe('low');
  });

  it('records and annotation types do not crash', () => {
    const a = 'record P(int x) { int twice() { return x * 2; } }';
    const r = jv(a, a.replace('x * 2', 'x * 3'));
    expect(changed(r)).toEqual(['modified:P.twice() › return']);
  });

  it('ignorePaths applies to Java change paths', () => {
    const r = jv(base, base.replace('timeout = 30', 'timeout = 45'), { ignorePaths: ['LoginTest.timeout'] });
    expect(changed(r)).toEqual([]);
  });

  it('syntax errors fall back to text with a warning', () => {
    const r = jv('class A {', 'class A { int x; }');
    expect(r.format).toBe('text');
    expect(r.warnings[0]).toMatch(/Invalid JAVA/);
  });

  it('summary renders Java changes', () => {
    const s = renderSummary(jv(base, base.replace('timeout = 30', 'timeout = 45')));
    expect(s).toContain('LoginTest.timeout');
    expect(s).toContain('private int timeout = 30 → private int timeout = 45');
  });
});
