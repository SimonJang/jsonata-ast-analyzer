---
phase: 02-scope-infrastructure-variable-tracing
plan: 02
subsystem: core
tags: [typescript, jsonata, ast, lambda, higher-order, apply-operator, scope, custom-functions, tdd, vitest]

# Dependency graph
requires:
  - phase: 02-scope-infrastructure-variable-tracing
    plan: 01
    provides: "ScopeTracker with bindVariable/resolveVariable, BUILTIN_FUNCTIONS, HIGHER_ORDER_SEMANTICS, scope-aware walker with function pass-through"
provides:
  - "Lambda-aware walker with higher-order function resolution ($map, $filter, $reduce, $each, $sift, $sort)"
  - "Apply operator (~>) handler that prepends lhs as first argument to rhs function"
  - "Custom function call tracing through scope-bound lambdas (bindLambda/resolveLambda)"
  - "Thunk lambda unwrapping for parser-generated wrappers"
  - "16-test lambda/higher-order/apply/custom-function suite"
affects: [03-filter-sort, 04-confidence, 05-public-api]

# Tech tracking
tech-stack:
  added: []
  patterns: [higher-order-semantic-binding, lambda-scope-storage, apply-operator-rewrite, thunk-unwrapping, custom-function-tracing]

key-files:
  created: []
  modified: [src/walker.ts, src/scope.ts, src/types.ts, test/extract-paths.test.ts]

key-decisions:
  - "Extend ScopeTracker with lambdas Map for custom function node storage alongside paths"
  - "Thunk lambdas (parser-generated) are unwrapped by walking their body, not treated as definitions"
  - "Apply operator creates synthetic FunctionNode with lhs prepended -- dedup handles duplicates"
  - "Higher-order semantic roles map to two binding categories: data-bound (element/value/left/right/array/accumulator) and non-data (index/key)"

patterns-established:
  - "Higher-order semantic binding: lambda params bound to data arg paths based on HIGHER_ORDER_SEMANTICS role map"
  - "Custom function tracing: bindLambda stores LambdaNode at bind-time, resolveLambda retrieves at call-time"
  - "Apply rewrite: ~> operator creates augmented FunctionNode, reuses walkFunction for uniform handling"
  - "Thunk unwrapping: parser thunk lambdas detected via thunk flag, body walked with current scope"

requirements-completed: [SCOPE-04, SCOPE-05]

# Metrics
duration: 5min
completed: 2026-03-02
---

# Phase 2 Plan 02: Lambda Resolution, Higher-Order Functions, Apply Operator, and Custom Function Tracing Summary

**Lambda-aware walker resolving $map/$filter/$reduce/$each/$sift parameter bindings, apply operator (~>) rewriting, and custom function call tracing through scope-stored lambdas across 65 passing tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-02T15:00:10Z
- **Completed:** 2026-03-02T15:05:20Z
- **Tasks:** 3 (RED, GREEN, REFACTOR)
- **Files modified:** 4

## Accomplishments
- Lambda-aware function handler replacing pass-through with semantic parameter binding for all 6 higher-order functions ($map, $filter, $reduce, $each, $sift, $sort)
- Apply operator (~>) handling that rewrites `lhs ~> fn(args)` to `fn(lhs, args)` for uniform processing
- Custom function call tracing (SCOPE-05) through scope-stored lambda nodes with parameter-to-argument binding
- Thunk lambda unwrapping for parser-generated wrapper nodes in nested higher-order expressions
- 16 new tests covering all plan truths plus nested higher-order edge case, zero regressions

## Task Commits

Each TDD phase was committed atomically:

1. **RED: Failing tests** - `8da43a7` (test) - 16 new tests, 11 failing
2. **GREEN: Implementation** - `36e6c72` (feat) - all 65 passing
3. **REFACTOR: Cleanup** - `9d21a5b` (refactor) - add thunk type property, remove cast

## Files Created/Modified
- `src/walker.ts` - 426-line lambda-aware walker with 14 handler functions including walkFunction, walkHigherOrderCall, walkLambdaWithBindings, walkCustomFunctionCall, walkApply, walkLambda
- `src/scope.ts` - 97-line scope module extended with lambdas Map, bindLambda, and resolveLambda for custom function storage
- `src/types.ts` - 161-line type definitions with optional thunk property on LambdaNode
- `test/extract-paths.test.ts` - 476-line test suite with 65 tests (49 prior + 16 new)

## Decisions Made
- Extended ScopeTracker with a parallel `lambdas: Map<string, LambdaNode>` to store lambda node references alongside path bindings, keeping the immutable pattern while enabling custom function call tracing
- JSONata parser thunk lambdas (auto-generated wrappers with `thunk: true` and no arguments) are unwrapped by walking their body directly rather than treating them as lambda definitions
- Apply operator creates a synthetic FunctionNode with lhs prepended to arguments, then delegates to walkFunction for uniform higher-order and custom function handling; deduplication in extractPaths handles the double-walk of lhs
- Higher-order semantic roles consolidated into two binding categories: data-bound roles (element, value, left, right, array, accumulator) map to data argument paths, non-data roles (index, key) bind to empty arrays

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Handle parser thunk lambdas in nested higher-order calls**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Nested `$map` calls produce a thunk lambda wrapper (`{ type: "lambda", thunk: true, arguments: [], body: ... }`) around the inner function call. The walkLambda handler returned [] for all lambdas, causing nested higher-order calls to lose their inner paths.
- **Fix:** Added thunk detection in walkLambda: if `node.thunk` is true, walk the body with current scope instead of returning []. Added `thunk` property to LambdaNode interface.
- **Files modified:** src/walker.ts, src/types.ts
- **Verification:** Nested $map test passes: `$map(items, function($v) { $map($v.children, function($c) { $c.name }) })` correctly returns `["items", "items.children", "items.children.name"]`
- **Committed in:** `36e6c72` (GREEN), refined in `9d21a5b` (REFACTOR)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Thunk handling was necessary for correctness with nested higher-order functions. No scope creep.

## Issues Encountered
None beyond the thunk lambda discovery documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 2 complete: all SCOPE-01 through SCOPE-05 requirements implemented
- Walker handles all variable resolution patterns: simple assignment, multi-hop chains, lambda parameter binding, higher-order functions, apply operator, custom function calls
- 65 comprehensive tests provide regression protection for Phase 3 (filter/sort stages)
- Filter/sort stages on NameNode (Phase 3) can build on the variable resolution and lambda infrastructure
- `pnpm test` all green, `pnpm typecheck` clean

---
*Phase: 02-scope-infrastructure-variable-tracing*
*Completed: 2026-03-02*
