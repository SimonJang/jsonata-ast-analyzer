# Phase 19: API Reference - Research

**Researched:** 2026-03-09
**Domain:** README documentation -- API reference section for a single-function TypeScript library
**Confidence:** HIGH

## Summary

Phase 19 adds the API Reference content to the existing `## API Reference` heading in README.md. The library has a minimal API surface: one function (`extractPaths`), one interface (`PathResult`), and one type alias (`Confidence`). All source types, signatures, and behaviors are verified directly from the codebase -- no external research is needed.

The CONTEXT.md provides highly specific structural decisions: two H3 subsections (`### extractPaths(expression: string): PathResult[]` and `### Types`), inline error documentation, clean TypeScript definitions without `export`/JSDoc, a 4-column confidence table, and a brief priority-order intro. The existing Quick Example above the API Reference section already demonstrates usage, so no additional example is needed in the extractPaths subsection.

**Primary recommendation:** This is a pure documentation task. Write markdown content matching the exact structure and constraints from CONTEXT.md, inserting it between the existing `## API Reference` and `## CLI Usage` headings in README.md.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Two H3 subsections under `## API Reference`: `### extractPaths(expression: string): PathResult[]` and `### Types`
- extractPaths heading uses inline TypeScript signature: `### extractPaths(expression: string): PathResult[]`
- Types subsection combines PathResult interface and Confidence type together (not separate H3s)
- Confidence level table lives inside ### Types, directly after the type definitions
- No additional usage example in extractPaths subsection -- the Quick Example above already demonstrates it
- Confidence table shows expression-only examples (no output column) -- Phase 21 handles full input/output examples
- Confidence table has 4 columns: Level, Meaning, Cause, Example
- Brief one-liner intro before confidence table explaining priority order: partial > dynamic > static
- Brief inline "Throws" note: throws on invalid JSONata, parser error propagates unmodified
- Mention that empty string throws ("Unexpected end of expression")
- Note that extractPaths always returns an array (never null) or throws -- for JS users who don't read types
- Mention deduplication: each unique path appears once
- Clean type definitions without `export` keywords or JSDoc comments
- Brief bullet list below the code block describing each PathResult field
- `path` description mentions special markers: `[*]` (dynamic segment) and `%` (parent reference)
- `confidence` description references the table below

### Claude's Discretion
- Exact wording of prose descriptions and one-liners
- Which JSONata expressions to use as examples in the confidence table rows
- Spacing and formatting details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | README documents the `extractPaths(expression)` function with signature, parameters, return type, and error behavior | Source verified: `extractPaths(expression: string): PathResult[]`, throws on invalid JSONata (parser error propagates), throws on empty string ("Unexpected end of expression"), always returns array or throws, deduplicates paths |
| API-02 | README documents the `PathResult` interface (`path` + `confidence` fields) | Source verified: `PathResult = { path: string; confidence: Confidence }`, path uses `[*]` for dynamic segments and `%` for parent references |
| API-03 | README documents the `Confidence` type with a table explaining `static`, `dynamic`, and `partial` levels with examples | Source verified: `Confidence = "static" \| "dynamic" \| "partial"`, priority order partial > dynamic > static, tested examples available for all three levels |
</phase_requirements>

## Standard Stack

Not applicable -- this phase is pure markdown documentation. No new libraries or dependencies.

## Architecture Patterns

### Existing README Structure

The README has a skeleton with empty section headings created by Phase 18:

```
# jsonata-ast-analyzer             (H1 - exists)
  ## Quick Example                  (H2 - exists, has content)
  ## Installation                   (H2 - exists, has content)
  ## API Reference                  (H2 - exists, EMPTY - Phase 19 target)
  ## CLI Usage                      (H2 - exists, empty - Phase 20)
  ## Examples                       (H2 - exists, empty - Phase 21)
  ## How It Works                   (H2 - exists, empty - Phase 22)
  ## Limitations                    (H2 - exists, empty - Phase 22)
  ## License                        (H2 - exists, has content)
```

### Target Content Structure (from CONTEXT.md decisions)

```markdown
## API Reference                       (existing H2, line 33)

### extractPaths(expression: string): PathResult[]
  - Parameter description
  - Return type description
  - Deduplication note
  - Throws note (invalid JSONata, empty string)
  - Always returns array or throws note

### Types
  - PathResult interface code block (clean, no export/JSDoc)
  - Bullet list describing path and confidence fields
  - Confidence type code block
  - Priority order one-liner
  - 4-column confidence table (Level, Meaning, Cause, Example)

## CLI Usage                           (existing H2, line 35)
```

### Insertion Point

Content must be inserted between line 33 (`## API Reference`) and line 35 (`## CLI Usage`) of the current README.md. The `## API Reference` heading already exists and must NOT be duplicated.

## Verified Source Data

### Function Signature (from src/index.ts)

```typescript
export function extractPaths(expression: string): PathResult[]
```

- **Parameter:** `expression: string` -- a JSONata expression string
- **Returns:** Deduplicated array of `PathResult` objects with confidence annotations
- **Throws:** On invalid JSONata input (parser error propagates unmodified)
- **Deduplication:** Uses `new Set(rawPaths)` to ensure each unique path appears once

### Type Definitions (from src/types.ts)

```typescript
type Confidence = "static" | "dynamic" | "partial";

interface PathResult {
  path: string;
  confidence: Confidence;
}
```

The `Confidence` type is defined first in the source file (line 3), followed by `PathResult` (lines 5-8). The CONTEXT.md says to present PathResult interface first, then Confidence type -- both in a single `### Types` subsection.

### Error Behavior (verified by running the code)

| Input | Error Message |
|-------|---------------|
| `}{invalid` | "The symbol "}" cannot be used as a unary operator" |
| `""` (empty string) | "Unexpected end of expression" |
| `account.name` | Returns `[{ path: "account.name", confidence: "static" }]` (no error) |
| `a + a` | Returns `[{ path: "a", confidence: "static" }]` (deduplicated) |

### Confidence Level Classification (from src/index.ts deriveConfidence function)

| Level | Detection Rule | Priority |
|-------|---------------|----------|
| `partial` | Path contains `%` as a whole dot-separated segment | Highest (checked first) |
| `dynamic` | Path contains `[*]` anywhere | Middle (checked second) |
| `static` | All other paths (including explicit wildcards like `*` and `**`) | Lowest (default) |

### Verified Example Expressions for Confidence Table

From the test suite, these are confirmed working expressions with their confidence levels:

**Static:**
- `account.name` -> `{ path: "account.name", confidence: "static" }` (simple dot path)
- `orders[status = "active"].items.price` -> static paths (filter with literal comparison)

**Dynamic:**
- `item[$field]` -> includes `{ path: "item[*]", confidence: "dynamic" }` (unbound variable in bracket filter)
- `($data := orders; $data[$field].price)` -> includes `{ path: "orders[*]", confidence: "dynamic" }`

**Partial:**
- `orders.items.%.orderRef` -> `{ path: "orders.items.%.orderRef", confidence: "partial" }` (parent operator)
- `items.%.name` -> `{ path: "items.%.name", confidence: "partial" }`

### Recommended Confidence Table Examples (Claude's Discretion)

For maximum clarity with minimal complexity, these expression examples are recommended:

| Level | Example Expression |
|-------|-------------------|
| `static` | `account.name` -- simplest possible, immediately understandable |
| `dynamic` | `item[$field]` -- clearly shows unbound variable causing dynamic marker |
| `partial` | `orders.items.%.orderRef` -- shows parent operator in realistic context |

These are all verified in the test suite and demonstrate the core concept of each confidence level without requiring additional context to understand.

## Don't Hand-Roll

Not applicable -- this is a documentation phase with no code.

## Common Pitfalls

### Pitfall 1: Duplicating the H2 heading
**What goes wrong:** Adding a second `## API Reference` heading when the skeleton already has one
**Why it happens:** Copy-pasting content without checking existing structure
**How to avoid:** Insert content AFTER line 33 (`## API Reference`), never write the H2 heading itself
**Warning signs:** Two `## API Reference` headings in the rendered README

### Pitfall 2: Including export keywords in type definitions
**What goes wrong:** Showing `export type Confidence = ...` instead of clean `type Confidence = ...`
**Why it happens:** Copying directly from source without stripping exports
**How to avoid:** CONTEXT.md explicitly requires clean definitions without `export` or JSDoc
**Warning signs:** `export` keyword visible in the TypeScript code block

### Pitfall 3: Adding a usage example in extractPaths section
**What goes wrong:** Redundant example duplicating the Quick Example above
**Why it happens:** Natural instinct to show usage in API docs
**How to avoid:** CONTEXT.md explicitly says no additional example -- Quick Example above already demonstrates it
**Warning signs:** Code block with `extractPaths()` call in the `### extractPaths(...)` subsection

### Pitfall 4: Adding output column to confidence table
**What goes wrong:** Including full path output in the confidence table
**Why it happens:** Wanting to show complete input->output mapping
**How to avoid:** CONTEXT.md says expression-only examples; Phase 21 handles full examples
**Warning signs:** Table has 5+ columns or shows PathResult output

### Pitfall 5: Wrong insertion boundary
**What goes wrong:** Content bleeds into `## CLI Usage` section or overwrites the License section
**Why it happens:** Not carefully managing the edit boundaries
**How to avoid:** Insert between `## API Reference` (line 33) and `## CLI Usage` (line 35), preserving both headings

## Code Examples

### Target README Content Structure

This is the approximate shape of what needs to be written (exact wording is Claude's discretion):

```markdown
### extractPaths(expression: string): PathResult[]

[Brief description of what it does]

- **expression** -- [parameter description]
- **Returns** -- [return type description]. Each unique path appears once.
- **Throws** -- [error behavior]. Empty string throws ("Unexpected end of expression").

[Note about always returning array or throwing -- for JS users]

### Types

```typescript
interface PathResult {
  path: string;
  confidence: Confidence;
}

type Confidence = "static" | "dynamic" | "partial";
```

- **path** -- [description mentioning `[*]` dynamic segment and `%` parent reference markers]
- **confidence** -- [description referencing table below]

[One-liner about priority order: partial > dynamic > static]

| Level | Meaning | Cause | Example |
|-------|---------|-------|---------|
| `static` | [meaning] | [cause] | `account.name` |
| `dynamic` | [meaning] | [cause] | `item[$field]` |
| `partial` | [meaning] | [cause] | `orders.items.%.orderRef` |
```

## State of the Art

Not applicable -- this phase involves writing markdown documentation for a stable API. No evolving technology concerns.

## Open Questions

None. All information is verified directly from the codebase:
1. Function signature, parameters, return type -- verified from `src/index.ts`
2. Type definitions -- verified from `src/types.ts`
3. Error behavior -- verified by running the code
4. Confidence classification logic -- verified from `deriveConfidence()` function and test suite
5. Content structure -- fully specified in CONTEXT.md

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:unit` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | README documents extractPaths with signature, params, return, errors | manual-only | N/A -- documentation review | N/A |
| API-02 | README documents PathResult interface | manual-only | N/A -- documentation review | N/A |
| API-03 | README documents Confidence type with table | manual-only | N/A -- documentation review | N/A |

**Justification for manual-only:** This phase writes markdown documentation. The requirements are about content presence and accuracy in README.md, which is verified by reading the file, not by running tests. The underlying code behavior is already tested by the existing test suite (294 tests passing).

### Sampling Rate
- **Per task commit:** Visual review of README.md content
- **Per wave merge:** Verify README renders correctly (no broken markdown)
- **Phase gate:** All three subsection elements present and accurate

### Wave 0 Gaps
None -- existing test infrastructure covers all code behavior. Documentation content is verified by review, not automated tests.

## Sources

### Primary (HIGH confidence)
- `src/index.ts` -- function signature, deriveConfidence logic, deduplication, JSDoc comments
- `src/types.ts` -- PathResult interface, Confidence type definition
- `test/extract-paths.test.ts` -- verified examples for all three confidence levels, error behavior
- `test/integration/api-reshaping.test.ts` -- verified partial confidence examples
- `README.md` -- current skeleton structure, insertion point
- Runtime verification -- confirmed error messages for invalid and empty expressions

### Secondary (MEDIUM confidence)
None needed -- all information sourced directly from codebase.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no libraries needed, pure documentation
- Architecture: HIGH -- insertion point and content structure fully specified by CONTEXT.md and existing README
- Pitfalls: HIGH -- all pitfalls derived from explicit CONTEXT.md constraints

**Research date:** 2026-03-09
**Valid until:** Indefinite -- documents a stable API with no planned changes
