# Changelog

## Unreleased

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
