# Phase 10: Business Rule Tests - Research

**Researched:** 2026-03-04
**Domain:** Integration testing -- business rule pattern path extraction
**Confidence:** HIGH

## Summary

Phase 10 adds integration tests to `test/integration/business-rules.test.ts` validating path extraction from five business rule patterns: conditionals (BIZR-01), compound boolean filters (BIZR-02), aggregation over nested arrays (BIZR-03), lookup/cross-reference patterns (BIZR-04), and variable-driven object construction (BIZR-05). The existing test infrastructure from Phase 8 and structural patterns from Phase 9 (`data-transforms.test.ts`) provide a complete template.

Pre-check testing of all five BIZR pattern families against the live `extractPaths()` analyzer reveals that most patterns work correctly. The primary bugs discovered are: (1) variable-resolved paths get spuriously context-prefixed inside filter predicates (the same "filter predicate path leak" bug documented in Phase 9), which affects BIZR-04 cross-reference patterns that use variables inside filters; and (2) `$lookup(obj, key).field` path chaining loses function arguments when $lookup is a step in a PathNode (EDGE-05 tech debt). Both bugs should be documented with `it.skip` and `BUG(v1.2):` comments per project convention.

**Primary recommendation:** Follow Phase 9's exact structural pattern -- one `describe` block per BIZR requirement with a `fixtures` array iterated via `for-of`, focused single-pattern fixtures first, then a composite fixture. Use `it.skip` with `BUG(v1.2):` for any expressions that expose known analyzer bugs.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Carry forward Phase 9 mix strategy: focused single-pattern fixture first per requirement, then a realistic composite fixture combining patterns
- Claude decides fixture count per requirement based on complexity
- Each BIZR requirement gets its own nested `describe('BIZR-XX: ...', () => { ... })` block inside the top-level "Business Rules" describe
- Pre-check expressions during planning by running them through `extractPaths()` to discover bugs upfront
- Exact match (`expectedPaths`) for ALL fixtures -- no subset matching
- Confidence level always explicit in every PathResult
- Assert what the analyzer actually produces -- run expressions first during planning, observe output, then codify as expected result
- When a test expression reveals wrong/missing paths: use `it.skip('name', () => { ... })` with `BUG(v1.2):` tracking comment
- v1.1 is testing-only -- document bugs for v1.2, don't fix them
- Skipped fixtures show CORRECT expected output (what fix should produce), not buggy actual
- Multi-line template literals for complex expressions; single-line strings for simple ones
- Fixture names combine pattern and behavior: `'nested ternary with field access: extracts all branch paths'`
- Realistic variable names: `$order`, `$customer`, `$total` (not `$a`, `$b`)
- No inline JSONata comments

### Claude's Discretion
- Exact number of fixtures per BIZR requirement
- Which JSONata expressions best represent each business rule pattern
- Whether composite fixture combines all 5 BIZR patterns or a realistic subset
- What constitutes a "lookup" pattern for BIZR-04 (variable-based cross-reference, $lookup() function, array index lookup, or manual join patterns)
- Conditional form coverage for BIZR-01 (how many of ternary/elvis/coalescing get separate fixtures vs combined)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BIZR-01 | Path extraction from conditional field selection (ternary, elvis `?:`, coalescing `??`) | All three conditional forms parse to `ConditionNode` and work correctly. `walkCondition` extracts paths from condition, then-branch, and else-branch. Nested ternaries chain correctly. No bugs found. |
| BIZR-02 | Path extraction from multi-field compound filter predicates (and/or boolean) | `and`/`or` are `BinaryNode` operators inside filter predicates. `walkBinary` recursively walks both sides. All compound predicate paths correctly context-prefixed. No bugs found when predicates use only literal field references (no variables). |
| BIZR-03 | Path extraction from aggregation over nested arrays ($sum, $count, $average) | Aggregation functions ($sum, $count, $average, $min, $max) are NOT in `HIGHER_ORDER_SEMANTICS` -- they're pass-through builtins. `walkFunction` Step 3 walks all args. Nested path args (e.g., `$sum(orders.items.price)`) correctly resolve. Combined with $map lambda works. No bugs found. |
| BIZR-04 | Path extraction from lookup and cross-reference patterns | `$lookup` is a builtin (NOT in HIGHER_ORDER_SEMANTICS). Simple `$lookup(obj, key)` works -- both args produce paths. BUG: `$lookup(obj, key).field` loses args (EDGE-05 tech debt -- function step in PathNode not walked for args). BUG: Variable-resolved paths in filter predicates get spuriously context-prefixed (same Phase 9 leak bug). Clean patterns: variable-bound cross-ref without filter, direct $lookup without .field suffix. |
| BIZR-05 | Path extraction from variable-driven object construction (bind + multi-reference) | `walkBlock` correctly accumulates scope bindings. Multi-hop variable resolution works (`$a := x; $b := $a.y`). Object constructor `walkUnary` for `{` walks value expressions. Multiple references to same variable correctly deduped by `extractPaths()`. No bugs found for patterns without filter predicates. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test runner | Already configured, used by Phase 8/9 |
| extractPaths | src/index.ts | API under test | The public entry point for path extraction |
| assertFixture | test/integration/helpers.ts | Assertion helper | One-liner test assertion, calls extractPaths internally |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| IntegrationFixture | test/integration/helpers.ts | Type definition | Type for every fixture object (ExactFixture mode only) |
| sortPaths | test/integration/helpers.ts | Path sorting | Used internally by assertFixture |

### Not Needed
| Library | Why Not |
|---------|---------|
| jsonata (runtime) | Not imported in test files -- extractPaths calls parser internally |
| Any mocking library | Integration tests run against real analyzer, no mocks |

## Architecture Patterns

### File Structure
```
test/integration/
  business-rules.test.ts   # <-- THIS FILE (skeleton exists, needs content)
  helpers.ts               # assertFixture, IntegrationFixture, sortPaths
  helpers.test.ts          # Tests for helpers
  data-transforms.test.ts  # Phase 9 reference template
```

### Pattern 1: Describe-per-Requirement with Fixture Array
**What:** Each BIZR requirement gets a nested `describe` block containing a typed `fixtures` array iterated with `for-of`.
**When to use:** Every requirement block.
**Example:**
```typescript
// Source: test/integration/data-transforms.test.ts (Phase 9 template)
describe("BIZR-XX: Description of requirement", () => {
  const fixtures: IntegrationFixture[] = [
    {
      name: "pattern description: extracts expected behavior",
      expression: `jsonata expression here`,
      expectedPaths: [
        { path: "some.path", confidence: "static" },
      ],
    },
  ];

  for (const fixture of fixtures) {
    it(fixture.name, () => {
      assertFixture(fixture);
    });
  }
});
```

### Pattern 2: Bug-Tracking Skip Pattern
**What:** When an expression reveals a bug, use `it.skip` with `BUG(v1.2):` comment. The fixture shows CORRECT expected output.
**When to use:** Any expression that produces wrong/missing/spurious paths.
**Example:**
```typescript
// Source: test/integration/data-transforms.test.ts lines 52-63
// BUG(v1.2): description of the bug
it.skip("fixture name: expected correct behavior", () => {
  assertFixture({
    name: "fixture name: expected correct behavior",
    expression: `buggy expression`,
    expectedPaths: [
      // CORRECT expected output (what fix should produce)
      { path: "correct.path", confidence: "static" },
    ],
  });
});
```

### Pattern 3: Composite Cross-Pattern Fixture
**What:** A final `describe("Composite: ...")` block combining multiple BIZR patterns in a single realistic expression.
**When to use:** After all individual BIZR blocks, to test pattern interaction.
**Example:**
```typescript
// Source: test/integration/data-transforms.test.ts lines 292-310
describe("Composite: cross-pattern business rule", () => {
  const fixtures: IntegrationFixture[] = [
    {
      name: "combined patterns: resolves all paths across BIZR-XX/YY/ZZ",
      expression: `complex multi-pattern expression`,
      expectedPaths: [ /* ... */ ],
    },
  ];
  // ...
});
```

### Anti-Patterns to Avoid
- **Subset matching:** CONTEXT.md mandates exact match (`expectedPaths`) for ALL fixtures. Never use `mustContain`/`mustNotContain`.
- **Generic variable names:** Use `$order`, `$customer`, `$total` -- not `$a`, `$b`, `$x`.
- **Asserting buggy output:** Skipped fixtures must show CORRECT expected output, not what the buggy analyzer currently produces.
- **Inline JSONata comments:** CONTEXT.md explicitly prohibits these.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path comparison | Custom sort + equality | `assertFixture()` | Handles sorting, error messages, both match modes |
| Expression parsing | Manual AST inspection | `extractPaths()` | The API under test -- don't bypass it |
| Test infrastructure | New helpers or utilities | Existing helpers.ts | Phase 8 built everything needed |

**Key insight:** This phase is ONLY about writing fixtures. All infrastructure exists. Zero helper code needed.

## Common Pitfalls

### Pitfall 1: Variable-Resolved Paths in Filter Predicates
**What goes wrong:** When a variable's resolved paths appear inside a filter predicate, they get spuriously context-prefixed with the filter's base path.
**Why it happens:** `walkFilterStages` calls `prefixPaths` on all sub-expression paths, including resolved variable paths that already have their correct absolute path.
**How to avoid:** For passing tests, avoid using variables inside filter predicates. For expressions that need this pattern, use `it.skip` with `BUG(v1.2):`.
**Example of bug:**
```
Expression: ($min := minPrice; products[price >= $min].name)
Expected:   [minPrice, products.name, products.price]
Actual:     [minPrice, products.name, products.price, products.minPrice]  <-- spurious
```
**Affected BIZR patterns:** BIZR-04 (cross-reference with filter), potentially BIZR-02 (if variables used in predicates).

### Pitfall 2: $lookup Result Path Chaining (EDGE-05)
**What goes wrong:** `$lookup(obj, key).field` loses the function arguments. Only `.field` appears in results.
**Why it happens:** When a FunctionNode is a step in a PathNode, `buildPathString` skips the function step. The function's arguments are not separately walked by `walkPath`.
**How to avoid:** For BIZR-04, use `$lookup` without `.field` suffix, or bind result to variable first. Use `it.skip` for patterns that chain property access on `$lookup` result.
**Example of bug:**
```
Expression: $lookup(products, sku).price
Expected:   [products, sku, price]  (or similar -- semantics debatable)
Actual:     [price]  <-- function args lost
```

### Pitfall 3: Duplicate Path Entries with Variables
**What goes wrong:** When a variable is bound (`$x := path`) and then referenced multiple times, the binding expression produces `path` and each `$x` reference also resolves to `path`.
**Why it happens:** `walkBlock` walks the bind RHS (producing paths) AND each subsequent reference resolves the same paths.
**How to avoid:** This is not a bug -- `extractPaths()` deduplicates via `new Set(rawPaths)`. Just ensure `expectedPaths` lists each unique path only once regardless of how many times it's referenced.

### Pitfall 4: Object Constructor Key vs Value Walking
**What goes wrong:** Forgetting that `walkUnary` for `{` object constructors walks VALUE expressions only, not key expressions.
**Why it happens:** Object keys in JSONata are string literals (not path references), so they don't produce paths.
**How to avoid:** When writing fixtures for `{"key": value}` patterns, only include paths from value expressions in expectedPaths.

### Pitfall 5: $count/$sum with Filtered Arrays
**What goes wrong:** `$count(items[active])` produces `[items, items.active]` -- the base `items` path appears because the filter predicate is on a name step that already contributed `items` to the base path.
**Why it happens:** The path node `items[active]` produces both the base path `items` and the filter predicate path `items.active`. Both are passed through as function arguments.
**How to avoid:** This is correct behavior. Include BOTH the base array path and the predicate path in expectedPaths.

## Code Examples

Verified patterns from live `extractPaths()` testing:

### BIZR-01: Ternary Conditional
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "simple ternary: extracts condition and both branch paths",
  expression: `status = "active" ? order.total : order.estimate`,
  expectedPaths: [
    { path: "order.estimate", confidence: "static" },
    { path: "order.total", confidence: "static" },
    { path: "status", confidence: "static" },
  ],
}
```

### BIZR-01: Nested Ternary
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "nested ternary: extracts condition paths and all branch paths",
  expression: `type = "A" ? price.retail : type = "B" ? price.wholesale : price.default`,
  expectedPaths: [
    { path: "price.default", confidence: "static" },
    { path: "price.retail", confidence: "static" },
    { path: "price.wholesale", confidence: "static" },
    { path: "type", confidence: "static" },
  ],
}
```

### BIZR-01: Coalescing (??) Operator
```typescript
// Verified: 2026-03-04 via extractPaths()
// JSONata parser converts ?? to a ConditionNode with $exists() wrapper
{
  name: "null coalescing: extracts both fallback paths",
  expression: `nickname ?? firstName`,
  expectedPaths: [
    { path: "firstName", confidence: "static" },
    { path: "nickname", confidence: "static" },
  ],
}
```

### BIZR-01: Elvis (?:) Operator
```typescript
// Verified: 2026-03-04 via extractPaths()
// JSONata parser converts ?: to a ConditionNode with duplicated condition in then-branch
{
  name: "elvis operator: extracts source and fallback paths",
  expression: `customer.email ?: customer.phone`,
  expectedPaths: [
    { path: "customer.email", confidence: "static" },
    { path: "customer.phone", confidence: "static" },
  ],
}
```

### BIZR-02: Compound AND Filter
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "AND filter predicate: extracts all field paths from compound condition",
  expression: `orders[status = "active" and total > 100].id`,
  expectedPaths: [
    { path: "orders.id", confidence: "static" },
    { path: "orders.status", confidence: "static" },
    { path: "orders.total", confidence: "static" },
  ],
}
```

### BIZR-02: Mixed AND + OR Filter
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "AND-OR compound predicate: extracts all referenced fields",
  expression: `products[(active and inStock) or featured].title`,
  expectedPaths: [
    { path: "products.active", confidence: "static" },
    { path: "products.featured", confidence: "static" },
    { path: "products.inStock", confidence: "static" },
    { path: "products.title", confidence: "static" },
  ],
}
```

### BIZR-03: Aggregation Over Nested Path
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "sum over nested array: extracts nested path to aggregated field",
  expression: `$sum(orders.items.price)`,
  expectedPaths: [
    { path: "orders.items.price", confidence: "static" },
  ],
}
```

### BIZR-03: Aggregation with Map Lambda
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "sum with map lambda: extracts base array and all lambda body field paths",
  expression: `$sum($map(orders.items, function($v) { $v.price * $v.qty }))`,
  expectedPaths: [
    { path: "orders.items", confidence: "static" },
    { path: "orders.items.price", confidence: "static" },
    { path: "orders.items.qty", confidence: "static" },
  ],
}
```

### BIZR-04: Simple $lookup
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "direct lookup: extracts both object and key paths",
  expression: `$lookup(products, orders.productId)`,
  expectedPaths: [
    { path: "orders.productId", confidence: "static" },
    { path: "products", confidence: "static" },
  ],
}
```

### BIZR-04: Variable Cross-Reference (Clean)
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "variable cross-reference: extracts config and calculation paths",
  expression: `($config := settings; order.amount * $config.taxRate)`,
  expectedPaths: [
    { path: "order.amount", confidence: "static" },
    { path: "settings", confidence: "static" },
    { path: "settings.taxRate", confidence: "static" },
  ],
}
```

### BIZR-05: Variable-Driven Object Construction
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "variable-driven object: resolves all variable references back to source paths",
  expression: `($order := order; {"id": $order.id, "total": $order.total, "customer": $order.customer.name})`,
  expectedPaths: [
    { path: "order", confidence: "static" },
    { path: "order.customer.name", confidence: "static" },
    { path: "order.id", confidence: "static" },
    { path: "order.total", confidence: "static" },
  ],
}
```

### BIZR-05: Multi-Variable Object Construction
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "multi-variable object: resolves two-hop variable chain into object fields",
  expression: `($cust := customer; $addr := $cust.address; {"name": $cust.name, "city": $addr.city, "zip": $addr.zip})`,
  expectedPaths: [
    { path: "customer", confidence: "static" },
    { path: "customer.address", confidence: "static" },
    { path: "customer.address.city", confidence: "static" },
    { path: "customer.address.zip", confidence: "static" },
    { path: "customer.name", confidence: "static" },
  ],
}
```

## Analyzer Behavior Reference

### How Conditional Nodes Work (BIZR-01)
The `walkCondition` function extracts paths from all three branches:
- `node.condition` -- the test expression
- `node.then` -- the true branch
- `node.else` -- the false branch (if present)

JSONata's parser converts syntactic sugar:
- `a ?? b` becomes `$exists(a) ? a : b` (ConditionNode)
- `a ?: b` becomes `a ? a : b` (ConditionNode)
- Both produce correct path extraction because the analyzer walks all branches.

### How Binary Operators Work (BIZR-02)
The `walkBinary` function simply concatenates paths from `node.lhs` and `node.rhs`. For `and`/`or` operators, this recursively extracts all field references. Inside filter predicates, all extracted paths get context-prefixed with the filter's base path via `prefixPaths`.

### How Aggregation Functions Work (BIZR-03)
`$sum`, `$count`, `$average`, `$min`, `$max` are in `BUILTIN_FUNCTIONS` but NOT in `HIGHER_ORDER_SEMANTICS`. They're handled by `walkFunction` Step 3 (pass-through): all arguments are walked for paths. This means:
- `$sum(path.expression)` extracts paths from the argument
- `$sum($map(...))` works because $map IS in HIGHER_ORDER_SEMANTICS

### How $lookup Works (BIZR-04)
`$lookup` is a builtin NOT in HIGHER_ORDER_SEMANTICS. Pass-through walking extracts paths from both arguments. However, `$lookup(obj, key).field` is buggy because when $lookup is a step in a PathNode, `buildPathString` skips the function step and the function's arguments are not separately walked.

### How Variable Binding Works (BIZR-05)
`walkBlock` processes bind nodes sequentially, accumulating scope. Each `$var := expr` stores the RHS paths in scope. Later references resolve via `resolveVariable` which walks up the scope chain. Multi-hop chains work: `$a := x; $b := $a.y` resolves `$b` to `x.y`. Object constructor `{k: v}` walks only value expressions.

## Known Bugs Affecting This Phase

| Bug | Pattern | Impact | Workaround |
|-----|---------|--------|------------|
| Filter predicate path leak | Variable resolved inside filter predicate | Spurious context-prefixed paths (e.g., `items.minPrice` when `$min` resolves to `minPrice`) | Avoid variables in filter predicates for passing tests; use `it.skip` for expressions that need this |
| $lookup path step (EDGE-05) | `$lookup(obj, key).field` | Function args lost, only `.field` remains | Use $lookup without .field suffix, or bind result to variable first; use `it.skip` for chained access |
| $lookup result variable (EDGE-05 related) | `$result := $lookup(obj, key); $result.field` | Variable bound to function arg paths, not to lookup result -- produces `obj.field` and `key.field` | This is technically wrong semantics but the analyzer can't know what $lookup returns; document as known limitation |

## Fixture Count Recommendation

Based on pattern complexity and available clean (non-buggy) expressions:

| Requirement | Recommended Fixtures | Rationale |
|-------------|---------------------|-----------|
| BIZR-01 | 4-5 | Three conditional forms (ternary, `?:`, `??`) plus nested ternary and conditional-in-object; all work cleanly |
| BIZR-02 | 3-4 | AND, OR, combined AND+OR, multi-field; all work cleanly without variables |
| BIZR-03 | 3-4 | Direct aggregation, aggregation with filter, aggregation with map/lambda; all clean |
| BIZR-04 | 3-4 passing + 1-2 skipped | Simple $lookup, variable cross-ref, map-with-lookup (clean); $lookup.field chained access and variable-in-filter cross-ref (buggy, skip) |
| BIZR-05 | 3-4 | Single variable object, multi-variable object, multi-source object, variable with aggregation inside object |
| Composite | 1 | Combine clean patterns from multiple BIZR categories |
| **Total** | ~18-22 | Similar scope to Phase 9 (26 total, 21 passing + 5 skipped) |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest config via package.json (no separate file) |
| Quick run command | `npx vitest run test/integration/business-rules.test.ts` |
| Full suite command | `npm run test:integration` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BIZR-01 | Conditional field selection paths | integration | `npx vitest run test/integration/business-rules.test.ts` | Skeleton only |
| BIZR-02 | Compound boolean filter predicate paths | integration | `npx vitest run test/integration/business-rules.test.ts` | Skeleton only |
| BIZR-03 | Aggregation over nested array paths | integration | `npx vitest run test/integration/business-rules.test.ts` | Skeleton only |
| BIZR-04 | Lookup/cross-reference paths | integration | `npx vitest run test/integration/business-rules.test.ts` | Skeleton only |
| BIZR-05 | Variable-driven object construction paths | integration | `npx vitest run test/integration/business-rules.test.ts` | Skeleton only |

### Sampling Rate
- **Per task commit:** `npx vitest run test/integration/business-rules.test.ts`
- **Per wave merge:** `npm run test:integration`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. The skeleton file exists, helpers are in place, and the test runner is configured.

## Sources

### Primary (HIGH confidence)
- `src/walker.ts` -- Direct code reading of walkCondition, walkBinary, walkFunction, walkBlock, walkUnary, walkFilterStages
- `src/builtins.ts` -- BUILTIN_FUNCTIONS set and HIGHER_ORDER_SEMANTICS map
- `src/scope.ts` -- Variable resolution and binding mechanics
- `src/index.ts` -- extractPaths entry point and deduplication logic
- `test/integration/data-transforms.test.ts` -- Phase 9 reference template (structural pattern)
- `test/integration/helpers.ts` -- assertFixture, IntegrationFixture, sortPaths
- Live `extractPaths()` testing -- all code examples verified against running analyzer

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions -- user-locked choices from discuss phase
- REQUIREMENTS.md -- BIZR-01 through BIZR-05 definitions
- STATE.md -- project history, Phase 9 bug conventions

### Tertiary (LOW confidence)
- None -- all findings verified via direct code execution

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- same stack as Phase 8/9, no new dependencies
- Architecture: HIGH -- exact template exists in data-transforms.test.ts
- Pitfalls: HIGH -- all bugs verified via live extractPaths() testing with actual expressions
- JSONata operator support: HIGH -- `??` and `?:` parser behavior verified via AST inspection

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- no moving dependencies)
