---
phase: 15-pipeline-and-apply-fixes
verified: 2026-03-06T10:20:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 15: Pipeline and Apply Fixes Verification Report

**Phase Goal:** Apply operator correctly binds inline lambda parameters and variable-resolved sort expressions extract sort key paths relative to the resolved variable
**Verified:** 2026-03-06T10:20:00Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Expression `data ~> function($d) { $d.count }` extracts both `data` and `data.count` | VERIFIED | Test at line 134 of data-transforms.test.ts is unskipped (changed from `it.skip` to `it`), marked FIXED(v1.2), and passing. walkApply at line 702 has `else if (node.rhs.type === "lambda")` branch that creates childScope, binds first lambda parameter via `bindVariable(lambdaScope, lambda.arguments[0].value, lhsPaths)` at line 707, and walks lambda body. |
| 2 | Expression `($x := items; $x^(price))` extracts both `items` and `items.price` | VERIFIED | Test at line 66 of data-transforms.test.ts is unskipped (changed from `it.skip` to `it`), marked FIXED(v1.2), and passing. walkPath variable branch at lines 124-131 iterates suffixSteps for sort nodes and calls `walkSortTerms(remainStep as SortNode, resolvedPath, scope)` at line 128. |
| 3 | Both previously-skipped BUG(v1.2) PIPE tests are unskipped and passing | VERIFIED | Lines 65-75 (variable-resolved sort) and lines 133-143 (inline lambda apply) both use `it(` not `it.skip(`. Comments changed from `BUG(v1.2)` to `FIXED(v1.2)`. Full suite shows 265 passed, 6 skipped (down from 8). |
| 4 | 10+ new regression tests cover apply/lambda and variable-resolved sort patterns | VERIFIED | 12 new tests in PIPE describe block (lines 312-441): 5 apply/lambda regressions, 5 sort regressions, 2 existing behavior verifications. All 12 passing. |
| 5 | All 251+ existing tests continue passing with zero regressions | VERIFIED | Full suite: 265 passed, 6 skipped (271 total). TypeScript compiles cleanly (`pnpm typecheck` exits 0). No test failures. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/walker.ts` | walkApply inline lambda branch | VERIFIED | Line 702: `else if (node.rhs.type === "lambda")` branch with childScope + bindVariable + walkNode(lambda.body). 8 lines added. |
| `src/walker.ts` | walkPath variable branch sort term iteration | VERIFIED | Lines 124-131: iterates suffixSteps for sort nodes, calls walkSortTerms per resolved path. 7 lines added. |
| `test/integration/data-transforms.test.ts` | Unskipped BUG tests and 12 regression tests | VERIFIED | 2 tests unskipped (lines 66, 134), 12 new tests in PIPE describe block (lines 312-441). Total active tests: 35 (38 - 3 skipped). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/walker.ts (walkApply) | childScope + bindVariable from scope.ts | lambda parameter binding | WIRED | Line 707: `bindVariable(lambdaScope, lambda.arguments[0].value, lhsPaths)` -- pattern matches `bindVariable.*lambda\.arguments\[0\]` |
| src/walker.ts (walkPath variable branch) | walkSortTerms | sort term iteration over suffixSteps | WIRED | Line 128: `walkSortTerms(remainStep as SortNode, resolvedPath, scope)` -- pattern matches `walkSortTerms.*resolvedPath` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PIPE-01 | 15-01-PLAN | Apply operator with inline lambda correctly binds lambda parameter and extracts body paths | SATISFIED | walkApply lambda branch at line 702-709. Test at line 134 unskipped and passing. 5 apply/lambda regression tests passing. |
| PIPE-02 | 15-01-PLAN | Variable-resolved sort extracts sort key paths relative to resolved variable | SATISFIED | walkPath sort iteration at lines 124-131. Test at line 66 unskipped and passing. 5 sort regression tests passing. |
| PIPE-03 | 15-01-PLAN | Thorough regression suite (10+ tests) covering pipeline and apply operator path extraction | SATISFIED | 12 new regression tests in PIPE describe block (lines 312-441). All passing. Covers multi-arg lambda, complex body, object constructor, no-params guard, literal lhs, multi-term sort, sort+property, deep path sort key, multi-hop variable, descending sort, HOF behavior preservation, non-variable sort preservation. |

No orphaned requirements found. REQUIREMENTS.md maps PIPE-01, PIPE-02, PIPE-03 to Phase 15, and all three appear in the 15-01-PLAN requirements field.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No TODO/FIXME/HACK/PLACEHOLDER markers found in modified files |

No empty implementations, no console.log-only handlers, no placeholder returns found in `src/walker.ts` or `test/integration/data-transforms.test.ts`.

### Human Verification Required

No human verification items identified. All phase behaviors are fully testable via automated integration tests. Both bug fixes produce deterministic path extraction outputs verified by `assertFixture()`.

### Commit Verification

All 5 commits from SUMMARY exist in git history:
- `ceaacda` -- test(15-01): add failing test for walkApply inline lambda binding
- `99c56f0` -- feat(15-01): fix walkApply to bind inline lambda parameter from apply lhs
- `853ede1` -- test(15-01): add failing test for walkPath variable-resolved sort
- `ed9d65e` -- feat(15-01): fix walkPath variable branch to walk sort terms
- `9fedfc6` -- test(15-01): add 12 PIPE regression tests for apply and sort patterns

### Validation Metrics

- Full suite: 265 passed, 6 skipped (271 total)
- TypeScript: clean (`pnpm typecheck` exits 0)
- BUG(v1.2) markers: 6 remaining across 3 files (all Phase 16 filter/focus bugs)
- `it.skip` count in data-transforms.test.ts: 3 (all Phase 16 filter predicate leaks)
- Suite runtime: ~342ms

### Gaps Summary

No gaps found. All 5 observable truths are verified. Both bug fixes are substantive (not stubs), properly wired to existing infrastructure (childScope, bindVariable, walkSortTerms), and covered by comprehensive regression tests. All 3 requirements (PIPE-01, PIPE-02, PIPE-03) are satisfied. The phase goal is fully achieved.

---

_Verified: 2026-03-06T10:20:00Z_
_Verifier: Claude (gsd-verifier)_
