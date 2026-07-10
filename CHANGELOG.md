# Changelog

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
