# Changelog

Changes to the CLI and the GitHub Action. The IDE packages keep their own changelogs
([VS Code](packages/vscode/CHANGELOG.md), [IntelliJ](packages/intellij/CHANGELOG.md)).

## 0.4.0 — 2026-10-28

- `--explain` (with `--model <id>`) on `compare`, `git` and `dir` adds an AI explanation of the changes. Opt-in; needs `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` (`--provider anthropic|gemini` to choose; default is whichever key is set, Anthropic first). Only a compact list of the changes is sent, never whole files. If the call fails, the normal summary still prints and the exit code is unchanged. With `--json` the text is in `explanation`.
- GitHub Action: opt-in `explain` input (with `anthropic-api-key` / `gemini-api-key`, `ai-provider`, `ai-model`) adds the explanation to the PR comment and job summary. If the key is missing (fork PRs) or the call fails, the normal summary is still posted.
- Core: `buildExplainPrompt` (pure) and `explainWithAnthropic`, `explainWithGemini`.

## 0.3.0 — 2026-10-13

- Test-change summaries (Java): disabling a test no longer also reports the annotation's import, and the skip reason is shown (`@Disabled("Broken in Chrome 142")`); adding a reason to an already disabled test is low impact.
- Locators declared as page-object fields (`new Query(By.name("q"))`) and `@FindBy`/`@FindAll`/`@FindBys` are reported as locator changes. A move to a position-based XPath is high impact, a move to a sturdier strategy is low.
- Import version bumps (`.v138.` → `.v147.`) are reported once as a "version bump", and the body of an anonymous class is no longer listed as separate removed calls of the surrounding method.
- `diffsense git`, `diffsense dir` and the GitHub Action report identical changes across sibling files once ("6 files with the same change") in both the text and Markdown output, and show the reason inline for high-impact items.
- README leads with the Java test-impact workflow and a real-repository example.

## 0.2.0 — 2026-10-06

- Folder comparison: `diffsense dir <left> <right>` summarizes two directories with the same engine as `git` (per-file structural changes, impact, Markdown, `--fail-on`). Files are paired by relative path; `--match name` also pairs leftovers that have a unique file name on both sides (for example `target/classes/` against `src/main/resources/`, shown as renames). `--exclude <glob>` skips paths; `.git` and `node_modules` are always skipped. Exit code 1 on any difference, or per `--fail-on`.
- Core: `pairDirectories` (pure) feeds `compareChangeSet`.
- EDIFACT: structural comparison of `.edi`/`.edifact` files (also detected by content). Delimiters come from the `UNA` header, line breaks are ignored so one-line and one-segment-per-line files compare equal, segments are matched by tag and qualifier (`NAD[BY]`, `LOC[7]`, line-item scoped `LIN[1]/QTY[21]`), and changes are reported per element (`LOC[7].2.1`) with impact estimates. Envelope metadata (sender timestamps, control references, counts) is informational.
- Formatting: `formatContent` in the core and `diffsense format <file> [--write] [--indent <n>]` in the CLI. JSON, XML and YAML are re-indented, EDIFACT is split into one segment per line. Values are never changed: JSON strings, numbers and key order are kept exactly, XML text is not trimmed or re-wrapped, and invalid input is rejected instead of repaired.
- CLI: `diffsense git [<rev> | A..B | A...B]` summarizes a whole git change set (working tree, commit, branch or PR-style range) with the structural, Java and QA engines. Files are listed most severe first, formatting-only changes are flagged, and an overall impact estimate is given. Options: `--markdown`, `--json`, `--fail-on <impact>`.
- Core: `compareChangeSet` and the change-set renderers (pure, reusable by the IDE plugins).
- GitHub Action (`uses: shossain786/diff-sense@master`): posts and updates a semantic summary comment on pull requests, writes the job summary, and can fail the check with `fail-on`.
