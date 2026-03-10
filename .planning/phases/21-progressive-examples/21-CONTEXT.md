# Phase 21: Progressive Examples - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

README includes 3-5 progressive worked examples demonstrating all three confidence levels (static, dynamic, partial) across increasingly complex JSONata patterns. Content goes under the existing `## Examples` heading created by Phase 18. No API reference, CLI docs, or architecture content — those are other phases.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
User delegated all decisions to Claude. The following areas are flexible during planning/implementation:

- **Example progression** — Which JSONata patterns to showcase and in what order. Must cover: simple dot-path access (static), variable assignment tracing (static), filter predicates, dynamic/computed paths (dynamic), and parent operator or partial resolution (partial). Must avoid repeating expressions already used in Quick Example (`orders[status = "active"].items.price`), CLI argument mode (`account.name`), or CLI stdin mode (`$sum(orders.total)`).
- **Presentation format** — How each example is displayed (intro sentences, code block style, headings vs numbered list). Should match the clean, minimal prose style established in Phases 18-20.
- **Expression choices** — Which specific JSONata expressions to use. Should feel real-world rather than synthetic. Fresh expressions that don't overlap with earlier README sections.
- **Section intro** — Whether the Examples section needs a brief intro paragraph or jumps straight into examples.
- **Example count** — 3-5 examples per EXMP-01 requirement, covering all three confidence levels across the set.

</decisions>

<specifics>
## Specific Ideas

No specific requirements — user delegated all choices. Prior phases establish the style: clean content, no badges, no TOC, minimal prose with code blocks doing the heavy lifting.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/index.ts`: `extractPaths(expression: string): PathResult[]` — run against candidate expressions to verify output
- `src/types.ts`: `Confidence = "static" | "dynamic" | "partial"` — all three must appear in examples
- Existing test fixtures in `tests/` provide many real-world JSONata expressions with known outputs

### Established Patterns
- README style: clean, no badges, no TOC, package name as H1, minimal prose (Phases 18-20)
- Quick Example uses JS import + code comment showing output array
- CLI examples use shell command + JSON output block
- Confidence table (Phase 19) uses expression-only examples — Phase 21 provides full expression + output pairs
- Phase 18 created empty `## Examples` heading ready for content insertion

### Integration Points
- Insert content under existing `## Examples` heading in README.md (between CLI Usage and How It Works sections)
- Examples should reference confidence levels documented in Phase 19's API Reference section
- Phase 22 (Architecture and Limitations) may reference examples when explaining over-approximation

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-progressive-examples*
*Context gathered: 2026-03-10*
