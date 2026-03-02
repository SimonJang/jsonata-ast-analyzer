# Phase 1: Foundation and Basic Walker - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Custom AST types, parser adapter, and exhaustive walker that extracts data paths from JSONata expressions using simple dot-paths, wildcards, descendants, binary operators, conditionals, and block expressions. Variable tracing, scope analysis, and filter/sort context resolution are out of scope (Phases 2-3).

</domain>

<decisions>
## Implementation Decisions

### Path output format
- Dot-notation strings matching JSONata syntax (e.g., `"account.orders.price"`)
- Return `PathResult` objects from day one (not plain strings) to avoid breaking changes when Phase 4 adds confidence annotations
- Deduplicate paths in output — callers care about "what data is accessed", not frequency
- Function name: `extractPaths(expression: string): PathResult[]`

### Wildcard & special segment representation
- Literal `*` in path strings for wildcards: `"order.*"`
- Literal `**` for descendant operator: `"**.price"`
- Full path context preserved: `"account.**.price"` (not just `"**.price"`)
- Bracket wildcard `[*]` for dynamically computed paths (Phase 4): `"item[*]"`
- Parent operator `%` representation deferred to Phase 4 discussion

### Error & edge case behavior
- Throw on invalid JSONata input — let the jsonata parser's error propagate to the caller
- String-only input — `extractPaths` accepts expression strings, not pre-parsed ASTs
- Pre-parsed AST support can be considered for Phase 5 public API if needed

### Project setup
- Package manager: pnpm
- Test framework: Vitest
- Module format: ESM only (`"type": "module"`)
- TypeScript with strict mode

### Claude's Discretion
- Unknown/unexpected AST node handling strategy (skip, warn, or throw)
- Empty expression and whitespace-only input behavior
- Package name (jsonata-ast-analyzer, jsonata-path-extractor, or similar)
- Build tooling (tsup, tsc, unbuild, etc.)
- Source directory structure and file organization
- TypeScript strictness level details

</decisions>

<specifics>
## Specific Ideas

- Path format should mirror JSONata's own syntax — `"account.name"` not `["account", "name"]`
- Objects from day one pattern: `{ path: "account.name" }` even before metadata fields exist, so the API contract is stable across all 5 phases
- Deduplication keeps output clean for the primary use case: "tell me what fields this expression reads"

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project with no existing source code

### Established Patterns
- None yet — Phase 1 establishes all foundational patterns (AST types, walker architecture, test structure)

### Integration Points
- jsonata npm package — parser produces the AST that the walker traverses
- No existing routes, components, or providers to integrate with

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-and-basic-walker*
*Context gathered: 2026-03-02*
