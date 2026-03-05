# Phase 8: Test Infrastructure - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Set up shared integration test helpers, fixture types, assertion utilities, and NPM scripts so that phases 9-13 can write 50+ integration tests with consistent structure and assertion discipline. No scenario tests are written in this phase — only the scaffolding.

</domain>

<decisions>
## Implementation Decisions

### Fixture design
- Name only — the `name` field IS the documentation, no separate description field
- `expectedPaths` (exact match) and `mustContain`/`mustNotContain` (subset checks) are mutually exclusive — each fixture uses one mode, never both
- No `skip` or `todo` field in the fixture type — use Vitest's native `it.skip()`/`it.todo()` directly in test files
- Expression only — no `inputExample` field; this is static analysis, input JSON is irrelevant

### Assertion output
- Rich context on failure: show the expression, expected paths, actual paths, and diff
- For `mustContain`/`mustNotContain` mode: list specific missing or unexpected paths (e.g., "Missing: [orders.items.price]")
- `assertFixture()` sorts both actual and expected paths internally — tests can list paths in any order
- `assertFixture()` takes the fixture (with expression string) and calls `extractPaths()` internally — one-liner per test

### Test runner setup
- Single `vitest.config.ts` with include/exclude patterns — no separate config files
- `npm test` runs everything (unit + integration); `test:unit` and `test:integration` for targeted runs
- Category name convention: `test/integration/data-transforms.test.ts`, `business-rules.test.ts`, etc. — maps 1:1 to phases 9-12 + edge-cases
- Helpers co-located at `test/integration/helpers.ts` — simple import from `./helpers`

### Claude's Discretion
- Exact `sortPaths()` implementation (sort key: path string, then confidence)
- Error message formatting details
- Whether to use Vitest workspace vs include/exclude in single config

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `extractPaths(expression: string)` from `src/index.ts` — the public API that all integration tests will call
- `PathResult` type: `{ path: string, confidence: "static" | "dynamic" }` — assertion targets

### Established Patterns
- Vitest with `globals: true` — `describe/it/expect` without imports in existing tests
- Direct `toEqual` assertions with inline expected arrays (see `test/extract-paths.test.ts`)
- ESM-only (`"type": "module"` in package.json)

### Integration Points
- `vitest.config.ts` — needs include/exclude patterns added
- `package.json` scripts — needs `test:unit`, `test:integration`, `test:update-snapshots` added
- `test/integration/` — new directory, co-exists with existing `test/extract-paths.test.ts`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-test-infrastructure*
*Context gathered: 2026-03-04*
