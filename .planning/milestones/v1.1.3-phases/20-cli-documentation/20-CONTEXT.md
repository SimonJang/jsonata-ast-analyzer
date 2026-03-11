# Phase 20: CLI Documentation - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Document `jsonata-paths` CLI for argument mode and stdin/pipe mode with shell quoting guidance. Content goes under the existing `## CLI Usage` heading created by Phase 18. No API reference, progressive examples, or architecture content — those are other phases.

</domain>

<decisions>
## Implementation Decisions

### Section structure
- Two H3 subsections under `## CLI Usage`: `### Argument Mode` and `### Stdin Mode`
- Each mode shows a runnable command and its compact JSON output
- No usage/help output block at the top — the examples are self-explanatory

### Example expressions
- Argument Mode uses a simple dot-path: `account.name` — different from the Quick Example above to avoid repetition
- Stdin Mode uses a `$` function: `echo '$sum(orders.total)' | jsonata-paths` — naturally ties into the quoting note below
- Output shown as compact single-line JSON (matches actual CLI output from `JSON.stringify`)
- No file piping examples (cat) — standard Unix knowledge, not needed

### Shell quoting note
- Blockquote callout after Stdin Mode section (matches the ESM note style from Installation)
- Includes correct/wrong comparison with `$sum(prices)` as the example expression
- Unix-only — no Windows/PowerShell mention
- Format: `> **Note:**` with embedded code block showing `# Correct` and `# Wrong` comments

### Error behavior
- Brief one-sentence mention after the quoting note: exits with code 1, error to stderr
- No error output example — minimal is enough
- No-argument usage hint not documented — users will see it when they run bare

### Claude's Discretion
- Exact wording of prose around examples
- Spacing and formatting details

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User chose clean, minimal content per project-level decisions from Phase 18.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.ts`: Two modes — argument (`process.argv[2]`) and stdin (piped via readline), output is `JSON.stringify(paths)` to stdout
- CLI binary name: `jsonata-paths` (via `bin` field in package.json)
- Error handling: stderr message + exit code 1, handles both Error instances and unknown types

### Established Patterns
- README style: clean, no badges, no TOC, package name as H1, minimal prose
- Phase 18 created empty `## CLI Usage` heading ready for content insertion
- Installation section uses `> **Note:**` blockquote for ESM notice — quoting note should match this style
- API Reference section (Phase 19) uses H3 subsections for organization

### Integration Points
- Insert content under existing `## CLI Usage` heading in README.md (between API Reference and Examples sections)
- Phase 21 (Progressive Examples) may reference CLI for running examples

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 20-cli-documentation*
*Context gathered: 2026-03-10*
