# Phase 3: Context-Relative Operators - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract accurate data paths from filter predicates, sort expressions, transform operators, and array indexing — all of which resolve sub-expression paths relative to their parent context. Does NOT include parent operator (`%`), dynamic paths, or confidence annotations (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Filter context resolution
- Use prefix-after-walk approach: walk the filter predicate expression normally, then prefix all resulting paths with the parent collection path (e.g., `items[price > 10]` → walk `price > 10` → get `["price"]` → prefix with `items` → `["items.price"]`)
- Recursive prefixing for nested filters: each nesting level adds its prefix (`orders[items[price > 10]]` → `price` → `items.price` → `orders.items.price`)
- Focus variables (`@$v`): bind `$v` to the collection path in a child scope so `$v.name` inside the filter resolves to `items.name`
- External variable references inside filters resolve normally through scope chain — no context prefix applied to variable-resolved paths (e.g., `items[price > $threshold]` → `$threshold` resolves via scope, not prefixed with `items`)

### Index vs filter distinction
- Explicit check: if `filter.expr.type === "number"`, treat as array indexing — no paths extracted, no context prefixing. Applies to all numeric literals (positive, negative, zero)
- Non-numeric filter expressions (including variable references like `$i`) are treated as filter predicates — over-approximate by extracting and context-prefixing paths. Safer for static analysis
- Bare name boolean coercion filters (e.g., `items[active]`) get context-prefixed: `items.active`

### Sort & group-by extraction
- Same prefix-after-walk approach as filters: walk sort term expressions, prefix with collection path (`items^(price)` → `items.price`, `items^(>price, <date)` → `items.price` + `items.date`)
- Sort direction flags (`descending: true/false`) are ignored — they affect ordering, not which data is read
- Sort steps are transparent to path building: `items^(price).name` produces base path `items.name` (sort step skipped in `buildPathString`, walked separately for sort key paths)
- Group-by: both key and value expressions are context-prefixed (`items{category: price}` → `items.category` + `items.price`)

### Transform operator paths
- Extract from `pattern` (the target object — a data read) and `update` values (context-relative reads)
- Update values are prefixed with pattern path: `| Account | {"name": FirstName} |` → `Account` + `Account.FirstName`
- Update keys are not extracted (they define output field names, not data reads)
- Delete clause contains string literals (field names to remove) — no paths extracted
- Reuse existing `walkUnary` for the update node (it's a unary `{` node), then prefix results with pattern path

### Claude's Discretion
- Internal helper function organization (how to structure walkFilter, walkSort, walkTransform)
- Whether to extract the context prefix computation into a shared utility or inline per operator
- Test case organization and grouping strategy
- Error handling for malformed AST nodes (missing fields on filter/sort/transform)

</decisions>

<specifics>
## Specific Ideas

- Uniform prefix-after-walk pattern across all three context-relative operators (filter, sort, transform) — consistent mental model
- The `buildPathString` function already skips unknown step types (like sort steps) — this future-proofing pays off now
- `NameNode.stages` property is already defined in types for filter/sort stages — the type system is ready

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `walkNode` switch dispatcher: new cases for `filter`, `sort`, `transform` node types (currently fall to `default: return []`)
- `ScopeTracker` with `childScope`, `bindVariable`: ready for creating filter contexts and binding focus variables
- `buildPathString`: already skips unknown step types — sort steps pass through transparently
- `walkUnary` (case `{`): walks object constructor values — reusable for transform update nodes
- `NameNode.stages` property: already typed for filter/sort stage arrays
- `NameNode.focus` / `NameNode.index` properties: ready for context/positional variable binding
- `PathNode.group` property: already typed for group-by expression

### Established Patterns
- Walker pattern: add a case to `walkNode` switch, create a `walkXxx` helper function
- Immutable scope threading: each handler receives scope, passes it through
- TDD approach with test files in `test/` directory
- Path concatenation via `buildPathString` or manual `.` joining
- Over-approximation principle: when in doubt, report the path rather than skip it

### Integration Points
- `walkPath` (line 79-104): needs to detect `stages` on name steps and walk filter/sort/index stages with context prefixing
- `walkNode` switch: needs new cases for `sort` and `transform` node types (filter is handled via stages, not as a top-level type)
- `buildPathString`: sort steps already skip silently — no changes needed
- `walkBlock`: no changes needed — transform/filter expressions in blocks are walked via `walkNode`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-context-relative-operators*
*Context gathered: 2026-03-02*
