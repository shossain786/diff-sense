## What does this change?

<!-- One or two sentences. Link the issue it closes: "Closes #123". -->

## How was it tested?

- [ ] `npm run build && npm run typecheck && npm test`
- [ ] If comparison behaviour changed: added a case to `conformance/inputs.mjs` and regenerated `conformance/cases.json`
- [ ] If the IntelliJ plugin is affected: `./gradlew test` in `packages/intellij` (or noted below that a maintainer should port it)
- [ ] Updated docs / `CHANGELOG.md` if user-visible behaviour changed

## Checklist

- [ ] Stays local-first: no network calls, no telemetry
- [ ] Follows the style of the surrounding code
- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md)

## Notes for reviewers

<!-- Anything tricky, trade-offs, screenshots for UI changes. -->
