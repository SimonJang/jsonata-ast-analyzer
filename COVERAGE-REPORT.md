# Coverage verification report

**Result: 100% lines, statements, functions and branches. All 2,607 tests passed; none failed or skipped.**

Verified 2026-09-06T21:27:11.945827+00:00 against the working tree based on commit `b1204960b6db122c08686466bfeab71e544ce25a`. Runtime: Node.js 22.23.1 (arm64), pnpm 10.30.3, Vitest 4.1.11, V8 coverage with Istanbul-compatible reports.

| Metric | Original tests / original source | Added tests / original source | Final source / all tests |
|---|---:|---:|---:|
| Lines | 93.64% (3,922/4,188) | 99.37% (4,162/4,188) | 100.00% (4,141/4,141) |
| Statements | 92.10% (4,245/4,609) | 99.30% (4,577/4,609) | 100.00% (4,556/4,556) |
| Functions | 95.05% (673/708) | 99.85% (707/708) | 100.00% (707/707) |
| Branches | 86.07% (3,802/4,417) | 98.86% (4,367/4,417) | 100.00% (4,317/4,317) |

## What changed

- Added 387 tests in 18 new test files, plus one helper that assembles real walker operations.
- Verified SHA-256 hashes for all 19 original test/fixture files: every file is unchanged.
- Removed documented unreachable or repeated conditions in eight walker source files. No source files were excluded from coverage and no ignore directives were added.
- The complete 2,607-test suite also passes against the original source in an isolated temporary copy. That comparison still has 50 uncovered branch outcomes; its strict coverage gate fails as expected. The final source removes those unreachable outcomes and their associated conditional scaffolding.
- Reachability proofs and the reproducible command are in [COVERAGE.md](COVERAGE.md).

## Formal reports

- [HTML coverage report](coverage/index.html): source annotations and per-file results.
- [LCOV report](coverage/lcov.info): standard input for Codecov and compatible tools.
- [Clover XML](coverage/clover.xml), [coverage summary JSON](coverage/coverage-summary.json), and [verification summary JSON](coverage/verification-summary.json).
- [JUnit results](coverage/junit.xml) and [expanded Vitest results](coverage/test-results.json).
- [Per-test proof audit: all 387 added cases](coverage/test-proof-audit.md).

## Verification

| Check | Result |
|---|---|
| `pnpm test:coverage` | Exit 0; 34 files, 2,607 passed, 0 failed/skipped; all four 100% thresholds passed |
| `pnpm typecheck` | Passed |
| Additional tests and coverage configuration TypeScript check | Passed with strict checking |
| `pnpm build` | Passed: ESM library, CLI, source map and declarations |
| Original tests / fixtures | All 19 SHA-256 hashes unchanged |
| `git diff --check` | Passed |

## Performance

- Existing synthetic smoke suite: all five fixtures passed the 1,000 ms limit; measured 0.285–3.766 ms.
- Existing synthetic scaling suite: all 42 combinations (seven families, sizes 10–400) passed. The largest size-400 `analyzeExpression` / `extractPaths` ratio was 1.359, below its 2.0 gate.
- An additional size-400 comparison against the original source flagged `many-bindings` at 1.172×, above the 1.10 regression gate. Three longer focused repeats measured 1.006×, 1.035× and 0.961×; all passed. The initial failure is retained as measurement variability, not hidden or counted as a passing comparison run.
- [Scaling measurements](coverage/scaling.csv), [initial comparison](coverage/scaling-comparison.csv), and focused repeats [1](coverage/many-bindings-trial-1.csv), [2](coverage/many-bindings-trial-2.csv), [3](coverage/many-bindings-trial-3.csv).

## Privacy and scope

At verification time, no source, tests, coverage or Qargo production data was uploaded. Generated coverage artifacts remain local; this Markdown summary is versioned with the code. The new tests and performance fixtures use synthetic expressions and ASTs. This coverage run did not read BigQuery exports or access production services; the earlier private export verification is separate.

Coverage proves execution of the measured source outcomes, not correctness for every input or production performance. Some defensive cases use ASTs the parser would normally normalize or reject; their assertions cover the walker boundary.

Reproduce the strict report with `pnpm test:coverage`. It regenerates HTML, LCOV, Clover, JSON and JUnit artifacts in the ignored `coverage/` directory. This report and the proof audit are snapshots of this verification run.
