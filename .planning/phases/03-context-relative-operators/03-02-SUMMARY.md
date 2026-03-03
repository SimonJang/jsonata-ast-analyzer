---
phase: 03-context-relative-operators
plan: 02
subsystem: ast-walker
tags: [jsonata, sort, group-by, transform, context-prefix, tdd]

# Dependency graph
requires:
  - phase: 03-context-relative-operators
    plan: 01
    provides: "prefixPaths utility, walkFilterStages pattern, filter stage handling in walkPath"
provides:
  - "SortNode, SortTerm, TransformNode, GroupByNode type definitions"
  - "walkSortTerms helper for sort term path extraction with context prefixing"
  - "walkGroupBy helper for group-by key/value path extraction with context prefixing"
  - "walkTransform handler for transform operator (pattern + prefixed update, skip delete)"
  - "Complete Phase 3: all four context-relative operators (filter, sort, group-by, transform)"
affects: [04-confidence-annotations]

# Tech tracking
tech-stack:
  added: []
  patterns: [sort-context-prefix-off-by-one, group-by-key-value-prefixing, transform-pattern-update-prefixing]

key-files:
  created: []
  modified:
    - src/types.ts
    - src/walker.ts
    - test/extract-paths.test.ts

key-decisions:
  - "Sort context prefix uses slice(0, i) NOT slice(0, i+1) -- sort step is NOT a path segment, unlike filter stages which ARE on the name step"
  - "Group-by cast uses `as unknown as GroupByNode` pattern consistent with FilterStage casting"
  - "Transform update prefixing uses patternPaths[0] as prefix -- first pattern path is the canonical base"
  - "Transform delete clause intentionally not walked -- contains string literals only per JSONata spec"

patterns-established:
  - "walkSortTerms: extracted helper for sort term iteration with context prefix, mirrors walkFilterStages pattern"
  - "walkGroupBy: extracted helper for group-by key/value pair iteration with base path prefixing"
  - "walkTransform: walks pattern for base paths, then walks update with prefix, skips delete"

requirements-completed: [EXPR-07, EXPR-08]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 3 Plan 02: Sort, Group-By, and Transform Extraction Summary

**Sort key extraction with context prefix, group-by key/value prefixing, and transform operator path extraction completing all four context-relative operators**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T06:05:23Z
- **Completed:** 2026-03-03T06:08:22Z
- **Tasks:** 3 (RED, GREEN, REFACTOR)
- **Files modified:** 3

## Accomplishments
- Sort expressions like `items^(price)` now correctly extract sort key paths with context prefix from preceding steps
- Multi-key sort `items^(>price, <date)` extracts all key paths; direction flags are ignored (as expected)
- Group-by expressions like `items{category: price}` extract both key and value paths with base path prefix
- Transform operator `| Account | {"name": FirstName} |` extracts pattern path plus context-prefixed update values
- Transform delete clause correctly skipped (string literals only, no data paths)
- All four context-relative operators (filter, sort, group-by, transform) are now complete

## Task Commits

Each task was committed atomically:

1. **Task 1: RED -- Write failing tests** - `d0aeb97` (test)
2. **Task 2: GREEN -- Implement sort, group-by, and transform** - `1d3766d` (feat)
3. **Task 3: REFACTOR -- Extract walkSortTerms and walkGroupBy helpers** - `1c296cd` (refactor)

_TDD plan with three commits (test -> feat -> refactor)_

## Files Created/Modified
- `src/types.ts` - Added SortNode, SortTerm, TransformNode, GroupByNode interfaces; added SortNode and TransformNode to AstNode union
- `src/walker.ts` - Added sort step handling in walkPath, group-by handling via walkGroupBy helper, walkTransform handler, walkSortTerms helper; updated imports
- `test/extract-paths.test.ts` - Added 11 new tests: 5 for EXPR-07 (sort), 4 for EXPR-08 (transform), 2 for group-by

## Decisions Made
- Sort context prefix uses `slice(0, i)` (steps before sort) NOT `slice(0, i+1)` -- the sort step itself is not a path segment, contrasting with filter stages which are stages ON name steps that ARE part of the path
- Group-by uses `as unknown as GroupByNode` cast pattern, consistent with the `as unknown as FilterStage` pattern from Plan 01
- Transform update prefixing takes `patternPaths[0]` as the canonical prefix for update value paths
- Transform delete clause is intentionally not walked -- it contains string literals specifying field names to remove, not data read paths

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All four context-relative operators complete: filter (Plan 01), sort, group-by, transform (Plan 02)
- Phase 3 is fully complete with all 87 tests passing and typecheck clean
- Ready for Phase 4 (confidence annotations)
- No blockers

## Self-Check: PASSED

All files verified present, all commit hashes verified in git log.

---
*Phase: 03-context-relative-operators*
*Completed: 2026-03-03*
