# Phase 20: CLI Documentation - Research

**Researched:** 2026-03-10
**Domain:** CLI documentation for README.md
**Confidence:** HIGH

## Summary

Phase 20 adds CLI usage documentation under the existing empty `## CLI Usage` heading in README.md (line 67). The CLI binary `jsonata-paths` supports two modes: argument mode (expression as CLI argument) and stdin/pipe mode (expression piped via stdin). Both produce compact single-line JSON output via `JSON.stringify(paths)`.

The primary risk in this phase is the shell quoting pitfall: JSONata expressions containing `$` (function calls like `$sum`, `$count`, etc.) will be silently mangled by bash when double-quoted, because bash interprets `$identifier` as shell variable expansion. This was verified empirically -- `"$sum(prices)"` becomes `(prices)` in bash, which still parses as valid JSONata but produces wrong results with no error. The quoting note is the most important piece of content in this phase.

**Primary recommendation:** Single plan, single task -- insert CLI documentation content between the `## CLI Usage` heading (line 67) and `## Examples` heading (line 69) in README.md, following the exact structure and formatting decisions locked in CONTEXT.md.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Two H3 subsections under `## CLI Usage`: `### Argument Mode` and `### Stdin Mode`
- Each mode shows a runnable command and its compact JSON output
- No usage/help output block at the top -- the examples are self-explanatory
- Argument Mode uses a simple dot-path: `account.name` -- different from the Quick Example above to avoid repetition
- Stdin Mode uses a `$` function: `echo '$sum(orders.total)' | jsonata-paths` -- naturally ties into the quoting note below
- Output shown as compact single-line JSON (matches actual CLI output from `JSON.stringify`)
- No file piping examples (cat) -- standard Unix knowledge, not needed
- Blockquote callout after Stdin Mode section (matches the ESM note style from Installation)
- Includes correct/wrong comparison with `$sum(prices)` as the example expression
- Unix-only -- no Windows/PowerShell mention
- Format: `> **Note:**` with embedded code block showing `# Correct` and `# Wrong` comments
- Brief one-sentence mention of error behavior after the quoting note: exits with code 1, error to stderr
- No error output example -- minimal is enough
- No-argument usage hint not documented -- users will see it when they run bare

### Claude's Discretion
- Exact wording of prose around examples
- Spacing and formatting details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | README documents `jsonata-paths` argument mode with example | Verified CLI output for `account.name`: `[{"path":"account.name","confidence":"static"}]` |
| CLI-02 | README documents `jsonata-paths` stdin/pipe mode with example | Verified CLI output for `echo '$sum(orders.total)' \| jsonata-paths`: `[{"path":"orders.total","confidence":"static"}]` |
| CLI-03 | README includes shell quoting note for `$` in JSONata expressions | Verified pitfall: `"$sum(prices)"` in double quotes becomes `(prices)` due to shell expansion -- silent wrong results |
</phase_requirements>

## Standard Stack

Not applicable -- this is a documentation-only phase. No libraries or dependencies involved.

## Architecture Patterns

### README Section Structure

```
## CLI Usage                          ← existing heading (line 67)

### Argument Mode                     ← new content
[brief intro + sh code block + output]

### Stdin Mode                        ← new content
[brief intro + sh code block + output]

> **Note:** quoting callout           ← new content

[one-sentence error behavior]         ← new content

## Examples                           ← existing heading (line 69)
```

### Verified CLI Outputs

These are the exact outputs from the built CLI, verified on 2026-03-10:

**Argument mode:**
```sh
jsonata-paths 'account.name'
```
Output:
```
[{"path":"account.name","confidence":"static"}]
```

**Stdin mode:**
```sh
echo '$sum(orders.total)' | jsonata-paths
```
Output:
```
[{"path":"orders.total","confidence":"static"}]
```

### Shell Quoting Pitfall (Verified)

The quoting note uses `$sum(prices)` as the example expression (per CONTEXT.md). The actual behavior was verified:

```
# What bash sends to the CLI:
echo 'Single quotes: $sum(prices)'     →  $sum(prices)    ✓ correct
echo "Double quotes: $sum(prices)"     →  (prices)        ✗ $sum vanishes
```

Both parse as valid JSONata, but the double-quote version silently produces wrong results (analyzes the expression `(prices)` instead of `$sum(prices)`). This is particularly dangerous because there is no error -- just incorrect output.

### Blockquote Note Format

The project uses `> **Note:**` blockquote style for callouts. The existing ESM notice in Installation sets the pattern:

```markdown
> **Note:** This package is ESM-only. Use `import` -- `require()` is not supported.
```

The quoting note should match this style. Per CONTEXT.md, it includes an embedded code block showing `# Correct` and `# Wrong` comments.

### Error Behavior

From `src/cli.ts`:
- Invalid expressions: writes `Error: {message}` to stderr, sets `process.exitCode = 1`
- No input (TTY with no argument): writes usage hint to stderr, sets `process.exitCode = 1`
- Success: writes `JSON.stringify(paths) + "\n"` to stdout, implicit exit code 0

Per CONTEXT.md: document as a brief one-sentence mention. No error output example.

### README Insertion Point

Content goes between line 67 (`## CLI Usage`) and line 69 (`## Examples`). Currently there is just a blank line between them. The `## CLI Usage` heading must NOT be duplicated -- content is inserted after it, and `## Examples` heading must be preserved exactly as-is after the new content.

This is the same insertion pattern used by Phase 19 (API Reference inserted between `## API Reference` and `## CLI Usage`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Verifying CLI output | Running CLI manually and copying output | Verified outputs documented above | Output already verified against built dist |
| Markdown formatting | Inventing new callout styles | `> **Note:**` blockquote pattern | Consistency with existing Installation section |

## Common Pitfalls

### Pitfall 1: Duplicating the H2 Heading
**What goes wrong:** Adding `## CLI Usage` at the top of the inserted content, creating a duplicate heading.
**Why it happens:** Phase 18 created the empty heading. The executor might include it in the content block.
**How to avoid:** Insert content AFTER the existing `## CLI Usage` line. Do NOT include `## CLI Usage` in the written content.
**Warning signs:** `grep -c "## CLI Usage" README.md` returns 2 instead of 1.

### Pitfall 2: Showing Incorrect CLI Output
**What goes wrong:** Output in documentation doesn't match actual CLI output.
**Why it happens:** Guessing output format instead of verifying.
**How to avoid:** Use the verified outputs from this research. Output is compact JSON (single line, no pretty-printing).
**Warning signs:** Multi-line or pretty-printed JSON in the examples.

### Pitfall 3: Using Double Quotes in the Stdin Example
**What goes wrong:** The documented `echo` command uses double quotes, which would fail for the reader.
**Why it happens:** Habit -- double quotes are common in documentation.
**How to avoid:** The stdin example MUST use single quotes: `echo '$sum(orders.total)' | jsonata-paths`
**Warning signs:** Any double-quoted `echo` command containing `$`.

### Pitfall 4: Breaking Adjacent Sections
**What goes wrong:** The `## Examples` heading below or the `## API Reference` content above gets modified or deleted.
**Why it happens:** Overzealous edits that replace too much content.
**How to avoid:** Use targeted insertion. Only modify content between line 67 (`## CLI Usage`) and line 69 (`## Examples`).
**Warning signs:** Missing or duplicated section headings after edit.

## Code Examples

### Complete CLI Documentation Content

The following shows the structure and content pattern. Claude has discretion on exact prose wording.

```markdown
### Argument Mode

[Brief intro sentence]

```sh
jsonata-paths 'account.name'
```

```json
[{"path":"account.name","confidence":"static"}]
```

### Stdin Mode

[Brief intro sentence]

```sh
echo '$sum(orders.total)' | jsonata-paths
```

```json
[{"path":"orders.total","confidence":"static"}]
```

> **Note:** [Shell quoting callout with correct/wrong comparison using $sum(prices)]
> ```sh
> # Correct
> jsonata-paths '$sum(prices)'
>
> # Wrong -- bash expands $sum to an empty string
> jsonata-paths "$sum(prices)"
> ```

[One-sentence error behavior: exits with code 1, error to stderr]
```

## State of the Art

Not applicable -- documentation phase with no technology choices.

## Open Questions

None -- all decisions are locked in CONTEXT.md, all CLI outputs verified, and the insertion point is clear.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-01 | README contains argument mode section with example | grep verification | `grep -c "### Argument Mode" README.md` | N/A (doc verification) |
| CLI-02 | README contains stdin mode section with example | grep verification | `grep -c "### Stdin Mode" README.md` | N/A (doc verification) |
| CLI-03 | README contains shell quoting note | grep verification | `grep -c "Correct" README.md && grep -c "Wrong" README.md` | N/A (doc verification) |

### Sampling Rate
- **Per task commit:** Structural grep checks on README.md
- **Per wave merge:** `pnpm test` (ensure no regressions from doc-only changes)
- **Phase gate:** Structural grep checks + `pnpm test` green

### Wave 0 Gaps
None -- this is a documentation-only phase. Verification is structural (grep-based) rather than test-based. Existing test suite confirms no code regressions.

## Sources

### Primary (HIGH confidence)
- `src/cli.ts` -- read directly, verified CLI behavior by running built dist
- `README.md` -- read directly, confirmed section structure and line numbers
- `package.json` -- confirmed binary name `jsonata-paths` from `bin` field
- `.planning/phases/20-cli-documentation/20-CONTEXT.md` -- all locked decisions
- `.planning/phases/18-overview-and-installation/18-01-PLAN.md` -- formatting patterns
- `.planning/phases/19-api-reference/19-01-PLAN.md` -- insertion pattern precedent

### Empirical Verification (HIGH confidence)
- `node dist/cli.js 'account.name'` -- output: `[{"path":"account.name","confidence":"static"}]`
- `echo '$sum(orders.total)' | node dist/cli.js` -- output: `[{"path":"orders.total","confidence":"static"}]`
- Shell expansion test: `echo "$sum(prices)"` produces `(prices)` (confirmed silent mangling)
- Error test: `node dist/cli.js 'invalid @@@'` produces `Error: Syntax error: "expression"` with exit code 1

## Metadata

**Confidence breakdown:**
- Content structure: HIGH - all decisions locked in CONTEXT.md, no ambiguity
- CLI outputs: HIGH - verified empirically against built dist
- Shell quoting pitfall: HIGH - verified empirically with bash expansion
- Insertion point: HIGH - README line numbers confirmed, pattern matches Phase 19

**Research date:** 2026-03-10
**Valid until:** Indefinite (documentation of existing stable CLI)
