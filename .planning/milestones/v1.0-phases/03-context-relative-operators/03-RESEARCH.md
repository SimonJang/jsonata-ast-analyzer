# Phase 3: Context-Relative Operators - Research

**Researched:** 2026-03-02
**Domain:** JSONata AST walking — filter predicates, sort expressions, transform operators, group-by, and array index distinction
**Confidence:** HIGH

## Summary

Phase 3 adds context-relative path resolution to the walker. The core challenge is that filter predicates, sort keys, transform update values, and group-by expressions all contain sub-expressions whose paths are relative to a parent collection — e.g., `items[price > 10]` means `price` resolves to `items.price`, not a standalone `price`. The solution is a uniform **prefix-after-walk** pattern: walk the sub-expression normally to get raw paths, then prefix each result with the parent collection's path string.

Empirical AST inspection (JSONata 2.1.0) reveals that filters appear as `stages` arrays on `NameNode`, sorts appear as separate `sort`-typed steps in the `PathNode.steps` array, transforms are top-level `transform` nodes with `pattern`/`update`/`delete` children, and group-by is a `group` property on `PathNode`. All these structures are already anticipated by the existing type definitions (`NameNode.stages`, `PathNode.group`) but are currently unhandled — they fall through to the default empty-array return in `walkNode` and silent skip in `buildPathString`.

**Primary recommendation:** Implement prefix-after-walk as a shared `prefixPaths(prefix: string, paths: string[]): string[]` utility, then add handlers for filter stages, sort steps, transform nodes, and group-by in `walkPath`/`walkNode`. Numeric filter check (`expr.type === "number"`) is the gating test for EXPR-06.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use prefix-after-walk approach: walk the filter predicate expression normally, then prefix all resulting paths with the parent collection path (e.g., `items[price > 10]` → walk `price > 10` → get `["price"]` → prefix with `items` → `["items.price"]`)
- Recursive prefixing for nested filters: each nesting level adds its prefix (`orders[items[price > 10]]` → `price` → `items.price` → `orders.items.price`)
- Focus variables (`@$v`): bind `$v` to the collection path in a child scope so `$v.name` inside the filter resolves to `items.name`
- External variable references inside filters resolve normally through scope chain — no context prefix applied to variable-resolved paths (e.g., `items[price > $threshold]` → `$threshold` resolves via scope, not prefixed with `items`)
- Explicit check: if `filter.expr.type === "number"`, treat as array indexing — no paths extracted, no context prefixing. Applies to all numeric literals (positive, negative, zero)
- Non-numeric filter expressions (including variable references like `$i`) are treated as filter predicates — over-approximate by extracting and context-prefixing paths. Safer for static analysis
- Bare name boolean coercion filters (e.g., `items[active]`) get context-prefixed: `items.active`
- Same prefix-after-walk approach as filters for sort: walk sort term expressions, prefix with collection path (`items^(price)` → `items.price`, `items^(>price, <date)` → `items.price` + `items.date`)
- Sort direction flags (`descending: true/false`) are ignored — they affect ordering, not which data is read
- Sort steps are transparent to path building: `items^(price).name` produces base path `items.name` (sort step skipped in `buildPathString`, walked separately for sort key paths)
- Group-by: both key and value expressions are context-prefixed (`items{category: price}` → `items.category` + `items.price`)
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXPR-03 | Extract paths from filter predicates (`items[price > 10]` → `items.price`) | Prefix-after-walk on `NameNode.stages` filter entries; walk `filter.expr` with `walkNode`, prefix results with context path built from preceding steps |
| EXPR-06 | Distinguish array index access from filter predicates | Check `filter.expr.type === "number"` — if true, skip path extraction entirely. Confirmed via AST: `items[0]` produces `{type:"filter", expr:{type:"number", value:0}}` |
| EXPR-07 | Extract paths from sort expressions (`items^(price)` → `items.price`) | Sort appears as a `{type:"sort", terms:[...]}` step in `PathNode.steps`. Walk each `term.expression`, prefix results with context path from preceding steps |
| EXPR-08 | Extract paths from transform operator patterns and update expressions | Transform is a top-level `{type:"transform", pattern, update, delete?}` node. Walk `pattern` for base paths, walk `update` (reuse `walkUnary`) and prefix with pattern path. Delete clause contains only string literals — no extraction needed |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jsonata | 2.1.0 | Parser producing AST to analyze | Already in use — no change |
| vitest | 4.0.18 | Test framework | Already in use — TDD approach continues |
| typescript | ~5.9.3 | Type-safe implementation | Already in use — no change |

### Supporting
No new libraries needed. Phase 3 is purely internal walker logic using existing infrastructure.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared `prefixPaths` utility | Inline prefixing in each handler | Utility reduces duplication across 4+ call sites (filter, sort, group-by, transform update); recommended |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── types.ts          # Add FilterStage, SortNode, SortTerm, TransformNode, GroupBy types
├── walker.ts         # Add walkPath stages handling, walkSort case, walkTransform case, walkGroupBy logic
├── path-builder.ts   # No changes needed (sort steps already skip silently)
├── scope.ts          # No changes needed (childScope + bindVariable already sufficient)
├── builtins.ts       # No changes needed
├── parser.ts         # No changes needed
└── index.ts          # No changes needed
test/
└── extract-paths.test.ts  # Add EXPR-03, EXPR-06, EXPR-07, EXPR-08 test sections
```

### Pattern 1: Prefix-After-Walk (Core Pattern)
**What:** Walk a sub-expression to get raw paths, then prefix each with the parent context path.
**When to use:** Every context-relative operator (filter, sort, group-by, transform update).
**Example:**
```typescript
// Shared utility
function prefixPaths(prefix: string, paths: string[]): string[] {
  return paths.map(p => `${prefix}.${p}`);
}

// Usage in filter stage handling
const filterPaths = walkNode(filterExpr, filterScope);
const prefixed = prefixPaths(contextPrefix, filterPaths);
```
**Confidence:** HIGH — directly implements locked user decision.

### Pattern 2: Context Prefix Computation from Path Steps
**What:** Compute the context prefix string from the PathNode steps up to and including the current name step.
**When to use:** Inside `walkPath` when processing stages on a name step or computing prefix for sort steps.
**Example:**
```typescript
// In walkPath, when step at index i has stages:
// Build prefix from steps[0..i] (inclusive)
const prefixSteps = node.steps.slice(0, stepIndex + 1);
const contextPrefix = buildPathString(prefixSteps);
// Then walk each stage and prefix results
```
**Confidence:** HIGH — verified empirically that `account.orders[total > 100]` puts stages on the `orders` step at index 1, with `account` at index 0.

### Pattern 3: AST-Level Numeric Filter Guard
**What:** Check `stage.expr.type === "number"` to distinguish array indexing from filter predicates.
**When to use:** Before walking any filter stage expression.
**Example:**
```typescript
// For each filter stage on a name step
if (stage.type === "filter") {
  const filterNode = stage as FilterStage;
  if (filterNode.expr.type === "number") {
    // Array index — skip, no paths extracted
    continue;
  }
  // Filter predicate — walk and prefix
  const filterPaths = walkNode(filterNode.expr, filterScope);
  paths.push(...prefixPaths(contextPrefix, filterPaths));
}
```
**Confidence:** HIGH — confirmed via AST: `items[0]`, `items[-1]` both produce `{type:"filter", expr:{type:"number"}}`.

### Pattern 4: Sort Step in walkPath
**What:** Sort appears as a separate step in `PathNode.steps` (type `"sort"`), NOT as a stage on a name step. The walker must detect sort steps, compute context prefix from preceding steps, and walk each sort term's expression.
**When to use:** When iterating `PathNode.steps` in `walkPath`.
**Example:**
```typescript
// In walkPath step iteration, when step.type === "sort":
const sortNode = step as SortNode;
const contextPrefix = buildPathString(node.steps.slice(0, stepIndex));
for (const term of sortNode.terms) {
  const termPaths = walkNode(term.expression, scope);
  paths.push(...prefixPaths(contextPrefix, termPaths));
}
// Don't add sort step to the path segments (buildPathString already skips it)
```
**Confidence:** HIGH — empirically verified: `items^(price)` has steps `[{type:"name",value:"items"}, {type:"sort",terms:[...]}]`.

### Pattern 5: Group-By on PathNode
**What:** Group-by appears as a `group` property on `PathNode` (not on any step). The `group.lhs` is an array of `[key, value]` pairs, structured identically to object constructor pairs. Both key and value expressions get context-prefixed with the full PathNode base path.
**When to use:** After processing all steps in `walkPath`, check for `node.group`.
**Example:**
```typescript
// In walkPath, after building the base path:
if (node.group) {
  const basePath = buildPathString(node.steps);
  for (const [keyExpr, valExpr] of node.group.lhs) {
    const keyPaths = walkNode(keyExpr, scope);
    paths.push(...prefixPaths(basePath, keyPaths));
    const valPaths = walkNode(valExpr, scope);
    paths.push(...prefixPaths(basePath, valPaths));
  }
}
```
**Confidence:** HIGH — empirically verified: `items{category: price}` has `group.lhs: [[{path:"category"}, {path:"price"}]]`.

### Pattern 6: Transform Node (Top-Level)
**What:** Transform is a top-level node type `{type:"transform", pattern, update, delete?}`. Pattern is walked for base paths. Update is a unary `{` node (object constructor) — reuse existing `walkUnary`, then prefix results with pattern path. Delete is a unary `[` node with string literals — no paths to extract.
**When to use:** New `case "transform"` in `walkNode` switch.
**Example:**
```typescript
case "transform":
  return walkTransform(node as TransformNode, scope);

function walkTransform(node: TransformNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];
  // Walk pattern for base paths
  const patternPaths = walkNode(node.pattern, scope);
  paths.push(...patternPaths);
  // Walk update and prefix with pattern path
  const patternStr = patternPaths[0]; // or buildPathString from pattern
  if (node.update) {
    const updatePaths = walkNode(node.update, scope);
    paths.push(...prefixPaths(patternStr, updatePaths));
  }
  // Delete clause: string literals only, no paths
  return paths;
}
```
**Confidence:** HIGH — empirically verified: `| Account | {"name": FirstName} |` → pattern is `{type:"path"}`, update is `{type:"unary", value:"{"}`, delete is `{type:"unary", value:"["}` with string expressions.

### Anti-Patterns to Avoid
- **Prefixing variable-resolved paths inside filters:** Variable references like `$threshold` in `items[price > $threshold]` resolve via scope chain and should NOT be prefixed with `items`. Only direct path references inside the filter get prefixed.
- **Walking the filter expression with scope but forgetting to bind focus variables:** When `@$v` is present on a name step, `$v` must be bound to the context path in a child scope before walking the filter expression.
- **Treating sort as a stage on NameNode:** Sort is a separate step in `PathNode.steps`, not in `NameNode.stages`. Filters are in stages, sorts are in steps — different locations.
- **Modifying buildPathString for sort handling:** `buildPathString` already skips unknown types including sort steps. No changes needed there.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Object constructor walking in transform update | Custom transform update walker | Existing `walkUnary` (case `{`) | Transform update node is literally a unary `{` node — same AST shape as object constructors |
| Child scope for filter context | Custom scope mechanism | Existing `childScope` + `bindVariable` | Focus variable binding uses the same scope infrastructure from Phase 2 |
| Path string construction | Custom string joining | Existing `buildPathString` | It already handles name/wildcard/descendant and skips unknown types |

**Key insight:** The existing walker infrastructure (walkNode dispatch, walkUnary, scope chain, buildPathString) handles most of the heavy lifting. Phase 3 is primarily about detecting the right AST locations (stages, sort steps, group, transform) and applying the prefix-after-walk pattern.

## Common Pitfalls

### Pitfall 1: Sort Context Prefix Off-By-One
**What goes wrong:** The context prefix for sort key expressions must be built from steps BEFORE the sort step, not including it. Since sort is at `steps[i]`, the prefix is `steps[0..i-1]`.
**Why it happens:** The sort step itself is not a path segment — it's an operator. The collection being sorted is described by the preceding steps.
**How to avoid:** Use `buildPathString(node.steps.slice(0, sortStepIndex))` to compute the prefix. Verified: `account.items^(price)` has steps `[account, items, sort]` — prefix for sort keys is `account.items`.
**Warning signs:** Sort key paths missing the collection name (e.g., `price` instead of `account.items.price`).

### Pitfall 2: Filter Prefix in Multi-Step Paths
**What goes wrong:** For `account.orders[total > 100]`, the filter is on the `orders` step (index 1). The context prefix must include ALL preceding steps plus the current step: `account.orders`, not just `orders`.
**Why it happens:** Filters are in `stages` on a specific name step, but that step has a position within the broader path. The context is cumulative.
**How to avoid:** Build prefix from `steps[0..stepIndex]` (inclusive of the step that has the stages).
**Warning signs:** Filter predicate paths missing ancestor segments.

### Pitfall 3: Nested Filter Double-Prefixing
**What goes wrong:** For `orders[items[price > 10]]`, if prefix-after-walk is applied naively, `price` gets prefixed to `items.price` at the inner level, but then the outer filter also prefixes, yielding `orders.items.price`. This is actually CORRECT behavior — but it requires the inner filter to have already produced `items.price` (with its own prefixing) before the outer filter prefixes it with `orders`.
**Why it happens:** Nested filters work recursively — the inner filter's stages are processed first (naturally, since walking the outer filter's expression walks the inner path which has its own stages).
**How to avoid:** The recursive nature of `walkNode` handles this automatically IF stages processing happens inside `walkPath`. When walkPath encounters `items` with a filter stage, it walks the filter expr. That expr contains a `path` node for `items` which itself has stages. The recursion prefixes correctly at each level.
**Warning signs:** Only the outermost prefix applied, or double-prefixing producing `orders.orders.items.price`.

### Pitfall 4: Variable Paths Getting Context-Prefixed
**What goes wrong:** Inside `items[price > $threshold]`, `$threshold` resolves to whatever it was bound to in the outer scope. If we naively prefix ALL paths from the filter expression, the variable's resolved paths get incorrectly prefixed with `items`.
**Why it happens:** The prefix-after-walk approach prefixes ALL returned paths, but variable-resolved paths are already absolute.
**How to avoid:** Two strategies: (a) Walk filter expr in a scope where the context prefix is bound to a focus variable, then only prefix paths that came from direct field references (complex), or (b) Separate the filter expr walk into "context-relative paths" (from walking non-variable nodes) and "absolute paths" (from variable resolution). The user decision says "external variable references resolve normally through scope chain — no context prefix applied to variable-resolved paths."
**Warning signs:** Variable-resolved paths getting the collection name prepended.

**IMPORTANT NOTE on Pitfall 4:** This is the trickiest implementation detail. The simplest approach: walk the filter expression with the focus variable `$` concept — but JSONata's `@$v` already handles this by binding `$v` to the collection path. For bare filters without focus variables, the walker needs to distinguish between paths that came from variable resolution vs. direct field access. One practical approach: walk the filter expression with a child scope, and the returned paths are either (a) already-resolved variable paths (absolute) or (b) relative field paths needing prefixing. Since `walkNode` for `variable` returns resolved paths (already absolute) and `walkNode` for `path`/`name` returns relative paths, the prefix-after-walk naturally works IF variable-resolved paths don't also get prefixed. This means the prefixing must happen at the point where we know a path is context-relative, not at the top level. The practical solution: walk the filter expr's AST nodes that represent field accesses (paths) and prefix those, while letting variable nodes resolve through scope normally without prefixing.

### Pitfall 5: Transform Pattern Path Computation
**What goes wrong:** The transform pattern can be a multi-step path (`items.Account`). The update values need prefixing with the FULL pattern path, not just the last segment.
**Why it happens:** Walking the pattern node with `walkNode` returns `["items.Account"]`. This string is the correct prefix.
**How to avoid:** Use the first element of `walkNode(node.pattern, scope)` as the prefix string (or compute it via `buildPathString` from the pattern's steps).
**Warning signs:** Update value paths only prefixed with last segment of pattern.

## Code Examples

Verified patterns from empirical AST inspection (JSONata 2.1.0):

### AST Structure: Filter as Stage on NameNode
```typescript
// Expression: items[price > 10]
// AST:
{
  type: "path",
  steps: [{
    type: "name", value: "items",
    stages: [{
      type: "filter",
      expr: {
        type: "binary", value: ">",
        lhs: { type: "path", steps: [{ type: "name", value: "price" }] },
        rhs: { type: "number", value: 10 }
      }
    }]
  }]
}
// Expected output: ["items", "items.price"]
// "items" from the base path, "items.price" from prefix("items", walk(filter.expr) → ["price"])
```

### AST Structure: Numeric Index (No Path Extraction)
```typescript
// Expression: items[0]
// AST:
{
  type: "path",
  steps: [{
    type: "name", value: "items",
    stages: [{
      type: "filter",
      expr: { type: "number", value: 0 }  // ← type check gates extraction
    }]
  }]
}
// Expected output: ["items"]
// The numeric filter produces no additional paths

// Same for negative: items[-1] → expr: { type: "number", value: -1 }
```

### AST Structure: Sort as Step in PathNode
```typescript
// Expression: items^(price)
// AST:
{
  type: "path",
  steps: [
    { type: "name", value: "items" },
    { type: "sort", terms: [{
      descending: false,
      expression: { type: "path", steps: [{ type: "name", value: "price" }] }
    }]}
  ]
}
// Expected output: ["items", "items.price"]
// "items" from base path (sort step skipped by buildPathString)
// "items.price" from prefix("items", walk(sort.terms[0].expression) → ["price"])
```

### AST Structure: Multi-Key Sort
```typescript
// Expression: items^(>price, <date)
// AST sort step has two terms:
// terms: [
//   { descending: true,  expression: { path: "price" } },
//   { descending: false, expression: { path: "date" } }
// ]
// Expected output: ["items", "items.price", "items.date"]
```

### AST Structure: Sort with Path Continuation
```typescript
// Expression: items^(price).name
// AST:
{
  type: "path",
  steps: [
    { type: "name", value: "items" },
    { type: "sort", terms: [{ expression: { path: "price" } }] },
    { type: "name", value: "name" }
  ]
}
// Expected output: ["items.name", "items.price"]
// buildPathString(steps) → "items.name" (sort step skipped)
// Sort key: prefix("items", ["price"]) → "items.price"
```

### AST Structure: Group-By on PathNode
```typescript
// Expression: items{category: price}
// AST:
{
  type: "path",
  steps: [{ type: "name", value: "items" }],
  group: {
    lhs: [[
      { type: "path", steps: [{ type: "name", value: "category" }] },  // key
      { type: "path", steps: [{ type: "name", value: "price" }] }      // value
    ]]
  }
}
// Expected output: ["items", "items.category", "items.price"]
```

### AST Structure: Transform Node
```typescript
// Expression: | Account | {"name": FirstName} |
// AST:
{
  type: "transform",
  pattern: { type: "path", steps: [{ type: "name", value: "Account" }] },
  update: {
    type: "unary", value: "{",
    lhs: [[
      { type: "string", value: "name" },        // key (not extracted)
      { type: "path", steps: [{ type: "name", value: "FirstName" }] }  // value
    ]]
  }
}
// Expected output: ["Account", "Account.FirstName"]
```

### AST Structure: Transform with Delete
```typescript
// Expression: | Account | {"name": FirstName}, ["oldField"] |
// AST:
{
  type: "transform",
  pattern: { type: "path", steps: [{ type: "name", value: "Account" }] },
  update: { type: "unary", value: "{", lhs: [[...]] },
  delete: { type: "unary", value: "[", expressions: [{ type: "string", value: "oldField" }] }
}
// Delete clause: string literals only → no paths extracted
// Expected output: ["Account", "Account.FirstName"]
```

### AST Structure: Nested Filter
```typescript
// Expression: orders[items[price > 10]]
// AST:
{
  type: "path",
  steps: [{
    type: "name", value: "orders",
    stages: [{
      type: "filter",
      expr: {
        type: "path",
        steps: [{
          type: "name", value: "items",
          stages: [{
            type: "filter",
            expr: { type: "binary", value: ">",
              lhs: { type: "path", steps: [{ type: "name", value: "price" }] },
              rhs: { type: "number", value: 10 }
            }
          }]
        }]
      }
    }]
  }]
}
// Processing: outer filter walks its expr → walks PathNode[items] → items has filter stage →
// inner filter: prefix("items", walk(price > 10)) → "items.price"
// inner path result: ["items", "items.price"]
// outer filter: prefix("orders", ["items", "items.price"]) → ["orders.items", "orders.items.price"]
// Final: ["orders", "orders.items", "orders.items.price"]
```

### AST Structure: Filter in Middle of Path
```typescript
// Expression: account.orders[total > 100].items
// AST:
{
  type: "path",
  steps: [
    { type: "name", value: "account" },
    { type: "name", value: "orders", stages: [{ type: "filter", expr: { binary: "total > 100" } }] },
    { type: "name", value: "items" }
  ]
}
// Base path: buildPathString(all steps) → "account.orders.items"
// Filter at step index 1: prefix from steps[0..1] → "account.orders"
// Filter paths: prefix("account.orders", walk(total > 100)) → ["account.orders.total"]
// Final: ["account.orders.items", "account.orders.total"]
```

### Focus Variable Binding
```typescript
// Expression: items@$v[price > 10]
// AST NameNode has: { value: "items", focus: "v", stages: [filter...] }
// Before walking filter, create child scope: bindVariable(scope, "v", ["items"])
// Then $v.name inside filter → resolveVariable → ["items"] → "items.name"
// And bare `price` inside filter → context-prefixed → "items.price"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Filters/sorts fall through to empty return | Explicit handling with prefix-after-walk | Phase 3 (now) | Enables complete path extraction for context-relative operators |
| GenericNode catch-all for unknown types | Typed FilterStage, SortNode, TransformNode | Phase 3 (now) | Sort and transform nodes get proper type discriminants instead of falling to GenericNode |

**Deprecated/outdated:**
- Nothing deprecated. All Phase 1/2 infrastructure remains valid and is extended, not replaced.

## Open Questions

1. **Variable path discrimination in filter expressions**
   - What we know: The user decision says variable-resolved paths in filters should NOT be context-prefixed, while direct field references SHOULD be. The current `walkNode` returns a flat `string[]` without marking which paths came from variables vs. field access.
   - What's unclear: The cleanest implementation strategy. Options: (a) track path provenance in the return type, (b) walk filter expressions in a special mode that prefixes at the point of field access, (c) bind a synthetic variable representing the filter context and use existing resolution.
   - Recommendation: Use approach (b) — create a helper `walkFilterExpr(expr, scope, contextPrefix)` that prefixes paths from non-variable sub-expressions. Since `walkNode` for a `variable` node returns already-resolved absolute paths, and `walkNode` for `path`/`name` returns relative paths, we can prefix at the walkPath level when processing filter stages: walk the filter expr normally, then for each resulting path, check if it was produced by a direct field access. In practice, the simplest correct approach: walk the filter's expr with the current scope (variables resolve to their bindings), and prefix ALL non-variable-sourced paths. Since the walker is recursive and variables get resolved to absolute paths, prefixing the entire result of `walkNode(filter.expr, scope)` will correctly prefix relative paths AND incorrectly prefix variable-resolved paths. To fix this, bind a focus variable to the context prefix paths and let references through `$v.field` resolve correctly, OR accept the over-approximation (prefix everything). The user decision states "no context prefix for variable-resolved paths," so this needs careful handling. **Concrete implementation suggestion**: split the filter walk into two parts — (1) walk for variable references separately (they resolve via scope, no prefix), (2) walk for everything else (prefix the results). Alternatively, accept that over-approximation here produces a superset (adding e.g. `items.$threshold` when `$threshold` was meant to resolve absolutely) — this is consistent with the project's over-approximation principle.

2. **Group-by with complex expressions in key/value**
   - What we know: Group-by key and value can be arbitrary expressions, not just simple field names. The walker should handle `items{$toUpper(category): $sum(price)}` by walking the expressions and prefixing.
   - What's unclear: Whether function calls inside group-by expressions should have their argument paths prefixed. By the prefix-after-walk approach, yes — but function names (like `$toUpper`) are variables that resolve to built-ins and produce no paths, so only their arguments get walked and prefixed.
   - Recommendation: Apply prefix-after-walk uniformly. Walk the full expression (including function calls), and prefix results. This handles all cases correctly because variable names resolve to empty and field names get prefixed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest configured via package.json scripts |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXPR-03 | Filter predicate `items[price > 10]` → `["items", "items.price"]` | unit | `pnpm test` | Needs new tests |
| EXPR-03 | Nested filter `orders[items[price > 10]]` → recursive prefix | unit | `pnpm test` | Needs new tests |
| EXPR-03 | Filter in middle of path `account.orders[total > 100].items` | unit | `pnpm test` | Needs new tests |
| EXPR-03 | Boolean coercion filter `items[active]` → `items.active` | unit | `pnpm test` | Needs new tests |
| EXPR-03 | Focus variable binding `items@$v[price > 10]` | unit | `pnpm test` | Needs new tests |
| EXPR-06 | Numeric index `items[0]` → only `["items"]`, no spurious path | unit | `pnpm test` | Needs new tests |
| EXPR-06 | Negative index `items[-1]` → only `["items"]` | unit | `pnpm test` | Needs new tests |
| EXPR-06 | Variable index `items[$i]` → over-approximate as filter | unit | `pnpm test` | Needs new tests |
| EXPR-07 | Sort `items^(price)` → `["items", "items.price"]` | unit | `pnpm test` | Needs new tests |
| EXPR-07 | Multi-key sort `items^(>price, <date)` → both keys prefixed | unit | `pnpm test` | Needs new tests |
| EXPR-07 | Sort with continuation `items^(price).name` → base + sort key | unit | `pnpm test` | Needs new tests |
| EXPR-07 | Multi-step sort `account.items^(price)` → correct prefix | unit | `pnpm test` | Needs new tests |
| EXPR-08 | Transform `\| Account \| {"name": FirstName} \|` → pattern + prefixed update | unit | `pnpm test` | Needs new tests |
| EXPR-08 | Transform with delete clause → no paths from delete | unit | `pnpm test` | Needs new tests |
| EXPR-08 | Transform with multi-step pattern → full prefix on update values | unit | `pnpm test` | Needs new tests |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] New type definitions for FilterStage, SortNode, SortTerm, TransformNode in `src/types.ts`
- [ ] Test cases for all 4 requirements (EXPR-03, EXPR-06, EXPR-07, EXPR-08) in `test/extract-paths.test.ts`

## Sources

### Primary (HIGH confidence)
- JSONata 2.1.0 official parser AST output — empirically verified via `jsonata(expr).ast()` for all operator types (filter, sort, transform, group-by, index access)
- Existing codebase — `src/types.ts`, `src/walker.ts`, `src/scope.ts`, `src/path-builder.ts` read and analyzed

### Secondary (MEDIUM confidence)
- None needed — all findings verified empirically against actual parser output

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, extending existing infrastructure
- Architecture: HIGH - all AST structures empirically verified against JSONata 2.1.0 parser output, prefix-after-walk pattern validated against user decisions
- Pitfalls: HIGH - edge cases identified through systematic AST inspection of 15+ expression variants

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable — JSONata 2.1.0 AST structure unlikely to change)
