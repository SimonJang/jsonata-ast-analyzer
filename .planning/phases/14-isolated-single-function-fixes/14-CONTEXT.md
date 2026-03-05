# Phase 14: Isolated Single-Function Fixes - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix 8 isolated walker bugs across 4 categories (walkPath parent steps, walkVariable .group, $lookup chaining, array constructor scope) and build 40+ regression tests. Each bug has a documented `it.skip` fixture with correct expected output. No API changes, no refactoring, no new features.

</domain>

<decisions>
## Implementation Decisions

### Fix scope boundary
- Fix ONLY the documented bugs — do not speculatively fix other node types walkPath may skip
- Each fix should be minimal and targeted: make the skipped test pass without altering behavior of passing tests
- If a fix naturally covers additional cases (e.g., walkPath object constructor fix also handles nested objects), that's fine — but don't go looking for undocumented gaps

### Regression test organization
- Add new regression tests as new `describe` blocks within the existing integration test files where the BUG(v1.2) skips live
- Parent operator tests → `api-reshaping.test.ts` (where PRNT skips are)
- walkVariable .group tests → `data-export.test.ts` (where WVAR skip is)
- $lookup chaining tests → `business-rules.test.ts` and `edge-cases.test.ts` (where LOOK skips are)
- Array constructor scope tests → `edge-cases.test.ts` (where ARRS skip is)
- 10+ new regression tests per bug category, 40+ total across 4 files

### Test depth & style
- Match the v1.1 integration test style: scenario-based with realistic field names, IntegrationFixture[] arrays, assertFixture() helper
- Test boundary variations: nested depth, empty inputs, mixed confidence levels, combinations with other operators
- Each regression test should document what specific edge it's testing (not just "works")

### Fix ordering
- Claude's Discretion — order by dependency analysis (likely: walkPath first since it's used by others, then walkVariable, then $lookup, then array scope)

### Claude's Discretion
- Exact implementation approach for each fix (how to modify walker functions)
- Specific regression test expressions and expected outputs beyond the documented skips
- Whether fixes share any common helper code or remain independent
- Fix ordering within the phase

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/walker.ts`: Contains all 4 functions that need fixes — walkPath (line 98), walkVariable (line 379), walkFilterStages (line 207), walkBlock (line 316)
- `assertFixture()` helper: Established test pattern across all 5 integration test files
- `IntegrationFixture` type: Discriminated union (ExactFixture | SubsetFixture) — all existing tests use ExactFixture
- `extractPaths()` API: The public function all tests call

### Established Patterns
- Immutable scope chain: Linked list of Maps with parent pointer — fixes must respect this
- Two-pass architecture: Walk then resolve — variable fixes must fit this model
- BUG(v1.2) convention: `// BUG(v1.2): description` on line before `it.skip`, fixture shows correct expected output
- Test structure: `describe("CATEGORY-NN: Description")` → `fixtures` array → `for...of` → `assertFixture()`

### Integration Points
- All fixes are in `src/walker.ts` — single file for source changes
- Tests spread across 4 existing integration test files
- 200 existing tests (186 passing, 14 skipped) must continue passing — zero regressions

</code_context>

<specifics>
## Specific Ideas

No specific requirements — the 8 bugs have exact expressions and expected outputs documented in the existing `it.skip` fixtures:
- PRNT: `orders.items.{"itemName": name, "orderDate": %.date}` and `orders.items.(%.orderRef & ": " & name)`
- WVAR: `$r{category: $sum(amount)}`
- LOOK: `$lookup(inventory, itemCode).quantity` and `$lookup(products, sku).price`
- ARRS: `[$x := data.source, $x.field]`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-isolated-single-function-fixes*
*Context gathered: 2026-03-05*
