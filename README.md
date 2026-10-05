# DiffSense

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Install-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=RazaTech.diffsense-vscode)

![DiffSense](packages/vscode/media/hero.png)

Compare files. Understand what changed.

## Install

- **VS Code:** [DiffSense Semantic Compare on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=RazaTech.diffsense-vscode), or search for "DiffSense Semantic Compare" in the Extensions view.
- **IntelliJ IDEA and other JetBrains IDEs:** submitted to the JetBrains Marketplace and awaiting review. Until it is published you can install the zip from [`packages/intellij`](packages/intellij) (build it with `./gradlew buildPlugin`) through Settings | Plugins | Install Plugin from Disk.

See [docs/DiffSense_Product_Requirements.md](docs/DiffSense_Product_Requirements.md) for the product requirements.

## Contributing

DiffSense is open source (MIT) and contributions are welcome, from typo fixes to new file formats.

- Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [architecture guide](docs/ARCHITECTURE.md)
- Pick something from the [`good first issue`](https://github.com/shossain786/diff-sense/labels/good%20first%20issue) or [`help wanted`](https://github.com/shossain786/diff-sense/labels/help%20wanted) labels
- Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems: [SECURITY.md](SECURITY.md)

Every comparison runs on your machine. No network calls, no telemetry, and that will not change.

## Layout
- `packages/core` — VS Code-independent comparison engine (pure functions)
- `packages/cli` — thin CLI over the core (`diffsense compare a b`, `diffsense api expected actual`, `diffsense git [range]` for a multi-file semantic summary of a commit, branch or working tree; add `--markdown` for PR text or `--fail-on high` for CI)
- `packages/vscode` — the VS Code extension
- `packages/intellij` — the IntelliJ plugin (Kotlin port of the engine; see its README)
- `conformance` — shared test cases that keep the TypeScript and Kotlin engines identical

## Develop
```
npm install
npm run build && npm run typecheck && npm test
```
Press F5 in VS Code to launch the extension in a development host.

## Package the extension
```
npm run build
npm run package -w diffsense-vscode      # produces a .vsix
```

## License
MIT
