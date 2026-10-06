# Changelog

## Unreleased

- New command "DiffSense: Compare Folders" (also in the Explorer context menu for folders): pairs files by relative path, or also by unique file name (for example `target/classes` against `src/main/resources`), shows a Markdown summary and lets you open any changed file pair.
- New command "DiffSense: Format File" (also in the editor context menu for JSON, XML, YAML and EDIFACT files): re-indents the file, or splits EDIFACT into one segment per line. One undo step, not saved automatically; invalid files are reported and left untouched.
- EDIFACT (`.edi`, `.edifact`) files are now compared structurally, with element-level changes and impact estimates.

## 0.1.3 — 2026-09-26

- Marketplace page: added API-comparison and config-change images to the README
- API comparison panel: fixed the subtitle showing "text" as the format and listing the file names twice

## 0.1.2 — 2026-09-26

- Marketplace display name is now "DiffSense Semantic Compare" (the name "DiffSense" was already taken). No functional changes.

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
