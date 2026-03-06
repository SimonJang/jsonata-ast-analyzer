---
phase: 16-filter-predicate-scope-awareness
plan: 01
subsystem: ast-walker
tags: [jsonata, ast, walker, filter, predicate, HOF, lambda, scope]

# Dependency graph
requires:
  - phase: 15-pipeline-apply-fixes
    provides: walkApply and walkHigherOrderCall HOF binding infrastructure
provides:
  - extractBasePaths() helper for collection-identity path extraction
  - filterToBasePaths() helper for stripping dot-prefixed extension paths
  - Scope-aware filter predicate prefixing in walkFilterStages
  - 4 unskipped FILT BUG tests and 11 new regression tests
affects: [16-02 focus variable fixes]

# Tech tracking
tech-stack:
  added: []
  patterns: [extractBasePaths structural path extraction, two-walk scope-aware filter prefixing]

key-files:
  created: []
  modified:
    - src/walker.ts
    - test/integration/data-transforms.test.ts
    - test/integration/business-rules.test.ts

key-decisions:
  - "extractBasePaths uses buildPathString for PathNode, filterToBasePaths for VariableNode, recursive lhs for ApplyNode"
  - "walkFilterStages uses two-walk approach (full scope vs local-only scope) to distinguish external variable paths from local field names"
  - "Variable steps in PathNode handled by extractBasePaths via resolution + filterToBasePaths + suffix"

patterns-established:
  - "extractBasePaths: structural base path extraction without filter stage content for HOF binding"
  - "filterToBasePaths: prefix-based path deduplication to keep only root paths from a set"
  - "Two-walk filter prefixing: walk filter expr with full scope and stripped scope to determine which paths need context prefixing"

requirements-completed: [FILT-01, FILT-02, FILT-03, FILT-04, FILT-05]

# Metrics
duration: 4min
completed: 2026-03-06
---

# Phase 16 Plan 01: Filter Predicate Scope Isolation Summary

**extractBasePaths/filterToBasePaths helpers fix filter predicate path leak into HOF lambda bindings; scope-aware walkFilterStages prevents spurious variable-resolved path prefixing**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-06T09:54:19Z
- **Completed:** 2026-03-06T09:58:25Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Fixed 4 FILT BUG(v1.2) tests: filter predicate paths no longer leak into HOF lambda parameter bindings
- Created extractBasePaths() and filterToBasePaths() helpers for structural base path extraction
- Fixed walkFilterStages to not re-prefix variable-resolved absolute paths in filter predicates
- Added 11 new FILT regression tests covering compound predicates, multi-step paths, nested HOFs, $reduce, chained apply, multiple variables in filter
- Zero regressions: 280 tests pass (265 original + 4 unskipped + 11 new), 2 remaining FOCV skips

## Task Commits

Each task was committed atomically:

1. **Task 1: Create extractBasePaths/filterToBasePaths, fix walkHigherOrderCall and walkFilterStages** - `6f2b03c` (test: RED), `0b3af4f` (feat: GREEN)
2. **Task 2: Add 11 FILT regression tests** - `1877f87` (test)

_TDD task had separate RED and GREEN commits._

## Files Created/Modified
- `src/walker.ts` - Added filterToBasePaths(), extractBasePaths() helpers; modified walkHigherOrderCall to use extractBasePaths for lambda binding; modified walkFilterStages for scope-aware prefixing
- `test/integration/data-transforms.test.ts` - Unskipped 3 FILT BUG tests, added 8 regression tests in new FILT regression describe block
- `test/integration/business-rules.test.ts` - Unskipped 1 FILT BUG test, added 3 regression tests in new FILT regression describe block

## Decisions Made
- Used buildPathString for PathNode base path extraction (already skips filter stages by design)
- Used filterToBasePaths for VariableNode to strip predicate-derived suffix paths from resolved path sets
- Used two-walk approach in walkFilterStages: walk filter expression with full scope and local-only scope to distinguish external variable paths from context-relative field names
- Handled PathNode with variable steps in extractBasePaths by resolving variable, applying filterToBasePaths, then appending suffix

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added walkFilterStages fix for FILT-04 (variable-in-filter prefix)**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Plan only specified extractBasePaths/walkHigherOrderCall changes, but FILT-04 (`$min := minPrice; products[price >= $min].name`) fails due to walkFilterStages blindly prefixing variable-resolved paths with context prefix
- **Fix:** Modified walkFilterStages to use two-walk approach: walk filter expression with full scope and with local-only scope (empty parent variables), then only prefix paths that appear in the local-only result
- **Files modified:** src/walker.ts (walkFilterStages function)
- **Verification:** FILT-04 test passes, all 269 tests pass after fix
- **Committed in:** 0b3af4f (Task 1 GREEN commit)

**2. [Rule 1 - Bug] Fixed extractBasePaths PathNode variable step handling**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** extractBasePaths for PathNode used buildPathString which skips variable steps, causing nested HOF paths like `$v.children` to produce `"children"` instead of `"items.children"`
- **Fix:** Added variable step detection in extractBasePaths PathNode branch: resolve variable, apply filterToBasePaths, then append suffix from buildPathString
- **Files modified:** src/walker.ts (extractBasePaths function)
- **Verification:** Nested $map test passes (`items.children.name` correctly produced), 269 tests pass
- **Committed in:** 0b3af4f (Task 1 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes were necessary to make all 4 FILT tests pass without regressions. The plan underspecified the walkFilterStages change and the variable-step edge case. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Filter predicate scope isolation complete
- extractBasePaths pattern established for future HOF-related fixes
- Ready for Plan 02 (FOCV focus variable fixes) which will modify walkFilterStages further
- Only 2 BUG(v1.2) skips remain: FOCV-01 and FOCV-02 in api-reshaping.test.ts

## Self-Check: PASSED

All files exist, all commits verified (6f2b03c, 0b3af4f, 1877f87). 280 tests passing, 2 skipped (FOCV).

---
*Phase: 16-filter-predicate-scope-awareness*
*Completed: 2026-03-06*
