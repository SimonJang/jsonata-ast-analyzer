# Phase 13: Edge Cases and Tech Debt - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Write integration tests validating the analyzer handles the hardest feature interactions (deep variable chains, nested closures, interprocedural tracing) and known tech debt items ($sort lambda, $lookup HOF, standalone BindNode), plus CLI round-trip verification. Covers EDGE-01 through EDGE-07. No analyzer fixes — only tests.

</domain>

<decisions>
## Implementation Decisions

### Tech debt handling (EDGE-04, EDGE-05, EDGE-06)
- One fixture per debt item — single representative test, skipped with `BUG(v1.2):` comment
- Skipped fixtures show CORRECT expected output (what the fix should produce), consistent with phases 9-12
- Pre-check each expression during planning to confirm it actually fails before marking as skip
- $sort lambda (EDGE-04): test `$sort(array, function($a,$b){...})` pattern
- $lookup HOF (EDGE-05): test `$lookup(obj, key)` with chained field access (already documented in BIZR-04 skip)
- Standalone BindNode (EDGE-06): test variable binding outside block expression context

### Variable chain depth (EDGE-01)
- Happy path only — test chains that should fully resolve (3-4 hops)
- If analyzer can't resolve multi-hop chains, skip with `BUG(v1.2):` and show correct expected output
- No broken/undefined/circular chain tests — that's beyond phase scope

### Nested HOFs and closures (EDGE-02)
- Carry forward Phase 9/10/11 patterns for HOF testing
- Test nested `$map` with closure capture across two levels
- Claude decides exact nesting depth and variable capture patterns

### Custom function interprocedural tracing (EDGE-03)
- Test `$fn := function($x){...}` called from multiple sites
- Expected: union of paths from all call-site arguments
- Claude decides whether to test single-definition-multi-call or multiple definitions

### CLI round-trip (EDGE-07)
- 2-3 representative expressions piped through `jsonata-paths` CLI
- One simple, one complex (multi-variable), one with dynamic confidence
- Verify CLI JSON output matches `extractPaths()` API output exactly
- Test uses `execSync` or similar to invoke CLI as subprocess

### Scenario complexity
- Carry forward Phase 9-12 mix strategy: focused single-pattern fixture first per requirement, then composite
- Each EDGE requirement gets its own nested `describe('EDGE-XX: ...', () => { ... })` block inside top-level "Edge Cases" describe
- Pre-check expressions during planning by running through `extractPaths()` to discover bugs upfront

### Assertion strategy
- Exact match (`expectedPaths`) for ALL fixtures — no subset matching
- Confidence level always explicit in every PathResult
- Assert what the analyzer actually produces — run expressions first during planning

### Failure handling
- When a test expression reveals wrong/missing paths: use `it.skip('name', () => { ... })` with `BUG(v1.2):` tracking comment
- v1.1 is testing-only — document bugs for v1.2, don't fix them
- Skipped fixtures show CORRECT expected output (what fix should produce), not buggy actual

### Expression style
- Multi-line template literals for complex expressions; single-line strings for simple ones
- Fixture names combine pattern and behavior: `'3-hop variable chain: resolves all hops to root data path'`
- Realistic variable names: `$intermediate`, `$resolved`, `$fn` (not `$a`, `$b`)
- No inline JSONata comments

### Claude's Discretion
- Exact number of fixtures per EDGE requirement
- Which specific JSONata expressions best represent each edge case
- HOF nesting depth for EDGE-02 (2-level minimum per requirement)
- Custom function patterns for EDGE-03 (single vs multiple definition variations)
- Whether composite fixture combines passing EDGE tests only (preferred) or attempts broader combination
- CLI invocation method (execSync, spawn, etc.)

</decisions>

<specifics>
## Specific Ideas

- EDGE-04 ($sort) and EDGE-05 ($lookup) already have related skipped tests in earlier phases (TRFM filter-sort-map skip, BIZR-04 lookup chaining skip) — new fixtures should test the specific tech debt angle, not duplicate earlier patterns
- EDGE-07 CLI test should use the actual `jsonata-paths` binary from package.json bin field

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `assertFixture()` from `./helpers.js` — one-liner assertion, calls `extractPaths()` internally, sorts both sides
- `IntegrationFixture` type (`ExactFixture` | `SubsetFixture`) — only `ExactFixture` mode used
- `sortPaths()` utility — deterministic ordering for comparison
- `extractPaths()` from `src/index.ts` — the public API under test
- `src/cli.ts` — CLI entry point, binary registered as `jsonata-paths` in package.json

### Established Patterns
- `data-transforms.test.ts`, `business-rules.test.ts`, `api-reshaping.test.ts`, `data-export.test.ts` provide exact structural templates
- `BUG(v1.2):` comment prefix for skipped tests with bug description
- Test files use explicit `import { describe, it } from "vitest"`
- ESM-only: all imports use `.js` extension
- Composite fixtures combine only bug-free patterns to avoid known bug exposure
- 12 existing `it.skip` tests with `BUG(v1.2)` across phases 9-12 document known analyzer limitations

### Integration Points
- `test/integration/edge-cases.test.ts` — existing skeleton file with empty "Edge Cases" describe block
- `npm run test:integration` — discovers and runs integration tests
- Phase 8 helpers at `test/integration/helpers.ts`
- `jsonata-paths` CLI binary via `npx jsonata-paths` or direct path to `dist/cli.js`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-edge-cases-and-tech-debt*
*Context gathered: 2026-03-04*
