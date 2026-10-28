# Changelog

## 0.4.0

- New optional **Explain Changes (AI)**: Tools | DiffSense | Explain Changes (AI), or the Explain (AI) button in the tool window, explains the last comparison in plain language. Bring your own Anthropic or Gemini API key (kept in the IDE credential store; provider and model in Settings | Tools | DiffSense). Only a compact list of the changes is sent, never file contents, and nothing is sent until you run it. Same prompt as the CLI and VS Code extension.

## 0.3.0

- Java files are now compared semantically instead of as text: types, fields, methods and signatures, annotations, imports, conditions, calls and exception handling. Results are identical to the VS Code extension and CLI (shared conformance suite, 47 new Java cases).
- Test-automation rules for test files (Selenium, JUnit, TestNG, Cucumber, Playwright, REST Assured): locator, wait and assertion changes with impact estimates and unchanged concerns listed, disabled or removed tests (with the skip reason), locators declared as page-object fields or `@FindBy`, a position-based XPath flagged as high impact, import version bumps (`.v138.` to `.v147.`) reported once, and anonymous-class bodies no longer listed as separate changes.
- New setting Settings | Tools | DiffSense | Java | Test-automation rules (`auto`, `on`, `off`); `qaMode` in `.diffsense.json` works as in VS Code.
- Invalid Java falls back to a line diff and says so.
- The plugin now bundles JavaParser (Apache-2.0 / LGPL dual licence; the Apache-2.0 option is used).

## 0.2.0

- Replaced the deprecated `ReadAction.computeCancellable` with the coroutine read action (reported by the Plugin Verifier against IntelliJ IDEA 2026.3 EAP).
- EDIFACT (`.edi`, `.edifact`, or detected by content) is compared segment by segment, with element-level changes and impact estimates. One-line and one-segment-per-line files compare equal.
- New action "DiffSense | Format File": re-indents JSON and XML, or splits EDIFACT into one segment per line. One undo step, not saved automatically; invalid files are left untouched. (For YAML use Code | Reformat Code.)

## 0.1.0

First release.

- Structure-aware comparison for JSON, YAML and XML; line diff for other files
- API response comparison (expected vs actual) with a pass/fail verdict
- Impact estimates with reasons
- Compare Files, Compare API Responses, Compare with Clipboard, Compare Selected Text
- Summary tool window with Swap sides, Copy/Export as Markdown
- Ignore rules via Settings or a project `.diffsense.json`
- Fully local: no network access, no telemetry
