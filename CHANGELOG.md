# Changelog

Changes to the CLI and the GitHub Action. The IDE packages keep their own changelogs
([VS Code](packages/vscode/CHANGELOG.md), [IntelliJ](packages/intellij/CHANGELOG.md)).

## Unreleased

- EDIFACT: structural comparison of `.edi`/`.edifact` files (also detected by content). Delimiters come from the `UNA` header, line breaks are ignored so one-line and one-segment-per-line files compare equal, segments are matched by tag and qualifier (`NAD[BY]`, `LOC[7]`, line-item scoped `LIN[1]/QTY[21]`), and changes are reported per element (`LOC[7].2.1`) with impact estimates. Envelope metadata (sender timestamps, control references, counts) is informational.
- Formatting: `formatContent` in the core and `diffsense format <file> [--write] [--indent <n>]` in the CLI. JSON, XML and YAML are re-indented, EDIFACT is split into one segment per line. Values are never changed: JSON strings, numbers and key order are kept exactly, XML text is not trimmed or re-wrapped, and invalid input is rejected instead of repaired.
- CLI: `diffsense git [<rev> | A..B | A...B]` summarizes a whole git change set (working tree, commit, branch or PR-style range) with the structural, Java and QA engines. Files are listed most severe first, formatting-only changes are flagged, and an overall impact estimate is given. Options: `--markdown`, `--json`, `--fail-on <impact>`.
- Core: `compareChangeSet` and the change-set renderers (pure, reusable by the IDE plugins).
- GitHub Action (`uses: shossain786/diff-sense@master`): posts and updates a semantic summary comment on pull requests, writes the job summary, and can fail the check with `fail-on`.
