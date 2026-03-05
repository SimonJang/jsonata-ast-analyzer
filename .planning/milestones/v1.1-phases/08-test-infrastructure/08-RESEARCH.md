# Phase 8: Test Infrastructure - Research

**Researched:** 2026-03-04
**Domain:** Vitest test organization, TypeScript fixture types, assertion utilities
**Confidence:** HIGH

## Summary

Phase 8 sets up the integration test infrastructure for phases 9-13. The project already uses Vitest 4.0.18 with `globals: true` and ESM-only configuration. The existing `test/extract-paths.test.ts` has 105 passing unit tests. The work involves: (1) modifying `vitest.config.ts` to add include/exclude patterns, (2) adding NPM scripts for targeted test runs, (3) creating TypeScript types for test fixtures, and (4) building `assertFixture()` and `sortPaths()` helper utilities in `test/integration/helpers.ts`.

The approach is straightforward since Vitest already handles everything needed natively. No new dependencies are required. The `include`/`exclude` config patterns and CLI flags (`vitest run test/integration/`, `vitest run --exclude 'test/integration/**'`) have been verified to work correctly with the installed Vitest 4.0.18.

**Primary recommendation:** Use a single `vitest.config.ts` with default include patterns, and differentiate `test:unit` vs `test:integration` via NPM script CLI arguments (positional filter and `--exclude` flag). This avoids workspace complexity and keeps the single-config decision.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Fixture design:** Name only -- the `name` field IS the documentation, no separate description field
- **Mutually exclusive modes:** `expectedPaths` (exact match) and `mustContain`/`mustNotContain` (subset checks) are mutually exclusive -- each fixture uses one mode, never both
- **No skip/todo in fixture type:** Use Vitest's native `it.skip()`/`it.todo()` directly in test files
- **Expression only:** No `inputExample` field; this is static analysis, input JSON is irrelevant
- **Rich failure output:** Show expression, expected paths, actual paths, and diff on failure
- **mustContain/mustNotContain mode:** List specific missing or unexpected paths
- **Internal sorting:** `assertFixture()` sorts both actual and expected paths internally -- tests can list paths in any order
- **One-liner assertion:** `assertFixture()` takes the fixture (with expression string) and calls `extractPaths()` internally
- **Single config file:** Single `vitest.config.ts` with include/exclude patterns -- no separate config files
- **npm test runs everything:** `npm test` runs unit + integration; `test:unit` and `test:integration` for targeted runs
- **Category naming:** `test/integration/data-transforms.test.ts`, `business-rules.test.ts`, etc. -- maps 1:1 to phases 9-12 + edge-cases
- **Helpers location:** Co-located at `test/integration/helpers.ts` -- simple import from `./helpers`

### Claude's Discretion
- Exact `sortPaths()` implementation (sort key: path string, then confidence)
- Error message formatting details
- Whether to use Vitest workspace vs include/exclude in single config

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFR-01 | Integration test directory (`test/integration/`) with category-per-file organization (5 files) | Vitest auto-discovers `*.test.ts` files in any subdirectory; directory structure verified to work with positional filters |
| INFR-02 | Typed `IntegrationFixture` interface with `name`, `expression`, `expectedPaths`, optional `mustContain`/`mustNotContain` | TypeScript discriminated union or optional fields; see Architecture Patterns for exact type design |
| INFR-03 | Shared `sortPaths()` utility that normalizes path order before comparison | Simple array sort with composite key; see Code Examples |
| INFR-04 | Shared `assertFixture()` utility enforcing `toEqual` on sorted results with confidence included | Vitest `expect().toEqual()` with custom error messaging; see Code Examples |
| INFR-05 | NPM scripts for `test:unit`, `test:integration`, and `test:update-snapshots` | Vitest CLI flags verified: positional filter for integration, `--exclude` for unit-only; see Standard Stack |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.0.18 | Test runner and assertion library | Already installed, project standard |
| typescript | ~5.9.3 | Type checking for fixture interfaces | Already installed, project standard |

### Supporting
No additional libraries needed. Everything required is already in the project.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CLI positional filter (`vitest run test/integration/`) | Vitest workspace with named projects | Workspace adds a `vitest.workspace.ts` file and complexity; single config with CLI args is simpler for this project size |
| `--exclude` flag for unit runs | Separate `vitest.unit.config.ts` | User explicitly decided single config file |

**NPM Script Implementation (verified):**
```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --exclude 'test/integration/**'",
    "test:integration": "vitest run test/integration/",
    "test:watch": "vitest",
    "test:update-snapshots": "vitest run --update"
  }
}
```

**Verification performed:** Both `vitest run test/integration/` (positional filter) and `vitest run --exclude 'test/integration/**'` (exclude flag) were tested against the installed Vitest 4.0.18 and confirmed working.

## Architecture Patterns

### Recommended Project Structure
```
test/
  extract-paths.test.ts         # existing 105 unit tests (unchanged)
  integration/
    helpers.ts                  # IntegrationFixture type + assertFixture() + sortPaths()
    data-transforms.test.ts     # Phase 9: TRFM-01 through TRFM-05
    business-rules.test.ts      # Phase 10: BIZR-01 through BIZR-05
    api-reshaping.test.ts       # Phase 11: APIR-01 through APIR-05
    data-export.test.ts         # Phase 12: DEXP-01 through DEXP-04
    edge-cases.test.ts          # Phase 13: EDGE-01 through EDGE-07
```

### Pattern 1: IntegrationFixture Type (Discriminated Union)

**What:** TypeScript interface for test fixtures with two mutually exclusive assertion modes.

**Design decision:** Use a discriminated union with a `mode` field, OR use two separate interfaces in a union. Since the user said "each fixture uses one mode, never both" the cleanest TypeScript approach is a union type with shared base fields.

**Recommended approach:**
```typescript
import type { PathResult } from "../../src/index.js";

/** Base fields shared by all fixture modes */
interface FixtureBase {
  /** Human-readable test name -- IS the documentation */
  name: string;
  /** JSONata expression to analyze */
  expression: string;
}

/** Exact match mode -- asserts the full set of paths */
interface ExactFixture extends FixtureBase {
  expectedPaths: PathResult[];
  mustContain?: never;
  mustNotContain?: never;
}

/** Subset match mode -- asserts presence/absence of specific paths */
interface SubsetFixture extends FixtureBase {
  expectedPaths?: never;
  mustContain?: PathResult[];
  mustNotContain?: PathResult[];
}

export type IntegrationFixture = ExactFixture | SubsetFixture;
```

**Why this pattern:** Using `never` for the excluded fields means TypeScript will error if you try to set both `expectedPaths` AND `mustContain` on the same object. This enforces the mutual exclusivity at compile time.

**Alternative (simpler):** Use a single interface with all optional fields and runtime validation in `assertFixture()`. Trades compile-time safety for simplicity. The discriminated union is preferred because it catches mistakes at the type level.

### Pattern 2: assertFixture() One-Liner Pattern

**What:** Single function that takes a fixture, calls `extractPaths()`, sorts results, and asserts.

**When to use:** Every integration test. Tests become data-driven one-liners.

**Test file pattern (phases 9-13 will follow this):**
```typescript
import { assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("Data Transforms", () => {
  const fixtures: IntegrationFixture[] = [
    {
      name: "filter -> map pipeline extracts all referenced fields",
      expression: 'orders[status = "active"].{"id": orderId, "total": amount * quantity}',
      expectedPaths: [
        { path: "orders.status", confidence: "static" },
        { path: "orders.orderId", confidence: "static" },
        { path: "orders.amount", confidence: "static" },
        { path: "orders.quantity", confidence: "static" },
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

### Pattern 3: sortPaths() Normalization

**What:** Deterministic sort for PathResult arrays so test order does not matter.

**Sort key:** Primary: `path` string (lexicographic). Secondary: `confidence` string (lexicographic -- "dynamic" < "partial" < "static").

```typescript
export function sortPaths(paths: PathResult[]): PathResult[] {
  return [...paths].sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return a.confidence.localeCompare(b.confidence);
  });
}
```

**Why copy before sort:** `Array.sort()` mutates in place. Using spread avoids mutating the original array passed to the function.

### Anti-Patterns to Avoid
- **Importing test globals:** The project uses `globals: true` in vitest config. Do NOT add `import { describe, it, expect } from "vitest"` in test files (the existing unit test does this, but new integration tests should follow the `globals: true` convention). **Update:** The existing test DOES import from vitest, so for consistency either approach is fine, but helpers.ts MUST import `expect` since it is a utility module, not a test file -- globals may not be injected in non-test files.
- **Testing assertFixture() by running expressions:** Phase 8 only needs a "smoke test" sample fixture to prove the infrastructure works. Do not write real scenario tests -- that is phases 9-13.
- **Snapshot-based assertions in helpers:** The user decided on `toEqual` with sorted results. Do not use `toMatchSnapshot()` or `toMatchInlineSnapshot()` in `assertFixture()`. Snapshots are a separate concern (EVAL-01, future requirement).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test file discovery | Custom glob/require logic | Vitest's built-in `include` patterns | Vitest auto-discovers `*.test.ts` files recursively |
| Test filtering by directory | Custom test runner wrapper | CLI positional filter (`vitest run test/integration/`) | Native Vitest feature, zero config |
| Diff output on assertion failure | Custom diff formatting | Vitest's built-in `toEqual` diff output | Vitest already shows expected vs received with color-coded diffs |
| Path sorting | In-test manual ordering | Shared `sortPaths()` utility | Centralizes the sort logic, tests stay order-agnostic |

**Key insight:** Vitest already provides rich assertion failure output including diffs. The `assertFixture()` helper should enhance this with expression context, not replace it.

## Common Pitfalls

### Pitfall 1: Globals Not Available in Helper Modules
**What goes wrong:** `expect` is undefined when called from `helpers.ts` because `globals: true` only injects into test files, not arbitrary `.ts` files.
**Why it happens:** Vitest's global injection targets files matching the `include` pattern. `helpers.ts` is not a test file.
**How to avoid:** Explicitly import `expect` from `vitest` in `helpers.ts`: `import { expect } from "vitest"`.
**Warning signs:** Runtime error "expect is not defined" when calling `assertFixture()`.

### Pitfall 2: ESM Import Extensions
**What goes wrong:** Import fails because `.js` extension is missing.
**Why it happens:** Project uses `"type": "module"` and TypeScript with `moduleResolution: "bundler"`. Vitest handles this, but explicit extensions are the project convention.
**How to avoid:** Use `import { assertFixture } from "./helpers.js"` (with `.js` extension) in test files, matching the existing project convention in `src/` imports.
**Warning signs:** Module not found errors during test runs.

### Pitfall 3: Mutating Sort
**What goes wrong:** `sortPaths()` mutates the input array, causing unexpected side effects if the same array is referenced elsewhere.
**Why it happens:** JavaScript `Array.sort()` sorts in-place.
**How to avoid:** Always spread before sorting: `[...paths].sort(...)`.
**Warning signs:** Test order dependencies, flaky tests.

### Pitfall 4: Forgetting Confidence in Assertions
**What goes wrong:** Tests compare only path strings, not `PathResult` objects with confidence.
**Why it happens:** It is tempting to simplify fixtures to just path strings.
**How to avoid:** The `IntegrationFixture` type requires `PathResult[]` (with confidence). `assertFixture()` compares full objects.
**Warning signs:** Tests pass but don't validate confidence annotations.

### Pitfall 5: Sample Test File Names Conflicting with Phase 9-13 Files
**What goes wrong:** Phase 8 creates a sample test in a file that phases 9-13 will overwrite.
**Why it happens:** Using `data-transforms.test.ts` for the sample fixture.
**How to avoid:** Either: (a) put the sample fixture in one of the real category files with a single trivial test that later phases extend, or (b) create a separate `_sample.test.ts` that gets deleted. Option (a) is simpler -- just put a single smoke-test fixture in `data-transforms.test.ts` that phase 9 will expand.
**Warning signs:** Git merge conflicts when phase 9 starts.

## Code Examples

Verified patterns from the existing codebase and Vitest 4.0.18:

### Complete helpers.ts Implementation

```typescript
// test/integration/helpers.ts
import { expect } from "vitest";
import { extractPaths } from "../../src/index.js";
import type { PathResult } from "../../src/index.js";

// --- Fixture Types ---

interface FixtureBase {
  name: string;
  expression: string;
}

interface ExactFixture extends FixtureBase {
  expectedPaths: PathResult[];
  mustContain?: never;
  mustNotContain?: never;
}

interface SubsetFixture extends FixtureBase {
  expectedPaths?: never;
  mustContain?: PathResult[];
  mustNotContain?: PathResult[];
}

export type IntegrationFixture = ExactFixture | SubsetFixture;

// --- Utilities ---

export function sortPaths(paths: PathResult[]): PathResult[] {
  return [...paths].sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return a.confidence.localeCompare(b.confidence);
  });
}

// --- Assertion ---

export function assertFixture(fixture: IntegrationFixture): void {
  const actual = extractPaths(fixture.expression);
  const sortedActual = sortPaths(actual);

  if ("expectedPaths" in fixture && fixture.expectedPaths !== undefined) {
    // Exact match mode
    const sortedExpected = sortPaths(fixture.expectedPaths);
    expect(
      sortedActual,
      `Expression: ${fixture.expression}\n` +
      `Expected ${sortedExpected.length} paths, got ${sortedActual.length}`
    ).toEqual(sortedExpected);
  } else {
    // Subset match mode
    if (fixture.mustContain) {
      for (const required of fixture.mustContain) {
        const found = sortedActual.some(
          (p) => p.path === required.path && p.confidence === required.confidence
        );
        expect(
          found,
          `Expression: ${fixture.expression}\n` +
          `Missing: ${JSON.stringify(required)}\n` +
          `Actual paths: ${JSON.stringify(sortedActual, null, 2)}`
        ).toBe(true);
      }
    }
    if (fixture.mustNotContain) {
      for (const forbidden of fixture.mustNotContain) {
        const found = sortedActual.some(
          (p) => p.path === forbidden.path && p.confidence === forbidden.confidence
        );
        expect(
          found,
          `Expression: ${fixture.expression}\n` +
          `Unexpected: ${JSON.stringify(forbidden)}\n` +
          `Actual paths: ${JSON.stringify(sortedActual, null, 2)}`
        ).toBe(false);
      }
    }
  }
}
```

### vitest.config.ts Update

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
  },
});
```

**Note:** The config stays unchanged. Test segmentation is done entirely via NPM scripts using CLI arguments. No `include`/`exclude` changes needed in the config itself.

### package.json Scripts Update

```json
{
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:unit": "vitest run --exclude 'test/integration/**'",
    "test:integration": "vitest run test/integration/",
    "test:watch": "vitest",
    "test:update-snapshots": "vitest run --update",
    "typecheck": "tsc --noEmit"
  }
}
```

### Sample Smoke Test (Phase 8 proof-of-concept)

```typescript
// test/integration/data-transforms.test.ts
import { assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("Data Transforms", () => {
  // Phase 8: single smoke-test fixture to verify infrastructure
  // Phase 9 will expand this with TRFM-01 through TRFM-05 scenarios
  const fixtures: IntegrationFixture[] = [
    {
      name: "simple dot-path extraction (infrastructure smoke test)",
      expression: "account.name",
      expectedPaths: [
        { path: "account.name", confidence: "static" },
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

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vitest `include` in config for segmentation | CLI positional filters + `--exclude` | Vitest 1.x+ | Simpler config, NPM scripts handle segmentation |
| Separate config files per test type | Single config + CLI flags | Vitest 2.x+ workspace feature made it optional | One config to maintain |
| Manual path ordering in assertions | `sortPaths()` utility | Project-specific | Tests become order-agnostic |

**Deprecated/outdated:**
- Vitest workspace is NOT deprecated but is overkill for this project. The user explicitly decided on a single config file.

## Open Questions

1. **Import style in test files**
   - What we know: Existing `test/extract-paths.test.ts` imports `{ describe, it, expect }` from `"vitest"` despite `globals: true` being set.
   - What's unclear: Should new integration tests follow the same explicit import pattern or rely on globals?
   - Recommendation: Follow the existing pattern (explicit imports) for consistency within the test directory. Either works, but consistency matters.

2. **Sample fixture placement**
   - What we know: Phase 8 needs a working sample. Phase 9 will create the real `data-transforms.test.ts` content.
   - What's unclear: Should the sample go in `data-transforms.test.ts` (later extended) or a separate file (later deleted)?
   - Recommendation: Put it directly in `data-transforms.test.ts` with a clear comment that Phase 9 expands it. Avoids a throwaway file.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run test/integration/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFR-01 | Integration test directory with 5 category files | smoke | `npx vitest run test/integration/ --reporter verbose` | No -- Wave 0 |
| INFR-02 | IntegrationFixture type with required fields | unit (typecheck) | `npx tsc --noEmit` | No -- Wave 0 |
| INFR-03 | sortPaths() normalizes path order | unit | `npx vitest run test/integration/ -t "sortPaths"` | No -- Wave 0 |
| INFR-04 | assertFixture() enforces toEqual on sorted results | smoke | `npx vitest run test/integration/ -t "smoke test"` | No -- Wave 0 |
| INFR-05 | NPM scripts for test:unit, test:integration, test:update-snapshots | manual-only | Run each script and verify output | N/A -- manual |

### Sampling Rate
- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run && npx tsc --noEmit`
- **Phase gate:** Full suite green + all 3 NPM scripts verified

### Wave 0 Gaps
- [ ] `test/integration/helpers.ts` -- IntegrationFixture type + sortPaths() + assertFixture()
- [ ] `test/integration/data-transforms.test.ts` -- smoke test fixture proving infrastructure works
- [ ] `test/integration/business-rules.test.ts` -- empty placeholder (Phase 10)
- [ ] `test/integration/api-reshaping.test.ts` -- empty placeholder (Phase 11)
- [ ] `test/integration/data-export.test.ts` -- empty placeholder (Phase 12)
- [ ] `test/integration/edge-cases.test.ts` -- empty placeholder (Phase 13)
- [ ] NPM scripts added to `package.json`

## Sources

### Primary (HIGH confidence)
- Vitest 4.0.18 installed in project -- CLI help output and runtime behavior verified directly
- Vitest default include patterns verified: `["**/*.{test,spec}.?(c|m)[jt]s?(x)"]`
- `--exclude` CLI flag verified working: `vitest run --exclude 'test/integration/**'`
- Positional filter verified working: `vitest run test/integration/`
- Project source code: `src/index.ts`, `src/types.ts` -- `extractPaths()` API and `PathResult` type

### Secondary (MEDIUM confidence)
- Vitest `globals: true` behavior with non-test files (helpers.ts needs explicit import) -- based on Vitest documentation patterns and standard behavior

### Tertiary (LOW confidence)
- None -- all findings verified against installed tooling

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- already installed, version pinned, no new dependencies
- Architecture: HIGH -- patterns verified against existing codebase and Vitest CLI behavior
- Pitfalls: HIGH -- ESM import and globals injection are well-documented Vitest behaviors

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- no moving parts, all dependencies locked)
