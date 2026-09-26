# Contributing to DiffSense

Thanks for wanting to help. DiffSense is a small, focused project and every contribution matters, from a typo fix to a new file format.

**New here?** Look for issues labelled [`good first issue`](https://github.com/shossain786/diff-sense/labels/good%20first%20issue). Comment on the one you want so nobody duplicates your work, and ask questions there. No question is too basic.

## What DiffSense is (and is not)

DiffSense helps you understand *what changed* between two files, not just *which lines*. The principles that guide every decision:

1. **Local-first.** No network calls, no telemetry, no uploads. A change that sends file contents anywhere will not be accepted.
2. **Deterministic.** The same input always produces the same output. AI features, if added, are optional and only explain results the deterministic engine already found.
3. **Observed facts vs inferred intent.** Facts are labelled `fact`; guesses are labelled `inferred`. Never mix them.
4. **Estimates, not guarantees.** Impact levels are heuristics and must say so.
5. **Use the IDE's diff.** We add a layer around VS Code's and IntelliJ's diff viewers; we do not rebuild them.

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | The reference comparison engine (TypeScript, pure functions, no VS Code imports) |
| `packages/cli` | Thin command-line wrapper over the core |
| `packages/vscode` | The VS Code extension |
| `packages/intellij` | The IntelliJ plugin (Kotlin port of the engine, plus IDE integration) |
| `conformance` | Shared test cases that keep the TypeScript and Kotlin engines identical |
| `samples` | Small files for trying things by hand |
| `docs` | Product requirements, [architecture](docs/ARCHITECTURE.md), marketing assets |

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before a larger change.

## Set up

You need Node.js 22+ (and JDK 21 plus an installed IntelliJ IDEA only if you work on the plugin).

```bash
git clone https://github.com/shossain786/diff-sense.git
cd diff-sense
npm install
npm run build          # core, cli, vscode (in that order)
npm run typecheck
npm test               # core + extension tests
```

Try the CLI: `node packages/cli/dist/index.js compare samples/config-a.json samples/config-b.json`

Try the VS Code extension: open the repo in VS Code and press **F5**. A second window opens with `samples/` loaded and other extensions disabled.

Work on the IntelliJ plugin:

```bash
cd packages/intellij
./gradlew test          # conformance + engine + headless IDE tests
./gradlew buildPlugin   # build/distributions/*.zip
./gradlew verifyPlugin  # JetBrains binary-compatibility check
```

The plugin builds against your installed IDE. If IDEA is not at `/snap/intellij-idea-ultimate/current`, pass `-PideaPath=/path/to/idea`.

## The one rule about the two engines

`packages/core` (TypeScript) is the **reference**. `packages/intellij` has a Kotlin port that must behave identically. Both run the same cases from `conformance/cases.json`, including the rendered text and Markdown summaries.

When you change comparison behaviour:

1. Change `packages/core` and add a case to `conformance/inputs.mjs`.
2. Run `npm run build && node conformance/generate.mjs` to regenerate `conformance/cases.json`. Review the diff: it is your change's exact effect.
3. Run `npm test`. The TypeScript conformance test fails if you forgot step 2.
4. If the change affects a format the plugin supports, port it to Kotlin and run `./gradlew test` in `packages/intellij`. If you are not comfortable with Kotlin, say so in your PR and a maintainer will help port it.

## Making a change

1. Fork the repo and create a branch: `git checkout -b fix/short-description`.
2. Make your change. Match the style of the code around it: naming, comment density and idioms. Keep changes focused; unrelated cleanups belong in a separate PR.
3. Add or update tests. Bug fixes need a test that fails without the fix.
4. Run `npm run build && npm run typecheck && npm test` (and the Gradle tests if you touched the plugin).
5. Update user-facing docs (`packages/vscode/README.md`, `CHANGELOG.md`) if behaviour changed.
6. Open a pull request and fill in the template.

Commit messages use a short prefix, for example `feat(core): ...`, `fix(vscode): ...`, `docs: ...`, `chore: ...`, `test: ...`.

### Adding a file format

1. Add a comparator in `packages/core/src/` that parses both inputs into plain values and calls `diffValues` (see `yaml.ts` for the shortest example).
2. Register it in `compare.ts` and `detect.ts`; a parse failure must throw `ParseError` so the engine falls back to a text diff.
3. Add cases to `conformance/inputs.mjs` and unit tests under `packages/core/test`.
4. Document it in `packages/vscode/README.md`.

### Changing impact rules

Impact rules live in `packages/core/src/impact.ts` (and `Impact.kt`). Each rule needs a reason a user will understand. Prefer precise keywords; a noisy rule is worse than none.

## Reporting bugs and asking for features

Use the [issue templates](https://github.com/shossain786/diff-sense/issues/new/choose). For a bug, the most useful thing is the two input files (or a minimal reproduction) and what you expected. **Do not attach files that contain secrets or private code**; trim them down first.

Security problems: see [SECURITY.md](SECURITY.md). Please do not open a public issue.

## Code of conduct

Everyone taking part must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your contribution is licensed under the project's [MIT License](LICENSE).
