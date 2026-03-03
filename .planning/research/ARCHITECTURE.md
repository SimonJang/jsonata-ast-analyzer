# Architecture Patterns: Integration Test Structure

**Domain:** Integration test organization for a JSONata AST path analyzer
**Researched:** 2026-03-03
**Focus:** Test file organization, fixture patterns, validation approaches for 50+ scenario-based tests

## Recommended Architecture

The integration test suite follows a **category-per-file, fixture-driven, dual-validation** architecture. Each test file covers a real-world scenario category, test cases are defined as typed fixture objects, and each test uses a combination of exact path assertions and inline snapshot baselines.

```
test/
  extract-paths.test.ts              (existing: 105 unit tests, DO NOT MODIFY)
  integration/
    data-transforms.integration.test.ts
    business-rules.integration.test.ts
    api-reshaping.integration.test.ts
    data-export.integration.test.ts
    edge-cases.integration.test.ts
    helpers.ts                        (shared assertion utilities)
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Fixture Objects** | Define expression + expected paths + metadata per scenario | Test runner (consumed by `describe.each` / `it.for`) |
| **Category Test Files** | One file per scenario category. Groups related fixtures into `describe` blocks. | `extractPaths()` API, assertion helpers |
| **Assertion Helpers** (`helpers.ts`) | `expectPaths()` exact match, `expectContainsPaths()` superset check, sorted comparison | Individual test cases |
| **Inline Snapshots** | Baseline recording of full output for regression detection | Vitest snapshot engine |

### Data Flow

```
Fixture Object (expression string + expected PathResult[])
        |
        v
extractPaths(fixture.expression)   <-- single public API entry point
        |
        v
PathResult[]  (actual output)
        |
        +---> Exact assertion:  expect(actual).toEqual(fixture.expected)
        |
        +---> Snapshot baseline: expect(actual).toMatchInlineSnapshot(...)
```

## Test File Organization

### Why Category-Per-File (Not One Giant File)

The existing `extract-paths.test.ts` is 848 lines with 105 tests. Adding 50+ integration tests to the same file would push it past 1,500 lines, making navigation painful. Separate files provide:

1. **Faster feedback loops** -- Vitest runs files in parallel by default. Five smaller files run faster than one large file.
2. **Clearer ownership** -- Each file maps to a requirement category from PROJECT.md.
3. **Independent snapshots** -- Snapshot updates in one category do not create noisy diffs in others.
4. **Focused test runs** -- `vitest run test/integration/business-rules` runs just one category.

### File Naming Convention

Use `.integration.test.ts` suffix to distinguish from unit tests. This enables selective running:

```bash
# Run only integration tests
vitest run test/integration/

# Run only unit tests
vitest run test/extract-paths.test.ts

# Run everything
vitest run
```

No workspace config changes needed. The existing `vitest.config.ts` already picks up any `*.test.ts` files.

### Category Mapping

| File | Scenario Category | Target Count | Source Requirement |
|------|-------------------|--------------|-------------------|
| `data-transforms.integration.test.ts` | Filter, map, reshape pipelines | 12-15 tests | "Data transformation pipeline scenarios" |
| `business-rules.integration.test.ts` | Conditionals, lookups, cross-field calc | 12-15 tests | "Business rule expression scenarios" |
| `api-reshaping.integration.test.ts` | Nested payload extraction, flattening | 10-12 tests | "API response reshaping scenarios" |
| `data-export.integration.test.ts` | Structure-to-structure conversion | 8-10 tests | "Data export/format conversion scenarios" |
| `edge-cases.integration.test.ts` | Deep variable chains, mixed contexts, complex constructors | 8-10 tests | "Deeply nested variable chains", "Mixed context", "Complex object constructors" |

## Fixture Patterns

### Fixture Type Definition

Define a typed fixture interface in `helpers.ts` to enforce consistency across all test files:

```typescript
// test/integration/helpers.ts

import type { PathResult } from "../../src/index.js";

export interface IntegrationFixture {
  /** Human-readable scenario name (becomes test title) */
  name: string;
  /** The JSONata expression under test -- may be multi-line */
  expression: string;
  /** Expected paths the analyzer should extract (exact match) */
  expectedPaths: PathResult[];
  /** Optional: paths that MUST appear (subset check, for complex outputs) */
  mustContain?: PathResult[];
  /** Optional: paths that must NOT appear (negative assertion) */
  mustNotContain?: PathResult[];
}
```

### Why Typed Fixture Objects (Not Raw Inline Data)

1. **TypeScript catches typos** -- A misspelled `confidence: "statc"` is a compile error.
2. **Self-documenting** -- The `name` field serves as both test title and documentation.
3. **Portable** -- Fixtures can be extracted to JSON files later if needed (they are plain data).
4. **Review-friendly** -- Adding a new test means adding one object to an array, not writing a full `it()` block.

### Fixture Definition Pattern

Each test file defines its fixtures as a typed array at the top, then iterates with `it.for`:

```typescript
// test/integration/data-transforms.integration.test.ts

import { describe, it, expect } from "vitest";
import { extractPaths } from "../../src/index.js";
import type { IntegrationFixture } from "./helpers.js";

const fixtures: IntegrationFixture[] = [
  {
    name: "filter then map with nested field access",
    expression: `
      $map(
        $filter(orders, function($o) { $o.status = "active" }),
        function($o) {
          {
            "id": $o.orderId,
            "total": $sum($o.items.price)
          }
        }
      )
    `,
    expectedPaths: [
      { path: "orders", confidence: "static" },
      { path: "orders.status", confidence: "static" },
      { path: "orders.orderId", confidence: "static" },
      { path: "orders.items.price", confidence: "static" },
    ],
  },
  // ... more fixtures
];

describe("Integration: Data Transformation Pipelines", () => {
  it.for(fixtures)("$name", (fixture, { expect }) => {
    const actual = extractPaths(fixture.expression);
    expect(actual).toEqual(fixture.expectedPaths);
  });
});
```

### Why `it.for` Over `it.each`

Vitest's `it.for` (introduced post-1.x) provides `TestContext` access as the second argument. This enables:

- Concurrent-safe inline snapshots (each test gets its own `expect`)
- Better TypeScript inference for object parameters (no array spreading)
- The `$name` interpolation in test titles works with object properties

If `it.for` is unavailable in the installed Vitest version, fall back to `it.each` with the object syntax:

```typescript
it.each(fixtures)("$name", (fixture) => {
  const actual = extractPaths(fixture.expression);
  expect(actual).toEqual(fixture.expectedPaths);
});
```

### Multi-Line Expression Formatting

Integration test expressions are multi-line by nature. Use template literals with consistent indentation:

```typescript
expression: `
  (
    $data := account.orders;
    $active := $filter($data, function($o) { $o.active });
    $active.items.price
  )
`,
```

The JSONata parser ignores whitespace, so formatting has zero impact on behavior. Readable expressions are more maintainable than compressed one-liners.

## Validation Approaches

### Dual Validation Strategy

Each integration test should use **both** exact assertions and inline snapshots:

| Approach | Purpose | When It Catches Bugs |
|----------|---------|---------------------|
| **Exact assertion** (`toEqual`) | Validates specific expected paths | When a code change drops or adds a path |
| **Inline snapshot** (`toMatchInlineSnapshot`) | Baseline of full sorted output | When output format changes, ordering shifts, or confidence annotations change |

### Pattern 1: Exact Path Match (Primary)

For tests where the expected output is known and stable:

```typescript
expect(actual).toEqual(fixture.expectedPaths);
```

Use sorted comparison when order does not matter:

```typescript
// helpers.ts
export function sortPaths(paths: PathResult[]): PathResult[] {
  return [...paths].sort((a, b) => a.path.localeCompare(b.path));
}

// In test:
expect(sortPaths(actual)).toEqual(sortPaths(fixture.expectedPaths));
```

### Pattern 2: Subset Match (For Complex Outputs)

When the expression is so complex that enumerating every path is fragile, assert on the important subset:

```typescript
if (fixture.mustContain) {
  for (const expected of fixture.mustContain) {
    expect(actual).toContainEqual(expected);
  }
}
if (fixture.mustNotContain) {
  for (const notExpected of fixture.mustNotContain) {
    expect(actual).not.toContainEqual(notExpected);
  }
}
```

### Pattern 3: Inline Snapshot (Secondary Baseline)

Use inline snapshots as a **secondary** validation. They auto-populate on first run and serve as regression baselines:

```typescript
// On first run, Vitest fills in the snapshot:
expect(sortPaths(actual)).toMatchInlineSnapshot(`
  [
    {
      "confidence": "static",
      "path": "orders",
    },
    {
      "confidence": "static",
      "path": "orders.items.price",
    },
  ]
`);
```

**When to use inline snapshots:**
- Every test should have one, populated by `vitest -u` on first run
- Review the populated content before committing
- Snapshots complement (not replace) explicit assertions

**When NOT to use inline snapshots:**
- Do not use as the only validation. Snapshots are brittle to formatting and easy to blindly update.

### Pattern 4: Path Count Guard

For complex expressions, assert the total count as a sanity check:

```typescript
expect(actual).toHaveLength(fixture.expectedPaths.length);
```

This catches accidental duplicates or missed deduplication.

## Assertion Helper Module

```typescript
// test/integration/helpers.ts

import { expect } from "vitest";
import { extractPaths, type PathResult } from "../../src/index.js";

export interface IntegrationFixture {
  name: string;
  expression: string;
  expectedPaths: PathResult[];
  mustContain?: PathResult[];
  mustNotContain?: PathResult[];
}

/**
 * Sort PathResult[] by path for deterministic comparison.
 * The analyzer's output order depends on AST walk order,
 * which is an implementation detail, not a contract.
 */
export function sortPaths(paths: PathResult[]): PathResult[] {
  return [...paths].sort((a, b) =>
    a.path.localeCompare(b.path) || a.confidence.localeCompare(b.confidence)
  );
}

/**
 * Run extractPaths and validate against a fixture's expectations.
 * Combines exact match, subset checks, and negative assertions.
 */
export function assertFixture(fixture: IntegrationFixture): PathResult[] {
  const actual = extractPaths(fixture.expression);

  // Primary: exact match (when expectedPaths is provided)
  if (fixture.expectedPaths.length > 0) {
    expect(sortPaths(actual)).toEqual(sortPaths(fixture.expectedPaths));
  }

  // Subset: must-contain paths
  if (fixture.mustContain) {
    for (const expected of fixture.mustContain) {
      expect(actual).toContainEqual(expected);
    }
  }

  // Negative: must-not-contain paths
  if (fixture.mustNotContain) {
    for (const notExpected of fixture.mustNotContain) {
      expect(actual).not.toContainEqual(notExpected);
    }
  }

  return actual; // return for snapshot chaining
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: One Giant Test File
**What:** Putting all 50+ integration tests in `extract-paths.test.ts`
**Why bad:** 1,500+ line file, slow feedback (single-threaded within a file), noisy diffs
**Instead:** Category-per-file with 8-15 tests each

### Anti-Pattern 2: Snapshot-Only Tests
**What:** Using `toMatchInlineSnapshot()` as the sole assertion
**Why bad:** Snapshots can be blindly updated with `vitest -u`, masking regressions. Nobody reads 50-line snapshot diffs carefully.
**Instead:** Explicit `toEqual` as primary, snapshot as secondary baseline

### Anti-Pattern 3: Testing Internal AST Details
**What:** Asserting on AST node shapes, walker call counts, or scope internals
**Why bad:** Integration tests validate the public API contract (`extractPaths` input/output), not implementation details. Coupling to internals makes refactoring impossible.
**Instead:** Only assert on `PathResult[]` output from `extractPaths()`

### Anti-Pattern 4: Order-Dependent Assertions
**What:** `expect(actual).toEqual([...paths in specific order...])`
**Why bad:** Walk order is an implementation detail. Refactoring the walker could change order without changing correctness.
**Instead:** Sort both actual and expected before comparison, or use `expect.arrayContaining`

### Anti-Pattern 5: Computed Expected Values
**What:** Generating expected paths programmatically from the expression
**Why bad:** Duplicates the logic under test. If both the analyzer and the expectation generator have the same bug, the test passes.
**Instead:** Hand-written expected values derived from human understanding of the expression

## Patterns to Follow

### Pattern 1: Scenario Naming Convention
**What:** Each fixture's `name` follows: `[verb] [what] [context]`
**Example:** `"extracts paths from filter-then-map pipeline with nested objects"`

### Pattern 2: Expression Complexity Ladder
**What:** Within each category file, order fixtures from simple to complex
**Why:** When a complex test fails, simpler tests above it help isolate the cause
**Example in data-transforms:**
1. Single `$map` with field access
2. `$filter` then `$map` pipeline
3. `$filter` -> `$map` -> `$reduce` chain
4. Nested `$map` inside `$map` with variable chains
5. Full pipeline: filter, sort, map, reshape into new object

### Pattern 3: Descriptive Expression Comments
**What:** Add inline comments in the JSONata expression explaining what it does
**Why:** Reviewers unfamiliar with JSONata can understand the test intent
```typescript
expression: `
  /* Filter active orders, then extract line item totals */
  $map(
    $filter(orders, function($o) { $o.status = "active" }),
    function($o) { $sum($o.items.price) }
  )
`,
```

### Pattern 4: Regression-Driven Growth
**What:** When a bug is found in production usage, add a new integration fixture before fixing
**Why:** Ensures the bug is covered and never regresses

## Build Order Implications

The integration test files should be built in this order, because each category builds on confidence from the previous:

### Phase 1: Data Transformation Pipelines (build first)
**Rationale:** These exercises the core walker features most heavily: `$map`, `$filter`, `$reduce`, variable binding, lambda parameter resolution. If the walker has a fundamental issue, these tests surface it first. They also have the most predictable expected outputs (the path set is mechanically derivable from the expression).

### Phase 2: Business Rule Expressions (build second)
**Rationale:** Introduces conditionals, cross-field references, and computed values. Depends on Phase 1's confidence that basic higher-order function tracing works. Business rules combine features (conditionals inside lambdas, variables referencing conditional results) in ways that stress the scope chain.

### Phase 3: API Response Reshaping (build third)
**Rationale:** These involve deeply nested input structures and complex object constructors. They exercise the path-builder's ability to produce long multi-segment paths and the walker's handling of nested object literals. Depends on Phase 2's confidence with conditionals (API reshaping often includes conditional field inclusion).

### Phase 4: Data Export / Format Conversion (build fourth)
**Rationale:** Format conversion expressions tend to be the longest and most complex, often combining everything from the previous categories. They serve as end-to-end validation of the full pipeline.

### Phase 5: Edge Cases (build last)
**Rationale:** Deep variable chains (3+ hops), mixed context expressions (parent ops inside filter predicates inside maps), and complex object constructors with computed keys. These are the hardest to reason about and the most likely to uncover subtle bugs. Building them last means the test infrastructure and helper patterns are already battle-tested.

## Scalability Considerations

| Concern | At 50 tests | At 200 tests | At 1000+ tests |
|---------|-------------|--------------|----------------|
| **File organization** | 5 category files | Subcategories within directories | Sharded by complexity tier |
| **Test runtime** | <2s total | <5s with parallelism | Shard with `--shard` flag |
| **Fixture readability** | Inline arrays in each file | Extract to `.fixtures.ts` co-located files | External JSON fixture files |
| **Snapshot maintenance** | Inline snapshots per test | Inline snapshots (still manageable) | File snapshots with `toMatchSnapshot()` |
| **CI feedback** | Single `vitest run` | `vitest run --reporter=verbose` | Parallel CI jobs per category |

At the target of 50+ tests, inline fixtures and inline snapshots remain manageable. No external fixture files or complex infrastructure needed.

## Sources

- [Vitest Test API Reference](https://vitest.dev/api/) -- `it.each`, `it.for`, `describe.each` syntax
- [Vitest Snapshot Guide](https://vitest.dev/guide/snapshot) -- `toMatchInlineSnapshot` best practices
- [Vitest Improving Performance](https://vitest.dev/guide/improving-performance) -- file-level parallelism
- [How to separate unit and integration tests (vitest discussion #4675)](https://github.com/vitest-dev/vitest/discussions/4675) -- file naming conventions
- [Vitest Fixture System (DeepWiki)](https://deepwiki.com/vitest-dev/vitest/3.4-fixture-system) -- `test.extend()` and context fixtures
- [Vitest with async fixtures and it.for](https://macwright.com/2025/03/06/vitest-async-fixtures-and-for) -- `it.for` vs `it.each` comparison
