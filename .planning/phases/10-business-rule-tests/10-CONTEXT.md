# Phase 10: Business Rule Tests - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Write integration tests validating that the path analyzer correctly extracts paths from business rule patterns — conditionals, compound filters, aggregation, lookups, and variable-driven object construction. Covers BIZR-01 through BIZR-05. No analyzer fixes — only tests.

</domain>

<decisions>
## Implementation Decisions

### Scenario complexity
- Carry forward Phase 9 mix strategy: focused single-pattern fixture first per requirement, then a realistic composite fixture combining patterns
- Claude decides fixture count per requirement based on complexity
- Each BIZR requirement gets its own nested `describe('BIZR-XX: ...', () => { ... })` block inside the top-level "Business Rules" describe
- Pre-check expressions during planning by running them through `extractPaths()` to discover bugs upfront

### Assertion strategy
- Exact match (`expectedPaths`) for ALL fixtures — no subset matching
- Confidence level always explicit in every PathResult
- Assert what the analyzer actually produces — run expressions first during planning, observe output, then codify as expected result

### Failure handling
- When a test expression reveals wrong/missing paths: use `it.skip('name', () => { ... })` with `BUG(v1.2):` tracking comment
- v1.1 is testing-only — document bugs for v1.2, don't fix them
- Skipped fixtures show CORRECT expected output (what fix should produce), not buggy actual

### Expression style
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

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `assertFixture()` from `./helpers.js` — one-liner assertion, calls `extractPaths()` internally, sorts both sides
- `IntegrationFixture` type (`ExactFixture` | `SubsetFixture`) — only `ExactFixture` mode used
- `sortPaths()` utility — deterministic ordering for comparison
- `extractPaths()` from `src/index.ts` — the public API under test

### Established Patterns
- `data-transforms.test.ts` provides the exact structural template: imports, describe nesting, fixture arrays, for-of loop, it.skip for bugs
- `BUG(v1.2):` comment prefix for skipped tests with bug description
- Test files use explicit `import { describe, it } from "vitest"`
- ESM-only: all imports use `.js` extension

### Integration Points
- `test/integration/business-rules.test.ts` — existing skeleton file with empty "Business Rules" describe block
- `npm run test:integration` — discovers and runs integration tests
- Phase 8 helpers at `test/integration/helpers.ts`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-business-rule-tests*
*Context gathered: 2026-03-04*
