---
phase: 14-isolated-single-function-fixes
plan: 02
subsystem: walker
tags: [jsonata, ast-walker, path-extraction, lookup-chaining, array-constructor, scope-accumulation]

# Dependency graph
requires:
  - phase: 14-isolated-single-function-fixes
    plan: 01
    provides: "walkPath step handling for unary/block, walkVariable group-by"
provides:
  - "walkPath handles function steps in path (e.g., $lookup(obj, key).field)"
  - "walkUnary array constructor accumulates scope sequentially for variable resolution"
  - "22 regression tests covering LOOK chaining and ARRS scope patterns"
affects: [15-pipeline-multi-function-fixes, 16-coupled-cross-cutting-fixes]

# Tech tracking
tech-stack:
  added: []
  patterns: ["function step continuation: prefix basePath with first argument path", "array constructor scope mirrors walkBlock sequential accumulation"]

key-files:
  created: []
  modified: [src/walker.ts, test/integration/business-rules.test.ts, test/integration/edge-cases.test.ts]

key-decisions:
  - "basePath after function step is prefixed with first argument (not emitted bare) -- it represents a chained property relative to the function result"
  - "BIZR-04 expected output updated from bare 'price' to 'products.price' for consistency with EDGE-05 semantics"
  - "Array constructor scope accumulation uses same pattern as walkBlock (no child scope needed)"

patterns-established:
  - "Function step in walkPath: walk arguments via walkFunction, prefix trailing basePath with first arg"
  - "Array constructor scope: sequential accumulation with bindVariable for bind expressions"

requirements-completed: [LOOK-01, LOOK-02, LOOK-03, ARRS-01, ARRS-02]

# Metrics
duration: 5min
completed: 2026-03-06
---

# Phase 14 Plan 02: $lookup chaining and array constructor scope Summary

**Fixed $lookup chaining to extract function arguments and prefix chained properties, and array constructor to accumulate scope sequentially for variable resolution, with 22 regression tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-06T08:41:10Z
- **Completed:** 2026-03-06T08:45:54Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- walkPath now correctly handles function steps in paths, extracting all function arguments and prefixing chained properties with the first argument path (e.g., `$lookup(inventory, key).quantity` produces `inventory`, `itemCode`, `inventory.quantity`)
- walkUnary array constructor now accumulates scope sequentially, enabling variable bindings to propagate across array elements (e.g., `[$x := data.source, $x.field]` resolves `$x.field` to `data.source.field`)
- 3 BUG(v1.2) tests unskipped and passing (LOOK-01, LOOK-02, ARRS-01)
- 22 new regression tests covering diverse LOOK chaining and ARRS scope patterns
- Zero regressions: all 251 tests pass, TypeScript clean
- Total BUG(v1.2) skips reduced from 11 to 8

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix walkPath to handle function steps** - `8e5c4f3` (test: RED) + `29fb38a` (feat: GREEN)
2. **Task 2: Fix array constructor scope accumulation** - `b930836` (test: RED) + `fb8ec24` (feat: GREEN)
3. **Task 3: Add 22 regression tests** - `509ba90` (test)

_TDD tasks had separate RED/GREEN commits._

## Files Created/Modified
- `src/walker.ts` - Added function step handling in walkPath loop, basePath prefixing with first argument, sequential scope accumulation in walkUnary "[" case
- `test/integration/business-rules.test.ts` - Unskipped BIZR-04/LOOK-01 BUG test with updated expected output, added 6 LOOK regression tests
- `test/integration/edge-cases.test.ts` - Unskipped EDGE-05/LOOK-02 and EDGE-06/ARRS-01 BUG tests, added 5 LOOK edge case tests and 11 ARRS regression tests

## Decisions Made
- **basePath after function step is prefixed, not bare:** When a path contains a function step (like `$lookup(obj, key).field`), the basePath (`field`) is relative to the function's return value. It is prefixed with the first function argument (`obj.field`) rather than emitted bare, since `field` alone is not a real standalone data path.
- **BIZR-04 expected output updated:** Changed from `[products, price, sku]` to `[products, products.price, sku]` for consistency with the EDGE-05 pattern where chained properties are prefixed with the lookup table argument.
- **Array constructor uses same pattern as walkBlock:** No child scope creation needed -- sequential accumulation with `currentScope = bindVariable(...)` suffices. The accumulated scope stays local to the walkUnary call since only `string[]` paths are returned.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Phase 14 plans complete (Plans 01 and 02)
- 6 BUG(v1.2) tests unskipped across both plans, 8 remaining for Phases 15-16
- Phase 15 pipeline fixes can build on the walkPath step handling and scope accumulation patterns established here
- Phase 16 coupled fixes will need the walkFilterStages scope-awareness mechanism (highest regression risk)

## Self-Check: PASSED

- All 3 modified files verified present
- All 5 commits verified in git log
- src/walker.ts contains `step.type === "function"` (function step handling)
- src/walker.ts contains `currentScope = bindVariable` (array scope accumulation)
- business-rules.test.ts: 6 LOOK regression tests
- edge-cases.test.ts: 5 LOOK + 11 ARRS regression tests

---
*Phase: 14-isolated-single-function-fixes*
*Completed: 2026-03-06*
