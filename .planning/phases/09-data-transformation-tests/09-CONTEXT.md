# Phase 9: Data Transformation Tests - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Write integration tests validating that the path analyzer correctly extracts paths from real-world data transformation patterns — the most common JSONata production use case. Covers TRFM-01 through TRFM-05: pipeline chains, apply operators, array dot-notation mapping, string formatting, and multi-stage transforms with variable bindings. No analyzer fixes — only tests.

</domain>

<decisions>
## Implementation Decisions

### Scenario complexity
- Mix strategy: focused single-pattern fixture first per requirement, then a realistic composite fixture combining patterns
- Claude decides fixture count per requirement based on complexity — some may need more, others less
- Claude decides whether composites combine patterns across TRFM requirements or stay within one
- Each TRFM requirement gets its own nested `describe('TRFM-XX: ...', () => { ... })` block inside the top-level "Data Transforms" describe

### Assertion strategy
- Exact match (`expectedPaths`) for ALL fixtures — no subset matching in this phase
- Confidence level always explicit in every PathResult (`confidence: "static"`, `confidence: "dynamic"`, etc.)
- Assert what the analyzer actually produces — run the expression first during planning, observe output, then codify as the expected result. Don't assume expected paths

### Failure handling
- When a test expression reveals the analyzer produces wrong/missing paths: use `it.skip('name', () => { ... })` with a tracking comment
- v1.1 is testing-only — document bugs for v1.2, don't fix them
- Claude decides tracking comment format (consistent across all skipped tests)
- Pre-check expressions during planning by running them through `extractPaths()` to discover bugs upfront before execution

### Expression style
- Multi-line template literals for complex expressions (pipelines, multi-stage transforms); single-line strings for simple expressions
- Fixture names combine pattern and behavior: `'filter-sort-map pipeline: extracts fields from all stages'`
- No inline JSONata comments explaining syntax — fixture name is the documentation
- Realistic variable names in expressions: `$filtered`, `$sorted`, `$mapped` (not `$a`, `$b`)

### Claude's Discretion
- Exact number of fixtures per TRFM requirement
- Whether to cross-reference requirements in composite fixtures
- Tracking comment format for `it.skip` tests
- Which expressions to choose as representative real-world patterns

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `assertFixture()` from `./helpers.js` — one-liner assertion, calls `extractPaths()` internally, sorts both sides
- `IntegrationFixture` type (union of `ExactFixture` | `SubsetFixture`) — only `ExactFixture` mode used in this phase
- `sortPaths()` utility — deterministic ordering for comparison
- `extractPaths()` from `src/index.ts` — the public API under test

### Established Patterns
- Smoke test already exists in `data-transforms.test.ts` — replace with real fixtures
- Unit tests use nested `describe` blocks with requirement IDs (e.g., `describe("SCOPE-04: $map element binding")`)
- Vitest with `globals: true` but helpers.ts uses explicit import `{ expect } from "vitest"`
- Test files use explicit `import { describe, it } from "vitest"` (see existing data-transforms.test.ts)
- ESM-only: all imports use `.js` extension

### Integration Points
- `test/integration/data-transforms.test.ts` — existing file, will be expanded in place
- `npm run test:integration` — discovers and runs integration tests
- Phase 8 helpers at `test/integration/helpers.ts` — import `assertFixture` and `IntegrationFixture`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-data-transformation-tests*
*Context gathered: 2026-03-04*
