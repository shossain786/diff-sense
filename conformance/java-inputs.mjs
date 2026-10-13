// Java and QA-pack cases for the cross-engine conformance suite.
const f = (name, content) => ({ name, content });
const c = (name, left, right, options = {}) => ({ name, left, right, options });

const TEST_IMPORTS = 'import org.openqa.selenium.By;\nimport org.junit.jupiter.api.Test;\n';

const test = (locator = 'By.id("login")', wait = '10', extra = '', anno = '@Test') => `${TEST_IMPORTS}
public class LoginTest {
  private int timeout = 30;

  ${anno}
  void login() {
    driver.findElement(${locator}).click();
    new WebDriverWait(driver, Duration.ofSeconds(${wait})).until(ready);
    assertEquals("Home", driver.getTitle());${extra}
  }
}
`;

const SERVICE = `package com.acme.svc;

import java.util.List;
import java.util.Map;

@Service
public class OrderService extends Base implements Auditable, Closeable {
  private static final int MAX_RETRIES = 3;
  private final Map<String, List<Integer>> cache = new HashMap<>();
  protected String name;

  public OrderService(String name) {
    this.name = name;
  }

  @Override
  public int submit(Order order, int... flags) throws IOException, TimeoutException {
    if (order.total() > MAX_RETRIES) {
      log.info("big order");
      throw new IllegalStateException("too big");
    }
    try {
      repo.save(order);
    } catch (IOException e) {
      return -1;
    } finally {
      cleanup();
    }
    return order.id();
  }

  private <T extends Comparable<T>> T pick(List<T> items) {
    return items.get(0);
  }
}
`;

export const javaCases = [
  c('java/identical', f('A.java', SERVICE), f('B.java', SERVICE)),
  c('java/formatting-only', f('A.java', SERVICE), f('B.java', SERVICE.replace(/\n {2}/g, '\n\t').replace('{ ', '{  '))),
  c('java/field-value', f('A.java', SERVICE), f('B.java', SERVICE.replace('MAX_RETRIES = 3', 'MAX_RETRIES = 5'))),
  c('java/field-added-removed', f('A.java', SERVICE), f('B.java', SERVICE.replace('  protected String name;\n', '  protected long id;\n'))),
  c('java/field-type-change', f('A.java', SERVICE), f('B.java', SERVICE.replace('private final Map<String, List<Integer>> cache', 'private final Map<String, Set<Integer>> cache'))),
  c('java/method-signature', f('A.java', SERVICE), f('B.java', SERVICE.replace('int submit(Order order, int... flags)', 'long submit(Order order, int... flags)'))),
  c('java/method-params', f('A.java', SERVICE), f('B.java', SERVICE.replace('int... flags', 'String note'))),
  c('java/method-removed', f('A.java', SERVICE), f('B.java', SERVICE.replace(/\n {2}private <T[\s\S]*?\n {2}}\n/, '\n'))),
  c('java/method-added', f('A.java', SERVICE), f('B.java', SERVICE.replace(/}\n$/, '  public void extra() {\n    audit.record();\n  }\n}\n'))),
  c('java/throws-changed', f('A.java', SERVICE), f('B.java', SERVICE.replace('throws IOException, TimeoutException', 'throws IOException'))),
  c('java/generic-method', f('A.java', SERVICE), f('B.java', SERVICE.replace('<T extends Comparable<T>> T pick', '<T extends Number> T pick'))),
  c('java/class-header', f('A.java', SERVICE), f('B.java', SERVICE.replace('public class OrderService extends Base', 'public final class OrderService extends Other'))),
  c('java/class-annotation', f('A.java', SERVICE), f('B.java', SERVICE.replace('@Service', '@Service("orders")'))),
  c('java/method-annotation-removed', f('A.java', SERVICE), f('B.java', SERVICE.replace('  @Override\n', ''))),
  c('java/package-and-imports', f('A.java', SERVICE), f('B.java', SERVICE.replace('package com.acme.svc', 'package com.acme.orders').replace('import java.util.Map;', 'import java.util.Set;'))),
  c('java/condition-and-call', f('A.java', SERVICE), f('B.java', SERVICE.replace('> MAX_RETRIES', '>= MAX_RETRIES').replace('repo.save(order)', 'repo.saveAndFlush(order)'))),
  c('java/exception-handling', f('A.java', SERVICE), f('B.java', SERVICE.replace('catch (IOException e)', 'catch (Exception e)').replace('throw new IllegalStateException("too big")', 'throw new IllegalArgumentException("too big")'))),
  c('java/return-and-logging', f('A.java', SERVICE), f('B.java', SERVICE.replace('return -1;', 'return -2;').replace('log.info("big order")', 'log.warn("big order")'))),
  c('java/assignment-keyword-impact', f('A.java', 'class C { void m() { timeout = 5; apiUrl = "a"; other = 1; } }'), f('B.java', 'class C { void m() { timeout = 9; apiUrl = "b"; other = 2; } }')),
  c('java/overloads', f('A.java', 'class C { void m(int a) {} void m(String a) {} }'), f('B.java', 'class C { void m(int a) { x(); } void m(String a) {} }')),
  c('java/enum', f('A.java', 'public enum Mode { FAST("f"), SLOW("s"); private final String code; Mode(String code) { this.code = code; } }'), f('B.java', 'public enum Mode { FAST("f"), SLOW("slow"), IDLE("i"); private final String code; Mode(String code) { this.code = code; } }')),
  c('java/interface', f('A.java', 'public interface Repo { int count(); default void ping() { a(); } }'), f('B.java', 'public interface Repo { long count(); default void ping() { b(); } void drop(); }')),
  c('java/record', f('A.java', 'public record Point(int x, int y) implements Shape { }'), f('B.java', 'public record Point(int x, int y, int z) implements Shape { }')),
  c('java/nested-types', f('A.java', 'class Outer { static class In { int a; } }'), f('B.java', 'class Outer { static class In { int a; int b; } class Extra {} }')),
  c('java/type-removed-added', f('A.java', 'class A {}\nclass B {}\n'), f('B.java', 'class A {}\nclass C {}\n')),
  c('java/ignore-paths', f('A.java', SERVICE), f('B.java', SERVICE.replace('MAX_RETRIES = 3', 'MAX_RETRIES = 5').replace('log.info("big order")', 'log.info("huge order")')), { ignorePaths: ['**.MAX_RETRIES'] }),
  c('java/invalid-falls-back-to-text', f('A.java', 'class A { void m( { } }'), f('B.java', 'class A { void m( { x } }')),

  // ---- QA pack
  c('java/qa/locator-and-wait', f('A.java', test()), f('B.java', test('By.cssSelector(".login-button")', '20'))),
  c('java/qa/identical-lists-unchanged', f('A.java', test()), f('B.java', test())),
  c('java/qa/assertion-changed', f('A.java', test()), f('B.java', test().replace('"Home"', '"Dashboard"'))),
  c('java/qa/assertion-removed', f('A.java', test()), f('B.java', test().replace('    assertEquals("Home", driver.getTitle());\n', ''))),
  c('java/qa/locator-removed-page-object', f('A.java', test()), f('B.java', test().replace('driver.findElement(By.id("login")).click();', 'loginPage.clickLogin();'))),
  c('java/qa/test-annotation-removed', f('A.java', test()), f('B.java', test('By.id("login")', '10', '', ''))),
  c('java/qa/test-disabled', f('A.java', test()), f('B.java', test('By.id("login")', '10', '', '@Test @Disabled'))),
  c('java/qa/disabled-with-reason-and-import', f('A.java', test()), f('B.java', test('By.id("login")', '10', '', '@Test @Disabled("Broken in Chrome 142")').replace('import org.junit.jupiter.api.Test;', 'import org.junit.jupiter.api.Test;\nimport org.junit.jupiter.api.Disabled;'))),
  c('java/qa/skip-reason-added', f('A.java', test('By.id("login")', '10', '', '@Test @Disabled')), f('B.java', test('By.id("login")', '10', '', '@Test @Disabled("flaky on CI")'))),
  c('java/qa/field-locator-positional-xpath', f('A.java', 'import org.openqa.selenium.By;\nclass P { private Query q = new Query(By.id("q")); }'), f('B.java', 'import org.openqa.selenium.By;\nclass P { private Query q = new Query(By.xpath("/html/body/div[2]/input")); }')),
  c('java/qa/field-locator-wrapper-only', f('A.java', 'import org.openqa.selenium.By;\nclass P { Query q = new Query(By.name("q")); }'), f('B.java', 'import org.openqa.selenium.By;\nclass P { Query q = new Query().defaultLocator(By.name("q")); }')),
  c('java/qa/field-locator-added', f('A.java', 'import org.openqa.selenium.By;\nclass P { }'), f('B.java', 'import org.openqa.selenium.By;\nclass P { By b = By.id("x"); }')),
  c('java/qa/findby-strategy-improved', f('A.java', 'import org.openqa.selenium.support.FindBy;\nclass P {\n  @FindBy(xpath = "//input[@name=\'q\']")\n  WebElement q;\n}'), f('B.java', 'import org.openqa.selenium.support.FindBy;\nclass P {\n  @FindBy(id = "q")\n  WebElement q;\n}')),
  c('java/qa/import-version-bump', f('A.java', 'import org.openqa.selenium.devtools.v138.network.Network;\nimport org.openqa.selenium.devtools.v138.network.model.Reason;\nimport java.util.List;\nclass C {}'), f('B.java', 'import org.openqa.selenium.devtools.v147.network.Network;\nimport org.openqa.selenium.devtools.v147.network.model.Reason;\nimport java.util.List;\nclass C {}')),
  c('java/qa/anonymous-class-body', f('A.java', 'class C { void m() { new Wait(driver, 10).until(new Cond<Boolean>() { public Boolean apply(Driver d) { return d.title().startsWith("a"); } }); } }'), f('B.java', 'class C { void m() { new Wait(driver, 10).until(new Cond<Boolean>() { public Boolean apply(Driver d) { return d.title().startsWith("b"); } }); } }')),
  c('java/qa/forced-off', f('A.java', test()), f('B.java', test('By.cssSelector(".x")', '20')), { qaMode: false }),
  c('java/qa/forced-on-non-test', f('A.java', 'class C { void m() { driver.findElement(By.id("a")).click(); } }'), f('B.java', 'class C { void m() { driver.findElement(By.id("b")).click(); } }'), { qaMode: true }),
  c('java/qa/auto-off-non-test', f('A.java', 'class C { void m() { driver.findElement(By.id("a")).click(); } }'), f('B.java', 'class C { void m() { driver.findElement(By.id("b")).click(); } }')),
  c('java/qa/wait-removed', f('A.java', test()), f('B.java', test().replace('    new WebDriverWait(driver, Duration.ofSeconds(10)).until(ready);\n', ''))),
  c('java/qa/assert-library-calls', f('A.java', 'import org.junit.Assert;\nclass T { void t() { Assert.assertEquals(1, f()); assertThat(x).isEqualTo(2); } }'), f('B.java', 'import org.junit.Assert;\nclass T { void t() { Assert.assertEquals(2, f()); assertThat(x).isEqualTo(3); } }')),
];
