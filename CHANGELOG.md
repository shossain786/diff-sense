# Changelog

Changes to the CLI and the GitHub Action. The IDE packages keep their own changelogs
([VS Code](packages/vscode/CHANGELOG.md), [IntelliJ](packages/intellij/CHANGELOG.md)).

## Unreleased

- CLI: `diffsense git [<rev> | A..B | A...B]` summarizes a whole git change set (working tree, commit, branch or PR-style range) with the structural, Java and QA engines. Files are listed most severe first, formatting-only changes are flagged, and an overall impact estimate is given. Options: `--markdown`, `--json`, `--fail-on <impact>`.
- Core: `compareChangeSet` and the change-set renderers (pure, reusable by the IDE plugins).
- GitHub Action (`uses: shossain786/diff-sense@master`): posts and updates a semantic summary comment on pull requests, writes the job summary, and can fail the check with `fail-on`.
