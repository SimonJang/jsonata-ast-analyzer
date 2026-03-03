---
phase: 03-context-relative-operators
plan: 01
subsystem: ast-walker
tags: [jsonata, filter, predicate, array-index, context-prefix, tdd]

# Dependency graph
requires:
  - phase: 02-scope-infrastructure
    provides: "Scope chain (childScope, bindVariable, resolveVariable) for filter context variable binding"
provides:
  - "FilterStage type definition for typed filter stage handling"
  - "prefixPaths utility for context-relative path prefixing (reusable by sort, group-by, transform)"
  - "walkFilterStages helper for filter stage path extraction"
  - "isNumericIndex guard for array index vs filter distinction"
  - "Focus variable (@$v) binding in filter scope"
affects: [03-02-context-relative-operators, 04-confidence-annotations]

# Tech tracking
tech-stack:
  added: []
  patterns: [prefix-after-walk, numeric-index-guard, filter-scope-binding]

key-files:
  created: []
  modified:
    - src/types.ts
    - src/walker.ts
    - test/extract-paths.test.ts

key-decisions:
  - "FilterStage kept as standalone interface, not added to AstNode union -- stages are sub-nodes, not top-level AST nodes"
  - "Base path emitted before filter paths in walkPath for consistent ordering"
  - "Negative numeric index handled via isNumericIndex checking unary negation wrapping number literal"
  - "Filter stage cast uses `as unknown as FilterStage` pattern due to GenericNode overlap in AstNode union"

patterns-established:
  - "prefix-after-walk: walk sub-expression normally, prefix all resulting paths with context path"
  - "walkFilterStages: extracted helper for filter stage handling, reusable pattern for Plan 02 sort/group-by"
  - "isNumericIndex: type guard for array index detection, handles both positive and negative literals"

requirements-completed: [EXPR-03, EXPR-06]

# Metrics
duration: 4min
completed: 2026-03-03
---

# Phase 3 Plan 01: Filter Predicate Extraction Summary

**Filter predicate path extraction with context-relative prefixing, numeric index distinction, nested filter support, and focus variable binding**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-03T05:58:12Z
- **Completed:** 2026-03-03T06:02:01Z
- **Tasks:** 3 (RED, GREEN, REFACTOR)
- **Files modified:** 3

## Accomplishments
- Filter predicates in expressions like `items[price > 10]` now correctly extract `items.price` with context-relative prefixing
- Numeric array indices (`items[0]`, `items[-1]`) are distinguished from filter predicates -- no spurious path extraction
- Nested filters (`orders[items[price > 10]]`) recursively prefix at each nesting level
- Focus variable binding (`items@$v[type = "A"]`) correctly binds `$v` to context path in child scope
- Filter in middle of multi-step paths (`account.orders[total > 100].items`) correctly computes context prefix from preceding steps

## Task Commits

Each task was committed atomically:

1. **Task 1: RED -- Write failing tests** - `5ac0454` (test)
2. **Task 2: GREEN -- Implement filter handling** - `c54046b` (feat)
3. **Task 3: REFACTOR -- Extract helpers** - `b6f568c` (refactor)

_TDD plan with three commits (test -> feat -> refactor)_

## Files Created/Modified
- `src/types.ts` - Added FilterStage interface for typed filter stage casting
- `src/walker.ts` - Added prefixPaths utility, walkFilterStages helper, isNumericIndex guard, modified walkPath for filter stage iteration
- `test/extract-paths.test.ts` - Added 11 new tests for EXPR-03 (7 tests) and EXPR-06 (4 tests)

## Decisions Made
- FilterStage kept as standalone interface, not added to AstNode union -- stages are sub-nodes on NameNode, not top-level AST nodes
- Base path emitted before filter paths for consistent ordering in output
- Negative numeric index detection via isNumericIndex helper that checks unary negation wrapping a number literal
- Filter stage cast uses `as unknown as FilterStage` pattern to bridge the GenericNode overlap in AstNode union

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed negative numeric index detection**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** JSONata parser represents `items[-1]` as a filter with `{type: "unary", value: "-", expression: {type: "number"}}`, not directly as `{type: "number"}`. The plan's numeric guard only checked `expr.type === "number"`.
- **Fix:** Added `isNumericIndex` helper that checks both direct number type AND unary negation wrapping a number
- **Files modified:** src/walker.ts
- **Verification:** `items[-1]` test passes -- returns only `[{ path: "items" }]`
- **Committed in:** c54046b (GREEN commit), then extracted to helper in b6f568c (REFACTOR)

**2. [Rule 1 - Bug] Fixed path ordering in walkPath output**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** Initial implementation emitted filter paths before base path, but tests expected base path first (e.g., `[items, items.price]` not `[items.price, items]`)
- **Fix:** Moved base path computation before filter stage iteration
- **Files modified:** src/walker.ts
- **Verification:** All ordering-sensitive tests pass
- **Committed in:** c54046b (GREEN commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered

**TypeScript cast error for FilterStage:** Direct `as FilterStage` cast from `AstNode` failed because `GenericNode` with its index signature doesn't sufficiently overlap with `FilterStage`. Resolved by using `as unknown as FilterStage` cast, which is safe because we guard with `stage.type === "filter"` first.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- prefixPaths utility is ready for reuse by Plan 02 (sort, group-by, transform)
- walkFilterStages pattern establishes the template for walkSortSteps and walkGroupBy
- All 76 tests pass (65 existing + 11 new), typecheck clean
- No blockers for Plan 02

---
*Phase: 03-context-relative-operators*
*Completed: 2026-03-03*
