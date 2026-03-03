# Phase 2: Scope Infrastructure and Variable Tracing - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Resolve variable references, function arguments, lambda bindings, and positional variables back to their source data paths. After this phase, `$x := account.name; $x` correctly reports `["account.name"]` instead of nothing. Context-relative operators (filters, sorts, transforms) are Phase 3. Confidence annotations are Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Unresolvable Variable Behavior
- Silent skip for variables that can't be traced — return no paths (consistent with Phase 1 behavior where variables return `[]`)
- Recognize JSONata built-in variables/functions ($sum, $map, $now, etc.) via a maintained list — enables smarter handling
- Extract arguments from unknown function calls as pass-through data paths — `$unknownFunc(a.b)` → `["a.b"]` (over-approximation: arguments are data paths regardless)
- Unresolvable variable in path context (`$x.name` where `$x` is unresolvable) — Claude's discretion on whether to drop or emit wildcard prefix

### Ambiguous Assignment Strategy
- Over-approximate: report ALL possible paths from conditional assignments — `$x := cond ? a.b : c.d; $x` → `["a.b", "c.d"]`
- Merge all possible bindings when variable is assigned in multiple code paths
- Proper lexical scoping with shadowing — inner blocks shadow outer bindings, matching JSONata's actual semantics
- No artificial depth limit on multi-hop chains — resolve to full depth with cycle detection as safety net

### Higher-Order Built-in Coverage
- Core set for lambda-aware resolution: `$map`, `$filter`, `$reduce`, `$each` — covers 90%+ of real-world usage
- Resolve ALL lambda parameters with known semantics — $v = element, $i = index (non-data), $a = full array
- Pass-through extraction for non-higher-order built-ins — `$sum(items.price)` → `["items.price"]` without function-specific awareness
- Full closure resolution — lambdas capture enclosing scope, outer variables used inside lambda body are resolved

### Reassignment Semantics
- Last-write-wins for variable resolution — `($x := a; $x := b; $x)` resolves $x to `["b"]` only
- BUT all RHS paths are extracted as data reads — `a` WAS read from input even if $x is later reassigned, so `["a", "b"]` appear in overall output
- Scope carries across block boundaries — `($x := a.b); $x.name` resolves to `["a.b.name"]`, matching JSONata's actual semantics

### Claude's Discretion
- Partial path handling for unresolvable variables in path context (drop vs. wildcard prefix)
- Bind operator (`~>`) variable passing — whether to handle in Phase 2 or defer
- Exact scope tracker data structure design
- Cycle detection strategy for variable chains
- How to thread scope state through the walker (parameter, class, or other pattern)

</decisions>

<specifics>
## Specific Ideas

- The key distinction: "paths read from input" vs. "what a variable resolves to" — even dead assignments read data, so the RHS paths should always be extracted
- Over-approximation philosophy carries forward from Phase 1: when uncertain, include the path rather than drop it
- The walker currently returns `[]` for variable nodes (walker.ts:41) — this is the entry point for Phase 2 changes

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `walkNode()` (src/walker.ts) — existing dispatch-on-type pattern; will need scope parameter threading
- `buildPathString()` (src/path-builder.ts) — builds dot-notation from AST steps; can be reused for resolved variable paths
- `extractPaths()` (src/index.ts) — pipeline entry point with deduplication; may need scope initialization
- `VariableNode` type (src/types.ts) — already defined with `value: string` (name without $ prefix)
- `GenericNode` catch-all (src/types.ts) — covers `bind`, `lambda`, `function`, `apply` nodes that Phase 2 needs to handle

### Established Patterns
- Switch-based dispatch in walker (node.type → handler function)
- Pure function walker with no state — Phase 2 will change this by adding scope parameter
- Over-approximation: unknown nodes return `[]` rather than throwing
- Test structure organized by requirement ID (PATH-01, EXPR-01, etc.)

### Integration Points
- `walker.ts:41` — `case "variable": return [];` — this is where variable resolution hooks in
- `walker.ts:43` — `default: return [];` — GenericNode handler where bind/lambda/function nodes currently fall through
- `types.ts` AstNode union — needs new typed nodes for bind, lambda, function, apply
- `index.ts` — scope tracker initialization before walkNode call

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-scope-infrastructure-variable-tracing*
*Context gathered: 2026-03-02*
