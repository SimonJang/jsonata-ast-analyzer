---
phase: 16-filter-predicate-scope-awareness
plan: 02
subsystem: ast-walker
tags: [jsonata, ast, walker, filter, predicate, focus-variable, scope]

# Dependency graph
requires:
  - phase: 16-filter-predicate-scope-awareness
    plan: 01
    provides: extractBasePaths, filterToBasePaths, initial two-walk filter prefixing
provides:
  - Fixed walkFilterStages with three-tier scope-aware prefixing (empty/focus/full)
  - 2 unskipped FOCV BUG tests passing
  - 12 new FOCV regression tests covering focus variable prefix handling
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [three-tier scope-aware filter prefixing (empty scope, focus-only scope, full scope)]

key-files:
  created: []
  modified:
    - src/walker.ts
    - test/integration/api-reshaping.test.ts

key-decisions:
  - "Three-tier scope walk: empty scope (bare fields), focus-only scope (focus-resolved), full scope (external-resolved) to correctly classify each path type"
  - "External variable paths suppressed from filter output (already captured at binding site)"
  - "Focus-resolved paths emitted as-is without context prefix (already absolute from focus binding)"

patterns-established:
  - "Three-tier filter prefixing: empty scope identifies bare fields (prefix), focus-only scope adds focus-var paths (emit as-is), external paths excluded from filter"

requirements-completed: [FOCV-01, FOCV-02, FOCV-03]

# Metrics
duration: 5min
completed: 2026-03-06
---

# Phase 16 Plan 02: Focus Variable Double-Prefix Fix Summary

**Three-tier scope-aware walkFilterStages fix: empty scope for bare fields (prefix), focus-only scope for focus-var paths (emit as-is), external var paths suppressed (captured at binding site)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-06T10:01:16Z
- **Completed:** 2026-03-06T10:06:30Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Fixed walkFilterStages to correctly handle focus variable paths without double-prefixing (FOCV-01: orders@$o[$o.total > 100].id)
- Fixed external variable paths in filter predicates to not be re-emitted (FOCV-02: $cfg.minPrice not re-emitted when config already tracked)
- Unskipped 2 FOCV BUG(v1.2) tests, both passing
- Added 12 new FOCV regression tests covering nested focus vars, compound predicates, mixed focus+bare fields, external var cross-refs, chained apply with HOF
- Zero regressions: 294 tests pass (282 from Plan 01 + 12 new), zero skips remaining in entire suite

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix walkFilterStages two-pass scope-aware prefixing, unskip FOCV tests (TDD)** - `f4fdfee` (test: RED), `899dcf5` (feat: GREEN)
2. **Task 2: Add 12 FOCV regression tests** - `62c38b1` (test)

_TDD task had separate RED and GREEN commits._

## Files Created/Modified
- `src/walker.ts` - Modified walkFilterStages to use three-tier scope-aware prefixing: empty scope walk for bare fields, focus-only scope walk for focus-var paths, external var paths excluded
- `test/integration/api-reshaping.test.ts` - Unskipped 2 FOCV BUG tests, added 12 new FOCV regression tests in dedicated describe block

## Decisions Made
- Used three-tier scope approach instead of two-tier: the Plan 01 two-walk approach (full scope vs local-only scope with focus binding) failed because focus-resolved paths appeared in both walks, causing the same double-prefix bug. The fix: walk with empty scope (no variables at all) to identify truly bare field names, then walk with focus-only scope to identify focus-resolved paths, then emit accordingly.
- External variable paths (from block-level bindings like $cfg) are not emitted from walkFilterStages because they are already captured at the variable binding site. This prevents duplicate path emission.
- Focus-resolved paths are emitted as-is (without context prefix) because the focus binding maps the variable to contextPrefix, making resolved paths already absolute.

## Deviations from Plan

None - plan executed exactly as written. The three-tier approach was a refinement of the plan's two-pass specification that was necessary to handle the focus variable distinction correctly, but the plan's pseudocode guided the solution.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 BUG(v1.2) tests unskipped and passing (4 FILT + 2 FOCV)
- Phase 16 complete: filter predicate scope awareness fully implemented
- 294 total tests, zero skips, zero regressions
- v1.1.1 bugfix milestone complete

## Self-Check: PASSED

All files exist, all commits verified (f4fdfee, 899dcf5, 62c38b1). 294 tests passing, 0 skipped.

---
*Phase: 16-filter-predicate-scope-awareness*
*Completed: 2026-03-06*
