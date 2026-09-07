# Coverage verification

Run the complete existing and additional test suites with a strict coverage gate:

```sh
pnpm test:coverage
```

The target is **100% of lines, statements, functions, and branches** across every
TypeScript file under `src/`. The command exits unsuccessfully while any measured
code remains uncovered. It does not exclude defensive branches or use coverage
ignore comments. Nested development worktrees are excluded from test discovery.

The V8/Istanbul reports are written to the ignored `coverage/` directory:

| Artifact | Purpose |
|---|---|
| `index.html` | Browsable HTML report with annotated source and missing branches |
| `lcov.info` | Standard LCOV data, suitable for Codecov and other coverage services |
| `coverage-summary.json` | Aggregate and per-file percentages |
| `coverage-final.json` | Detailed statement, function, and branch execution counts |
| `clover.xml` | Clover report for CI tools |
| `test-results.json` | Expanded Vitest test results, including parameterized cases |
| `junit.xml` | Standard JUnit test results for CI tools |

The report is local. This command does not upload source, coverage, or test data to
Codecov or another service. The additional tests use synthetic expressions and
ASTs; they do not load Qargo production exports.

## Test preservation and scope

The original tests and fixtures are unchanged. New test files cover CLI output
and failures, parser-to-walker boundaries, context binding, callback and transform
results, recursion guards, and static-analysis handling of incomplete calls.
Internal-operation tests assemble real collaborating walker components rather
than mocking their decisions. CLI failure-format tests substitute the analyzer
boundary only to verify how unexpected thrown values are presented to users.

Code coverage demonstrates execution, not correctness for all possible JSONata
programs. Public-contract tests assert concrete expected paths; internal tests
also assert scope, alias, callable, or path results at their respective boundaries.

## Unreachable-code review

Some unexecuted branches duplicated conditions already enforced by their callers
or earlier returns. These were removed instead of adding impossible tests or
excluding them from coverage:

| Location | Reachability proof |
|---|---|
| `walkReturnedCallableCall` in `src/walker/functions.ts` | Its sole caller dispatches here only for function, block, or path procedures. The repeated rejection of other types cannot execute. |
| `appendSelectionSteps` in `src/walker/transforms.ts` | Its sole caller returns before calling it when the selected remainder is empty. |
| `walkGroupBy` in `src/walker/paths.ts` | Its sole caller checks `node.group` before calling. |
| Named partial fallback in the object-alias, dynamic-alias, and base-path result handlers in `src/walker/results.ts` | Each handler already resolves named partials and returns through its scoped partial handler before reaching the repeated lookup. |
| Older function-result suffix branch in `src/walker/paths.ts` | A function before the final path step is always a result-alias step. With a nonempty base path, the preceding result-alias branch necessarily handles it, making the later `else if` unreachable. |
| Repeated grouped-source lookup in `src/walker/callables.ts` | Both callable resolvers return for a grouped source node before reaching the nested-path branch. |
| Repeated static-key comparison in lookup fallbacks in `src/walker/callables.ts` | Both resolvers return earlier for a non-null static key. Their final object fallback therefore always uses the dynamic-key case. |
| Object predicate/group fallbacks in `src/walker/core.ts` | `dynamicObjectAliasForNode` always returns a variant for an object constructor, including an empty object. Its no-alias fallbacks cannot execute. |
| Repeated preservation and projection fallbacks in `src/walker/aliases.ts` | Unmapped-path preservation already continues earlier. A successful projection has already established that projection expressions exist. Both private suffix-selection callers supply nonempty steps validated by `aliasSuffixStepsFromPath`. |
| Missing-input guard in the private lookup alias helper in `src/walker/results.ts` | Both callers check for an object argument before calling it. |
| Repeated lambda-binding lookup guard in `src/walker/higher-order.ts` | The preceding `findIndex` resolves this exact name in the same immutable scope. |
| Missing-data fallbacks after callback resolution in `src/walker/higher-order.ts` and `src/walker/results.ts` | Finding a callback proves the dense AST argument list is nonempty. Reduce's accumulator falls back to its first argument. The private handlers either return first when no callback exists or are called only after callback resolution. |
| Collection fallback inside partial callback iteration in `src/walker/higher-order.ts` | Without collection data, the list of callback data arguments is empty, so its inner callback cannot execute. |

The latest [verification report](COVERAGE-REPORT.md) separates coverage gained by
the new tests from coverage changes caused by these removals. It also records
the strict coverage gate, original-file hash checks and performance measurements.
