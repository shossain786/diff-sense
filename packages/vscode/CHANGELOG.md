# Changelog

## 0.1.1 — 2026-09-26

- Marketplace page: hero image and refreshed README (no functional changes)

## 0.1.0 — 2026-09-26

First public release.

- Compare two files with VS Code's native diff plus a semantic summary panel (before/after labels, Swap sides)
- Structure-aware comparison for JSON, YAML and XML; Myers line diff for everything else
- Java semantic comparison: classes, fields, methods, signatures, annotations, imports, calls, conditions, exception handling
- Test-automation mode for Java: locator, wait, assertion and test-annotation changes, plus a labelled inferred Page Object hint; unchanged concerns are listed too
- Impact estimates (informational to critical) with a stated reason for each change
- API response comparison (expected vs actual, pass/fail) for raw HTTP, JSON envelopes and bare bodies
- Compare Clipboard, Compare Selected Text and Analyze Current Diff
- Ignore rules via `diffsense.*` settings or a workspace `.diffsense.json`
- Copy or export the summary as Markdown
- Fully local: no network access, no telemetry
