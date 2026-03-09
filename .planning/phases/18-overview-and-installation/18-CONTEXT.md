# Phase 18: Overview and Installation - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

README opens with value proposition, quick example, install commands, ESM notice, and license. This phase also creates the full README skeleton with empty headings for Phases 19-22 to fill in. No API reference, CLI docs, progressive examples, or architecture content — those are later phases.

</domain>

<decisions>
## Implementation Decisions

### README skeleton
- Full skeleton: Phase 18 writes its own sections fully and creates empty headings for future phases (API Reference, CLI Usage, Examples, How It Works, Limitations)
- Empty headings only — no placeholder text, no HTML comments, no "coming soon" markers
- Later phases (19-22) simply insert content under their respective headings

### Title and heading
- Use npm package name as the H1: `# jsonata-ast-analyzer`
- One-liner description follows immediately underneath (not in the heading itself)

### Section ordering
- title → one-liner → Quick Example → Installation → API Reference → CLI Usage → Examples → How It Works → Limitations → License
- Quick example appears BEFORE installation (show value first, per OVVW-02)

### Claude's Discretion
- Opening one-liner wording and tone
- Which JSONata expression to use in the quick example (should demonstrate core value: expression in, paths out)
- Install command formatting (code block style, tab vs separate blocks for pnpm/npm/yarn)
- ESM-only notice prominence and wording
- License section format

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User chose clean, minimal content (no badges, no TOC) per project-level decisions.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `package.json`: name is `jsonata-ast-analyzer`, license is `ISC`, ESM-only (`"type": "module"`), bin is `jsonata-paths`
- `src/index.ts`: exports `extractPaths(expression: string): PathResult[]` plus `PathResult` and `Confidence` types
- Current README is a placeholder: "jsonata-ast-poc / Sandbox repository to play around with JSONata and related AST parsing"

### Established Patterns
- Package is ESM-only with `exports` map (no CommonJS fallback)
- CLI binary name: `jsonata-paths` (via `bin` field in package.json)
- Build tool: tsup, test runner: vitest

### Integration Points
- README.md at project root — replace current placeholder content entirely
- Future phases (19-22) will edit this same file, inserting content under the empty headings Phase 18 creates

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-overview-and-installation*
*Context gathered: 2026-03-09*
