---
phase: 14-isolated-single-function-fixes
plan: 01
subsystem: walker
tags: [jsonata, ast-walker, path-extraction, object-constructor, block-expression, group-by, variable-resolution]

# Dependency graph
requires:
  - phase: 13-scope-and-advanced-features
    provides: "walkVariable, walkPath, scope chain, variable resolution"
provides:
  - "walkPath handles unary (object constructor) and block expression steps"
  - "walkVariable handles .group property for variable-resolved group-by"
  - "VariableNode interface with optional group property"
  - "23 regression tests covering PRNT and WVAR edge cases"
affects: [15-pipeline-multi-function-fixes, 16-coupled-cross-cutting-fixes]

# Tech tracking
tech-stack:
  added: []
  patterns: ["contextPrefix = buildPathString(node.steps.slice(0, i)) for non-path steps", "suppressBase for block-terminal paths"]

key-files:
  created: []
  modified: [src/walker.ts, src/types.ts, test/integration/api-reshaping.test.ts, test/integration/data-export.test.ts]

key-decisions:
  - "Suppress base path emission when path terminates with block step (pure projection)"
  - "VariableNode group-by uses resolved[0] as base path for prefixing (mirrors walkGroupBy pattern)"

patterns-established:
  - "Non-name step handling in walkPath: use slice(0, i) for context prefix (same as sort)"
  - "Block-terminal paths suppress buildPathString base path to avoid redundant output"

requirements-completed: [PRNT-01, PRNT-02, PRNT-03, WVAR-01, WVAR-02]

# Metrics
duration: 6min
completed: 2026-03-06
---

# Phase 14 Plan 01: walkPath step handling and walkVariable group-by Summary

**Fixed walkPath to extract paths from object constructor and block expression steps, and walkVariable to handle group-by on variable-resolved nodes, with 23 regression tests**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-06T08:32:25Z
- **Completed:** 2026-03-06T08:38:01Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- walkPath now correctly extracts inner paths from object constructor steps (`items.{"key": val}`) and block expression steps (`items.(expr)`) in path nodes
- walkVariable now handles `.group` property for variable-resolved group-by expressions (`$r{key: $sum(val)}`)
- 3 BUG(v1.2) tests unskipped and passing (PRNT-01, PRNT-02, WVAR-01)
- 23 new regression tests covering diverse edge cases across both fix categories
- Zero regressions: all 226 tests pass, TypeScript clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix walkPath unary/block step handling** - `559ed61` (test: RED) + `3cc4aee` (feat: GREEN)
2. **Task 2: Fix walkVariable group-by handling** - `8b3c4e0` (test: RED) + `b4df7b7` (feat: GREEN)
3. **Task 3: Add 23 regression tests** - `dfa8232` (test)

_TDD tasks had separate RED/GREEN commits._

## Files Created/Modified
- `src/walker.ts` - Added unary/block step handling in walkPath loop, group-by handling in walkVariable, base path suppression for block-terminal paths
- `src/types.ts` - Added `group?: AstNode` to VariableNode interface
- `test/integration/api-reshaping.test.ts` - Unskipped PRNT-01/02 BUG tests, added 13 PRNT regression tests
- `test/integration/data-export.test.ts` - Unskipped WVAR-01 BUG test, added 10 WVAR regression tests

## Decisions Made
- **Suppress base path for block-terminal paths:** When a path ends with a block step (`items.(expr)`), the base path (`items`) is not emitted separately because the block is a pure projection -- its inner expressions already produce the complete prefixed paths. Object constructor steps retain the base path since they read items to construct from.
- **VariableNode group-by uses resolved[0] as base:** Mirrors walkGroupBy's use of `buildPathString(node.steps)` for PathNode -- the first resolved path is the equivalent base for variable-resolved group-by prefixing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Suppressed base path for block-terminal paths**
- **Found during:** Task 1 (PRNT-02 test failure)
- **Issue:** `buildPathString(node.steps)` emits `orders.items` for `orders.items.(expr)`, but the PRNT-02 test expects only the block's inner projected paths (not the base). The block step is a pure projection that replaces the output.
- **Fix:** Added `suppressBase` flag that checks if the last step is a block type, and skips emitting the base path in that case.
- **Files modified:** src/walker.ts
- **Verification:** PRNT-02 test passes with correct 2 paths. All other tests unaffected.
- **Committed in:** 3cc4aee (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- walkPath and walkVariable fixes complete, ready for Phase 14 Plan 02 (walkLookup/array step fixes)
- Phase 15 pipeline fixes can build on the step handling patterns established here
- 2 non-PRNT skips remain in api-reshaping.test.ts (focus variable bugs for Phase 16)

## Self-Check: PASSED

- All 5 files verified present
- All 5 commits verified in git log
- src/walker.ts contains `step.type === "unary"` (1 match)
- src/types.ts contains `group?` (2 matches: PathNode + VariableNode)
- api-reshaping.test.ts: 13 PRNT test references
- data-export.test.ts: 10 WVAR test references

---
*Phase: 14-isolated-single-function-fixes*
*Completed: 2026-03-06*
