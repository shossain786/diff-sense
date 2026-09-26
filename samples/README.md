# Sample files for trying DiffSense

Select a pair in the Explorer (Ctrl+click), right-click, and choose **Compare with DiffSense**:

- config-a.json / config-b.json
- config-a.yaml / config-b.yaml
- user-a.xml / user-b.xml
- LoginTestOld.java / LoginTestNew.java (locator and wait changes)

API response comparison (Command Palette -> "DiffSense: Compare API Responses"; the current file is the *expected* one):

- api-expected.json / api-actual.json (amount 100 vs 120, plus an unexpected `traceId` field)

CLI: `node packages/cli/dist/index.js api samples/api-expected.json samples/api-actual.json`
