# Architecture

DiffSense adds a semantic layer around the IDE's own diff viewer. The comparison engine is a set of pure functions with no IDE dependencies, so it can be reused by the VS Code extension, the CLI, the IntelliJ plugin and, later, CI.

```
        VS Code extension        CLI          IntelliJ plugin
               \                  |               /
                \                 |              /
                 +---- comparison engine -------+
                 (TypeScript core; Kotlin port for IntelliJ)
```

## The pipeline (`packages/core/src`)

```
compare(left, right, options)
   |
   |  1. detect the format      detect.ts   (extension, or options.format)
   |  2. parse + compare        json.ts, yaml.ts, xml.ts, api.ts, java.ts, text.ts
   |        a parse error  ->   ParseError -> fall back to the text diff, with a warning
   |  3. classify               impact.ts   (+ qa.ts for Java test files)
   v
ComparisonResult { format, changes[], stats, impact?, warnings[] }
   |
   v  summary.ts: renderSummary (text), renderMarkdown
```

### The data model (`types.ts`)

A **Change** is `{ path, kind, before, after, evidence, impact?, reason? }`:

* `path` is structural (`user.age`, `items[2].id`, `L14` for text lines, `Class.method(int) › call foo` for Java)
* `kind` is `added | removed | modified | unchanged`
* `evidence` is `fact` for observed differences and `inferred` for guesses about intent (the only inferred result today is the Page Object hint)
* `impact` and `reason` are estimates with an explanation

### Structured formats share one differ

JSON, YAML and XML are each parsed into plain values (objects, arrays, scalars). `diffValues` in `json.ts` walks two such trees and produces the changes, applying the ignore rules (`ignorePaths` globs, case, whitespace, array order, numeric equality). A new format usually only needs a parser that produces that tree; see `yaml.ts`.

### Ignore rules

`CompareOptions` (`types.ts`) is the single option set. Sources are layered: extension/IDE settings, then a project `.diffsense.json` (`config.ts`), then per-call overrides.

### Java (`java.ts`, `qa.ts`)

Java is parsed to a syntax tree; classes, fields, methods and annotations become a model that is diffed by name and signature. Method bodies are reduced to *facts* (calls, assignments, conditions, catch/throw/return) that are matched within a method. The QA pack then replaces raw call changes with locator, wait and assertion changes for test files.

## The VS Code extension (`packages/vscode/src`)

* `extension.ts`: commands, reading files, running the engine, opening the native diff, message handling
* `html.ts`: builds the summary panel HTML. All file-derived text is escaped and the script is nonce-gated. It has no VS Code imports, so it is unit-tested

## The IntelliJ plugin (`packages/intellij`)

* `engine/`: the Kotlin port of the engine (no IntelliJ dependencies). It is held identical to the TypeScript core by the shared conformance suite
* `ide/`: actions, the runner (reads files under a read action, runs the engine in the background, opens the native diff), the summary tool window, settings

## Keeping the two engines identical

`conformance/inputs.mjs` lists inputs; `node conformance/generate.mjs` records the TypeScript engine's output in `conformance/cases.json` (changes, stats, impact, warnings, rendered summaries). The TypeScript test checks the file is current; the Kotlin `ConformanceTest` must reproduce every case. Parser error wording is masked because engines phrase syntax errors differently.

## Performance notes

* Text diffs use Myers' O(ND) algorithm and give up (with a warning) after 6000 edits
* Comparing a 3.5 MB JSON file takes about 250 ms; a 10,000-line Java file about 2 s
* The extension runs in VS Code's extension host, so a slow comparison does not freeze the UI, but very large files may deserve a worker thread (see the open issues)
