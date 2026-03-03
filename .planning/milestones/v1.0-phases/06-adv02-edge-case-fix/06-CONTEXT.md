# Phase 6: ADV-02 Edge Case Fix - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the `walkPath` variable-resolution early-return branch so that filter predicates on resolved `VariableNode` steps are inspected for unresolvable `$variable` expressions. When `walkPath` resolves a variable step and returns early (walker.ts:99-117), filter stages on the resolved VariableNode are not checked — the filter-stage loop (lines 127-139) is never reached.

Concrete broken case: `($data := orders; $data[$field].price)` silently emits only `orders.price` instead of also emitting `orders[*]` as a dynamic path.

</domain>

<decisions>
## Implementation Decisions

### Output completeness
- Emit BOTH the dynamic wildcard path (`orders[*]`, confidence: dynamic) AND the resolved path (`orders.price`, confidence: static)
- This matches existing behavior for `orders[$field].price` which emits both `item[*]` and `item` — the composed variable case should be consistent
- Over-approximation is the project's design principle: better to report a path that isn't used than miss one that is

### Edge case breadth
- Fix the identified scenario: single filter predicate on a resolved variable step (`$var[$field].prop`)
- Multi-filter composed cases (`$var[$f1][$f2]`) are out of scope unless they naturally fall out of the fix
- If the fix generalizes cleanly to multi-filter cases, that's fine — but don't over-engineer for it

### Confidence semantics
- Use confidence: `dynamic` for the wildcard path — matches existing ADV-02 behavior for `item[$field]`
- No new confidence levels needed for the composed case

### Claude's Discretion
- Exact placement of the filter-stage inspection (modify early-return branch vs restructure walkPath)
- Whether to extract a helper function or inline the fix
- Any additional test cases beyond the required composed variable-filter scenario

</decisions>

<specifics>
## Specific Ideas

- The fix should ensure `($data := orders; $data[$field].price)` emits `{path: "orders[*]", confidence: "dynamic"}`
- All existing 101 tests must continue to pass — this is a non-breaking fix
- Success criteria from ROADMAP.md are the exact acceptance criteria

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `walkFilterStages` (walker.ts:196-239): Already handles ADV-02 logic for filter predicates on NameNodes — the same logic needs to apply to filters on resolved VariableNodes
- `resolveVariable` (scope.ts:85-97): Variable resolution is already correct; the issue is that filter stages are skipped after resolution
- `buildPathString` (path-builder.ts): Used to construct context prefixes for filter stage walking

### Established Patterns
- Filter stages are processed by iterating `nameStep.stages` and calling `walkFilterStages` with a context prefix (walker.ts:127-139)
- ADV-02 wildcard emission: when a filter predicate is a pure `$variable` with no resolved paths, emit `contextPrefix[*]` with confidence "dynamic" (walker.ts:224-229)

### Integration Points
- The fix is localized to `walkPath` in walker.ts (lines 99-117, the variable-resolution early-return branch)
- Filter stage inspection needs the resolved base path as context prefix (e.g., "orders" from resolving `$data`)
- The VariableNode step may have `.stages` containing FilterStage entries, same structure as NameNode stages

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-adv02-edge-case-fix*
*Context gathered: 2026-03-03*
