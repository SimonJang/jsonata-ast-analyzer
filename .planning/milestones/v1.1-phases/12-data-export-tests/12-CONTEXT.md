# Phase 12: Data Export Tests - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Write integration tests validating that the path analyzer correctly extracts paths from data export patterns — structure-to-structure format conversion, multi-field flat record extraction, transform operator with update/delete clauses, and group-by aggregation. Covers DEXP-01 through DEXP-04. No analyzer fixes — only tests.

</domain>

<decisions>
## Implementation Decisions

### Scenario complexity
- Carry forward Phase 9/10/11 mix strategy: focused single-pattern fixture first per requirement, then a realistic composite fixture combining patterns
- Claude decides fixture count per requirement based on complexity
- Each DEXP requirement gets its own nested `describe('DEXP-XX: ...', () => { ... })` block inside the top-level "Data Export" describe
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
- Fixture names combine pattern and behavior: `'nested JSON reshaping: extracts all source leaf paths'`
- Realistic variable names: `$record`, `$export`, `$grouped` (not `$a`, `$b`)
- No inline JSONata comments

### Claude's Discretion
- Exact number of fixtures per DEXP requirement
- Which JSONata expressions best represent each data export pattern
- Format conversion depth for DEXP-01 (flat-to-flat, nested-to-flat, nested-to-nested reshaping)
- What constitutes "flat record extraction" for DEXP-02 (multi-field picks, cherry-picking from nested structures)
- Transform operator complexity for DEXP-03 (simple field updates vs multi-clause update/delete combinations)
- Group-by pattern selection for DEXP-04 (implicit grouping syntax, aggregation function combinations, single vs nested keys)
- Whether composite fixture combines all 4 DEXP patterns or a realistic subset (prefer combining only bug-free patterns)

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
- `data-transforms.test.ts`, `business-rules.test.ts`, `api-reshaping.test.ts` provide exact structural templates
- `BUG(v1.2):` comment prefix for skipped tests with bug description
- Test files use explicit `import { describe, it } from "vitest"`
- ESM-only: all imports use `.js` extension
- Composite fixtures combine only bug-free patterns to avoid known bug exposure

### Integration Points
- `test/integration/data-export.test.ts` — existing skeleton file with empty "Data Export" describe block
- `npm run test:integration` — discovers and runs integration tests
- Phase 8 helpers at `test/integration/helpers.ts`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-data-export-tests*
*Context gathered: 2026-03-04*
