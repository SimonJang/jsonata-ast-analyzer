# Phase 22: Architecture and Limitations - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

README explains how the analyzer works internally and documents what it intentionally does not do. Content goes under the existing `## How It Works` and `## Limitations` headings created by Phase 18. No API reference, CLI docs, or examples content — those are completed phases.

</domain>

<decisions>
## Implementation Decisions

### Pipeline diagram
- Compact single-line flow style (not box diagram)
- Stages: expression string → parse → walk → dedupe → classify → PathResult[]
- Each stage gets a brief label (e.g., "JSONata parser → AST", "recursive traversal → raw paths")
- Top-level stages only — no scope/variable resolution detail in the diagram itself
- Conceptual labels only — no source file names (parser.ts, walker.ts, etc.)

### Architecture depth
- Pipeline diagram + prose description of stages
- Claude decides how much internal detail to include — no constraints on depth
- Mention the official JSONata parser dependency explicitly (delegated parsing, not reimplemented)
- No test suite size or validation metrics — doesn't belong in architecture docs
- Keep heading as "How It Works" (not "Architecture")

### Over-approximation framing
- Presented as a paragraph at the end of How It Works section (not a separate subsection)
- No concrete example of superset behavior — the concept is clear in prose, and Phase 21 examples already demonstrate it
- No analogy to other static analyzers — keep it direct, audience understands static analysis
- Include one sentence explaining WHY: false positives (extra paths) are safe; false negatives (missed paths) can break downstream consumers

### Limitations
- Three items (not four): static analysis only + no evaluation merged into one, dynamic path wildcards, parent operator approximation
- Framed as deliberate design decisions with rationale (per LMTS-01), not deficiencies
- Format: bold heading + one sentence of rationale per limitation
- No concrete code examples in limitations — examples section already covers these

### Claude's Discretion
- Exact prose wording for stage descriptions
- How much internal detail to expose in the walk stage description (scope chains, variable tracing, filter handling)
- Precise wording of over-approximation paragraph
- Exact rationale sentences for each limitation

</decisions>

<specifics>
## Specific Ideas

No specific requirements — user chose recommended options for structure and tone. Prior phases establish the style: clean, minimal prose, no badges, no TOC.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/index.ts`: `extractPaths()` shows the actual pipeline: `parse()` → `walkNode()` → `Set` dedupe → `deriveConfidence()` → `PathResult[]`
- `src/parser.ts`: wraps official `jsonata` package's parser
- `src/walker.ts`: recursive `walkNode()` dispatcher with scope chain
- `src/scope.ts`: immutable linked-list scope chain for variable tracing
- `src/types.ts`: `PathResult` and `Confidence` type definitions

### Established Patterns
- README style: clean, no badges, no TOC, package name as H1, minimal prose (Phases 18-21)
- Phase 18 created empty `## How It Works` and `## Limitations` headings ready for content insertion
- ASCII art for diagrams (Mermaid explicitly out of scope per REQUIREMENTS)

### Integration Points
- Insert content under existing `## How It Works` heading (between Examples and Limitations)
- Insert content under existing `## Limitations` heading (between How It Works and License)
- Over-approximation paragraph in How It Works connects to limitation framing in Limitations section

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 22-architecture-and-limitations*
*Context gathered: 2026-03-11*
