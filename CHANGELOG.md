# Changelog

## 1.2.0 - Unreleased

### Added

- Added explicit external-function argument contracts with `value` and `subtree` access modes; `opaqueFunctions` remains supported as the value-only shorthand.
- Added `analyzeExpressionWithContext()` with root/current/parent origins and distinct path, wildcard, dynamic, and unresolved access kinds.
- Added parse and analysis diagnostics to contextual results so host adapters cannot confuse analyzer failure with an empty dependency set.
- Added production-shaped semantic and performance regression coverage.

### Fixed

- Preserved deep leaf dependencies when conditional or variable-bound inputs are projected through nested object constructors.
- Prevented host context from requiring synthetic path segments in analyzer output.
- Limited external `subtree` promotion to input values that flow into the argument result, keeping scalar computation dependencies exact.

### Performance

- Memoized immutable scope lookups and callable resolution by scope and AST-node identity with recursion guards.

## 1.1.0 - 2026-08-27

### Added

- Added `analyzeExpression()` with `exact` or `subtree` dependency coverage for every referenced path.
- Added per-analysis `opaqueFunctions` overrides for host functions that replace recognized JSONata built-ins, including host-provided `$eval` helpers that parse JSON strings.
- Added corpus-wide compatibility proof and focused coverage tests without changing existing test expectations or fixtures.

### Performance

- Added same-run comparative scaling measurements for `extractPaths()` and `analyzeExpression()`.
- Enforced release limits of at most 10% median regression for `extractPaths()` and at most 2x its median for `analyzeExpression()` at fixture size 400.

## 1.0.3 - 2026-08-26

### Changed

- Split the analyzer walker into focused modules while preserving the public API and analysis behavior.
- Moved repository-only performance tooling and historical measurements into a dedicated `benchmark/` directory.

### Performance

- Reworked immutable scope updates as constant-time revisions and memoized variable and data-value resolution to avoid repeated map copies and lookup walks.
- Added fast paths for plain property chains and known data paths while preserving existing callable analysis behavior.
- Added reproducible smoke and scaling benchmarks with before-and-after snapshots. On the recorded 400-element fixtures, many-binding analysis improved by 13.6x and alias-chain analysis by 51.5x.

### Fixed

- Added repository, homepage, and issue tracker metadata so npm links back to the GitHub project.

## 1.0.2 - 2026-08-26

### Security

- Updated JSONata to 2.2.2 and refreshed the build and test dependency graph to patched releases.

### Fixed

- Preserved callable values and their source paths through arrays, objects, groups, sorting, transforms, apply chains, and higher-order collection functions.
- Corrected lexical closure, partial application, forward-reference, recursion, and callable rebinding analysis.
- Improved context and suffix propagation through map, each, reduce, spread, sift, lookup, filter, and projection stages.
- Handled empty root projection paths without emitting incorrect reads.

### Tests

- Expanded JSONata conformance and regression coverage for callable, transform, collection, and path-stage semantics.

## 1.0.1 - 2026-07-10

### Fixed

- Corrected path extraction for root and parent references, aliases, callbacks, transforms, dynamic lookups, and chained filter, sort, group, and projection stages.
- Preserved accurate source paths through arrays, objects, conditionals, blocks, constructors, and function results while suppressing synthetic paths.
- Expanded conformance, corpus, and regression coverage for the corrected analyzer behavior.

## 1.0.0 - 2026-07-01

Initial npm release of `jsonata-ast-analyzer`.

### Added

- Public ESM API: `extractPaths(expression): PathResult[]`.
- CLI entrypoint: `jsonata-paths`.
- Static read analysis for JSONata paths, filters, sorting, grouping, context bindings, lambdas, partial applications, regex predicates, constructors, and transforms.
- Conservative confidence markers for runtime-dependent reads: `[*]` for dynamic segments, `%` for parent reads, and `**` for descendant summaries.
- Release check script covering typecheck, build, tests, and benchmark smoke output.
