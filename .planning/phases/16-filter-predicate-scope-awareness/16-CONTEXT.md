# Phase 16: Filter Predicate Scope-Awareness - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix 6 remaining BUG(v1.2) bugs across 2 categories (filter predicate leak into HOF bindings, focus variable double-prefix) and build 20+ regression tests. Each bug has a documented `it.skip` fixture with correct expected output. No API changes, no refactoring, no new features.

</domain>

<decisions>
## Implementation Decisions

### Fix scope boundary
- Fix ONLY the 6 documented bugs -- do not speculatively fix other filter/focus interactions
- Each fix should be minimal and targeted: make the skipped test pass without altering behavior of 200+ passing tests
- Carry forward from Phase 14: if a fix naturally covers additional cases, that's fine -- but don't go looking for undocumented gaps

### Core fix approach
- **Filter predicate leak (FILT-01 to FILT-04)**: The root cause is `walkHigherOrderCall` calling `walkNode` on data args like `items[active]`, which returns both base paths (`items`) AND predicate paths (`items.active`). All paths get bound as `dataArgPaths` to lambda parameters, causing leak. Fix needs to separate base path extraction from predicate path extraction at the HOF call site
- **Focus variable double-prefix (FOCV-01, FOCV-02)**: Root cause is `walkFilterStages` binding focus variable `$o` to `["orders"]` then re-prefixing with `contextPrefix="orders"`, producing `orders.orders.total`. Fix needs to avoid double-prefixing when focus variable already contains the context prefix
- STATE.md notes: pre-implementation design needed for `extractBasePaths()` helper and `walkFilterStages` scope-awareness mechanism

### Regression test organization
- Add new regression tests as new `describe` blocks within existing integration test files where the BUG(v1.2) skips live
- Filter predicate tests: `data-transforms.test.ts` (3 FILT skips) and `business-rules.test.ts` (1 FILT skip)
- Focus variable tests: `api-reshaping.test.ts` (2 FOCV skips)
- 10+ new regression tests per bug category, 20+ total across 3 files

### Test depth & style
- Match the v1.1 integration test style: scenario-based with realistic field names, IntegrationFixture[] arrays, assertFixture() helper
- Test boundary variations: nested HOFs with filters, chained apply with filters, variable-bound intermediate filtered results, cross-referenced focus variables in nested contexts
- Each regression test should document what specific edge it's testing

### Regression risk management
- This phase touches HOF parameter binding path used by 40+ existing passing tests -- highest regression risk in milestone
- Run full test suite after each incremental fix to catch regressions immediately
- Fix filter predicate leak and focus variable double-prefix as separate changes to isolate blast radius

### Claude's Discretion
- Exact implementation of `extractBasePaths()` helper (whether it's a new function or inline logic)
- How `walkFilterStages` scope-awareness mechanism works internally
- Fix ordering within the phase (likely: filter predicate leak first since it's the larger bug set, focus variable second)
- Specific regression test expressions and expected outputs beyond the 6 documented skips

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/walker.ts`: Contains all functions that need fixes -- `walkHigherOrderCall` (line 558), `walkLambdaWithBindings` (line 601), `walkFilterStages` (line 259)
- `assertFixture()` helper: Established test pattern across all 5 integration test files
- `IntegrationFixture` type: Discriminated union -- all existing tests use ExactFixture
- `extractPaths()` API: The public function all tests call

### Established Patterns
- Immutable scope chain: Linked list of Maps with parent pointer -- fixes must respect this
- Two-pass architecture: Walk then resolve -- variable fixes must fit this model
- `walkHigherOrderCall` gets data arg paths via `walkNode(dataArg)` then passes ALL to `walkLambdaWithBindings` as binding paths -- this is the leak vector
- `walkFilterStages` binds focus variable to `contextPrefix` then re-prefixes filter results with same `contextPrefix` -- this is the double-prefix vector
- BUG(v1.2) convention: `// BUG(v1.2): description` on line before `it.skip`

### Integration Points
- All fixes are in `src/walker.ts` -- single file for source changes
- Tests spread across 3 existing integration test files
- 214+ existing tests (all passing after Phase 14/15 fixes) must continue passing -- zero regressions
- 6 `it.skip` fixtures to unskip: 3 in data-transforms.test.ts, 1 in business-rules.test.ts, 2 in api-reshaping.test.ts

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- the 6 bugs have exact expressions and expected outputs documented in the existing `it.skip` fixtures:
- FILT: `$map(items[active], function($v) { $v.name })` -- filter predicate leak into HOF binding
- FILT: `items ~> $filter(fn) ~> $map(fn)` -- chained HOF filter predicate leak
- FILT: `($filtered := items[active]; $map($filtered, fn))` -- variable-bound intermediate filter leak
- FILT: `$prices := products[inStock].price; $avg($prices)` -- variable-resolved filter predicate spurious prefix
- FOCV: `orders@$o[$o.total > 100].id` -- focus variable double-prefix
- FOCV: `$prices := products[inStock].price; $avg($prices)` -- variable-resolved filter spurious context prefix

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 16-filter-predicate-scope-awareness*
*Context gathered: 2026-03-06*
