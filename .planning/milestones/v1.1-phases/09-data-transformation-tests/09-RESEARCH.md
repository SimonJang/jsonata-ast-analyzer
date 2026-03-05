# Phase 9: Data Transformation Tests - Research

**Researched:** 2026-03-04
**Domain:** Integration test authoring for JSONata path analyzer -- data transformation patterns
**Confidence:** HIGH

## Summary

Phase 9 adds integration tests to `test/integration/data-transforms.test.ts` covering five TRFM requirements. The test infrastructure (Phase 8) is complete and working: `assertFixture()`, `IntegrationFixture` types, `sortPaths()`, and NPM scripts are all in place. The existing smoke test in `data-transforms.test.ts` will be replaced by real fixtures organized into nested `describe('TRFM-XX: ...')` blocks.

Live testing of the analyzer revealed several known bugs where filter/sort predicate paths leak into subsequent higher-order function element bindings. For example, `$map(items[active], function($v) { $v.name })` produces a spurious `items.active.name` path because the filter predicate path `items.active` gets bound as an element path to `$v`. Similarly, chained `~>` with multiple HOFs and variable-resolved sort expressions lose sort term paths. These bugs affect TRFM-01, TRFM-02, and TRFM-05 scenarios -- the CONTEXT.md decision is clear: use `it.skip` for buggy tests and document them for v1.2.

TRFM-03 (array dot-notation) and TRFM-04 (string formatting) work correctly with the current analyzer -- no bugs detected in those patterns.

**Primary recommendation:** Write fixtures by running each expression through `extractPaths()` first (as done in this research), codify the actual output as `expectedPaths` for passing tests, and use `it.skip` with a tracking comment for tests where the analyzer produces incorrect results.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Mix strategy: focused single-pattern fixture first per requirement, then a realistic composite fixture combining patterns
- Claude decides fixture count per requirement based on complexity
- Claude decides whether composites combine patterns across TRFM requirements or stay within one
- Each TRFM requirement gets its own nested `describe('TRFM-XX: ...', () => { ... })` block inside the top-level "Data Transforms" describe
- Exact match (`expectedPaths`) for ALL fixtures -- no subset matching in this phase
- Confidence level always explicit in every PathResult (`confidence: "static"`, `confidence: "dynamic"`, etc.)
- Assert what the analyzer actually produces -- run the expression first during planning, observe output, then codify as the expected result. Don't assume expected paths
- When a test expression reveals the analyzer produces wrong/missing paths: use `it.skip('name', () => { ... })` with a tracking comment
- v1.1 is testing-only -- document bugs for v1.2, don't fix them
- Claude decides tracking comment format (consistent across all skipped tests)
- Pre-check expressions during planning by running them through `extractPaths()` to discover bugs upfront before execution
- Multi-line template literals for complex expressions (pipelines, multi-stage transforms); single-line strings for simple expressions
- Fixture names combine pattern and behavior: `'filter-sort-map pipeline: extracts fields from all stages'`
- No inline JSONata comments explaining syntax -- fixture name is the documentation
- Realistic variable names in expressions: `$filtered`, `$sorted`, `$mapped` (not `$a`, `$b`)

### Claude's Discretion
- Exact number of fixtures per TRFM requirement
- Whether to cross-reference requirements in composite fixtures
- Tracking comment format for `it.skip` tests
- Which expressions to choose as representative real-world patterns

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRFM-01 | Verify path extraction from filter -> sort -> map -> reshape pipeline chains | Analyzer handles individual patterns correctly; combined pipelines with variable bindings exhibit Bug A (filter predicate path leaking). Direct path expressions `items[filter]^(sort).select` work. Tested multiple expression variants. |
| TRFM-02 | Verify path extraction from chained `~>` apply operator pipelines with lambda threading | Single `~>` with HOF works correctly. Chained `~>` with two HOFs exhibits Bug C (second HOF inherits first HOF's predicate paths as element bindings). Apply with custom lambda via variable works. Apply with inline lambda (Bug D) loses lambda parameter binding. |
| TRFM-03 | Verify path extraction from array dot-notation mapping with context-relative paths | Works correctly -- `orders.items.price` produces `orders.items.price`. Multi-level dot-notation and dot-notation with filters both produce expected results. No bugs detected. |
| TRFM-04 | Verify path extraction from string concatenation/formatting with path operands | Works correctly -- `&` operator extracts both operand paths, `$join` with array constructor extracts all path elements, `$map` with string concat in lambda works. No bugs detected. |
| TRFM-05 | Verify path extraction from multi-stage transforms with intermediate variable bindings | Simple variable binding chains work (`$base := account; $base.name`). Multi-hop via `$map` then `$sum` works. Complex chains with `$filter` then `$map` through variables exhibit Bug A/C (predicate path leaking). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.0.18 | Test framework | Already configured in project, globals + ESM |
| assertFixture | n/a | One-liner test assertion | Phase 8 infrastructure, handles sort + compare |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| IntegrationFixture (type) | n/a | Typed fixture interface | Every fixture definition |
| extractPaths | n/a | Public API under test | Pre-checking expressions during planning |

No new dependencies needed. Everything is already installed and configured.

## Architecture Patterns

### File Structure
```
test/integration/
  data-transforms.test.ts   # <-- THIS FILE: expand with TRFM-01 through TRFM-05
  helpers.ts                 # assertFixture, IntegrationFixture, sortPaths
  helpers.test.ts            # helper unit tests (Phase 8)
  business-rules.test.ts     # Phase 10 (empty shell)
  api-reshaping.test.ts      # Phase 11 (empty shell)
  data-export.test.ts        # Phase 12 (empty shell)
  edge-cases.test.ts         # Phase 13 (empty shell)
```

### Pattern 1: Nested Describe Blocks per Requirement
**What:** Each TRFM requirement gets its own `describe('TRFM-XX: ...', () => { ... })` block
**When to use:** Every requirement in this phase
**Example:**
```typescript
// Source: Established pattern from extract-paths.test.ts
describe("Data Transforms", () => {
  describe("TRFM-01: Pipeline chains (filter -> sort -> map -> reshape)", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "filter-sort pipeline: extracts filter predicate and sort key paths",
        expression: `items[status = "active"]^(price).name`,
        expectedPaths: [
          { path: "items.name", confidence: "static" },
          { path: "items.price", confidence: "static" },
          { path: "items.status", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });
});
```

### Pattern 2: Skipped Tests for Known Bugs
**What:** Use `it.skip` with tracking comment when analyzer produces wrong results
**When to use:** When pre-checking reveals buggy output (filter path leaking, missing paths)
**Example:**
```typescript
// BUG: filter predicate paths leak into HOF element bindings (v1.2)
it.skip("filter-map pipeline: extracts only data paths, not filter predicates as elements", () => {
  assertFixture({
    name: "filter-map pipeline: extracts only data paths, not filter predicates as elements",
    expression: `$map(items[active], function($v) { $v.name })`,
    expectedPaths: [
      { path: "items", confidence: "static" },
      { path: "items.active", confidence: "static" },
      { path: "items.name", confidence: "static" },
      // BUG: analyzer also produces items.active.name (spurious)
    ],
  });
});
```

### Pattern 3: Fixture Loop with assertFixture
**What:** Array of fixtures iterated with `for...of`, each producing an `it()` block
**When to use:** For all passing fixtures within a requirement's describe block
**Example:**
```typescript
const fixtures: IntegrationFixture[] = [ /* ... */ ];
for (const fixture of fixtures) {
  it(fixture.name, () => {
    assertFixture(fixture);
  });
}
```

### Anti-Patterns to Avoid
- **Assuming expected paths:** Always pre-check with `extractPaths()` first. The analyzer has known behaviors that differ from intuition.
- **Subset matching (`mustContain`):** CONTEXT.md explicitly locks exact match (`expectedPaths`) for ALL fixtures.
- **Missing confidence in PathResult:** Every path assertion MUST include `confidence: "static"` (or "dynamic"/"partial"). The `assertFixture()` uses `toEqual` which checks all fields.
- **Inline JSONata comments:** Fixture name IS the documentation per CONTEXT.md decisions.
- **Single-letter variable names:** Use `$filtered`, `$sorted`, `$mapped`, `$employee` -- not `$a`, `$b`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path sorting for comparison | Manual sort logic | `sortPaths()` from helpers.ts | Already handles primary (path) + secondary (confidence) sort |
| Test assertion boilerplate | Manual `expect(extractPaths(...))` | `assertFixture(fixture)` | One-liner, handles exact + subset, good error messages |
| Fixture type checking | Ad-hoc object shapes | `IntegrationFixture` type | Compile-time mutual exclusivity between Exact and Subset modes |

**Key insight:** Phase 8 built all the infrastructure. Phase 9 is purely fixture authoring -- no helper code changes needed.

## Common Pitfalls

### Pitfall 1: Filter Predicate Path Leaking (Bug A)
**What goes wrong:** When a filter expression like `items[price > 10]` is used as a data argument to `$map`/`$filter`/`$reduce`, the filter predicate paths (`items.price`) get included in the HOF element bindings alongside the base path (`items`). The lambda parameter `$v` then resolves to BOTH `items` and `items.price`, causing `$v.name` to produce both `items.name` (correct) and `items.price.name` (spurious).
**Why it happens:** `walkNode()` on `items[price > 10]` returns `["items", "items.price"]` as raw paths. When `walkHigherOrderCall` binds these to the lambda's element parameter, both paths get bound. The filter predicate path is a side-read, not an element path.
**How to avoid:** For test fixtures hitting this bug, use `it.skip` with tracking comment. For passing tests, choose expressions where filter is NOT applied directly to the HOF data argument (e.g., use `$filter(items, function($v) { $v.price > 10 })` separately, then use the result).
**Warning signs:** Any expression combining `array[filter]` inside `$map(array[filter], fn)` or `array[filter] ~> $map(fn)`.
**Affected requirements:** TRFM-01, TRFM-02, TRFM-05

### Pitfall 2: Variable-Resolved Sort Paths Lost (Bug B)
**What goes wrong:** When a sort expression uses a variable-resolved path like `($x := items; $x^(price))`, the sort term path (`items.price`) is not extracted. Direct `items^(price)` works correctly.
**Why it happens:** `walkPath`'s variable branch builds base paths and handles filter stages, but does NOT walk sort steps for variable-resolved paths. Sort step walking only happens in the non-variable branch.
**How to avoid:** For passing tests, use direct path expressions with sort (`items^(price)`). For variable-resolved sort, use `it.skip`.
**Affected requirements:** TRFM-01

### Pitfall 3: Chained ~> HOF Predicate Inheritance (Bug C)
**What goes wrong:** In `items ~> $filter(fn{active}) ~> $map(fn{name})`, the second `$map` receives `["items", "items.active"]` as data arg paths (because walkApply re-walks the LHS which now includes the first ~>'s output). This causes `$v.name` to produce both `items.name` and `items.active.name`.
**Why it happens:** `walkApply` prepends the LHS as a synthetic argument. For chained `~>`, the LHS of the second `~>` is the entire `items ~> $filter(...)` subexpression, which when walked produces both base and predicate paths.
**How to avoid:** For passing tests, chain ~> with non-filter HOFs (e.g., `~> $map(fn) ~> $sum()`). For filter-then-map chains, use `it.skip`.
**Affected requirements:** TRFM-02

### Pitfall 4: Inline Lambda with Apply (Bug D)
**What goes wrong:** `data ~> function($d) { $d.count }` produces only `["data"]`, missing `data.count`. The lambda parameter `$d` is never bound to `data` paths.
**Why it happens:** `walkApply` checks `node.rhs.type === "function"` (FunctionNode, i.e., a function call). An inline lambda has `type: "lambda"`, falling into the else branch which just does `walkNode(rhs, scope)`. Since `walkLambda` returns `[]` for non-thunk lambdas, the body is never walked with bindings.
**How to avoid:** Use variable-bound custom functions instead: `($fn := function($x) { $x.count }; data ~> $fn())`. This works correctly.
**Affected requirements:** TRFM-02

### Pitfall 5: Not Pre-Checking Expressions
**What goes wrong:** Writing expected paths based on intuition of what the analyzer "should" produce, only to find the test fails because the analyzer behaves differently.
**Why it happens:** The analyzer has specific behaviors around variable resolution, filter predicate scoping, and HOF parameter binding that don't always match JSONata runtime semantics.
**How to avoid:** ALWAYS run `extractPaths(expression)` before writing the fixture. The CONTEXT.md explicitly requires this.
**Warning signs:** Any complex expression with multiple features combined.

## Code Examples

### Verified Working Expression Patterns

#### TRFM-01: Filter-Sort Pipeline (direct path, no variable)
```typescript
// Verified: items[status = "active"]^(price).name
extractPaths('items[status = "active"]^(price).name')
// => [
//   { path: "items.name", confidence: "static" },
//   { path: "items.status", confidence: "static" },
//   { path: "items.price", confidence: "static" },
// ]
```

#### TRFM-01: Map with Reshape (direct, no filter in data arg)
```typescript
// Verified: $map(items, function($v) { {"n": $v.name, "t": $v.price * $v.qty} })
extractPaths('$map(items, function($v) { {"n": $v.name, "t": $v.price * $v.qty} })')
// => [
//   { path: "items", confidence: "static" },
//   { path: "items.name", confidence: "static" },
//   { path: "items.price", confidence: "static" },
//   { path: "items.qty", confidence: "static" },
// ]
```

#### TRFM-02: Single ~> Apply with HOF
```typescript
// Verified: items ~> $map(function($v) { $v.price })
extractPaths('items ~> $map(function($v) { $v.price })')
// => [
//   { path: "items", confidence: "static" },
//   { path: "items.price", confidence: "static" },
// ]
```

#### TRFM-02: Apply with Custom Lambda via Variable
```typescript
// Verified: ($fn := function($x) { $x.name }; data ~> $fn())
extractPaths('($fn := function($x) { $x.name }; data ~> $fn())')
// => [
//   { path: "data", confidence: "static" },
//   { path: "data.name", confidence: "static" },
// ]
```

#### TRFM-02: ~> Chain without Filter (clean, no bug)
```typescript
// Verified: data ~> $map(function($v) { $v.value }) ~> $sum()
extractPaths('data ~> $map(function($v) { $v.value }) ~> $sum()')
// => [
//   { path: "data", confidence: "static" },
//   { path: "data.value", confidence: "static" },
// ]
```

#### TRFM-03: Array Dot-Notation Mapping
```typescript
// Verified: orders.items.price
extractPaths('orders.items.price')
// => [{ path: "orders.items.price", confidence: "static" }]

// Verified: orders.items[active].price (with filter)
extractPaths('orders.items[active].price')
// => [
//   { path: "orders.items.price", confidence: "static" },
//   { path: "orders.items.active", confidence: "static" },
// ]
```

#### TRFM-04: String Concatenation
```typescript
// Verified: firstName & " " & lastName
extractPaths('firstName & " " & lastName')
// => [
//   { path: "firstName", confidence: "static" },
//   { path: "lastName", confidence: "static" },
// ]

// Verified: address.city & ", " & address.state & " " & address.zip
extractPaths('address.city & ", " & address.state & " " & address.zip')
// => [
//   { path: "address.city", confidence: "static" },
//   { path: "address.state", confidence: "static" },
//   { path: "address.zip", confidence: "static" },
// ]
```

#### TRFM-04: $join with Array Constructor
```typescript
// Verified: $join([firstName, " ", lastName])
extractPaths('$join([firstName, " ", lastName])')
// => [
//   { path: "firstName", confidence: "static" },
//   { path: "lastName", confidence: "static" },
// ]
```

#### TRFM-04: Map with String Concat in Lambda
```typescript
// Verified: $map(contacts, function($c) { $c.first & " " & $c.last })
extractPaths('$map(contacts, function($c) { $c.first & " " & $c.last })')
// => [
//   { path: "contacts", confidence: "static" },
//   { path: "contacts.first", confidence: "static" },
//   { path: "contacts.last", confidence: "static" },
// ]
```

#### TRFM-05: Simple Variable Binding Chain
```typescript
// Verified: ($base := account; $name := $base.firstName & " " & $base.lastName; ...)
extractPaths('($base := account; $name := $base.firstName & " " & $base.lastName; {"display": $name, "dept": $base.department.name, "id": $base.id})')
// => [
//   { path: "account", confidence: "static" },
//   { path: "account.firstName", confidence: "static" },
//   { path: "account.lastName", confidence: "static" },
//   { path: "account.department.name", confidence: "static" },
//   { path: "account.id", confidence: "static" },
// ]
```

#### TRFM-05: Multi-Hop via $map then $sum
```typescript
// Verified: ($raw := source.data; $mapped := $map($raw, fn{value}); $sum($mapped))
extractPaths('($raw := source.data; $mapped := $map($raw, function($v) { $v.value }); $sum($mapped))')
// => [
//   { path: "source.data", confidence: "static" },
//   { path: "source.data.value", confidence: "static" },
// ]
```

### Known Buggy Expression Patterns (use it.skip)

#### Bug A: Filter Predicate Leaking into HOF Element Bindings
```typescript
// $map(items[active], function($v) { $v.name })
// ACTUAL (buggy): items, items.active, items.name, items.active.name
// EXPECTED (correct): items, items.active, items.name
// The spurious "items.active.name" comes from $v binding to both "items" AND "items.active"
```

#### Bug B: Variable-Resolved Sort Paths Lost
```typescript
// ($x := items; $x^(price))
// ACTUAL (buggy): items (missing items.price)
// EXPECTED (correct): items, items.price
// Direct items^(price) works correctly
```

#### Bug C: Chained ~> HOF Predicate Inheritance
```typescript
// items ~> $filter(function($v) { $v.active }) ~> $map(function($v) { $v.name })
// ACTUAL (buggy): items, items.active, items.name, items.active.name
// EXPECTED (correct): items, items.active, items.name
```

#### Bug D: Inline Lambda with Apply
```typescript
// data ~> function($d) { $d.count }
// ACTUAL (buggy): data (missing data.count)
// EXPECTED (correct): data, data.count
// Workaround: ($fn := function($x) { $x.count }; data ~> $fn()) -- works correctly
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct `expect(extractPaths(...))` | `assertFixture()` with typed fixtures | Phase 8 (v1.1) | Standardized assertion, better error messages |
| Ad-hoc test structure | Requirement-ID nested describes | Phase 8 (v1.1) | Traceability to requirements |
| Guessing expected paths | Pre-check with `extractPaths()` | Phase 9 CONTEXT.md decision | Prevents false test failures |

**Current analyzer limitations (documented for v1.2):**
- Filter predicate paths leak into HOF element bindings (Bug A)
- Variable-resolved sort paths are lost (Bug B)
- Chained `~>` HOF predicate inheritance (Bug C)
- Inline lambda with apply loses parameter binding (Bug D)

## Open Questions

1. **How many fixtures per TRFM requirement?**
   - What we know: CONTEXT.md says "mix strategy: focused single-pattern fixture first per requirement, then a realistic composite"
   - What's unclear: Exact count depends on how many clean (non-buggy) patterns exist per requirement
   - Recommendation: TRFM-03 and TRFM-04 can have 3-5 passing fixtures each (no bugs). TRFM-01, TRFM-02, TRFM-05 will need a mix of passing fixtures (using patterns that avoid bugs) and `it.skip` fixtures (documenting bugs). Suggest 3-4 passing + 1-2 skipped per buggy requirement.

2. **Should composite fixtures cross TRFM requirements?**
   - What we know: CONTEXT.md leaves this to Claude's discretion
   - Recommendation: Include at least one composite that crosses requirements (e.g., TRFM-03 dot-notation + TRFM-04 string formatting in a single expression). Keep it to patterns that work correctly.

3. **Tracking comment format for it.skip?**
   - What we know: Must be consistent across all skipped tests per CONTEXT.md
   - Recommendation: Use `// BUG(v1.2): <brief description>` as the prefix on the line before `it.skip`. This is grep-able and clearly marks scope.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | vitest.config.ts (inferred from package.json scripts) |
| Quick run command | `npx vitest run test/integration/data-transforms.test.ts` |
| Full suite command | `npx vitest run test/integration/` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRFM-01 | Pipeline chains (filter/sort/map/reshape) | integration | `npx vitest run test/integration/data-transforms.test.ts` | Partial (smoke only) |
| TRFM-02 | Chained ~> apply with lambda threading | integration | `npx vitest run test/integration/data-transforms.test.ts` | Partial (smoke only) |
| TRFM-03 | Array dot-notation mapping | integration | `npx vitest run test/integration/data-transforms.test.ts` | Partial (smoke only) |
| TRFM-04 | String concatenation/formatting | integration | `npx vitest run test/integration/data-transforms.test.ts` | Partial (smoke only) |
| TRFM-05 | Multi-stage transforms with variable bindings | integration | `npx vitest run test/integration/data-transforms.test.ts` | Partial (smoke only) |

### Sampling Rate
- **Per task commit:** `npx vitest run test/integration/data-transforms.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green (excluding `it.skip` tests) before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. The file `data-transforms.test.ts` exists with working smoke test and imports. Only fixture content needs to be added.

## Sources

### Primary (HIGH confidence)
- Direct analyzer output via `extractPaths()` -- all expression patterns were tested live against the built `dist/index.js`
- Source code inspection: `src/walker.ts`, `src/index.ts`, `src/scope.ts`, `src/builtins.ts`, `src/types.ts`
- Existing test patterns: `test/extract-paths.test.ts` (212 lines of unit tests), `test/integration/helpers.ts`
- Phase 8 infrastructure: `test/integration/data-transforms.test.ts` (current state), `test/integration/helpers.ts`

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions and constraints from `/gsd:discuss-phase` session
- REQUIREMENTS.md for TRFM-01 through TRFM-05 definitions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries needed, all infrastructure in place from Phase 8
- Architecture: HIGH -- pattern is established by existing unit tests and Phase 8 integration test shell
- Pitfalls: HIGH -- all four bugs verified by running expressions through the live analyzer, root causes traced in source code
- Test patterns: HIGH -- expression behavior verified with actual `extractPaths()` output

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- no upstream dependencies changing)
