# Changelog

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
