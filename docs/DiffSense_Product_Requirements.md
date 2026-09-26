# DiffSense — Product Requirements Document

## 1. Product Overview

**Product:** DiffSense  
**Category:** Developer productivity / intelligent file comparison

**Positioning:**

> **Compare files. Understand what changed.**

DiffSense is an independent developer tool that goes beyond traditional line-by-line diff viewers by helping developers understand the **meaning and impact of changes** between two files.

The initial product should be lightweight, local-first, and focused on developer workflows.

DiffSense must **not** attempt to replace existing IDE diff engines. Instead, it should add semantic analysis, structured summaries, and developer-friendly explanations around existing comparison workflows.

---

## 2. Problem Statement

Developers already have excellent textual diff tools in VS Code, IntelliJ IDEA, Git, GitHub, and GitLab.

These tools answer:

> **Which lines changed?**

DiffSense focuses on:

> **What actually changed?**  
> **Does the change matter?**  
> **What behavior could be affected?**

---

## 3. Product Vision

> **Make file comparison semantic rather than purely textual.**

Instead of:

```text
Line 21 changed
Line 22 added
Line 23 removed
```

DiffSense should eventually communicate:

```text
HTTP timeout changed:
30 seconds → 45 seconds

Login implementation changed:
Direct Selenium interaction → Page Object method

Potential impact:
Medium
```

---

## 4. Target Users

### Primary
- Software developers
- QA Automation Engineers
- SDETs
- Code reviewers
- Technical leads
- Software architects

### Secondary
- DevOps engineers
- API testers
- Data engineers
- Students learning code
- Developers reviewing generated/AI-modified code

---

## 5. Product Principles

1. **Local-first**
2. **Fast**
3. **Privacy-friendly**
4. **Developer-first**
5. **Deterministic where possible**
6. **AI optional, not mandatory**
7. **Use existing IDE diff engines instead of rebuilding them**
8. **Explain changes rather than merely highlighting them**

---

## 6. Initial Product Scope

The first version should support:

- Plain text
- JSON
- XML
- YAML
- Java

Future formats:

- JavaScript
- TypeScript
- Python
- SQL
- Markdown
- CSV
- API responses

---

## 7. Core Workflow

```text
Developer
   |
   v
Select File A
   |
   v
Select File B
   |
   v
DiffSense Analysis
   |
   +---- Text Diff
   |
   +---- Structural Diff
   |
   +---- Semantic Diff
   |
   +---- Change Summary
   |
   v
Developer reviews changes
```

---

## 8. VS Code Extension — MVP

VS Code should be the first distribution channel.

### User workflow

```text
Right-click File A
        ↓
Compare with DiffSense
        ↓
Select File B
        ↓
DiffSense analyzes both
        ↓
Native VS Code diff opens
        +
Semantic Summary panel
```

DiffSense should use VS Code's existing diff capabilities where practical instead of building another full diff editor.

### Commands

```text
DiffSense: Compare Files
DiffSense: Compare Clipboard
DiffSense: Compare Selected Text
DiffSense: Analyze Current Diff
DiffSense: Explain Changes
```

Context menu:

```text
Compare with DiffSense
```

---

## 9. Semantic Change Summary

Example:

```text
DiffSense — Change Summary

Files:
old-config.json
new-config.json

Changes:
✓ 3 fields added
✓ 1 field removed
⚠ 2 values modified

Important changes:
────────────────────────────

⚠ timeout
30s → 45s

⚠ retryCount
3 → 5

✓ endpoint
unchanged

Potential impact:
Medium
```

---

## 10. JSON Comparison

JSON should be one of the first high-value formats.

Example:

```json
{
  "timeout": 30000,
  "retryCount": 3,
  "enabled": true
}
```

versus:

```json
{
  "timeout": 45000,
  "retryCount": 5,
  "enabled": true
}
```

DiffSense should report:

```text
timeout:
30000 → 45000

retryCount:
3 → 5

enabled:
unchanged
```

Options:

- Ignore property ordering
- Ignore whitespace
- Ignore selected fields
- Ignore array ordering where appropriate
- Case sensitivity
- Numeric comparison rules

---

## 11. XML Comparison

DiffSense should compare XML structurally rather than treating it as plain text.

Example:

```xml
<user>
    <name>John</name>
    <age>30</age>
</user>
```

versus:

```xml
<user>
    <name>John</name>
    <age>31</age>
</user>
```

Summary:

```text
user.age:
30 → 31
```

Options:

- Ignore whitespace
- Ignore attribute ordering
- Ignore selected attributes
- Namespace handling
- Ignore XML declaration

---

## 12. YAML Comparison

Example:

```yaml
timeout: 30
retries: 3
```

versus:

```yaml
timeout: 45
retries: 5
```

Summary:

```text
timeout: 30 → 45
retries: 3 → 5
```

---

## 13. Java Semantic Comparison

Java is an important differentiator.

DiffSense should initially detect:

- Classes added/removed
- Methods added/removed
- Method signature changes
- Fields added/removed
- Annotation changes
- Imports changed
- Method calls changed
- Conditional logic changes
- Exception handling changes
- Configuration changes

Example:

Old:

```java
driver.findElement(By.id("login")).click();
```

New:

```java
loginPage.clickLogin();
```

Traditional diff:

```text
1 line removed
1 line added
```

DiffSense:

```text
Implementation changed

Before:
Direct Selenium interaction

After:
Page Object abstraction

Potential impact:
Medium

Possible intent:
Improved test abstraction
```

The system must distinguish **observed facts** from **inferred intent**.

---

## 14. QA / Automation Mode

A future specialized analysis mode should understand:

- WebDriver initialization
- Locator changes
- Wait changes
- Page Object changes
- Test annotations
- Assertions
- Test data
- API endpoint changes
- Test configuration changes

Example:

```text
Automation Change Summary

✓ Test name unchanged
✓ Assertion unchanged

⚠ Locator changed
By.id("login")
→
By.cssSelector(".login-button")

⚠ Wait strategy changed
10 seconds
→
20 seconds

Potential test stability impact:
Medium
```

---

## 15. API Response Comparison

A future feature should allow developers and QA engineers to compare API responses.

```text
Expected Response
        vs
Actual Response
```

Example output:

```text
Status:
200 → 200 ✓

user.id:
123 → 123 ✓

user.name:
John → John ✓

amount:
100 → 120 ❌

currency:
INR → INR ✓
```

Potential integrations:

- Postman
- REST clients
- Automated test frameworks
- CI pipelines

---

## 16. Change Impact Analysis

Future classification:

- Informational
- Low
- Medium
- High
- Critical

Example:

```text
Change:
API base URL changed

Impact:
HIGH

Reason:
All requests using the affected configuration may
be redirected to a different service.
```

Impact analysis must be presented as an estimate, not an absolute guarantee.

---

## 17. Explain Changes

Optional AI-powered feature.

User clicks:

> **Explain Changes**

Example:

```text
The new implementation replaces direct Selenium
element interaction with a Page Object method.

The locator itself is no longer visible in the test
class, suggesting that locator management has been
moved into the page abstraction.

Potential benefit:
Improved maintainability.

Potential risk:
The Page Object implementation should be reviewed
to confirm equivalent behavior.
```

AI should explain detected changes rather than inventing changes.

---

## 18. Architecture

### MVP architecture

```text
VS Code Extension
       |
       v
DiffSense Core
       |
       +---- Text Comparator
       |
       +---- JSON Comparator
       |
       +---- XML Comparator
       |
       +---- YAML Comparator
       |
       +---- Java Analyzer
       |
       +---- Change Classifier
       |
       +---- Summary Generator
```

The core engine must remain independent of VS Code.

This allows future reuse by:

- IntelliJ plugin
- CLI
- GitHub Action
- CI/CD
- Web demo

---

## 19. Technology Recommendation

### Core engine

Recommended:

- TypeScript or Java
- AST-based analysis for programming languages
- Structured parsers for JSON/XML/YAML
- Deterministic comparison algorithms

### VS Code

- TypeScript
- VS Code Extension API

### Future IntelliJ

- Kotlin / Java
- IntelliJ Platform SDK

---

## 20. Local-First Architecture

MVP should not require a backend.

```text
User Machine

VS Code
   |
   v
DiffSense Extension
   |
   v
DiffSense Core
   |
   v
Local Analysis
```

No source code needs to leave the user's machine for deterministic comparison.

Benefits:

- No hosting cost
- No database
- No source-code retention problem
- Better privacy
- Easier maintenance
- Works offline
- Suitable for enterprise source code

---

## 21. AI Architecture — Future

AI should be optional.

Deterministic analysis:

```text
File A
File B
  ↓
Parser
  ↓
Structural Changes
  ↓
Change Classification
```

Optional AI:

```text
Structured Changes
       ↓
AI Explanation
       ↓
Human-readable Summary
```

The AI should not be responsible for determining the raw diff.

---

## 22. CLI — Future

Example:

```bash
diffsense compare file1.json file2.json
```

Output:

```text
DiffSense

3 fields changed
1 field added
1 field removed

Important:
⚠ timeout: 30 → 45
⚠ retryCount: 3 → 5

Impact: Medium
```

Additional commands:

```bash
diffsense analyze
diffsense compare
diffsense explain
```

---

## 23. IntelliJ Plugin — Future

The IntelliJ plugin should integrate with the existing IntelliJ diff viewer.

```text
Right click
     ↓
DiffSense
     ↓
Smart Compare
     ↓
Native IntelliJ Diff
     +
Semantic Analysis
```

Do not rebuild IntelliJ's existing diff UI.

---

## 24. Git Integration — Future

Possible commands:

```text
DiffSense: Analyze Git Changes
DiffSense: Explain Commit
DiffSense: Analyze Pull Request
```

Example:

```text
Pull Request Change Summary

12 files changed

Behavioral changes:
- API timeout increased
- Login locator changed
- Retry count increased

Potential impact:
Medium
```

---

## 25. GitHub / CI Integration — Future

Possible GitHub Action:

```yaml
- uses: diffsense/action@v1
```

It could generate a DiffSense Change Report and attach it to:

- Pull Requests
- CI builds
- Test reports

---

## 26. Privacy Requirements

### MVP

- No mandatory account
- No backend required
- No source-code upload
- No source-code retention
- No telemetry containing source code

If anonymous product telemetry is introduced later, it must never capture source contents.

Potential telemetry:

- Extension installed
- Comparison command used
- File type
- Feature usage

Never collect:

- Source code
- File contents
- Secrets
- Tokens
- Credentials

---

## 27. Performance Requirements

For normal developer files:

- Comparison should feel near-instant.
- JSON/XML/YAML structural comparison should complete quickly.
- Java analysis should provide progress feedback for large projects.

For large files/projects:

```text
Analyzing...

██████████████░░░░ 72%
```

The UI must not freeze.

---

## 28. MVP Feature List

### Must Have

- [ ] VS Code extension
- [ ] Compare two files
- [ ] Native VS Code diff integration
- [ ] Plain-text comparison
- [ ] JSON structural comparison
- [ ] XML structural comparison
- [ ] YAML structural comparison
- [ ] Change summary
- [ ] Added/removed/modified classification
- [ ] Local-only processing
- [ ] Configurable ignore rules

### Should Have

- [ ] Java semantic comparison
- [ ] Clipboard comparison
- [ ] Selected-text comparison
- [ ] Impact classification
- [ ] Export summary as Markdown

### Later

- [ ] AI explanation
- [ ] API response comparison
- [ ] QA automation mode
- [ ] IntelliJ plugin
- [ ] CLI
- [ ] Git integration
- [ ] GitHub integration
- [ ] CI/CD integration

---

## 29. MVP UX

The first experience should require no configuration.

### Step 1

Install DiffSense.

### Step 2

Right-click a file.

### Step 3

Select:

> **Compare with DiffSense**

### Step 4

Select the second file.

### Step 5

DiffSense opens:

```text
┌─────────────────────────────────────────────┐
│ DiffSense                                    │
│                                             │
│ 12 changes detected                         │
│                                             │
│ ✓ 7 unchanged structures                    │
│ ⚠ 4 modified values                         │
│ + 1 new field                                │
│                                             │
│ Important Changes                            │
│ ─────────────────────────────────────────── │
│ timeout: 30 → 45                            │
│ retryCount: 3 → 5                           │
│                                             │
│ [Open Diff]   [Explain Changes]             │
└─────────────────────────────────────────────┘
```

---

## 30. Product Differentiation

DiffSense should NOT compete on:

> “We have a better colored diff.”

It should compete on:

> **“We help you understand what changed.”**

Existing diff tools are primarily line-oriented.

DiffSense is:

> **Structure-aware + semantic + impact-oriented**

---

## 31. Branding

# DiffSense

### Recommended tagline

> **Compare files. Understand what changed.**

Alternative taglines:

- **See beyond the diff.**
- **Smarter diffs for developers.**
- **Your code changed. What does it mean?**

---

## 32. Roadmap

### Phase 1 — MVP

- [ ] VS Code extension
- [ ] Local comparison engine
- [ ] Text comparison
- [ ] JSON comparison
- [ ] XML comparison
- [ ] YAML comparison
- [ ] Summary panel
- [ ] Ignore rules
- [ ] Marketplace publication

### Phase 2

- [ ] Java semantic comparison
- [ ] QA automation patterns
- [ ] Clipboard comparison
- [ ] Markdown export
- [ ] Impact classification

### Phase 3

- [ ] AI explanation
- [ ] API response comparison
- [ ] CLI

### Phase 4

- [ ] IntelliJ plugin
- [ ] Git integration
- [ ] GitHub integration

### Phase 5

- [ ] CI/CD
- [ ] Enterprise policies
- [ ] Team-level reporting

---

## 33. Success Metrics

Primary MVP metric:

> **How many users install DiffSense and perform a second comparison?**

Additional metrics:

- Marketplace installs
- Weekly active users
- Comparisons per user
- JSON comparisons
- Java comparisons
- Feature usage
- Repeat usage
- Extension uninstall rate

Do not optimize for downloads alone.

A developer who installs the extension and uses it repeatedly is more valuable than 1,000 one-time installs.

---

## 34. Development Philosophy

Build the smallest useful version first.

Do NOT start with:

- Backend
- Database
- Authentication
- Cloud hosting
- Team dashboards
- Enterprise accounts
- Complex AI infrastructure

Start with:

```text
VS Code
   ↓
DiffSense Core
   ↓
Compare
   ↓
Understand
```

The product should earn the right to become more complex through real usage.

---

## 35. Long-Term Vision

DiffSense can eventually become a semantic change-analysis platform:

```text
                    DiffSense
                        |
       +----------------+----------------+
       |                |                |
      IDE              CLI             GitHub
       |                |                |
       +----------------+----------------+
                        |
                 Semantic Engine
                        |
       +----------------+----------------+
       |                |                |
      Code            Config           API
       |                |                |
    Java/TS          JSON/YAML          REST
       |
       +---- QA / Selenium
```

The long-term goal is not to replace Git diff.

It is to add the missing layer:

> **What do these changes actually mean?**
