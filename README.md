# DiffSense

Compare files. Understand what changed.

See [docs/DiffSense_Product_Requirements.md](docs/DiffSense_Product_Requirements.md).

## Layout
- `packages/core` — VS Code-independent comparison engine (pure functions)
- `packages/cli` — thin CLI over the core
- `packages/vscode` — extension (Phase 2)

## Develop
```
npm install
npm run build && npm test
```
