# Phase 4: Advanced Analysis - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the path extraction system to handle three advanced cases: parent-operator paths (`%`), dynamically-computed bracket paths (`item[$field]`), and confidence annotations on all extracted paths. The public API (`PathResult`) gains a required `confidence` field. No new path types beyond what these three requirements cover.

</domain>

<decisions>
## Implementation Decisions

### Dynamic path notation (ADV-02)
- Only `$variable` in bracket position triggers dynamic treatment: `item[$field]` where `$field` is unresolved → produces `item[*]`
- Bare name filters (`item[fieldName]`) keep current behavior: produces `item` + `item.fieldName` (fieldName is a field reference, not a computed key)
- The `[*]` notation is bracket-wildcard — a new notation distinct from dot-wildcard (`item.*`)

### Parent operator output (ADV-01)
- `%` is kept as a literal path segment
- Standalone `%` → `"%"`
- `%.name` → `"%.name"`
- `item.%.name` → `"item.%.name"`
- The `%` segment propagates through path building like any other segment

### Confidence field API shape (ADV-03)
- `confidence` is always required on `PathResult` — no optional/nullable
- Type: `"static" | "dynamic" | "partial"` string union
- Full interface: `{ path: string; confidence: "static" | "dynamic" | "partial" }`
- Meaning:
  - `"static"` — fully resolvable at analysis time (no unknowns)
  - `"dynamic"` — contains a computed/unresolvable segment (`[*]`)
  - `"partial"` — contains a parent-operator segment (`%`), parent context unresolvable

### Confidence propagation rules
- Priority order: `"partial"` > `"dynamic"` > `"static"`
- Any path containing a `%` segment → `"partial"` (regardless of other segments)
- Any path containing a `[*]` segment (but no `%`) → `"dynamic"`
- All other paths → `"static"` (including explicit dot-wildcards like `item.*` and `**.price`, which are written by the author and fully known at analysis time)

### Claude's Discretion
- Internal representation change: `walkNode` currently returns `string[]` — implementation may change internal type to carry confidence alongside path strings, or use a post-processing pass (mark strings containing `[*]` as dynamic, `%` as partial)
- Exact deduplication behavior when same path appears with different confidence levels (e.g., same path derived via two routes — one static, one dynamic)
- Whether `buildPathString` needs to understand `[*]` notation or if `[*]` is injected at the walker level

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildPathString` (src/path-builder.ts): builds dot-notation strings from step arrays — may need to skip or represent `[*]` segments, or walker handles `[*]` injection itself
- `prefixPaths` helper (src/walker.ts): prefixes paths with context — used in filter/sort/group-by, will interact with new `[*]` paths
- `walkFilterStages` (src/walker.ts): where filter predicate walking lives — ADV-02 change goes here (detect unresolved `$variable` predicate → emit `contextPrefix + "[*]"` instead of walking predicate)
- `walkVariable` (src/walker.ts): handles `$variable` resolution — currently returns `[]` for unresolved variables; ADV-02 logic needs to intercept this at the filter-stage level, not variable level

### Established Patterns
- Over-approximation principle: prefer emitting extra paths over missing paths — maintained by ADV-02 emitting `[*]` rather than dropping
- Immutable scope threading: confidence can be threaded similarly (either as wrapper type or post-processing)
- Silent skip via `default` branch in `walkNode`: parent operator (`%` appears as `BinaryNode` with `value: "%"`) currently falls through to `walkBinary` which walks both sides — ADV-01 needs targeted handling
- `PathResult` lives in `src/types.ts`, `extractPaths` in `src/index.ts` wraps raw strings — both need updating for confidence

### Integration Points
- `src/types.ts`: `PathResult` interface gains required `confidence` field
- `src/index.ts`: `extractPaths` currently does `unique.map((path) => ({ path }))` — must compute confidence per path
- `src/walker.ts`: internal return type may change from `string[]` to `{ path: string, confidence: ... }[]`, OR strings can encode markers (e.g., `[*]` and `%` as detectable characters) with confidence derived in post-processing

</code_context>

<specifics>
## Specific Ideas

- The `%` parent operator appears in `BinaryNode.value` per `types.ts` — need to confirm how JSONata parser actually emits it (may be a dedicated node type, or the `BinaryNode` for `%` with lhs/rhs being the parent and child expressions)
- `item[*]` uses bracket notation — distinguish clearly from `item.*` in output so consumers know the difference between an explicit wildcard and a computed-key access

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-advanced-analysis*
*Context gathered: 2026-03-03*
