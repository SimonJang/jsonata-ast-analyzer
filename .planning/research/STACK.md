# Technology Stack

**Project:** JSONata AST Path Analyzer -- v1.1 Integration Testing
**Researched:** 2026-03-03
**Scope:** Stack additions/changes for exhaustive real-world integration testing. Base stack (TypeScript 5.9, jsonata 2.1.0, Vitest 4.0, tsup 8.5) is validated and unchanged.

## Recommended Stack

### No New Dependencies Required

The existing stack handles everything needed for v1.1 integration testing. This section explains what capabilities to use and why no new packages are needed.

### Testing Framework (Existing -- Use More Features)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vitest | 4.0.18 (installed) | Test runner, snapshots, parameterized tests | Already installed. Vitest 4.0.18 is the latest release (Feb 2026). It includes `test.for()`, `toMatchInlineSnapshot()`, `toMatchSnapshot()`, `toMatchFileSnapshot()`, custom snapshot serializers, and `describe.each()` -- all the capabilities needed for 50+ integration tests with zero additional packages. | HIGH |
| @vitest/coverage-v8 | 4.0.18 (installed) | Code coverage | Already installed. V8-based coverage works out of the box. Useful for verifying integration tests exercise new code paths beyond what unit tests cover. | HIGH |

### Key Vitest APIs for Integration Testing

These are built-in Vitest features that should be leveraged heavily. They require no additional installation.

#### 1. `test.for()` -- Data-Driven Test Tables

**What:** Vitest-native parameterized test API. Superior to `test.each()` for TypeScript because it does not spread array arguments, giving better type inference.

**Why use it:** Each integration test scenario is a tuple of `(expression, expectedPaths)`. With 50+ scenarios, data-driven tables prevent boilerplate explosion. `test.for()` lets you define a typed array of test cases and run the same assertion logic over all of them.

**Example pattern for this project:**

```typescript
interface IntegrationCase {
  name: string;
  expression: string;
  expected: PathResult[];
}

const pipelineScenarios: IntegrationCase[] = [
  {
    name: "filter then map with nested access",
    expression: `Account.Order[price > 100].Product.{
      "name": Description.Title,
      "weight": Description.Weight
    }`,
    expected: [
      { path: "Account.Order.price", confidence: "static" },
      { path: "Account.Order.Product.Description.Title", confidence: "static" },
      { path: "Account.Order.Product.Description.Weight", confidence: "static" },
    ],
  },
  // ... 49 more cases
];

describe("Data transformation pipelines", () => {
  test.for(pipelineScenarios)(
    "$name",
    ({ expression, expected }) => {
      expect(extractPaths(expression)).toEqual(expected);
    }
  );
});
```

**Confidence:** HIGH -- `test.for()` is documented in Vitest 4.0 official API reference.

#### 2. `toMatchInlineSnapshot()` -- Baseline Validation

**What:** Stores the snapshot directly in the test file as a string literal. Vitest auto-updates the literal when you run `vitest -u`.

**Why use it:** For complex expressions where manually specifying every expected path is tedious or error-prone, inline snapshots let you verify the output once, then lock it in. The snapshot lives right next to the test case for easy review. This is the "snapshot-style baseline validation" mentioned in the project requirements.

**When to use vs. explicit assertions:**
- Use explicit `toEqual()` when the expected paths are the point of the test (most integration tests).
- Use `toMatchInlineSnapshot()` for complex expressions where you want to capture the full output shape and review it as a baseline, especially early in development before expected values are fully enumerated.

**Example pattern:**

```typescript
it("captures all paths from a complex reshape", () => {
  const result = extractPaths(`
    (
      $orders := Account.Order;
      $orders[price > 50].{
        "total": $sum(price * quantity),
        "items": Product.Description.Title
      }
    )
  `);
  expect(result).toMatchInlineSnapshot();
  // Vitest fills this in on first run:
  // expect(result).toMatchInlineSnapshot(`
  //   [
  //     { "path": "Account.Order", "confidence": "static" },
  //     ...
  //   ]
  // `);
});
```

**Confidence:** HIGH -- built into Vitest since v0.x, stable API.

#### 3. `toMatchSnapshot()` -- File-Based Snapshots

**What:** Stores snapshots in adjacent `__snapshots__/*.snap` files.

**Why use it sparingly:** For this project, inline snapshots are preferable because test cases are self-contained (expression in, paths out). File snapshots are useful when output is very large (20+ paths from a single expression), where inline snapshots would make test files hard to read.

**Confidence:** HIGH -- core Vitest API.

#### 4. Custom Snapshot Serializer

**What:** Controls how `PathResult[]` arrays are serialized in snapshots.

**Why use it:** The default pretty-format serializer outputs verbose `Object` wrappers. A custom serializer can produce a clean, readable format that makes snapshot diffs easy to review.

**Example:**

```typescript
// test/setup.ts or directly in test file
expect.addSnapshotSerializer({
  test(val) {
    return Array.isArray(val) && val.length > 0 && val[0]?.path !== undefined;
  },
  serialize(val: PathResult[]) {
    return val
      .map((p) => `${p.confidence === "static" ? " " : p.confidence.charAt(0).toUpperCase()} ${p.path}`)
      .join("\n");
  },
});
```

This would produce snapshots like:

```
  Account.Order.price
  Account.Order.Product.Description.Title
D Account.Order[*].computed
P some.%.parent.path
```

**Recommendation:** Consider but do not implement unless snapshot reviews become noisy. Explicit `toEqual()` assertions are clearer for most integration tests.

**Confidence:** HIGH -- Vitest custom serializer API is stable.

### Test Organization (Vitest Config Change)

| Change | Current | Proposed | Why | Confidence |
|--------|---------|----------|-----|------------|
| Vitest include pattern | Default (`**/*.test.ts`) | Keep default -- add new files in `test/integration/` | No config change needed. Vitest's default glob picks up `test/**/*.test.ts` automatically. Separate directory provides logical separation from unit tests without requiring workspace/project config overhead. | HIGH |

**Proposed test file structure:**

```
test/
  extract-paths.test.ts           # Existing 105 unit tests (unchanged)
  integration/
    pipelines.test.ts             # Data transformation pipeline scenarios
    business-rules.test.ts        # Business rule expression scenarios
    api-reshaping.test.ts         # API response reshaping scenarios
    export-conversion.test.ts     # Data export/format conversion scenarios
    edge-cases.test.ts            # Complex edge cases: deep variable chains,
                                  #   mixed contexts, complex object constructors
```

**Rationale:** Five focused integration test files (one per scenario category) rather than one monolithic file. Each file uses `test.for()` with typed test case arrays. This keeps individual files under 200 lines, makes test failures immediately locatable by category, and allows running a single category in isolation via `vitest run test/integration/pipelines.test.ts`.

**Alternative considered: Vitest Projects (workspace)** -- Overkill. Projects are for different environments (browser vs node) or different configs. Integration and unit tests here share the same config, same runner, same TypeScript setup. A subdirectory provides sufficient separation.

### Test Data Strategy (No Package Needed)

| Approach | Recommendation | Why | Confidence |
|----------|----------------|-----|------------|
| Inline test data | YES -- primary approach | JSONata expressions are short strings. The expression IS the test data. Inline keeps tests self-documenting. No external fixture files needed for expressions under 10 lines. | HIGH |
| Multi-line template literals | YES -- for complex expressions | TypeScript template literals handle multi-line JSONata cleanly. No special tooling needed. | HIGH |
| Shared fixture constants | YES -- for reusable expression fragments | Extract common sub-expressions (e.g., a standard "order" variable binding) into a `test/fixtures.ts` constants file. Import into multiple test files. | HIGH |
| External JSON fixture files | NO | Overkill. We are not testing with sample JSON data (static analysis does not evaluate). The only input is expression strings. | HIGH |
| Test data generation / fuzzing | NO | JSONata expressions cannot be meaningfully auto-generated. The value is in hand-crafted real-world patterns. Random expressions would not test real scenarios. | HIGH |
| JSONata official test suite | REFERENCE ONLY | The jsonata-js/jsonata repo has test cases organized as JSON files by feature group. These are useful as a reference for expression patterns but test evaluation, not path extraction. Do not import them as test data. | MEDIUM |

### NPM Scripts Addition

```jsonc
{
  "scripts": {
    // Existing
    "test": "vitest run",
    "test:watch": "vitest",
    // New -- optional convenience scripts
    "test:unit": "vitest run test/extract-paths.test.ts",
    "test:integration": "vitest run test/integration/",
    "test:update-snapshots": "vitest run -u"
  }
}
```

**Confidence:** HIGH -- standard Vitest CLI usage.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Test runner | Vitest 4.0 (keep) | Jest 30 | Already using Vitest. Switching would be pointless churn. Jest offers nothing Vitest lacks for this use case. |
| Snapshot tool | Vitest built-in snapshots | `jest-snapshot` standalone | Vitest includes its own snapshot engine. No need for external snapshot packages. |
| Snapshot tool | Vitest inline snapshots | `snap-shot-it` or `snap-shot-core` | Third-party snapshot libraries add complexity. Vitest's built-in `toMatchInlineSnapshot()` and `toMatchSnapshot()` cover all needs. |
| Test data | Inline expressions | External `.jsonata` fixture files | Adds file I/O complexity, makes tests harder to read, separates test intent from test data. Expressions are short strings -- keep them inline. |
| Test data | Hand-crafted scenarios | Property-based testing (fast-check) | Cannot meaningfully generate valid JSONata expressions that represent real-world patterns. Property-based testing is excellent for parsers; it is not useful for testing an analyzer against realistic scenarios. |
| Parameterized tests | `test.for()` | `test.each()` | Both work. `test.for()` has better TypeScript type inference because it does not spread array arguments. Prefer `test.for()` for new code. |
| Coverage | @vitest/coverage-v8 (keep) | @vitest/coverage-istanbul | v8 coverage is faster and already installed. Istanbul is only needed for specific edge cases (e.g., browser code). |
| Test organization | Subdirectory | Vitest workspace/projects | Workspace config is designed for multi-environment testing (browser + node). Same-environment test separation needs only a directory. |
| Test organization | Multiple files by category | Single large integration test file | A 1000+ line test file is hard to navigate. Five 150-200 line files by scenario category is more maintainable. |

## What NOT to Add

| Technology | Why Not |
|------------|---------|
| `fast-check` (property-based testing) | Cannot generate meaningful JSONata expressions. Hand-crafted real-world scenarios are the entire point of v1.1. |
| `faker` / `@faker-js/faker` | No sample data generation needed. This is static analysis of expression strings, not data processing. |
| `testcontainers` or database tools | No external services involved. Pure function testing: string in, paths out. |
| `supertest` / `msw` | No HTTP or API mocking needed. No network calls in the library. |
| `cypress` / `playwright` | No browser testing. This is a Node library. |
| `nock` | No HTTP mocking. The library has no network dependencies. |
| `sinon` / `vitest mocking` | The function under test (`extractPaths`) is a pure function. No mocking needed. Mocking the jsonata parser would defeat the purpose of integration testing. |
| `ts-mockito` | Same as above. Pure function testing requires no mocks. |
| `json-schema-faker` | No JSON schema involvement. Out of scope per PROJECT.md. |
| `snapshot-diff` | Vitest's built-in snapshot diffing is sufficient. No need for a specialized diff package. |
| Additional assertion libraries (`chai`, `should`) | Vitest's `expect` API is Jest-compatible and complete. No gaps to fill. |
| `test-data-bot` / `fishery` | Factory libraries for generating test fixtures. Not applicable -- our "fixtures" are JSONata expression strings, not complex object trees. |

## Integration Points with Existing Setup

### Zero Config Changes Required

The existing `vitest.config.ts` needs no modification:

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
  },
});
```

Vitest's default `include` pattern (`**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}`) already matches files in `test/integration/*.test.ts`. No include/exclude changes needed.

### Import Pattern

All integration tests import the same public API:

```typescript
import { extractPaths } from "../../src/index.js";
import type { PathResult } from "../../src/index.js";
```

This tests the library through its public interface, which is exactly what integration tests should do. No internal imports.

## Summary

**Net new dev dependencies: 0**
**Config changes: 0**
**New files: 5-6 test files + optional 1 fixtures file**

The v1.0 stack is fully sufficient for v1.1. The work is in writing tests, not in adding tooling. Use `test.for()` for parameterized scenario tables, `toMatchInlineSnapshot()` for baseline captures, organize by scenario category in `test/integration/`, and keep expressions inline. No external test data sources, no mocking, no new packages.

## Sources

- [Vitest Snapshot Guide](https://vitest.dev/guide/snapshot) -- `toMatchSnapshot()`, `toMatchInlineSnapshot()`, `toMatchFileSnapshot()`, custom serializers (HIGH confidence)
- [Vitest Test API Reference](https://vitest.dev/api/) -- `test.for()`, `test.each()`, `describe.each()` documentation (HIGH confidence)
- [Vitest 4.0 Announcement](https://vitest.dev/blog/vitest-4) -- confirms v4.0 as current stable, inline snapshots in test.for/each supported (HIGH confidence)
- [Vitest npm](https://www.npmjs.com/package/vitest) -- v4.0.18 latest (HIGH confidence)
- [Vitest GitHub Discussion #4675](https://github.com/vitest-dev/vitest/discussions/4675) -- separating unit and integration tests with directory structure vs workspace (HIGH confidence)
- [Vitest GitHub Discussion #5557](https://github.com/vitest-dev/vitest/discussions/5557) -- file suffix patterns for test organization (HIGH confidence)
- [JSONata Official Docs](https://docs.jsonata.org/) -- expression patterns and programming constructs for test case design (HIGH confidence)
- [JSONata Exerciser](https://try.jsonata.org/) -- interactive testing of expressions for verifying test case validity (HIGH confidence)
- [jsonata-js/jsonata GitHub](https://github.com/jsonata-js/jsonata) -- test suite structure as reference for expression patterns (MEDIUM confidence)
- [Glance Parser Testing Infrastructure](https://deepwiki.com/lpil/glance/3-testing-system) -- snapshot-based AST testing patterns from compiler/parser community (MEDIUM confidence)
