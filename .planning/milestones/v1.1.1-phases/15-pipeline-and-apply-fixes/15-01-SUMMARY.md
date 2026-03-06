---
phase: 15-pipeline-and-apply-fixes
plan: 01
subsystem: analysis
tags: [walker, apply, lambda, sort, pipeline, scope, variable-resolution]

# Dependency graph
requires:
  - phase: 14-isolated-single-function-fixes
    provides: "walkBlock terminal suppression, walkVariable group-by, walkPath function chaining, walkUnary array scope"
provides:
  - "walkApply inline lambda parameter binding via childScope + bindVariable"
  - "walkPath variable branch sort term walking via walkSortTerms reuse"
  - "12 PIPE regression tests covering apply/lambda and variable-resolved sort patterns"
affects: [16-filter-and-focus-fixes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "childScope + bindVariable for inline lambda parameter binding in walkApply"
    - "suffixSteps iteration for sort term walking in walkPath variable branch"

key-files:
  created: []
  modified:
    - src/walker.ts
    - test/integration/data-transforms.test.ts

key-decisions:
  - "Only bind first lambda parameter in walkApply (JSONata apply pipes lhs as first arg only)"
  - "Walk all suffixSteps for sort nodes (not just first) to handle multi-sort patterns"
  - "Corrected test expectation for variable-resolved sort+access: bind RHS emits base path too"

patterns-established:
  - "Inline lambda binding pattern: childScope + bindVariable + walkNode(lambda.body) for apply operator"
  - "Sort term iteration pattern: loop suffixSteps checking type=sort, iterate resolved paths for prefix"

requirements-completed: [PIPE-01, PIPE-02, PIPE-03]

# Metrics
duration: 3min
completed: 2026-03-06
---

# Phase 15 Plan 01: Pipeline and Apply Fixes Summary

**Fixed walkApply inline lambda binding and walkPath variable-resolved sort extraction with 12 regression tests**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-06T09:14:07Z
- **Completed:** 2026-03-06T09:17:01Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- Fixed walkApply to bind inline lambda parameters from apply lhs (PIPE-01)
- Fixed walkPath variable branch to walk sort terms after variable resolution (PIPE-02)
- Added 12 regression tests covering diverse apply/lambda and sort patterns (PIPE-03)
- Unskipped 2 BUG(v1.2) tests, reducing total skip count from 8 to 6
- Suite grew from 251 to 265 passing tests with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix walkApply inline lambda parameter binding (TDD)**
   - `ceaacda` (test: RED - unskip inline lambda apply test)
   - `99c56f0` (feat: GREEN - add else-if branch for lambda RHS in walkApply)
2. **Task 2: Fix walkPath variable-resolved sort term extraction (TDD)**
   - `853ede1` (test: RED - unskip variable-resolved sort test)
   - `ed9d65e` (feat: GREEN - add sort term iteration in walkPath variable branch)
3. **Task 3: Add 12 PIPE regression tests** - `9fedfc6` (test)

_Note: TDD tasks have two commits each (test then feat)_

## Files Created/Modified
- `src/walker.ts` - Added inline lambda binding branch in walkApply (~8 lines) and sort term iteration in walkPath variable branch (~7 lines)
- `test/integration/data-transforms.test.ts` - Unskipped 2 BUG tests, added 12 regression tests in new PIPE describe block

## Decisions Made
- Only bind first lambda parameter in walkApply -- JSONata apply operator pipes lhs as first argument only, second+ params are unbound
- Guard with lambda.arguments.length > 0 for zero-arg lambdas (valid pattern: `data ~> function() { 42 }`)
- Walk lambda.body (not lambda node itself) because walkLambda returns [] for non-thunk lambdas
- Iterate ALL suffixSteps for sort nodes (not just first) to handle edge case of multiple sorts
- Corrected regression test expectation: `($x := items; $x^(price).name)` correctly emits `items` (from bind RHS) in addition to `items.name` and `items.price`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected test expectation for variable-resolved sort+access**
- **Found during:** Task 3 (regression test #7)
- **Issue:** Expected `["items.name", "items.price"]` but actual output is `["items", "items.name", "items.price"]` because the bind RHS `$x := items` emits `items` as a base path
- **Fix:** Updated expected to include `items` base path
- **Files modified:** test/integration/data-transforms.test.ts
- **Verification:** Test passes, consistent with all other variable-bind patterns
- **Committed in:** 9fedfc6 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 test expectation correction)
**Impact on plan:** Minor expectation fix -- the analyzer behavior is correct, test was slightly under-specified.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 15 complete (single-plan phase)
- Phase 16 filter-and-focus-fixes can proceed -- 6 remaining BUG(v1.2) skipped tests are all filter predicate leak and focus variable double-prefix issues
- Reminder: Phase 16 requires pre-implementation design for `extractBasePaths()` helper and `walkFilterStages` scope-awareness mechanism

## Self-Check: PASSED

All files exist: src/walker.ts, test/integration/data-transforms.test.ts, 15-01-SUMMARY.md
All commits verified: ceaacda, 99c56f0, 853ede1, ed9d65e, 9fedfc6

---
*Phase: 15-pipeline-and-apply-fixes*
*Completed: 2026-03-06*
