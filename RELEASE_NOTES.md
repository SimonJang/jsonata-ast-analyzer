# Release Notes

## Expanded JSONata Coverage

- Keeps the supported public API as `extractPaths(expression): PathResult[]`.
- Adds internal AST normalization and broader read analysis for joins, grouping, ordering, lambdas, partials, regex predicates, constructors, and transforms.
- Preserves conservative summaries for broad or runtime-dependent reads: descendant paths stay as `**`, dynamic bracket variables use `[*]`, and parent reads keep `%` with `partial` confidence.
- Adds benchmark smoke coverage that reports parse-plus-analyze time, raw path count before dedupe, and unique path count after dedupe.
