# Phase 13: Edge Cases and Tech Debt - Research

**Researched:** 2026-03-04
**Domain:** JSONata AST path analysis -- edge case validation and tech debt documentation
**Confidence:** HIGH

## Summary

Phase 13 is the final phase of v1.1, covering integration tests for the hardest feature interactions and known tech debt items. Pre-verification of candidate expressions against the actual analyzer reveals that most "edge case" patterns (deep variable chains, nested closures, interprocedural tracing, and even `$sort` with lambda) work correctly. The tech debt items break down as follows: `$sort` lambda actually passes (HIGHER_ORDER_SEMANTICS handles it), `$lookup` with chaining is confirmed broken (loses function arguments), and standalone BindNode extracts RHS paths correctly but scope propagation is limited.

This means the test file will contain a mix of **passing tests** validating working edge cases (EDGE-01, EDGE-02, EDGE-03, EDGE-04 likely passing, EDGE-07) and **skipped tests** documenting bugs for v1.2 (EDGE-05 confirmed, EDGE-06 depending on the test expression chosen). The CONTEXT.md explicitly states: "Pre-check each expression during planning to confirm it actually fails before marking as skip."

**Primary recommendation:** Structure `edge-cases.test.ts` with one `describe` block per EDGE requirement plus a composite section. Use pre-verified expressions with known outputs. Mark only confirmed failures as `it.skip` with `BUG(v1.2):` comments. For EDGE-07 CLI tests, use `execSync` to invoke `node dist/cli.js` and parse the JSON output for comparison.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- One fixture per debt item -- single representative test, skipped with `BUG(v1.2):` comment
- Skipped fixtures show CORRECT expected output (what the fix should produce), consistent with phases 9-12
- Pre-check each expression during planning to confirm it actually fails before marking as skip
- $sort lambda (EDGE-04): test `$sort(array, function($a,$b){...})` pattern
- $lookup HOF (EDGE-05): test `$lookup(obj, key)` with chained field access (already documented in BIZR-04 skip)
- Standalone BindNode (EDGE-06): test variable binding outside block expression context
- EDGE-01: Happy path only -- test chains that should fully resolve (3-4 hops). If analyzer can't resolve multi-hop chains, skip with `BUG(v1.2):`. No broken/undefined/circular chain tests.
- EDGE-02: Carry forward Phase 9/10/11 patterns for HOF testing. Test nested `$map` with closure capture across two levels.
- EDGE-03: Test `$fn := function($x){...}` called from multiple sites. Expected: union of paths from all call-site arguments.
- EDGE-07: 2-3 representative expressions piped through `jsonata-paths` CLI. One simple, one complex (multi-variable), one with dynamic confidence. Verify CLI JSON output matches `extractPaths()` API output exactly. Test uses `execSync` or similar.
- Carry forward Phase 9-12 mix strategy: focused single-pattern fixture first per requirement, then composite
- Each EDGE requirement gets its own nested `describe('EDGE-XX: ...', () => { ... })` block inside top-level "Edge Cases" describe
- Exact match (`expectedPaths`) for ALL fixtures -- no subset matching
- Confidence level always explicit in every PathResult
- When a test expression reveals wrong/missing paths: use `it.skip` with `BUG(v1.2):` tracking comment
- Skipped fixtures show CORRECT expected output (what fix should produce), not buggy actual
- Multi-line template literals for complex expressions; single-line strings for simple ones
- Fixture names combine pattern and behavior
- Realistic variable names ($intermediate, $resolved, $fn)
- No inline JSONata comments

### Claude's Discretion
- Exact number of fixtures per EDGE requirement
- Which specific JSONata expressions best represent each edge case
- HOF nesting depth for EDGE-02 (2-level minimum per requirement)
- Custom function patterns for EDGE-03 (single vs multiple definition variations)
- Whether composite fixture combines passing EDGE tests only (preferred) or attempts broader combination
- CLI invocation method (execSync, spawn, etc.)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EDGE-01 | User can verify path extraction from deeply nested variable chains (3-4 hop resolution) | Pre-verified: 3-hop and 4-hop chains both resolve correctly. All intermediate + final paths extracted. Passing tests. |
| EDGE-02 | User can verify path extraction from recursive/nested higher-order functions (closure across `$map` levels) | Pre-verified: nested `$map` with outer closure capture works. Inner scope accesses outer `$order` variable correctly. Passing tests. |
| EDGE-03 | User can verify path extraction from custom function definition with multi-call interprocedural tracing | Pre-verified: `$fn` called from two sites produces union of all call-site paths. Passing tests. |
| EDGE-04 | User can verify path extraction from `$sort` with lambda callback (known tech debt) | Pre-verified: `$sort` with lambda actually WORKS. HIGHER_ORDER_SEMANTICS has `sort: { 0: "left", 1: "right" }`. This will be a passing test, not skipped. |
| EDGE-05 | User can verify path extraction from `$lookup` higher-order semantics (known tech debt) | Pre-verified: `$lookup(obj, key).field` loses function arguments -- confirmed BUG. Only `.field` path appears. Must be `it.skip` with `BUG(v1.2):`. |
| EDGE-06 | User can verify path extraction from standalone `BindNode` outside block (known tech debt) | Pre-verified: standalone `$x := expr` extracts RHS paths correctly. The tech debt is scope propagation limitation. Need to determine exact test expression. |
| EDGE-07 | User can verify complex expression round-trip via CLI (`jsonata-paths`) | Pre-verified: CLI output matches API output for simple, complex, and dynamic-confidence expressions. Use `execSync` with `node dist/cli.js`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test framework | Already configured with `globals: true`, `passWithNoTests: true` |
| node:child_process | built-in | CLI subprocess execution | `execSync` for EDGE-07 CLI round-trip tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| helpers.ts | local | `assertFixture()`, `sortPaths()`, `IntegrationFixture` type | Every test fixture assertion |
| src/index.ts | local | `extractPaths()` public API | Imported by helpers, also direct import for EDGE-07 comparison |

### No New Dependencies Required
This phase adds only test fixtures to an existing test file. No new libraries needed.

## Architecture Patterns

### Test File Structure
```
test/integration/edge-cases.test.ts
```

Follows the exact pattern from `data-transforms.test.ts`, `business-rules.test.ts`, `api-reshaping.test.ts`, `data-export.test.ts`:

```typescript
import { describe, it } from "vitest";
import { assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("Edge Cases", () => {
  describe("EDGE-01: ...", () => {
    const fixtures: IntegrationFixture[] = [/* ... */];
    for (const fixture of fixtures) {
      it(fixture.name, () => { assertFixture(fixture); });
    }
  });
  // ... more describe blocks per requirement
  // Composite section at the end
});
```

### Pattern 1: Passing Edge Case Fixture
**What:** Standard fixture with exact match assertion
**When to use:** EDGE-01, EDGE-02, EDGE-03, EDGE-04, EDGE-07
```typescript
{
  name: "3-hop variable chain: resolves all hops to root data path",
  expression: `($intermediate := root.data; $resolved := $intermediate.level1; $final := $resolved.level2; $final.value)`,
  expectedPaths: [
    { path: "root.data", confidence: "static" },
    { path: "root.data.level1", confidence: "static" },
    { path: "root.data.level1.level2", confidence: "static" },
    { path: "root.data.level1.level2.value", confidence: "static" },
  ],
}
```

### Pattern 2: Skipped Tech Debt Fixture
**What:** `it.skip` with `BUG(v1.2):` comment showing CORRECT expected output
**When to use:** EDGE-05 (confirmed), EDGE-06 (if test expression confirms failure)
```typescript
// BUG(v1.2): $lookup(obj, key).field loses function arguments -- only .field appears
it.skip("lookup HOF chaining: extracts object, key, and chained field paths", () => {
  assertFixture({
    name: "lookup HOF chaining: extracts object, key, and chained field paths",
    expression: `$lookup(catalog, productId).price`,
    expectedPaths: [
      { path: "catalog", confidence: "static" },
      { path: "price", confidence: "static" },
      { path: "productId", confidence: "static" },
    ],
  });
});
```

### Pattern 3: CLI Round-Trip Test
**What:** Invoke CLI via `execSync`, parse JSON output, compare with `extractPaths()` API
**When to use:** EDGE-07
```typescript
import { execSync } from "node:child_process";
import { extractPaths } from "../../src/index.js";

it("CLI round-trip: simple expression", () => {
  const expr = "orders.items.price";
  const cliOutput = execSync(`node dist/cli.js '${expr}'`, { encoding: "utf-8" }).trim();
  const cliResult = JSON.parse(cliOutput);
  const apiResult = extractPaths(expr);
  expect(sortPaths(cliResult)).toEqual(sortPaths(apiResult));
});
```

### Anti-Patterns to Avoid
- **Duplicating existing skipped tests:** EDGE-04/05/06 must test the *specific tech debt angle*, not re-test patterns already covered in TRFM/BIZR/APIR skips
- **Using subset matching:** ALL fixtures use `expectedPaths` exact match per CONTEXT.md
- **Hardcoding CLI path:** Use `node dist/cli.js` (confirmed working) rather than `npx jsonata-paths` (slower, may not resolve)
- **Testing broken chain/circular references:** EDGE-01 is happy path only per CONTEXT.md

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path comparison | Custom sort+compare logic | `assertFixture()` from helpers.ts | Already handles sorting, error messages, exact/subset modes |
| CLI invocation | Custom spawn wrapper | `execSync` from `node:child_process` | Simple, synchronous, perfect for test assertions |
| JSON parsing of CLI output | Manual string parsing | `JSON.parse(cliOutput)` | CLI outputs valid JSON (confirmed) |
| Fixture typing | Ad-hoc types | `IntegrationFixture` from helpers.ts | Compile-time mutual exclusivity of exact vs subset modes |

## Common Pitfalls

### Pitfall 1: Assuming $sort Lambda is Broken
**What goes wrong:** Marking EDGE-04 as `it.skip` when it actually passes
**Why it happens:** The CONTEXT.md lists $sort lambda as "known tech debt" but pre-verification shows HIGHER_ORDER_SEMANTICS already handles it with `sort: { 0: "left", 1: "right" }`
**How to avoid:** CONTEXT.md explicitly says "pre-check each expression during planning to confirm it actually fails before marking as skip." Pre-verification confirms $sort lambda works.
**Warning signs:** Creating skip tests without running the expression first

### Pitfall 2: CLI Path Resolution in Test Environment
**What goes wrong:** `npx jsonata-paths` or `node dist/cli.js` failing because dist/ is stale
**Why it happens:** Tests run against source but CLI runs against built dist/
**How to avoid:** Ensure `npm run build` has been run before CLI tests. Use `node dist/cli.js` directly. The build is already present (confirmed `dist/cli.js` exists with proper shebang).
**Warning signs:** "Cannot find module" errors from CLI tests

### Pitfall 3: Shell Escaping in execSync
**What goes wrong:** Expressions with `$`, quotes, or special characters getting mangled by shell
**Why it happens:** `execSync` runs through shell by default
**How to avoid:** Use the `argv` form or pass expression via stdin: `echo '...' | node dist/cli.js`. Alternatively, pass the expression as an argument with proper escaping.
**Warning signs:** JSONata parse errors from CLI that don't occur in API calls

### Pitfall 4: EDGE-05 vs BIZR-04 Duplication
**What goes wrong:** Creating an EDGE-05 test that's identical to the existing BIZR-04 skip
**Why it happens:** Both document the `$lookup` chaining bug
**How to avoid:** CONTEXT.md says "new fixtures should test the specific tech debt angle, not duplicate earlier patterns." BIZR-04 tests `$lookup(products, sku).price` -- EDGE-05 should test a different facet of $lookup HOF semantics (e.g., `$lookup` with variable-resolved key, or `$lookup` inside a pipeline).
**Warning signs:** Identical expression strings across BIZR-04 and EDGE-05

### Pitfall 5: Standalone BindNode Scope Confusion
**What goes wrong:** Testing standalone bind expecting variable resolution when there is no subsequent reference
**Why it happens:** The "tech debt" with standalone BindNode is subtle -- `walkBind` extracts RHS paths but doesn't propagate scope. In practice, standalone binds have no subsequent reference, so this is only a conceptual limitation.
**How to avoid:** Focus the EDGE-06 test on what standalone bind actually does (extracts RHS paths). If the expression pattern actually shows the scope limitation, document as skip.
**Warning signs:** Confusing "works correctly for its limited case" with "no bug"

## Code Examples

### Pre-Verified Expression Results

All expressions below were run against the actual analyzer on 2026-03-04.

#### EDGE-01: 3-Hop Variable Chain (PASSES)
```typescript
// Input: ($intermediate := root.data; $resolved := $intermediate.level1; $final := $resolved.level2; $final.value)
// Output:
[
  { path: "root.data", confidence: "static" },
  { path: "root.data.level1", confidence: "static" },
  { path: "root.data.level1.level2", confidence: "static" },
  { path: "root.data.level1.level2.value", confidence: "static" },
]
```

#### EDGE-01: 4-Hop Variable Chain (PASSES)
```typescript
// Input: ($root := data.source; $intermediate := $root.config; $resolved := $intermediate.settings; $final := $resolved.value; $final.result)
// Output:
[
  { path: "data.source", confidence: "static" },
  { path: "data.source.config", confidence: "static" },
  { path: "data.source.config.settings", confidence: "static" },
  { path: "data.source.config.settings.value", confidence: "static" },
  { path: "data.source.config.settings.value.result", confidence: "static" },
]
```

#### EDGE-02: Nested $map with Closure Capture (PASSES)
```typescript
// Input: $map(orders, function($order) { $map($order.items, function($item) { $item.price * $order.discount }) })
// Output:
[
  { path: "orders", confidence: "static" },
  { path: "orders.items", confidence: "static" },
  { path: "orders.items.price", confidence: "static" },
  { path: "orders.discount", confidence: "static" },
]
```

#### EDGE-02: Nested Map with Outer Scope Variable (PASSES)
```typescript
// Input: ($config := settings; $map(orders, function($o) { $map($o.items, function($i) { $i.price * $config.taxRate }) }))
// Output:
[
  { path: "settings", confidence: "static" },
  { path: "orders", confidence: "static" },
  { path: "orders.items", confidence: "static" },
  { path: "orders.items.price", confidence: "static" },
  { path: "settings.taxRate", confidence: "static" },
]
```

#### EDGE-03: Custom Function Multi-Call (PASSES)
```typescript
// Input: ($fn := function($x) { $x.name }; {"a": $fn(account), "b": $fn(customer)})
// Output:
[
  { path: "account", confidence: "static" },
  { path: "account.name", confidence: "static" },
  { path: "customer", confidence: "static" },
  { path: "customer.name", confidence: "static" },
]
```

#### EDGE-04: $sort with Lambda (PASSES -- NOT tech debt)
```typescript
// Input: $sort(employees, function($a, $b) { $a.salary > $b.salary })
// Output:
[
  { path: "employees", confidence: "static" },
  { path: "employees.salary", confidence: "static" },
]
```

#### EDGE-04: $sort with Variable-Resolved Input (PASSES)
```typescript
// Input: ($data := source.items; $sort($data, function($a, $b) { $a.priority > $b.priority }))
// Output:
[
  { path: "source.items", confidence: "static" },
  { path: "source.items.priority", confidence: "static" },
]
```

#### EDGE-05: $lookup Chaining (FAILS -- confirmed BUG)
```typescript
// Input: $lookup(catalog, productId).price
// Actual output (BUGGY):
[{ path: "price", confidence: "static" }]
// Expected CORRECT output:
[
  { path: "catalog", confidence: "static" },
  { path: "price", confidence: "static" },
  { path: "productId", confidence: "static" },
]
```

#### EDGE-06: Standalone BindNode (PASSES for basic case)
```typescript
// Input: $cache := account.preferences
// Output:
[{ path: "account.preferences", confidence: "static" }]
```

#### EDGE-07: CLI Round-Trip (PASSES)
```bash
# CLI: node dist/cli.js 'items[$var].name'
# Output: [{"path":"items.name","confidence":"static"},{"path":"items[*]","confidence":"dynamic"}]
# Matches extractPaths() API output exactly
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phases 9-12: category-specific integration tests | Phase 13: cross-cutting edge cases | v1.1 Phase 13 | Tests the analyzer at its limits |
| Assumed $sort lambda broken | Pre-verified: $sort lambda works | Phase 13 research | EDGE-04 becomes passing test, not skip |
| BIZR-04 covered $lookup bug | EDGE-05 needs distinct angle | Phase 13 research | Must avoid duplication with BIZR-04 skip |

**Key insight from pre-verification:** 5 of 7 EDGE requirements produce passing tests. Only EDGE-05 is confirmed broken. EDGE-06 needs careful expression selection to demonstrate the actual limitation.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` (globals: true, passWithNoTests: true) |
| Quick run command | `npx vitest run test/integration/edge-cases.test.ts` |
| Full suite command | `npx vitest run test/integration/` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EDGE-01 | 3-4 hop variable chain resolution | integration | `npx vitest run test/integration/edge-cases.test.ts` | Skeleton only |
| EDGE-02 | Nested HOF closure capture across $map levels | integration | `npx vitest run test/integration/edge-cases.test.ts` | Skeleton only |
| EDGE-03 | Custom function multi-call interprocedural tracing | integration | `npx vitest run test/integration/edge-cases.test.ts` | Skeleton only |
| EDGE-04 | $sort with lambda callback | integration | `npx vitest run test/integration/edge-cases.test.ts` | Skeleton only |
| EDGE-05 | $lookup HOF chaining (tech debt) | integration (skip) | `npx vitest run test/integration/edge-cases.test.ts` | Skeleton only |
| EDGE-06 | Standalone BindNode outside block | integration | `npx vitest run test/integration/edge-cases.test.ts` | Skeleton only |
| EDGE-07 | CLI round-trip verification | integration | `npx vitest run test/integration/edge-cases.test.ts` | Skeleton only |

### Sampling Rate
- **Per task commit:** `npx vitest run test/integration/edge-cases.test.ts`
- **Per wave merge:** `npx vitest run test/integration/`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. The skeleton file `edge-cases.test.ts` already exists with the correct describe block. `helpers.ts` provides all assertion utilities. `dist/cli.js` is built and functional.

## Open Questions

1. **EDGE-06: What constitutes a meaningful standalone BindNode test?**
   - What we know: `$x := expr` at the top level extracts RHS paths correctly via `walkBind()`. The "tech debt" is that the variable binding isn't propagated to scope since there's no block context.
   - What's unclear: Is there a realistic expression where standalone bind scope loss produces wrong results? Or is the "tech debt" simply that `walkBind` could theoretically propagate scope but doesn't need to since standalone binds have no subsequent reference?
   - Recommendation: Test the basic case (standalone bind extracts RHS paths) as a passing test. If a non-block context (like array constructor `[$x := data.a, $x.field]`) demonstrates the scope limitation, add that as a skip. Pre-verification shows `[$x := data.a, $x.field]` produces only `["data.a"]` (losing `$x.field`), which IS a demonstrable bug.

2. **EDGE-04: Should we still test $sort as "tech debt" if it passes?**
   - What we know: `$sort` with lambda works because HIGHER_ORDER_SEMANTICS includes `sort: { 0: "left", 1: "right" }`.
   - What's unclear: The CONTEXT.md lists it as tech debt but also says "pre-check each expression during planning to confirm it actually fails before marking as skip."
   - Recommendation: Include as a passing test. The pre-check confirms it passes. Document that the anticipated tech debt was already resolved by the HIGHER_ORDER_SEMANTICS implementation.

## Sources

### Primary (HIGH confidence)
- Direct pre-verification against `extractPaths()` API -- all expressions tested on 2026-03-04
- Source code review: `walker.ts`, `scope.ts`, `builtins.ts`, `cli.ts`, `index.ts`
- Existing test files: `data-transforms.test.ts`, `business-rules.test.ts`, `api-reshaping.test.ts`, `data-export.test.ts`
- `helpers.ts` -- `assertFixture()`, `sortPaths()`, `IntegrationFixture` type definitions

### Secondary (MEDIUM confidence)
- CONTEXT.md -- user decisions for test patterns, assertion strategy, failure handling

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing tooling confirmed working
- Architecture: HIGH -- follows established pattern from 4 prior test files, same helpers/types
- Pitfalls: HIGH -- pre-verification caught the $sort false assumption; all expressions tested against actual analyzer
- Pre-verification: HIGH -- every candidate expression was run through `extractPaths()` with actual output recorded

**Research date:** 2026-03-04
**Valid until:** Indefinite (v1.1 scope is frozen; no analyzer changes expected)
