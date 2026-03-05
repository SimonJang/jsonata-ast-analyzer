# Architecture Patterns: v1.1.1 Bug Fix Integration

**Domain:** Bug fix integration for JSONata AST path extraction walker
**Researched:** 2026-03-05
**Focus:** How 7 bug categories (14 tests) integrate with existing walkNode/scope chain architecture, with suggested fix order

## Existing Architecture Overview

```
parse(expression)          -- parser.ts: JSONata parser adapter
        |
        v
walkNode(ast, scope)       -- walker.ts: recursive type-dispatch (switch on node.type)
        |
        v
string[]  (raw paths)      -- each walk* function returns string[]
        |
        v
new Set(rawPaths)          -- index.ts: dedup via Set insertion order
        |
        v
deriveConfidence(path)     -- index.ts: static/dynamic/partial classification
        |
        v
PathResult[]               -- final output
```

**Key components:**
- `walkNode()` -- top-level dispatcher (switch on 17 node types)
- `walkPath()` -- handles PathNode steps, filter stages, sort terms, group-by
- `walkFilterStages()` -- walks filter predicates with context prefix and focus binding
- `walkHigherOrderCall()` / `walkLambdaWithBindings()` -- HOF parameter binding
- `walkCustomFunctionCall()` -- user lambda tracing
- `walkApply()` -- pipe operator (`~>`) synthetic function construction
- `walkVariable()` -- scope resolution with predicate support
- `walkBlock()` -- sequential scope accumulation
- `walkUnary()` -- array/object constructors
- `walkBind()` -- standalone bind (outside block)
- `ScopeTracker` -- immutable linked list of Maps with parent pointer
- `buildPathString()` -- step array to dot-notation string

## Bug-by-Bug Integration Analysis

### Bug 1: Filter Predicate Path Leak into HOF Bindings (4 tests)

**Root cause:** When a filtered expression like `items[active]` is passed as the data argument to a HOF (`$map`, `$filter`), `walkNode` on that argument produces ALL paths including the filter predicate paths (`["items", "items.active"]`). These paths are then bound wholesale to the lambda parameter via `walkLambdaWithBindings`. The lambda parameter `$v` resolves to `["items", "items.active"]`, so `$v.name` produces both `items.name` (correct) and `items.active.name` (spurious).

**Affected functions:** `walkHigherOrderCall()` (lines 475-507), `walkLambdaWithBindings()` (lines 518-555)

**Integration point:** The fix needs to distinguish "base data paths" from "filter predicate side-effect paths" when binding HOF lambda parameters. The element binding should only receive the base paths (`["items"]`), not the filter predicate paths (`["items.active"]`).

**Fix strategy -- Separate base paths from predicate paths in HOF data arg:**

Option A (recommended): Before binding lambda parameters, identify which paths from the data argument are "base paths" vs "predicate paths". The cleanest approach is to walk the data argument's base expression separately from its filter stages. When the data arg is a PathNode with filter stages or a NameNode with predicates, extract only the base path for element binding.

Concretely, introduce a helper function `extractBasePaths(node, scope): string[]` that walks a node but skips filter/predicate side effects. For a PathNode like `items[active]`, this returns `["items"]` only. The existing `walkNode` call on the data arg still runs (producing `["items", "items.active"]` for the overall output), but `extractBasePaths` is used specifically for the lambda parameter binding.

Option B (alternative): Tag paths with metadata (base vs predicate) throughout the walk. This is a much larger refactor and not recommended.

**Files modified:**
- `walker.ts`: Add `extractBasePaths()` helper, modify `walkHigherOrderCall()` to use it for lambda binding

**Test instances:**
1. `$map(items[active], function($v) { $v.name })` -- direct filter-in-HOF
2. `items ~> $filter(...) ~> $map(...)` -- chained apply with filter leak
3. `($data := items[active]; $map($data, ...))` -- variable-bound filter leak
4. `($min := minPrice; products[price >= $min].name)` -- variable cross-ref in filter

**Note on test 4:** This is slightly different. The bug is that `$min` resolves to `["minPrice"]` inside the filter predicate, and `prefixPaths` then produces `items.minPrice` (spurious). Variable-resolved paths that are already absolute should NOT be context-prefixed. This requires `walkFilterStages` to detect when a sub-expression resolves to an already-scoped path and skip prefixing for it.

**Sub-fix for variable cross-reference in filter predicates:** When walking filter predicate expressions, paths that come from variable resolution (already fully qualified) should not be re-prefixed with the filter context. This requires `walkFilterStages` to differentiate between locally-relative paths (like `price` -> `items.price`) and already-resolved variable paths (like `$min` -> `minPrice`, which should stay as `minPrice`).

The cleanest approach: walk filter predicate sub-expressions individually, and only prefix paths that come from `walkNode` on non-variable nodes. For variable nodes that resolve to scope bindings, emit their resolved paths without prefix. This means modifying the generic `walkNode` + `prefixPaths` pattern in `walkFilterStages` to be scope-aware.

**Complexity:** HIGH -- this is the most impactful and subtle bug category.

---

### Bug 2: $lookup HOF Chaining -- Function Argument Preservation (2 tests)

**Root cause:** `$lookup(inventory, itemCode).quantity` parses as a PathNode where the first step is a FunctionNode and the second step is a NameNode (`quantity`). But `walkPath` only processes `name`, `wildcard`, `descendant`, `parent`, `variable`, `sort`, and `filter` step types. When a step is a `function` node (like the `$lookup` call), `buildPathString` skips it (default case in switch), and the function arguments are never walked.

**Affected functions:** `walkPath()` (lines 98-159), specifically the step iteration loop (lines 138-151)

**Integration point:** `walkPath` needs to detect function-type steps and walk them, incorporating their output paths both as standalone results and as context prefix for subsequent steps.

**Fix strategy:** In the `walkPath` step iteration loop, add handling for steps with `type === "function"`. When encountered:
1. Walk the function node via `walkNode(step, scope)` to extract argument paths (`inventory`, `itemCode`)
2. Use the function step's output as a context prefix for subsequent path steps (`.quantity`)
3. Since `$lookup` is a built-in (not a HOF), `walkFunction` already handles it via pass-through (Step 3 in `walkFunction`), extracting `["inventory", "itemCode"]`

The tricky part is constructing the chained path. `$lookup(inventory, itemCode).quantity` should yield:
- `inventory` (arg 1)
- `itemCode` (arg 2)
- `inventory.quantity` (chained field on the looked-up result)

The function result is semantically "an element of inventory keyed by itemCode", so chaining `.quantity` should prefix with the first argument path. This mirrors how HOF element binding works.

**Files modified:**
- `walker.ts`: Add function-step handling in `walkPath` step loop

**Test instances:**
1. `$lookup(inventory, itemCode).quantity` -- basic chaining
2. `$lookup(products, sku).price` -- same pattern, different field names

**Complexity:** MEDIUM -- localized change to `walkPath` step iteration.

---

### Bug 3: Focus Variable @$v Double-Prefix (2 tests)

**Root cause:** In `orders@$o[$o.total > 100].id`, the focus variable `$o` is bound to `["orders"]` in `walkFilterStages`. When `$o.total` is encountered inside the filter predicate, it resolves to `["orders"]` via scope, producing `orders.total`. But `walkFilterStages` then applies `prefixPaths("orders", ["orders.total"])`, yielding `orders.orders.total` (double-prefixed).

**Affected functions:** `walkFilterStages()` (lines 207-251), specifically the interaction between focus variable binding and context prefixing

**Integration point:** The focus variable is already bound to the context prefix paths. When a filter predicate expression resolves through a focus variable, the resulting paths are already fully qualified -- they should NOT be re-prefixed.

**Fix strategy:** This is actually a sub-case of the same problem described in Bug 1 (variable cross-reference in filter). The fix is the same: paths originating from variable resolution in filter predicates should bypass `prefixPaths`. The focus variable case is the most obvious manifestation because the focus variable IS the context prefix.

Concretely, `walkFilterStages` should not blindly apply `prefixPaths(contextPrefix, filterPaths)` to all paths from the filter expression. Instead, it should:
1. Walk the filter expression with the filter scope
2. Separate the resulting paths into "locally-relative" (need prefix) and "scope-resolved" (already fully qualified)
3. Only prefix the locally-relative paths

This can be implemented by having `walkNode` (or a wrapper) track whether each returned path originated from a variable resolution. One clean approach: walk the filter expression, and for each returned path, check if it starts with any scope-resolved variable's path prefix. If so, do not re-prefix.

Alternatively (simpler): when the focus variable is bound, bind it to empty paths `[]` instead of `[contextPrefix]`, and let scope resolution produce no paths for focus variable references. Then the filter predicate paths from `$o.total` would just be `total` (locally relative), and `prefixPaths` correctly yields `orders.total`. But this breaks the semantics when the focus variable is used in a non-relative context (e.g., passed to a function).

**Recommended approach:** The cleanest fix is to make `walkFilterStages` smarter about what it prefixes. Walk the filter expression. For each resulting path, check if it starts with the context prefix already (from focus variable resolution). If it does, skip prefixing. This handles both focus variables and regular variable cross-references.

**Files modified:**
- `walker.ts`: Modify `walkFilterStages` path prefixing logic

**Dependency:** Shares root cause with Bug 1 filter predicate fixes. Fix them together.

**Test instances:**
1. `orders@$o[$o.total > 100].id` -- focus variable double-prefix
2. `($cfg := config; items[$cfg.minPrice < price].name)` -- variable cross-ref (also listed under Bug 1)

**Complexity:** MEDIUM -- but intertwined with Bug 1's filter predicate work.

---

### Bug 4: Parent Operator walkPath Through Object/Block Steps (2 tests)

**Root cause:** `walkPath` iterates over PathNode steps but only processes `name` (for filter stages), `sort`, and `variable` step types. When a step is an `unary` node (object constructor `{...}`) or a `block` node (`(...)` expression), `buildPathString` skips it (default case), and the inner expressions are never walked. So in `orders.items.{"itemName": name, "orderDate": %.date}`, the object constructor step is completely ignored -- `name` and `%.date` inside it are never extracted.

**Affected functions:** `walkPath()` (lines 138-151 step iteration loop)

**Integration point:** The step iteration loop in `walkPath` needs to handle `unary` and `block` step types by walking their inner expressions and prefixing results with the context built from preceding steps.

**Fix strategy:** Extend the step iteration loop in `walkPath` to handle additional step types:

```typescript
// In walkPath step iteration:
if (step.type === "unary" || step.type === "block") {
  const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
  const innerPaths = walkNode(step, scope);
  paths.push(...prefixPaths(contextPrefix, innerPaths));
}
```

For `orders.items.{"itemName": name, "orderDate": %.date}`:
- Steps: `[name:"orders", name:"items", unary:"{...}"]`
- When processing the unary step at index 2: contextPrefix = `"orders.items"`, inner paths from walkUnary = `["name", "%.date"]`
- prefixPaths produces `["orders.items.name", "orders.items.%.date"]`

For `orders.items.(%.orderRef & ": " & name)`:
- Steps: `[name:"orders", name:"items", block:(...)]`
- contextPrefix = `"orders.items"`, inner paths from walkBlock = `["%", "%.orderRef", "name"]` (from binary concat)
- After prefix: `["orders.items.%", "orders.items.%.orderRef", "orders.items.name"]`
- Wait -- the parent operator `%` in this context should produce `%.orderRef` not `orders.items.%.orderRef`. Actually, looking at the expected output: `orders.items.%.orderRef` IS the expected path (partial confidence). The `%` is relative to the items context, meaning "go up to orders". So `orders.items.%.orderRef` correctly represents "from items, go to parent (orders), access orderRef."

**Important nuance:** The base path `orders.items` is NOT emitted separately since it's only a context for the inner expression. But wait -- looking at the object constructor test, `orders.items` IS in the expected output. Let me re-examine.

Expected for `orders.items.{"itemName": name, "orderDate": %.date}`:
- `orders.items` (static) -- the base path
- `orders.items.%.date` (partial) -- parent-scoped field
- `orders.items.name` (static) -- local field

The base path `orders.items` comes from `buildPathString(node.steps)` which skips the unary step and produces `orders.items`. So the base path is already handled -- we only need to add the inner expression walking.

Expected for `orders.items.(%.orderRef & ": " & name)`:
- `orders.items.%.orderRef` (partial)
- `orders.items.name` (static)

No base path `orders.items` here -- which makes sense because the block step IS the terminal step, not a field access. The base path from `buildPathString` would be `orders.items` (skipping the block step), but the test doesn't expect it. Hmm, but `buildPathString` already produces `orders.items` and it IS pushed at line 134. Looking at expected output again: it only expects the two inner paths. So we need to NOT emit the base path when the terminal step is an expression step (block/unary).

Actually, let me re-read the expected output: `["orders.items.%.orderRef", "orders.items.name"]`. No `orders.items` base path. But `buildPathString(["orders", "items", block])` produces `"orders.items"` (block is skipped). So `paths.push(basePath)` on line 134 would add `"orders.items"`. This means the test expects `orders.items` to NOT appear.

This is a subtlety: when the PathNode ends with an expression step (block/unary), the "base path" from `buildPathString` is actually just the context prefix, not a data access itself. The path `orders.items` is being traversed, not read. However, looking at the object constructor test, `orders.items` IS expected. The difference: in the object constructor case, the object literal IS creating output from the items, so `orders.items` is a meaningful access. In the block case, the block IS the computation.

Actually, I think the simpler explanation is: the object constructor test includes `orders.items` as a base path, the block test doesn't. The current code already emits `orders.items` via `buildPathString` for both. The block test might just have been written to exclude it. Let me accept the expected outputs as authoritative and just focus on getting the inner expressions walked.

**Files modified:**
- `walker.ts`: Extend `walkPath` step loop to walk `unary` and `block` step types with context prefixing

**Complexity:** LOW-MEDIUM -- straightforward addition to existing loop, but need to verify base path emission behavior.

---

### Bug 5: Pipeline Duplicate Paths (2 tests)

**Test 1 -- Variable-resolved sort:** `($x := items; $x^(price))`
**Root cause:** When `$x` resolves to `["items"]` in `walkPath`'s variable branch (lines 100-127), the code builds the suffix from remaining steps. Sort steps produce no suffix (skipped by `buildPathString`). But sort TERMS need to be walked and prefixed with the resolved variable paths. The variable branch in `walkPath` handles predicates (lines 110-115) but has no handling for sort steps on the resolved variable.

**Test 2 -- Inline lambda with apply:** `data ~> function($d) { $d.count }`
**Root cause:** `walkApply` checks if `node.rhs.type === "function"` (line 610). But here the rhs is a `lambda` node, not a `function` node. So the code falls to the else branch (line 621) which calls `walkNode(node.rhs, scope)`. `walkLambda` returns `[]` for non-thunk lambdas. The parameter `$d` is never bound to `["data"]`.

These are two separate bugs with different root causes, grouped as "pipeline" because they both involve pipeline-style expressions failing to extract paths.

**Fix strategy for variable-resolved sort:** In the variable branch of `walkPath`, after handling predicates and building suffix, also check remaining steps for sort nodes and walk their terms prefixed with the resolved variable paths.

```typescript
// After suffix building in walkPath variable branch:
const suffixSteps = node.steps.slice(varStepIndex + 1);
for (const remainStep of suffixSteps) {
  if (remainStep.type === "sort") {
    for (const resolvedPath of resolved) {
      paths.push(...walkSortTerms(remainStep as SortNode, resolvedPath, scope));
    }
  }
}
```

**Fix strategy for inline lambda with apply:** In `walkApply`, when `node.rhs` is a `lambda` (not a function call), treat it as a direct function application: bind the lhs paths to the lambda's first parameter and walk the body.

```typescript
// In walkApply, after the function case:
if (node.rhs.type === "lambda") {
  const lambda = node.rhs as LambdaNode;
  let lambdaScope = childScope(scope);
  if (lambda.arguments.length > 0) {
    lambdaScope = bindVariable(lambdaScope, lambda.arguments[0].value, lhsPaths);
  }
  paths.push(...walkNode(lambda.body, lambdaScope));
}
```

**Files modified:**
- `walker.ts`: Extend `walkPath` variable branch for sort steps; extend `walkApply` for lambda rhs

**Complexity:** MEDIUM -- two independent fixes in different functions.

---

### Bug 6: walkVariable Missing .group Property (1 test)

**Root cause:** `($r := data.records; $r{category: $sum(amount)})`. The `$r{...}` syntax is a PathNode where `$r` is the first step (variable) and `{...}` is a group-by node on `node.group`. In `walkPath`'s variable branch (lines 100-127), after resolving the variable and handling predicates/suffix, the code returns without checking `node.group`. The `walkGroupBy` call on line 154 happens AFTER the variable branch returns, so it's never reached.

Actually, wait -- let me re-trace. The variable branch at line 102 does `if (varStepIndex >= 0)` and returns at line 124 with the resolved paths. The group-by handling at line 154 `if (node.group)` is after the variable branch's return, so it's skipped.

**Affected functions:** `walkPath()` variable branch (lines 100-127), `walkVariable()` (lines 379-408)

**Integration point:** The variable branch in `walkPath` needs to also handle `node.group` before returning, using the resolved variable paths as the group-by context prefix.

**Fix strategy:** Add group-by handling inside the variable branch of `walkPath`, before the return:

```typescript
// Inside walkPath variable branch, before return:
if (node.group) {
  const groupBasePath = resolved[0] ?? "";
  const groupNode = node.group as unknown as GroupByNode;
  if (groupNode.lhs) {
    for (const pair of groupNode.lhs) {
      const [keyExpr, valExpr] = pair;
      if (keyExpr) {
        paths.push(...prefixPaths(groupBasePath, walkNode(keyExpr, scope)));
      }
      if (valExpr) {
        paths.push(...prefixPaths(groupBasePath, walkNode(valExpr, scope)));
      }
    }
  }
}
```

Alternatively, extract the group-by walking into a reusable helper that accepts a base path, and call it from both the variable branch and the existing non-variable path.

**Files modified:**
- `walker.ts`: Add group-by handling in `walkPath` variable branch

**Note:** The existing `walkGroupBy` function already does this logic but uses `buildPathString(node.steps)` for the base path. For the variable branch, the base path is the resolved variable paths. Refactoring `walkGroupBy` to accept an explicit base path makes both call sites clean.

**Complexity:** LOW -- small addition to existing variable branch, potential helper refactor.

---

### Bug 7: Array Constructor Scope Leak in Standalone BindNode (1 test)

**Root cause:** `[$x := data.source, $x.field]`. This is an array constructor (`unary` node with `value: "["`) containing a `bind` node and a subsequent `path` node referencing `$x`. The current `walkUnary` for `[` does:

```typescript
case "[":
  return (node.expressions ?? []).flatMap((e) => walkNode(e, scope));
```

Each expression is walked with the SAME scope. The bind node (`$x := data.source`) is walked by `walkBind` which just walks the RHS -- it does NOT add `$x` to the scope. The scope from the bind is discarded. So when `$x.field` is walked next, `$x` is unresolved.

**Affected functions:** `walkUnary()` (lines 359-373, case `"["`) and `walkBind()` (lines 354-356)

**Integration point:** Array constructors need scope accumulation similar to `walkBlock` when they contain bind expressions. The binding from one element needs to be visible to subsequent elements.

**Fix strategy:** Change the array constructor case in `walkUnary` to accumulate scope like `walkBlock`:

```typescript
case "[": {
  const paths: string[] = [];
  let currentScope = scope;
  for (const expr of node.expressions ?? []) {
    if (expr.type === "bind") {
      const bindNode = expr as BindNode;
      const rhsPaths = walkNode(bindNode.rhs, currentScope);
      paths.push(...rhsPaths);
      currentScope = bindVariable(currentScope, bindNode.lhs.value, rhsPaths);
      if (bindNode.rhs.type === "lambda") {
        currentScope = bindLambda(currentScope, bindNode.lhs.value, bindNode.rhs as LambdaNode);
      }
    } else {
      paths.push(...walkNode(expr, currentScope));
    }
  }
  return paths;
}
```

This mirrors the `walkBlock` pattern exactly, adapted for array constructor expressions.

**Files modified:**
- `walker.ts`: Rewrite array constructor case in `walkUnary` with scope accumulation

**Complexity:** LOW -- direct adaptation of existing `walkBlock` pattern.

---

## Component Boundaries (Updated)

| Component | Current State | Bug Fix Changes |
|-----------|--------------|-----------------|
| `walkPath()` | Handles name, variable, sort, filter steps | Add: function steps (Bug 2), unary/block steps (Bug 4), sort in variable branch (Bug 5), group-by in variable branch (Bug 6) |
| `walkFilterStages()` | Blindly prefixes all filter paths | Change: scope-aware prefixing to avoid double-prefix (Bug 1, 3) |
| `walkHigherOrderCall()` | Binds ALL data arg paths to lambda params | Change: bind only base paths, not predicate paths (Bug 1) |
| `walkApply()` | Only handles FunctionNode rhs | Add: LambdaNode rhs handling (Bug 5) |
| `walkUnary()` | Stateless flatMap for array constructor | Change: scope-accumulating loop for `[` case (Bug 7) |
| `walkVariable()` | Handles predicates, not group-by | No direct change (handled via walkPath variable branch) |
| `walkBlock()` | Already correct | No changes |
| `scope.ts` | Already correct | No changes |
| `path-builder.ts` | Already correct | No changes |
| `index.ts` | Already correct | No changes |
| `types.ts` | Already correct | No changes |

**New helper functions:**
- `extractBasePaths(node, scope)` -- walk a node extracting only base data paths without filter predicate side effects (Bug 1)
- Refactored `walkGroupBy(groupNode, basePath, scope)` -- accept explicit base path parameter (Bug 6)

## Data Flow Changes

### Current Data Flow (walkHigherOrderCall)
```
dataArg node ---walkNode---> ALL paths (base + predicate) ---bind---> lambda param
```

### Fixed Data Flow (walkHigherOrderCall)
```
dataArg node ---walkNode---> ALL paths (to output)
dataArg node ---extractBasePaths---> base paths only ---bind---> lambda param
```

### Current Data Flow (walkFilterStages)
```
filter expr ---walkNode---> paths ---prefixPaths(contextPrefix)---> ALL prefixed
```

### Fixed Data Flow (walkFilterStages)
```
filter expr ---walkNode---> paths
  |
  +-- locally-relative paths ---prefixPaths(contextPrefix)---> prefixed
  +-- scope-resolved paths (from variables) ---> emitted as-is (no prefix)
```

### Current Data Flow (walkPath variable branch)
```
$x resolved --> suffix from buildPathString --> concatenate --> return
                                                  (misses sort, group-by)
```

### Fixed Data Flow (walkPath variable branch)
```
$x resolved --> suffix from buildPathString --> concatenate
            --> walk sort terms with resolved prefix
            --> walk group-by with resolved prefix
            --> return combined
```

## Suggested Build Order

### Order Rationale

Dependencies flow like this:
```
Bug 7 (array scope)       -- standalone, no deps
Bug 6 (group-by)          -- standalone, no deps
Bug 4 (walkPath steps)    -- standalone, no deps
Bug 2 ($lookup chaining)  -- standalone, no deps
Bug 5 (pipeline fixes)    -- standalone (two independent sub-fixes)
Bug 3 (focus double-prefix) -- shares root cause with Bug 1
Bug 1 (filter leak)       -- most complex, benefits from all other fixes being stable
```

### Phase 1: Isolated Single-Function Fixes (No cross-cutting concerns)

**Order: Bug 7 -> Bug 6 -> Bug 4 -> Bug 2**

1. **Bug 7: Array constructor scope leak** (1 test, LOW complexity)
   - Why first: Completely self-contained change to one `case` in `walkUnary`. Zero interaction with any other fix. Pattern is a direct copy of `walkBlock`. Easiest confidence builder.
   - Files: `walker.ts` (walkUnary `[` case only)
   - Risk: LOW -- mirrors existing proven pattern

2. **Bug 6: walkVariable .group property** (1 test, LOW complexity)
   - Why second: Small addition to `walkPath` variable branch. May benefit from a `walkGroupBy` refactor to accept explicit base path, which is a clean improvement.
   - Files: `walker.ts` (walkPath variable branch, optionally walkGroupBy signature)
   - Risk: LOW -- additive change, existing group-by logic is correct

3. **Bug 4: Parent operator in object/block steps** (2 tests, LOW-MEDIUM complexity)
   - Why third: Extends the `walkPath` step iteration loop. Straightforward addition but touches the most-modified function. Do it before the more complex walkPath changes in later bugs.
   - Files: `walker.ts` (walkPath step loop)
   - Risk: LOW -- additive case handling in existing loop

4. **Bug 2: $lookup HOF chaining** (2 tests, MEDIUM complexity)
   - Why fourth: Also extends `walkPath` step iteration. The function-step handling is more nuanced than block/unary steps because it needs to construct chained paths from function output. Do it after Bug 4 establishes the pattern for handling non-name steps.
   - Files: `walker.ts` (walkPath step loop)
   - Risk: MEDIUM -- path construction for function results requires careful design

### Phase 2: Pipeline and Apply Fixes (Moderate complexity)

**Order: Bug 5a -> Bug 5b**

5. **Bug 5a: Variable-resolved sort** (1 test, LOW complexity)
   - Why here: Extends walkPath variable branch (same area as Bug 6). Simple addition to handle sort steps in the remaining steps after variable resolution.
   - Files: `walker.ts` (walkPath variable branch)
   - Risk: LOW -- additive

6. **Bug 5b: Inline lambda with apply** (1 test, MEDIUM complexity)
   - Why here: Changes `walkApply` to handle lambda rhs. Independent of walkPath changes. Could be done earlier, but logically groups with the other "pipeline" fix.
   - Files: `walker.ts` (walkApply)
   - Risk: LOW -- small addition to existing function

### Phase 3: Filter Predicate Scope-Awareness (Highest complexity)

**Order: Bug 3 + Bug 1 together**

7. **Bug 3 + Bug 1: Focus double-prefix AND filter predicate leak** (6 tests, HIGH complexity)
   - Why last: These share the same root cause (scope-unaware prefixing in walkFilterStages) and the same fix (making walkFilterStages distinguish locally-relative vs scope-resolved paths). Fixing them together avoids doing the refactor twice.
   - This is the most architecturally significant change because it modifies how `walkFilterStages` applies `prefixPaths` AND how `walkHigherOrderCall` binds lambda parameters.
   - Files: `walker.ts` (walkFilterStages, walkHigherOrderCall, new extractBasePaths helper)
   - Risk: HIGH -- changes core path prefixing logic that affects all filter/predicate handling

**Why this order is optimal:**
1. Bugs 7, 6, 4, 2 are all independent, single-function fixes with clear boundaries. Fixing them first reduces the number of failing tests from 14 to 6 and builds confidence that the core walker structure is sound.
2. Bug 5 has two sub-fixes that are independent of each other and of the filter-related bugs. Clearing them reduces to 6 failing tests.
3. Bugs 3 and 1 share a root cause and should be designed and implemented together. They are the most complex and most likely to introduce regressions, so doing them last (on a stable base with 8 other tests already passing) minimizes risk.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Modifying walkNode Return Type
**What:** Changing `walkNode` to return `{ path: string; isBaseOnly: boolean }[]` to track path provenance.
**Why bad:** Every caller of `walkNode` would need updating. The return type is used in 15+ places. Massive blast radius.
**Instead:** Keep `walkNode` returning `string[]`. Use targeted helpers (`extractBasePaths`) where provenance matters.

### Anti-Pattern 2: Global Path Dedup Changes
**What:** Moving dedup from `extractPaths` into individual walk functions.
**Why bad:** Dedup at the leaves creates ordering dependencies and makes debugging harder. The current single-dedup-at-the-end design is correct and clean.
**Instead:** Keep dedup in `extractPaths`. Individual walkers may produce duplicates -- that is fine.

### Anti-Pattern 3: Fixing Symptoms Instead of Root Causes
**What:** Adding special-case exclusion lists (e.g., "if path contains filter keyword, skip it") instead of fixing the data flow.
**Why bad:** Fragile, breaks on edge cases, and masks the real issue.
**Instead:** Fix the data flow so correct paths are produced in the first place.

### Anti-Pattern 4: Touching scope.ts
**What:** Adding path provenance tracking to ScopeTracker.
**Why bad:** The scope chain is correct and elegant. The bugs are in how walker functions use scope, not in scope itself.
**Instead:** All fixes should be in `walker.ts` only.

## Regression Risk Assessment

| Fix | Regression Risk | Existing Tests at Risk | Mitigation |
|-----|----------------|----------------------|------------|
| Bug 7 (array scope) | LOW | None -- array constructor tests don't use binds | Run full suite after |
| Bug 6 (group-by variable) | LOW | Existing group-by tests (non-variable) | Verify existing group-by tests still pass |
| Bug 4 (step walking) | LOW | Existing path tests without block/unary steps | No overlap expected |
| Bug 2 ($lookup chain) | MEDIUM | Existing $lookup tests (without chaining) | Verify $lookup without chaining still works |
| Bug 5a (sort variable) | LOW | Existing sort tests | No overlap expected |
| Bug 5b (lambda apply) | LOW | Existing apply tests with function rhs | Verify `items ~> $map(...)` still works |
| Bug 3+1 (filter prefix) | HIGH | ALL filter/predicate tests (20+ existing) | Run all filter-related tests after each change. This is the highest-risk fix. |

## Summary of Changes by File

| File | Functions Modified | Functions Added | Lines Changed (est.) |
|------|-------------------|-----------------|---------------------|
| `walker.ts` | `walkPath`, `walkFilterStages`, `walkHigherOrderCall`, `walkApply`, `walkUnary` | `extractBasePaths` | 80-120 lines |
| `scope.ts` | None | None | 0 |
| `path-builder.ts` | None | None | 0 |
| `types.ts` | None | None | 0 |
| `index.ts` | None | None | 0 |
| `builtins.ts` | None | None | 0 |

All fixes are concentrated in `walker.ts`. No other source files require modification.

## Sources

- Source code analysis: `src/walker.ts` (626 lines), `src/scope.ts` (97 lines), `src/path-builder.ts` (33 lines), `src/types.ts` (213 lines), `src/index.ts` (46 lines), `src/builtins.ts` (47 lines)
- Bug specifications: 14 `it.skip` test fixtures across `test/integration/data-transforms.test.ts`, `test/integration/api-reshaping.test.ts`, `test/integration/business-rules.test.ts`, `test/integration/data-export.test.ts`, `test/integration/edge-cases.test.ts`
- Project context: `.planning/PROJECT.md`, `.planning/MILESTONES.md`
- Confidence: HIGH -- all analysis is based on direct source code examination, not external references
