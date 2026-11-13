# Changelog

## Unreleased

### Fixed

- Retain assignment effects through constructors, function arguments, operators, projections, filters, sorting, and grouping, including dependent and repeated writes.
- Cover data origins carried through input-dependent projection updates with conservative descendant summaries.
- Follow cycles between projected variable assignments when summarizing repeated updates.
- Preserve sort key assignments in later keys and post-sort predicates, including constructed aliases and captured callbacks.
- Carry earlier path assignments into subsequent constructors, computed projections, and registered-function arguments.
- Retain pre-sort bindings in predicates when a singleton input skips sort key evaluation.
- Preserve absolute captured data origins in sort keys and predicates over constructed objects.
- Follow source data through object projections over explicit arrays, including nested and computed fields.
- Resolve reconstructed assignment values against their preceding constructed-object context.
- Retain constructed current-context aliases when resolving and invoking projected callbacks.
- Preserve assignments exposed to the outer scope by multi-item tuple-sort predicates, subsequent sort keys, and grouping.
- Retain external data and callback reads when selecting suffix projections from constructed aliases.
- Resolve registered-function argument descendants and local assignment reads against constructed current-context aliases.
- Preserve sources and descendant dependencies for values inserted into transform results.
- Cover inserted value descendants conservatively when transform target placement is unresolved, including registered selectors.
- Include descendant reads from the input cloning performed by inline, stored, and higher-order transforms.
- Include `$formatNumber` option-property reads and preserve explicit argument positions inside path steps.
- Include conservative argument-descendant dependencies for registered host functions and opaque replacements of built-ins.
- Retain captured input reads and returned-value descendants for callbacks passed to host functions.
- Include data and reducer-seed descendants when built-ins invoke registered host callbacks, including mixed callback branches.
- Follow custom matcher continuations and preserve source paths selected from custom match groups.
- Avoid repeatedly expanding preceding matcher calls when analyzing continuation chains, while preserving each continuation's captured scope.
- Include object-property enumeration reads for explicit `$keys`, `$spread`, `$boolean`, `$not`, and `$merge` inputs while preserving constructed-object boundaries.
- Resolve static `$eval` result paths with their actual context bindings, including forwarded constructed objects.
- Trace descendant dependencies for deep equality, `$distinct`, and object values serialized by concatenation, including alias and transform contexts.
- Include descendant reads when `$string` or `$clone` consumes selected input values, including aliased and computed lookup results.
- Preserve both constructed and direct input branches through bound block projections and later selections.
- Preserve selected-value coverage for static `$eval` object results and keep consumed arguments out of chained result paths.
- Resolve static `$eval` programs against constructed context aliases, including returned lambdas and root references.
- Keep `$` and dynamic lookups relative to selected items in constructed-object predicates.
- Preserve property sources and selected-value coverage through projections of bound input variables and constructed aliases.
- Retain static and computed object aliases in block results followed by property selections.
- Follow block projections of array-bound input values through later selections and result bindings.
- Preserve source paths and selected-value coverage through dynamic dictionary lookup chains, including callback results, filters, sorting, constructors, and focus bindings.
- Resolve array projections and grouping against parenthesized function results, including nested parentheses and block-local bindings.
- Prevent repeated lookup chains from rewalking the full remaining tail at each step.

## 1.1.0 - 2026-08-27

### Added

- Added `analyzeExpression()` with `exact` or `subtree` dependency coverage for every referenced path.
- Added per-analysis `opaqueFunctions` overrides for host functions that replace recognized JSONata built-ins, including Qargo's `$eval` use case.
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
