# Changelog

## Unreleased

- Java semantic comparison (classes, fields, methods, signatures, annotations, imports, calls, conditions, exception handling)
- Swap sides button; panel labels the before/after files
- Test-automation mode for Java: locator, wait, assertion and test-annotation changes, plus a labelled inferred Page Object hint
- API response comparison (expected vs actual, pass/fail) for raw HTTP, JSON envelopes and bare bodies
- Impact estimates (informational to critical) with a stated reason for each change

## 0.0.1

Initial preview.

- Compare two files with VS Code's native diff plus a semantic summary panel
- Structure-aware comparison for JSON, YAML and XML; line diff for everything else
- Compare Clipboard and Compare Selected Text
- Analyze Current Diff for any open diff editor
- Ignore rules via `diffsense.*` settings or a workspace `.diffsense.json`
- Export or copy the summary as Markdown
- Fully local: no network access, no telemetry
