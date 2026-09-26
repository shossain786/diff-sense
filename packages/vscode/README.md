# DiffSense

**Compare files. Understand what changed.**

Line diffs tell you *which lines* changed. DiffSense tells you *what* changed. It compares JSON, YAML and XML by structure, so a reordered key or reformatted file is not a change, and `timeout: 30000 → 45000` is reported as exactly that. VS Code's own diff editor is still used for the side-by-side view.

## Usage

1. Right-click a file in the Explorer and choose **Compare with DiffSense** (or select two files and right-click).
2. Pick the second file.
3. The native diff opens, and a summary panel lists every added, removed and modified value.

Command Palette:

| Command | What it does |
|---|---|
| **DiffSense: Compare Files** | Compare two files |
| **DiffSense: Compare Clipboard** | Compare the current file (or selection) with the clipboard |
| **DiffSense: Compare Selected Text** | Select text, run it, select other text, run it again |
| **DiffSense: Analyze Current Diff** | Summarize a diff editor that is already open |

The summary can be copied or exported as Markdown, for example to paste into a pull request.

## Supported formats

| Format | Comparison |
|---|---|
| JSON | Structural: key order, whitespace and formatting are ignored |
| YAML | Structural: comments, anchors, aliases, merge keys and multi-document files handled |
| XML | Structural: elements, attributes, namespaces, CDATA |
| Java | Semantic: classes, fields, methods, signatures, annotations, imports, method calls, conditions and exception handling |
| Anything else | Line-by-line |

If a JSON, YAML, XML or Java file cannot be parsed, DiffSense falls back to a line diff and says so.

## Test-automation mode (Java)

For Java test files, DiffSense reports what matters for test stability instead of raw call diffs: **locator** changes (`By.id("login")` → `By.cssSelector(".login-button")`), **wait strategy** changes (`Duration.ofSeconds(10)` → `20`), **assertion** changes, and removed or disabled test annotations (`@Test`, `@Disabled`, `@BeforeEach`, ...).

When direct Selenium calls are replaced by a page-object style call, DiffSense adds one clearly labelled **inferred** note ("Possible intent: improved test abstraction"). Observed facts and inferred intent are never mixed.

It turns on automatically when the file imports Selenium, JUnit, TestNG, Cucumber, Playwright or REST Assured. Override with the `diffsense.qaMode` setting (`auto`, `on`, `off`).

## API response comparison

**DiffSense: Compare API Responses (Expected vs Actual)** checks an actual response against an expected one and gives a pass/fail verdict, listing every check with ✓ or ❌:

```
status:        200 → 200 ✓
user.id:       123 → 123 ✓
amount:        100 → 120 ❌
currency:      INR → INR ✓
```

Inputs can be a raw HTTP response (`HTTP/1.1 200 OK`, headers, blank line, body), a JSON envelope (`{ "status": 200, "headers": {...}, "body": {...} }`), or just the body. The current file is treated as *expected*. Volatile headers (`Date`, `Server`, request IDs, ...) are ignored, and only headers present in the expected response are checked. Use `diffsense.ignoreExtraFields` to allow extra fields in the actual response.

## Ignore rules

Settings (`diffsense.*`), or a `.diffsense.json` in the workspace root, which takes precedence:

```json
{
  "defaults": { "ignorePaths": ["**.timestamp", "metadata.*"] },
  "formats": {
    "json": { "ignoreArrayOrder": true },
    "xml": { "ignoreNamespaces": true, "ignoreAttributes": ["id"] }
  }
}
```

Available options: `ignoreWhitespace`, `ignoreCase`, `ignoreArrayOrder`, `numericEquality`, `ignorePaths`, `ignoreAttributes`, `ignoreNamespaces`, `ignoreXmlDeclaration`, `ignoreExtraFields` and `ignoreHeaders` (API comparison), `qaMode` (`.diffsense.json` only, boolean). Path globs use `*` within one segment and `**` across segments, for example `items[*].id`.

## Privacy

DiffSense runs entirely on your machine. It makes no network requests, needs no account, and sends no telemetry. Your files are never uploaded.

## Known limitations

- XML child order across differently named elements is not compared (repeated same-name siblings keep their order).
- XML namespaces are compared by prefix unless `ignoreNamespaces` is enabled.
- Impact levels are keyword-based estimates, never guarantees. Read the reason shown with each one.
- Java analysis covers a single file at a time, and does not resolve types across files.
- AI explanations are planned but not part of this release.

## Feedback

Issues and ideas: https://github.com/shossain786/diff-sense/issues
