# Phase 5: Public API and CLI - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose the existing path extraction logic as a consumable TypeScript/JS library package and add a CLI binary for command-line use. The core `extractPaths()` function already exists in `src/index.ts` — main work is CLI creation and API surface cleanup.

</domain>

<decisions>
## Implementation Decisions

### CLI output format
- JSON array to stdout — same shape as `PathResult[]` returned by `extractPaths()`
- Format: `[{"path":"items","confidence":"static"},...]`
- JSON is the only output mode (no plain-text or table modes needed)
- Primary use case is LLM tool calling — machine-readable JSON is the right default

### API export surface
- `deriveConfidence()` should be unexported — it is an internal utility
- Only `extractPaths()`, `PathResult`, and `Confidence` should be part of the public API surface
- Keep exports minimal and intentional

### Error handling
- Invalid JSONata expression: print error message to stderr, exit with code 1
- No paths found (valid expression but returns empty): print `[]` to stdout, exit 0
- Claude's Discretion: exact error message format, whether to wrap in JSON envelope or plain text

### Package format
- ESM-only — no CJS output needed
- Current `tsup.config.ts` ESM setup is correct and stays

</decisions>

<specifics>
## Specific Ideas

- Primary consumers are LLMs making tool calls — the JSON output should be clean and parseable without preprocessing
- The CLI output shape mirrors `extractPaths()` return type exactly — no translation layer needed

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/index.ts`: `extractPaths()` is fully implemented and returns `PathResult[]` — CLI can call it directly
- `src/types.ts`: `PathResult` and `Confidence` types already defined — CLI JSON output shape is already there
- `tsup.config.ts`: Single entry `src/index.ts` → needs a second entry for the CLI bin file

### Established Patterns
- ESM modules with `.js` extensions in imports
- `tsup` for build with `dts: true` — type declarations generated automatically
- No runtime dependencies other than `jsonata`

### Integration Points
- `package.json` needs a `bin` field pointing to the compiled CLI entry
- `tsup.config.ts` needs the CLI file added as a second entry point
- `src/index.ts` needs `deriveConfidence` export removed

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-public-api-and-cli*
*Context gathered: 2026-03-03*
