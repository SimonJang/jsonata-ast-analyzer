---
phase: 04-advanced-analysis
plan: "01"
subsystem: ast-walker
tags: [jsonata, ast, parent-operator, wildcard, path-extraction, tdd]

# Dependency graph
requires:
  - phase: 03-context-relative-operators
    provides: filter stage walking infrastructure and walkFilterStages function

provides:
  - ParentNode type in AstNode union (src/types.ts)
  - case "parent" in buildPathString emitting "%" segment
  - case "parent" in walkNode returning ["%"]
  - ADV-02 guard in walkFilterStages: unresolvable $variable -> contextPrefix + "[*]"

affects: [04-advanced-analysis, 04-02-confidence-annotations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parent operator produces literal '%' path segment via case dispatch in walkNode and buildPathString"
    - "ADV-02 guard pattern: intercept variable filter expressions before predicate walk, emit [*] and continue"

key-files:
  created: []
  modified:
    - src/types.ts
    - src/path-builder.ts
    - src/walker.ts
    - test/extract-paths.test.ts

key-decisions:
  - "ADV-01: Parent operator (%) produces literal '%' as path segment -- over-approximate rather than silent drop"
  - "ADV-02: Unresolvable $variable in bracket filter position emits contextPrefix + '[*]' with continue -- replaces predicate walk entirely"
  - "Standalone '%' and '%.name' are JSONata parse errors (S0217) -- only valid inside multi-step path or filter context"
  - "ADV-02 guard uses continue to prevent fallthrough to walkNode which would return [] -- explicit is better than implicit"

patterns-established:
  - "Over-approximation for parent operator: emit '%' segment rather than silently drop unknown step type"
  - "ADV-02 guard pattern: check filterStage.expr.type before walkNode to intercept dynamic filter expressions"

requirements-completed: [ADV-01, ADV-02]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 04 Plan 01: Parent Operator and Dynamic Bracket Wildcard Extraction Summary

**ParentNode type + "%" path segment emission for the % operator, and "[*]" wildcard emission for unresolvable $variable in bracket-filter position, extending the walker to over-approximate two previously silent cases**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-03T09:00:26Z
- **Completed:** 2026-03-03T09:03:12Z
- **Tasks:** 4
- **Files modified:** 4

## Accomplishments
- Added `ParentNode` interface to `src/types.ts` and inserted it into the `AstNode` union before `GenericNode`
- Extended `buildPathString` with `case "parent"` emitting `"%"` so paths like `items.%.name` produce `"items.%.name"`
- Extended `walkNode` with `case "parent"` returning `["%"]` so parent steps are recognized as path-producing nodes
- Added ADV-02 guard in `walkFilterStages`: when filter stage expression is an unresolvable `$variable`, emits `contextPrefix + "[*]"` and skips the predicate walk entirely
- 94 total tests pass (87 existing + 7 new ADV-01/ADV-02 tests); zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing ADV-01 and ADV-02 tests (RED)** - `7370425` (test)
2. **Task 2: Add ParentNode type to src/types.ts** - `d90d441` (feat)
3. **Task 3: Add parent case to buildPathString** - `30bf523` (feat)
4. **Task 4: Add parent case to walkNode + ADV-02 guard in walkFilterStages (GREEN)** - `aaf41d6` (feat)

_Note: TDD plan — RED commit followed by GREEN implementation commits_

## Files Created/Modified
- `src/types.ts` - Added `ParentNode` interface; inserted into `AstNode` union before `GenericNode`; removed stale Phase 4 comment
- `src/path-builder.ts` - Added `case "parent": segments.push("%"); break;` after `case "descendant"`
- `src/walker.ts` - Added `ParentNode` to imports; added `case "parent": return ["%"]` to `walkNode`; added ADV-02 guard to `walkFilterStages`
- `test/extract-paths.test.ts` - Added ADV-01 and ADV-02 describe blocks (7 new tests); fixed 2 test cases that used invalid JSONata expressions

## Decisions Made
- Parent operator `%` produces literal `"%"` as a path segment -- consistent with over-approximation principle
- ADV-02 guard uses `continue` explicitly: the `[*]` emission replaces the predicate walk, it does not supplement it
- `standalone "%"` and `"%.name"` are JSONata parse errors (S0217 - cannot be derived from expression); the plan's test cases for these were corrected to use valid expressions (`"items.%"` and `"items.%.name"`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed invalid JSONata expressions in ADV-01 test cases**
- **Found during:** Task 4 (GREEN verification)
- **Issue:** The plan specified test cases for `extractPaths("%")` and `extractPaths("%.name")`, but JSONata 2.1.0 throws `S0217` for both -- standalone `%` and `%.name` are not valid JSONata expressions (the parent operator is only valid inside a path context like `items.%`)
- **Fix:** Replaced the two invalid test cases with valid alternatives: `"items.%"` (parent at end of multi-step path) and kept `"items.%.name"` (parent mid-path). Removed the standalone `"%"` test case entirely.
- **Files modified:** `test/extract-paths.test.ts`
- **Verification:** All 94 tests pass; no S0217 errors
- **Committed in:** `aaf41d6` (Task 4 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug in test cases)
**Impact on plan:** Fix corrects factual errors about JSONata syntax. The implemented behavior is correct -- `%` produces `"%"` segment in valid paths. No functional scope change.

## Issues Encountered
- JSONata 2.1.0 throws `S0217` for `"%"` standalone and `"%.name"` -- these expressions have no valid parent context. The `%` operator requires a preceding sibling in a path (`items.%`) or appears in a filter predicate (`products[%]`).

## Next Phase Readiness
- ParentNode type and `%` path extraction are complete; ready for Plan 04-02 (confidence annotations)
- ADV-02 `[*]` wildcard emission is active for all unresolvable `$variable` filter expressions
- All 94 tests pass with `{ path }` shape; confidence field addition in 04-02 will not break existing tests

---
*Phase: 04-advanced-analysis*
*Completed: 2026-03-03*

## Self-Check: PASSED

- FOUND: src/types.ts (with ParentNode interface)
- FOUND: src/path-builder.ts (with case "parent")
- FOUND: src/walker.ts (with case "parent" and [*] emission at line 228)
- FOUND: test/extract-paths.test.ts (with ADV-01 and ADV-02 tests)
- FOUND: 04-01-SUMMARY.md
- FOUND: commits 7370425, d90d441, 30bf523, aaf41d6
- All 94 tests pass, TypeScript compiles clean
