# Phase 11: API Reshaping Tests - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Write integration tests validating that the path analyzer correctly extracts paths from API payload extraction and restructuring patterns — nested object flattening, mixed-source outputs, deep traversal, context variables, and parent operators. Covers APIR-01 through APIR-05. No analyzer fixes — only tests.

</domain>

<decisions>
## Implementation Decisions

### Scenario complexity
- Carry forward Phase 9/10 mix strategy: focused single-pattern fixture first per requirement, then a realistic composite fixture combining patterns
- Claude decides fixture count per requirement based on complexity
- Each APIR requirement gets its own nested `describe('APIR-XX: ...', () => { ... })` block inside the top-level "API Reshaping" describe
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
- `data-transforms.test.ts` and `business-rules.test.ts` provide exact structural templates
- `BUG(v1.2):` comment prefix for skipped tests with bug description
- Test files use explicit `import { describe, it } from "vitest"`
- ESM-only: all imports use `.js` extension
- Composite fixtures combine only bug-free patterns to avoid known bug exposure

### Integration Points
- `test/integration/api-reshaping.test.ts` — existing skeleton file with empty "API Reshaping" describe block
- `npm run test:integration` — discovers and runs integration tests
- Phase 8 helpers at `test/integration/helpers.ts`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-api-reshaping-tests*
*Context gathered: 2026-03-04*
