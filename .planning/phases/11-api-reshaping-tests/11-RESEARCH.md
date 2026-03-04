# Phase 11: API Reshaping Tests - Research

**Researched:** 2026-03-04
**Domain:** Integration testing -- API reshaping pattern path extraction
**Confidence:** HIGH

## Summary

Phase 11 adds integration tests to `test/integration/api-reshaping.test.ts` validating path extraction from five API reshaping patterns: nested payload extraction with flattening (APIR-01), mixed-source object construction (APIR-02), deep path traversal with array flattening (APIR-03), context variable binding with cross-reference (APIR-04), and parent operator in nested mapped contexts (APIR-05). The existing skeleton file has an empty "API Reshaping" describe block. Phase 9/10 test files provide the exact structural template.

Pre-check testing of all five APIR pattern families against the live `extractPaths()` analyzer reveals a clear split: APIR-01, APIR-02, and APIR-03 work correctly with no bugs. APIR-04 has two known bugs -- focus variable double-prefixing (`orders@$o[$o.total > 100]` produces `orders.orders.total` instead of `orders.total`) and the filter predicate path leak from Phase 9/10 (variable-resolved paths get spuriously context-prefixed inside filter predicates). APIR-05 has one bug and one working pattern: parent operator in flat paths works correctly (`orders.items.%.date` produces `orders.items.%.date` with `partial` confidence), but parent operator inside object constructor steps (`.{}`) and block steps (`.()`), which are the idiomatic JSONata usage, fails because `walkPath` does not walk value expressions inside unary/block path steps.

**Primary recommendation:** Follow Phase 9/10's exact structural pattern. APIR-01/02/03 should have 100% passing fixtures. APIR-04 should mix passing fixtures (variable binding without filter cross-reference) and `it.skip` fixtures (focus variable and filter cross-reference bugs). APIR-05 should have passing fixtures for flat parent paths and `it.skip` fixtures for object-constructor-step and block-step parent contexts. Composite fixture should combine only bug-free patterns from APIR-01/02/03.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Carry forward Phase 9/10 mix strategy: focused single-pattern fixture first per requirement, then a realistic composite fixture combining patterns
- Claude decides fixture count per requirement based on complexity
- Each APIR requirement gets its own nested `describe('APIR-XX: ...', () => { ... })` block inside the top-level "API Reshaping" describe
- Pre-check expressions during planning by running them through `extractPaths()` to discover bugs upfront
- Exact match (`expectedPaths`) for ALL fixtures -- no subset matching
- Confidence level always explicit in every PathResult
- Assert what the analyzer actually produces -- run expressions first during planning, observe output, then codify as expected result
- When a test expression reveals wrong/missing paths: use `it.skip('name', () => { ... })` with `BUG(v1.2):` tracking comment
- v1.1 is testing-only -- document bugs for v1.2, don't fix them
- Skipped fixtures show CORRECT expected output (what fix should produce), not buggy actual
- Multi-line template literals for complex expressions; single-line strings for simple ones
- Fixture names combine pattern and behavior: `'nested API extraction with flattening: extracts all leaf paths from source'`
- Realistic variable names: `$user`, `$response`, `$payload` (not `$a`, `$b`)
- No inline JSONata comments

### Claude's Discretion
- Exact number of fixtures per APIR requirement
- Nesting depth of test payloads (2-level vs 4-5 level realistic API responses)
- Which JSONata expressions best represent each API reshaping pattern
- How aggressively to test parent operator (%) edge cases for APIR-05
- Whether composite fixture combines all 5 APIR patterns or a realistic subset (prefer combining only bug-free patterns)
- Context variable binding patterns for APIR-04 (@$v variations)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| APIR-01 | Path extraction from nested API payload extraction + flattening into new objects | Object constructor (`walkUnary` for `{`) walks value expressions correctly. Nested paths through 4-5 levels resolve. Variable-bound extraction (`$resp := response.data; {... $resp.user.name ...}`) works with full path resolution. All tested expressions produce correct output. No bugs found. |
| APIR-02 | Path extraction from nested object output with mixed sources (multiple root paths) | Object constructor correctly extracts value paths from multiple independent roots. Both direct paths (`account.name`) and variable-resolved paths (`$acct.name` where `$acct := account`) produce distinct root paths. Numeric index (`orders[0].id`) correctly strips to `orders.id`. No bugs found. |
| APIR-03 | Path extraction from deep path traversal with array flattening | Deep dot-notation paths (5-6 levels like `api.response.data.records.fields.value`) produce single correct path. Intermediate filters add predicate paths. `$map` over deep paths resolves both base array and lambda body paths. No bugs found. |
| APIR-04 | Path extraction from context variable binding with cross-reference (`@$v` pattern) | Two distinct bugs found. BUG 1 (focus variable double-prefix): `@$v` binds the focus variable to the context prefix paths, but when `$v.field` is resolved inside the filter predicate, the resolved paths already contain the prefix, and then `prefixPaths` re-applies it (e.g., `orders@$o[$o.total > 100]` yields `orders.orders.total`). BUG 2 (filter predicate path leak): Same bug from Phase 9/10 -- variable-resolved absolute paths inside filter predicates get spuriously context-prefixed. Clean patterns: variable binding used in object construction without filter cross-reference. |
| APIR-05 | Path extraction from parent operator `%` in nested mapped contexts | Parent operator in flat paths works correctly: `orders.items.%.orderRef` produces `orders.items.%.orderRef` with `partial` confidence. Two-level parent works: `a.b.c.%.%.x` produces `a.b.c.%.%.x`. BUG: Object constructor as path step (`.{}` syntax) and block as path step (`.()`  syntax) do not walk inner value expressions -- `walkPath` only handles `name` and `sort` steps, so the entire object/block content is silently dropped. This means the idiomatic JSONata parent usage (`items.{"n": name, "d": %.date}`) loses all inner paths. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test runner | Already configured, used by Phase 8/9/10 |
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
  api-reshaping.test.ts   # <-- THIS FILE (skeleton exists with empty describe block)
  helpers.ts               # assertFixture, IntegrationFixture, sortPaths
  helpers.test.ts          # Tests for helpers
  data-transforms.test.ts  # Phase 9 reference template
  business-rules.test.ts   # Phase 10 reference template
```

### Pattern 1: Describe-per-Requirement with Fixture Array
**What:** Each APIR requirement gets a nested `describe` block containing a typed `fixtures` array iterated with `for-of`.
**When to use:** Every requirement block.
**Example:**
```typescript
// Source: test/integration/business-rules.test.ts (Phase 10 template)
describe("APIR-XX: Description of requirement", () => {
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
**What:** A final `describe("Composite: ...")` block combining multiple APIR patterns in a single realistic expression.
**When to use:** After all individual APIR blocks, to test pattern interaction.
**Constraint:** Combine only bug-free patterns (APIR-01/02/03) to avoid known bug exposure.
**Example:**
```typescript
// Source: test/integration/business-rules.test.ts lines 238-259
describe("Composite: cross-pattern API reshaping", () => {
  const fixtures: IntegrationFixture[] = [
    {
      name: "combined patterns: resolves all paths across APIR-XX/YY/ZZ",
      expression: `complex multi-pattern expression`,
      expectedPaths: [ /* ... */ ],
    },
  ];
  // ...
});
```

### Anti-Patterns to Avoid
- **Subset matching:** CONTEXT.md mandates exact match (`expectedPaths`) for ALL fixtures. Never use `mustContain`/`mustNotContain`.
- **Generic variable names:** Use `$response`, `$payload`, `$user` -- not `$a`, `$b`, `$x`.
- **Asserting buggy output:** Skipped fixtures must show CORRECT expected output, not what the buggy analyzer currently produces.
- **Inline JSONata comments:** CONTEXT.md explicitly prohibits these.
- **`@$v` inside brackets:** The focus variable syntax is `array@$var[predicate]`, not `array[@$var.field = value]`. The `@` goes on the array name, not inside the filter brackets.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path comparison | Custom sort + equality | `assertFixture()` | Handles sorting, error messages, both match modes |
| Expression parsing | Manual AST inspection | `extractPaths()` | The API under test -- don't bypass it |
| Test infrastructure | New helpers or utilities | Existing helpers.ts | Phase 8 built everything needed |

**Key insight:** This phase is ONLY about writing fixtures. All infrastructure exists. Zero helper code needed.

## Common Pitfalls

### Pitfall 1: Focus Variable Double-Prefix Bug (APIR-04)
**What goes wrong:** When `@$v` is used to bind a focus variable (e.g., `orders@$o[$o.total > 100]`), the focus variable `$o` is bound to `["orders"]` by `walkFilterStages`. When `$o.total` is resolved inside the filter predicate, `resolveVariable` returns `["orders"]`, so the path becomes `orders.total`. But then `prefixPaths` applies the context prefix `orders` again, producing `orders.orders.total`.
**Why it happens:** The focus variable binding in `walkFilterStages` binds `focus` to `contextPrefix ? [contextPrefix] : []`. The resolved variable paths are already absolute (context-prefixed), but `prefixPaths` still prepends the filter context.
**How to avoid:** For passing tests, do not use `@$v` focus variable syntax. Use `it.skip` for any focus variable cross-reference patterns.
**Verified example:**
```
Expression: orders@$o[$o.total > 100].id
Expected:   [orders.id, orders.total]
Actual:     [orders.id, orders.orders.total]  <-- double-prefix
```

### Pitfall 2: Variable-Resolved Paths in Filter Predicates (APIR-04, same as Phase 9/10)
**What goes wrong:** When a variable's resolved paths appear inside a filter predicate, they get spuriously context-prefixed with the filter's base path.
**Why it happens:** `walkFilterStages` calls `prefixPaths` on all sub-expression paths, including resolved variable paths that already have their correct absolute path.
**How to avoid:** For passing tests, avoid using variables inside filter predicates. For expressions that need this pattern, use `it.skip` with `BUG(v1.2):`.
**Verified example:**
```
Expression: ($cfg := config; items[$cfg.minPrice < price].name)
Expected:   [config, items.name, items.price]
Actual:     [config, items.name, items.config.minPrice, items.price]  <-- spurious
```

### Pitfall 3: Object Constructor / Block as Path Step (APIR-05)
**What goes wrong:** When an object constructor `{...}` or block `(...)` appears as a step within a PathNode (e.g., `items.{...}` or `items.(...)`), the inner value expressions are NOT walked. Only the preceding path steps contribute to extracted paths.
**Why it happens:** `walkPath` iterates steps and only handles `name` (for filter stages) and `sort` steps. The `unary` step type (object constructor) and `block` step type are silently skipped.
**How to avoid:** Use flat parent paths (`items.%.field`) which DO work correctly for passing tests. Use `it.skip` for the idiomatic `.{key: val}` and `.(expr)` parent patterns.
**Verified example:**
```
Expression: orders.items.{"n": name, "d": %.date}
Expected:   [orders.items, orders.items.name, orders.items.%.date (partial)]
Actual:     [orders.items]  <-- all inner values lost
```

### Pitfall 4: Parent Operator Requires Multi-Step Path Context
**What goes wrong:** The parent operator `%` can only be used within a multi-step path or filter context. Standalone `%` or `%.field` are JSONata parse errors (S0217).
**Why it happens:** JSONata's parser requires a tuple/ancestor context to resolve the parent reference. The parent must have a preceding path that establishes the tuple context.
**How to avoid:** Always use parent operator within a longer path: `items.%.name`, `a.b.c.%.x`. Never attempt standalone `%`.

### Pitfall 5: Confidence Levels for Parent Paths
**What goes wrong:** Forgetting that paths containing `%` as a whole dot-separated segment get `partial` confidence, not `static`.
**Why it happens:** `deriveConfidence` in `src/index.ts` checks for `%` as a segment: `segments.includes("%")`.
**How to avoid:** Any fixture with parent operator paths must use `confidence: "partial"` for those paths.
**Verified example:**
```
Expression: orders.items.%.orderRef
Result:     [{ path: "orders.items.%.orderRef", confidence: "partial" }]
```

## Code Examples

Verified patterns from live `extractPaths()` testing:

### APIR-01: Direct Nested Extraction (Flattening)
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "nested API payload extraction: extracts all leaf paths from deep source structure",
  expression: `{"name": response.data.user.name, "email": response.data.user.contact.email, "zip": response.data.user.address.zip}`,
  expectedPaths: [
    { path: "response.data.user.address.zip", confidence: "static" },
    { path: "response.data.user.contact.email", confidence: "static" },
    { path: "response.data.user.name", confidence: "static" },
  ],
}
```

### APIR-01: Variable-Bound Nested Extraction
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "variable-bound API extraction: resolves variable through nested source paths",
  expression: `($user := response.data.user; {"fullName": $user.profile.firstName & " " & $user.profile.lastName, "email": $user.contact.email})`,
  expectedPaths: [
    { path: "response.data.user", confidence: "static" },
    { path: "response.data.user.contact.email", confidence: "static" },
    { path: "response.data.user.profile.firstName", confidence: "static" },
    { path: "response.data.user.profile.lastName", confidence: "static" },
  ],
}
```

### APIR-01: Map Over Nested Records
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "map over nested API records: extracts base array and deep leaf paths from lambda",
  expression: `$map(response.data.records, function($r) { {"id": $r.id, "value": $r.attributes.metadata.value} })`,
  expectedPaths: [
    { path: "response.data.records", confidence: "static" },
    { path: "response.data.records.attributes.metadata.value", confidence: "static" },
    { path: "response.data.records.id", confidence: "static" },
  ],
}
```

### APIR-02: Multiple Independent Root Sources
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "mixed source object: extracts paths under each distinct root",
  expression: `{"userName": account.profile.name, "orderCount": $count(orders), "balance": billing.currentBalance}`,
  expectedPaths: [
    { path: "account.profile.name", confidence: "static" },
    { path: "billing.currentBalance", confidence: "static" },
    { path: "orders", confidence: "static" },
  ],
}
```

### APIR-02: Multi-Variable Mixed Sources
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "multi-variable mixed sources: resolves variables from independent roots into single output",
  expression: `($acct := account; $ship := shipping; {"name": $acct.name, "addr": $ship.address.city, "trackingId": $ship.tracking.id})`,
  expectedPaths: [
    { path: "account", confidence: "static" },
    { path: "account.name", confidence: "static" },
    { path: "shipping", confidence: "static" },
    { path: "shipping.address.city", confidence: "static" },
    { path: "shipping.tracking.id", confidence: "static" },
  ],
}
```

### APIR-02: Array Index with Mixed Roots
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "array index with mixed roots: extracts paths from multiple roots with index access",
  expression: `{"user": account.name, "order": orders[0].id, "total": billing.amount}`,
  expectedPaths: [
    { path: "account.name", confidence: "static" },
    { path: "billing.amount", confidence: "static" },
    { path: "orders.id", confidence: "static" },
  ],
}
```

### APIR-03: Deep Dot-Notation Traversal
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "deep path traversal: extracts single leaf path through 6-level nesting",
  expression: `api.response.data.records.fields.value`,
  expectedPaths: [
    { path: "api.response.data.records.fields.value", confidence: "static" },
  ],
}
```

### APIR-03: Deep Traversal with Intermediate Filter
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "deep traversal with filter: extracts leaf path and filter predicate through nested arrays",
  expression: `response.data.items[active].attributes.dimensions.height`,
  expectedPaths: [
    { path: "response.data.items.active", confidence: "static" },
    { path: "response.data.items.attributes.dimensions.height", confidence: "static" },
  ],
}
```

### APIR-03: Deep Traversal with Map Flattening
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "map over deep nested structure: extracts base array and deep leaf path from lambda",
  expression: `$map(response.data.items, function($item) { $item.nested.deep.leaf })`,
  expectedPaths: [
    { path: "response.data.items", confidence: "static" },
    { path: "response.data.items.nested.deep.leaf", confidence: "static" },
  ],
}
```

### APIR-04: Variable Binding Without Filter Cross-Reference (Clean)
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "variable-bound API payload: resolves variable through nested API response paths",
  expression: `($payload := event.data; {"type": $payload.eventType, "userId": $payload.actor.id, "target": $payload.resource.name})`,
  expectedPaths: [
    { path: "event.data", confidence: "static" },
    { path: "event.data.actor.id", confidence: "static" },
    { path: "event.data.eventType", confidence: "static" },
    { path: "event.data.resource.name", confidence: "static" },
  ],
}
```

### APIR-04: Variable Cross-Reference in Arithmetic (Clean)
```typescript
// Verified: 2026-03-04 via extractPaths()
// Variable resolved OUTSIDE a filter predicate works correctly
{
  name: "variable cross-reference in calculation: resolves bound variable in arithmetic context",
  expression: `($config := settings; order.amount * $config.taxRate)`,
  expectedPaths: [
    { path: "order.amount", confidence: "static" },
    { path: "settings", confidence: "static" },
    { path: "settings.taxRate", confidence: "static" },
  ],
}
```

### APIR-04: Focus Variable Double-Prefix (SKIP)
```typescript
// BUG(v1.2): focus variable @$o double-prefixes -- $o resolves to ["orders"],
// then filter context re-prefixes with "orders", yielding "orders.orders.total"
it.skip("focus variable cross-reference: extracts focus-resolved paths without double prefix", () => {
  assertFixture({
    name: "focus variable cross-reference: extracts focus-resolved paths without double prefix",
    expression: `orders@$o[$o.total > 100].id`,
    expectedPaths: [
      { path: "orders.id", confidence: "static" },
      { path: "orders.total", confidence: "static" },
    ],
  });
});
```

### APIR-04: Variable in Filter Predicate (SKIP)
```typescript
// BUG(v1.2): variable-resolved paths in filter predicates get spuriously context-prefixed
it.skip("variable cross-reference in filter: extracts variable source and filter paths without spurious prefixing", () => {
  assertFixture({
    name: "variable cross-reference in filter: extracts variable source and filter paths without spurious prefixing",
    expression: `($cfg := config; items[$cfg.minPrice < price].name)`,
    expectedPaths: [
      { path: "config", confidence: "static" },
      { path: "items.name", confidence: "static" },
      { path: "items.price", confidence: "static" },
    ],
  });
});
```

### APIR-05: Parent in Flat Path (Working)
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "parent operator in flat path: produces partial-confidence path with % segment",
  expression: `orders.items.%.orderRef`,
  expectedPaths: [
    { path: "orders.items.%.orderRef", confidence: "partial" },
  ],
}
```

### APIR-05: Two-Level Parent (Working)
```typescript
// Verified: 2026-03-04 via extractPaths()
{
  name: "two-level parent operator: produces path with double % segments",
  expression: `company.departments.employees.%.%.companyName`,
  expectedPaths: [
    { path: "company.departments.employees.%.%.companyName", confidence: "partial" },
  ],
}
```

### APIR-05: Parent in Object Constructor Step (SKIP)
```typescript
// BUG(v1.2): walkPath does not walk value expressions inside unary (object constructor)
// path steps -- all inner paths including parent references are silently dropped
it.skip("parent in object constructor: extracts both local and parent-scoped paths", () => {
  assertFixture({
    name: "parent in object constructor: extracts both local and parent-scoped paths",
    expression: `orders.items.{"itemName": name, "orderDate": %.date}`,
    expectedPaths: [
      { path: "orders.items", confidence: "static" },
      { path: "orders.items.%.date", confidence: "partial" },
      { path: "orders.items.name", confidence: "static" },
    ],
  });
});
```

## Analyzer Behavior Reference

### How Object Constructors Work (APIR-01/02)
`walkUnary` for `{` walks VALUE expressions only (not key expressions, which are string literals). Each `[keyExpr, valExpr]` pair has only `valExpr` walked via `walkNode`. This means paths in object values are correctly extracted when the object constructor is at the TOP level or inside a block/lambda body. The bug only affects object constructors appearing as PATH STEPS (`.{}`).

### How Deep Paths Work (APIR-03)
`walkPath` builds a base path string from all name/wildcard/descendant/parent steps via `buildPathString`. A path like `a.b.c.d.e.f` produces a single string `"a.b.c.d.e.f"`. Filter stages on intermediate name steps (e.g., `items[active]`) are separately walked by `walkFilterStages` and context-prefixed.

### How Focus Variables Work (APIR-04)
JSONata's `@$v` syntax binds a "focus variable" on an array name step. In the AST, the `NameNode` gets a `focus: "v"` property (without `$` prefix). In `walkFilterStages`, when `focus` is present, a child scope is created with the focus variable bound to `contextPrefix ? [contextPrefix] : []`. The bug is that these resolved paths are then re-prefixed by `prefixPaths`.

### How Parent Operator Works (APIR-05)
The parent operator `%` produces a `ParentNode` in the AST with a `slot` property containing `{label, level, index}`. In `walkNode`, `case "parent"` returns `["%"]`. In `buildPathString`, `case "parent"` pushes `"%"`. In `deriveConfidence`, paths containing `%` as a whole segment get `"partial"` confidence. The parent operator works correctly when it appears as a step in a PathNode that is directly built by `buildPathString`. It fails when nested inside object constructors or blocks that are themselves path steps.

### Variable Resolution Mechanics (APIR-04)
`walkBlock` processes bind nodes sequentially. Each `$var := expr` stores the RHS paths in scope. `resolveVariable` walks up the scope chain. When a variable is used inside a filter predicate, its resolved paths are treated as sub-expression paths and get context-prefixed, which is incorrect for absolute paths.

## Known Bugs Affecting This Phase

| Bug | Pattern | Impact | Workaround |
|-----|---------|--------|------------|
| Focus variable double-prefix | `array@$v[$v.field = val]` | `$v.field` resolves to `array.field`, then filter re-prefixes to `array.array.field` | Use regular filters without `@$v`; `it.skip` for focus patterns |
| Filter predicate path leak | Variable resolved inside filter predicate | Spurious context-prefixed paths (e.g., `items.config.min` when `$cfg` resolves to `config`) | Same as Phase 9/10; `it.skip` for variable-in-filter patterns |
| Object constructor path step | `.{key: val}` as path step | All inner value expressions (including parent refs) silently dropped | Use flat parent paths; `it.skip` for `.{}` patterns |
| Block path step | `.(expr)` as path step | All inner expressions silently dropped | Same root cause as object constructor step; `it.skip` |

## Fixture Count Recommendation

Based on pattern complexity and available clean (non-buggy) expressions:

| Requirement | Recommended Fixtures | Passing | Skipped | Rationale |
|-------------|---------------------|---------|---------|-----------|
| APIR-01 | 3-4 | 3-4 | 0 | Direct extraction, variable-bound extraction, map-over-records; all clean |
| APIR-02 | 3 | 3 | 0 | Multiple roots direct, variable-bound multi-root, index+mixed roots; all clean |
| APIR-03 | 3-4 | 3-4 | 0 | Deep dot-notation, deep+filter, deep+map, deep+variable; all clean |
| APIR-04 | 2-3 passing + 2-3 skipped | 2-3 | 2-3 | Clean: variable binding for object construction, variable cross-ref in arithmetic. Buggy: focus variable, variable-in-filter |
| APIR-05 | 2-3 passing + 2-3 skipped | 2-3 | 2-3 | Clean: flat parent path, two-level parent, parent at end. Buggy: parent in .{}, parent in .() |
| Composite | 1 | 1 | 0 | Combine APIR-01/02/03 patterns (bug-free only) |
| **Total** | ~16-21 | ~12-16 | ~4-6 | |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest config via package.json (no separate file) |
| Quick run command | `npx vitest run test/integration/api-reshaping.test.ts` |
| Full suite command | `npm run test:integration` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| APIR-01 | Nested API payload extraction + flattening paths | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only |
| APIR-02 | Mixed source multiple root paths | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only |
| APIR-03 | Deep path traversal with array flattening | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only |
| APIR-04 | Context variable binding with cross-reference | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only |
| APIR-05 | Parent operator in nested mapped contexts | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only |

### Sampling Rate
- **Per task commit:** `npx vitest run test/integration/api-reshaping.test.ts`
- **Per wave merge:** `npm run test:integration`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. The skeleton file exists, helpers are in place, and the test runner is configured.

## Sources

### Primary (HIGH confidence)
- `src/walker.ts` -- Direct code reading of walkPath, walkFilterStages, walkUnary, walkBlock, walkApply, walkVariable
- `src/path-builder.ts` -- buildPathString handling of parent, name, wildcard, descendant steps
- `src/scope.ts` -- Variable resolution, focus variable binding mechanics
- `src/index.ts` -- extractPaths entry point, deriveConfidence logic for % segment detection
- `src/types.ts` -- NameNode.focus, ParentNode.slot, AST structure
- `test/integration/business-rules.test.ts` -- Phase 10 reference template (structural pattern)
- `test/integration/data-transforms.test.ts` -- Phase 9 reference template
- `test/integration/helpers.ts` -- assertFixture, IntegrationFixture, sortPaths
- `test/extract-paths.test.ts` -- Unit tests for SCOPE-02 (@$v), ADV-01 (parent operator), ADV-03 (confidence)
- Live `extractPaths()` testing -- all code examples verified against running analyzer (30+ expressions tested)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions -- user-locked choices from discuss phase
- REQUIREMENTS.md -- APIR-01 through APIR-05 definitions
- STATE.md -- project history, Phase 9/10 bug conventions

### Tertiary (LOW confidence)
- None -- all findings verified via direct code execution

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- same stack as Phase 8/9/10, no new dependencies
- Architecture: HIGH -- exact template exists in business-rules.test.ts and data-transforms.test.ts
- Pitfalls: HIGH -- all bugs verified via live extractPaths() testing with actual expressions and AST inspection
- APIR-01/02/03 behavior: HIGH -- all tested expressions produce correct, expected output
- APIR-04 bugs: HIGH -- focus variable double-prefix and filter leak both reproduced and root-caused in walker.ts
- APIR-05 bugs: HIGH -- object constructor step and block step non-walking confirmed via AST inspection and live testing

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- no moving dependencies)
