# Phase 7: Integration Polish - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Close two specific integration gaps identified in the v1.0 milestone audit: (1) `walkVariable` standalone predicate inspection for function arguments, and (2) CLI error message formatting for jsonata parse errors. Plus drive-by cosmetic cleanup.

</domain>

<decisions>
## Implementation Decisions

### CLI error output
- Single exit code (1) for all errors — no distinction between parse errors and internal errors
- Errors written to stderr (keep current behavior)
- No expression echo in error output — just the error information
- Exit code behavior unchanged from current implementation

### Phase scope
- Strictly the 2 integration gaps from milestone audit: `walkVariable-predicate-gap` and `CLI-error-message`
- Carried-forward tech debt ($sort untested, standalone BindNode, $lookup semantics) stays in the audit — not in scope
- Drive-by cosmetic fixes included: remove unused `ParentNode` import in walker.ts, update ROADMAP.md Phase 6 checkbox and progress table

### Claude's Discretion
- CLI error detail level — how much of jsonata's error object to expose (message, position, token are available)
- walkVariable predicate fix implementation approach — should mirror walkPath's pattern but Claude determines exact mechanics

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The two bugs are well-characterized in the milestone audit with concrete reproduction cases:
- `$map($data[status], fn)` where `$data` resolves to a path — `[status]` filter predicate paths must be extracted
- CLI must show actual error message, not `[object Object]`, for jsonata parse errors

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `walkFilterStages` (walker.ts:208-252): Already handles predicate inspection with context prefix, focus variable binding, numeric index guard, and ADV-02 dynamic wildcard emission — can be called from `walkVariable`
- `walkPath` variable branch (walker.ts:110-116): Reference implementation for VariableNode predicate handling in PathNode context

### Established Patterns
- Predicate handling pattern: resolve variable → check `node.predicate` → call `walkFilterStages` with resolved paths as context prefix
- Error handling in CLI: `try/catch` with message extraction and stderr output
- All walker functions return `string[]` and thread `ScopeTracker`

### Integration Points
- `walkVariable` (walker.ts:380-399): Needs predicate inspection added after variable resolution
- `cli.ts:31-34`: Error catch block needs to handle jsonata's plain object errors (not `Error` instances)
- `walker.ts` imports: `ParentNode` import can be removed (unused)
- `ROADMAP.md` progress table: Phase 6 row needs completion update

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Carried tech debt items remain documented in v1.0-MILESTONE-AUDIT.md.

</deferred>

---

*Phase: 07-integration-polish*
*Context gathered: 2026-03-03*
