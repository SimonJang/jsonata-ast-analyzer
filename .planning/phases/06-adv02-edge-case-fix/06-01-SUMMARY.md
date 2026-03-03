---
phase: 06-adv02-edge-case-fix
plan: 01
subsystem: api
tags: [ast-walker, jsonata, variable-resolution, filter-predicate, tdd]

# Dependency graph
requires:
  - phase: 04-advanced-analysis
    provides: ADV-02 dynamic bracket wildcard logic in walkFilterStages
provides:
  - "Fixed walkPath variable-resolution branch to inspect filter predicates on resolved VariableNode steps"
  - "Refactored walkFilterStages to accept generic stages array instead of NameNode"
  - "VariableNode interface extended with predicate and focus properties"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "walkFilterStages accepts (stages[], contextPrefix, scope, focus?) instead of NameNode -- reusable for both NameNode.stages and VariableNode.predicate"

key-files:
  created: []
  modified:
    - src/walker.ts
    - src/types.ts
    - test/extract-paths.test.ts

key-decisions:
  - "Refactored walkFilterStages signature to accept generic stages array + focus parameter (Strategy A from RESEARCH.md)"
  - "VariableNode interface extended with predicate and focus properties for type safety (matches NameNode pattern)"

patterns-established:
  - "Variable-resolution branch in walkPath inspects predicates before early return -- same pattern should apply to any future VariableNode-carried stage types"

requirements-completed: [ADV-02]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 6 Plan 1: ADV-02 Edge Case Fix Summary

**Fixed walkPath variable-resolution early-return to inspect VariableNode filter predicates, emitting ADV-02 dynamic wildcards for composed variable-filter expressions like `$data[$field].price`**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T10:40:20Z
- **Completed:** 2026-03-03T10:41:50Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Fixed the ADV-02 gap: `($data := orders; $data[$field].price)` now correctly emits `{path: "orders[*]", confidence: "dynamic"}` alongside `{path: "orders.price", confidence: "static"}`
- Refactored `walkFilterStages` from NameNode-specific to generic stages array signature, enabling reuse for both NameNode and VariableNode filter stages
- Extended VariableNode interface with `predicate` and `focus` properties for type-safe access to parser-emitted properties
- All 102 tests pass (101 existing + 1 new), TypeScript compiles cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Add VariableNode interface properties and write failing test** - `50d5149` (test) - TDD RED
2. **Task 2: Fix walkPath and refactor walkFilterStages to close ADV-02 gap** - `1fcbeac` (feat) - TDD GREEN

## Files Created/Modified
- `src/types.ts` - Added `predicate?: AstNode[]` and `focus?: string` to VariableNode interface
- `src/walker.ts` - Refactored walkFilterStages signature; added predicate inspection to walkPath variable-resolution branch
- `test/extract-paths.test.ts` - Added regression test for composed variable-filter scenario

## Decisions Made
- Used Strategy A from RESEARCH.md: refactored `walkFilterStages` to accept `(stages[], contextPrefix, scope, focus?)` instead of `NameNode` -- this reuses existing ADV-02 logic without duplication
- Extended VariableNode interface with `predicate` and `focus` optional properties rather than using `as any` casts -- matches the project's pattern of declaring known parser properties on interfaces (same as NameNode declaring stages/focus)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ADV-02 edge case is fully closed
- All 102 tests pass, TypeScript compiles cleanly
- No follow-up work needed for this phase

## Self-Check: PASSED

- All 3 modified files exist on disk
- Both task commits (50d5149, 1fcbeac) verified in git log
- 102 tests pass, TypeScript compiles cleanly

---
*Phase: 06-adv02-edge-case-fix*
*Completed: 2026-03-03*
