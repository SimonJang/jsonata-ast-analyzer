# Phase 19: API Reference - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Document the complete programmatic API (`extractPaths`, `PathResult`, `Confidence`) so a developer can understand it without reading source code. Content goes under the existing `## API Reference` heading created by Phase 18. No CLI docs, progressive examples, or architecture content — those are later phases.

</domain>

<decisions>
## Implementation Decisions

### Section structure
- Two H3 subsections under `## API Reference`: `### extractPaths(expression)` and `### Types`
- extractPaths heading uses inline TypeScript signature: `### extractPaths(expression: string): PathResult[]`
- Types subsection combines PathResult interface and Confidence type together (not separate H3s)
- Confidence level table lives inside ### Types, directly after the type definitions

### Code examples
- No additional usage example in extractPaths subsection — the Quick Example above already demonstrates it
- Confidence table shows expression-only examples (no output column) — Phase 21 handles full input/output examples
- Confidence table has 4 columns: Level, Meaning, Cause, Example
- Brief one-liner intro before confidence table explaining priority order: partial > dynamic > static

### Error documentation
- Brief inline "Throws" note: throws on invalid JSONata, parser error propagates unmodified
- Mention that empty string throws ("Unexpected end of expression")
- Note that extractPaths always returns an array (never null) or throws — for JS users who don't read types
- Mention deduplication: each unique path appears once

### TypeScript presentation
- Clean type definitions without `export` keywords or JSDoc comments
- Brief bullet list below the code block describing each PathResult field
- `path` description mentions special markers: `[*]` (dynamic segment) and `%` (parent reference)
- `confidence` description references the table below

### Claude's Discretion
- Exact wording of prose descriptions and one-liners
- Which JSONata expressions to use as examples in the confidence table rows
- Spacing and formatting details

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User chose clean, minimal content (no badges, no TOC) per project-level decisions from Phase 18.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/index.ts`: exports `extractPaths(expression: string): PathResult[]`, plus re-exports `PathResult` and `Confidence` types
- `src/types.ts`: `PathResult = { path: string; confidence: Confidence }`, `Confidence = "static" | "dynamic" | "partial"`
- `deriveConfidence()` is internal (not exported) — documents how confidence is derived from path string markers

### Established Patterns
- Phase 18 README has empty `## API Reference` heading ready for content insertion
- README style: clean, no badges, no TOC, package name as H1, minimal prose

### Integration Points
- Insert content under existing `## API Reference` heading in README.md (between Installation and CLI Usage sections)
- Phase 21 (Progressive Examples) will reference confidence levels documented here

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-api-reference*
*Context gathered: 2026-03-09*
