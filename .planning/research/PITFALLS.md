# Domain Pitfalls: Bug Fixes in JSONata AST Walker

**Domain:** Fixing 14 documented bugs in a recursive AST path extraction walker
**Researched:** 2026-03-05
**Confidence:** HIGH (based on direct source code analysis of walker.ts, scope.ts, index.ts, types.ts, builtins.ts, path-builder.ts, and all 14 BUG(v1.2) test fixtures across 5 integration test files)

---

## Critical Pitfalls

Mistakes that cause one fix to break previously-passing tests, or that introduce new bugs worse than the ones being fixed.

### Pitfall 1: Scope Isolation Fix Breaks Legitimate Scope Sharing

**What goes wrong:**
The array constructor scope leak bug (BUG in `[$x := data.source, $x.field]`) requires making `BindNode` inside array constructors propagate scope to subsequent elements. The naive fix is to make `walkUnary` for `[` process expressions sequentially with scope accumulation (like `walkBlock` does for blocks). But this changes scope semantics for ALL array constructor contexts, not just the standalone-bind case. Existing tests rely on array constructor elements being walked with the SAME scope (not accumulated scope). If scope accumulates across all array elements, expressions like `[a, ($x := b; $x), c]` will leak `$x` into the evaluation of `c`, which does not happen in JSONata runtime semantics.

**Why it happens:**
`walkBlock` processes expressions sequentially, accumulating scope at each bind. `walkUnary` for `[` uses `flatMap` -- no scope threading. The temptation is to copy `walkBlock`'s accumulation pattern into `walkUnary`, but blocks and arrays have different scoping rules in JSONata. In blocks, bindings are visible to subsequent expressions. In array constructors, each element is independently evaluated -- a bind in one element should not leak to siblings UNLESS the bind is at the top level of the array (which is the specific parser-generated pattern for `[$x := data.source, $x.field]`).

**Consequences:**
- All 3 existing array constructor tests regress (PATH `[a, b, c]` test, object constructor test, and various integration tests using array constructors).
- New false-positive paths appear for expressions where array elements happen to share variable names.
- The fix is correct for the 1 BUG test but breaks 5+ existing tests.

**Prevention:**
- Check how the JSONata parser actually represents `[$x := data.source, $x.field]`. The parser may wrap this in a block node, not a raw array unary node. If so, the fix belongs in `walkBlock` or `walkBind`, not `walkUnary`.
- If the parser does produce a unary-`[` with bind children, the fix must distinguish between "bind as a direct child of array constructor" (accumulate) and "bind inside a nested expression" (don't accumulate). The safest approach is: scan the array elements, and if any element is a `BindNode`, switch to sequential scope accumulation for that specific array. Otherwise, keep the current `flatMap` behavior.
- Write regression tests BEFORE the fix: `[a, b, c]`, `[($x := 1; $x), y]`, and `[$sum(items.price), $count(orders)]` must produce the same output before and after.

**Detection (warning signs):**
- The diff touches `walkUnary` and replaces `flatMap` with a `for` loop.
- Array constructor tests start seeing extra paths.
- Variable names like `$x` start appearing in paths for unrelated array elements.

**Phase to address:** Array constructor scope fix phase. Must verify parser AST shape first.

---

### Pitfall 2: Filter Predicate Path Leak Fix Breaks Legitimate Filter-HOF Interaction

**What goes wrong:**
The filter predicate path leak is the most prolific bug (4 instances). When `$map(items[active], function($v) { $v.name })` is analyzed, the predicate path `items.active` leaks into the HOF element binding, producing spurious `items.active.name`. The root cause is that `walkNode` on the data argument `items[active]` returns `["items", "items.active"]`, and then ALL of those paths are bound to `$v`. The fix must separate "base collection paths" (bind to `$v`) from "predicate metadata paths" (do not bind to `$v`). But this separation is hard because `walkNode`/`walkPath` returns a flat `string[]` with no metadata about which paths are "base" vs "predicate."

The dangerous fix is to strip filter-related paths from the data argument before binding. But how do you know which paths are "filter-related"? If you strip any path that is a prefix+suffix of another path (e.g., `items.active` is `items` + `.active`), you will strip legitimate nested paths. For example, `$map(orders.items, function($v) { $v.price })` should bind `$v` to `["orders.items"]` -- but `orders.items` is `orders` + `.items`, which looks like a predicate suffix of `orders`.

**Why it happens:**
The walker was designed with a flat path list output. Filter predicates produce additional paths that are contextually different from base paths, but the data structure doesn't distinguish them. Any fix that tries to infer the distinction from the string values alone will have false positives.

**Consequences:**
- A string-matching heuristic to strip predicate paths will strip legitimate nested paths in other contexts.
- The `$map(orders.items, ...)` and `$filter(data.records, ...)` tests (6 passing integration tests) regress.
- Worse: the fix may appear to work for simple cases but fail for nested paths like `$map(orders.items[active].details, ...)` where the relationship between paths is ambiguous.

**Prevention:**
- The correct fix is structural, not string-based. Options:
  1. **Return metadata from walkPath**: Change the data argument walk to return `{ basePaths: string[], predicatePaths: string[] }` -- but this changes the walkNode signature and is invasive.
  2. **Walk the data argument AST twice**: First walk to extract base paths (skip filter stages), second walk for predicate paths. Bind only base paths to the HOF parameter.
  3. **Separate the predicate walk from the base path walk in walkPath**: The current `walkPath` builds `basePath` from `buildPathString(node.steps)` AND walks filter stages in the same loop. Split these so the caller can distinguish them.
  4. **Fix at the HOF binding level**: In `walkHigherOrderCall`, instead of calling `walkNode(dataArg, scope)` to get binding paths, call a specialized function that extracts only the "collection identity" paths (the path without filter decoration).
- Option 4 is the least invasive. The existing `buildPathString(node.steps)` already computes the base path without predicates. Use that for HOF binding, and let the full `walkNode` output (including predicates) flow into the result paths normally.
- Write regression tests: `$map(orders.items, fn)`, `$filter(data.records, fn)`, `$map(a.b.c, fn)` must all still bind the full dotted path to the lambda parameter.

**Detection (warning signs):**
- The fix modifies `walkHigherOrderCall` or `walkLambdaWithBindings` to filter the `dataArgPaths` array using string matching.
- Tests for `$map(orders.items, ...)` start missing `orders.items.fieldName` paths.
- The fix works for `items[active]` but not for `orders.items[active]` (multi-step base path).

**Phase to address:** Filter predicate leak fix phase. This is the highest-risk fix and should be done first with the most regression coverage.

---

### Pitfall 3: Focus Variable (@$v) Prefix Fix Breaks Non-Focus Variable Resolution

**What goes wrong:**
The focus variable double-prefix bug occurs in `orders@$o[$o.total > 100].id` where `$o` resolves to `["orders"]` (the context prefix), then the filter walker prefixes `$o.total` with the context prefix again, producing `orders.orders.total`. The fix must prevent double-prefixing. But the naive fix -- "don't prefix paths that come from variable resolution" -- will break the legitimate case where a variable reference inside a filter should NOT be prefixed, but a bare field name SHOULD be prefixed.

Consider the expression `($cfg := config; items[$cfg.minPrice < price].name)`. Here:
- `price` is a bare field name inside the filter and MUST be prefixed to `items.price`.
- `$cfg.minPrice` is a variable reference and MUST NOT be prefixed (it should stay `config.minPrice`, not become `items.config.minPrice`).

Both of these go through `walkFilterStages` -> `walkNode` -> `prefixPaths`. The current code applies `prefixPaths` uniformly to ALL paths returned by `walkNode(filterStage.expr, filterScope)`. The fix must distinguish between "paths that come from the filter's own context" (prefix them) and "paths that come from external variable resolution" (don't prefix them).

**Why it happens:**
`prefixPaths` is a dumb string concatenation helper. It has no concept of where a path came from. The filter walker calls `walkNode` on the filter expression, gets back a flat list of paths, and prefixes all of them. Paths from variable resolution are indistinguishable from paths from local field names.

**Consequences:**
- If the fix is "never prefix variable-resolved paths," then `items@$v[$v.name = "x"]` will produce `name` instead of `items.name` (because `$v` resolves to `["items"]`, and `$v.name` resolves to `["items.name"]`, and the fix skips prefixing that already-resolved path). Wait -- actually this is correct: `$v.name` already resolves to `items.name`, so NOT re-prefixing it is right. But what about a bare `name` in the filter? `items[name = "x"]` should produce `items.name`. The bare `name` is NOT variable-resolved, so it WILL be prefixed. This works.
- The real danger is the interaction with the second bug (`$cfg := config; items[$cfg.minPrice < price].name`). Here `$cfg.minPrice` resolves to `config.minPrice` and should NOT be prefixed. `price` should be prefixed to `items.price`. If the fix works by checking whether a path "starts with a known variable binding prefix," it will be fragile and fail for multi-hop chains.

**Prevention:**
- The correct approach: walk the filter expression, and for each resulting path, check if it was produced by a variable node (which already has resolved absolute paths) or by a name node (which needs context prefixing). This requires the walker to tag paths with their origin, or requires walking name nodes and variable nodes separately in the filter context.
- Simpler approach: in `walkFilterStages`, instead of walking the entire filter expression and then prefixing everything, walk each sub-node of the filter expression individually. For name/path nodes, prefix them. For variable nodes, don't prefix (they're already resolved). This requires understanding the filter expression's AST structure.
- Simplest safe approach: change `prefixPaths` behavior specifically for paths that are already absolute (i.e., came from variable resolution). A path is "already absolute" if it was produced by `resolveVariable`, which returns the paths stored at bind time. These paths are always absolute. The trick is knowing WHICH paths in the flat list came from resolution.
- Alternative: in `walkFilterStages`, walk the filter expression in a child scope where variables resolve as before, but wrap `walkNode` results to track which paths need prefixing. Use a two-list approach: `{ needsPrefix: string[], alreadyAbsolute: string[] }`.

**Detection (warning signs):**
- The fix modifies `prefixPaths` to conditionally skip prefixing based on string content (e.g., "if the path already starts with the prefix, skip").
- Tests for `items[name = "x"]` (bare field in filter) start producing un-prefixed `name` instead of `items.name`.
- Tests for `($threshold := 50; items[price > $threshold])` start producing `items.50` or `items.$threshold`.
- The 6 passing filter predicate tests in extract-paths.test.ts regress.

**Phase to address:** Focus variable / prefix fix phase. Closely coupled with the filter predicate leak fix (Pitfall 2) -- both touch `walkFilterStages` and `prefixPaths`.

---

### Pitfall 4: walkPath Expansion for Object Constructor/Block Steps Causes Infinite Recursion

**What goes wrong:**
The parent operator walkPath bug (2 instances) is that `walkPath` silently skips steps of type `unary` (object constructor `{...}`) and `block` (`(...)`) because `buildPathString` has a `default: break` for unknown step types, and `walkPath`'s step iteration loop only handles `name` and `sort` step types. The fix must walk these additional step types when they appear as path steps. But if the fix naively calls `walkNode(step, scope)` for every unrecognized step type, it can cause infinite recursion when a step contains a path that contains steps that contain paths.

Specifically, `orders.items.{"itemName": name, "orderDate": %.date}` has a PathNode whose steps include a `name("orders")`, `name("items")`, and a `unary("{", ...)` step. If `walkPath` calls `walkNode` on the unary step, and the unary step's values include path references, those paths are walked correctly. But if a pathological expression has a path step that itself contains a path with the same structure, recursion is unbounded.

**Why it happens:**
The current `walkPath` is designed to handle a specific set of step types. Adding a catch-all "walk any unrecognized step" clause opens the door to unbounded recursion because `walkNode` dispatches back to `walkPath` for path nodes, which then finds more steps, which calls `walkNode` again.

**Consequences:**
- Stack overflow on deeply nested expressions with path steps containing object constructors or blocks.
- While this is unlikely in practice (JSONata expressions are typically short), it violates the "don't crash" principle.

**Prevention:**
- Add EXPLICIT case handling for `unary` and `block` step types in the `walkPath` step iteration loop. Do NOT add a catch-all default that walks arbitrary steps.
- For `unary` steps (object constructor): walk the unary node using the existing `walkUnary` function, prefix results with the path built from steps up to (but not including) the unary step.
- For `block` steps: walk the block node using `walkBlock`, prefix results similarly.
- Do NOT recurse through `walkPath` -- call `walkNode` on the individual step, which dispatches to the appropriate type-specific handler.
- The context prefix for these inner walks should be computed from `buildPathString(node.steps.slice(0, i))` -- the path up to but not including the current step. This matches the existing pattern for sort steps (line 148 of walker.ts).
- Add a recursion depth guard (optional but safe): if `walkPath` is called with a depth > 20, return `[]` and log a warning.

**Detection (warning signs):**
- The fix adds a `default:` case to the step iteration loop that calls `walkNode` without type checking.
- Stack overflow errors appear in tests with nested object constructors in paths.
- The fix works for the 2 BUG test cases but fails for deeply nested expressions.

**Phase to address:** Parent operator walkPath fix phase. Low risk of breaking existing tests if done as explicit case additions.

---

### Pitfall 5: Dedup Fix Removes Legitimate Duplicate Paths

**What goes wrong:**
The "pipeline duplicate path extraction" bugs (2 instances) involve expressions where the same path appears in the output multiple times because of how `walkApply` works: it walks `lhs` paths, then creates an augmented function node that re-walks `lhs` as the first argument. The current code has a comment acknowledging this: "walkFunction will re-walk the lhs arg, but dedup in extractPaths handles it" (walker.ts line 617). The problem is that some pipeline expressions produce DIFFERENT paths from each walk pass (not duplicates), and the current approach conflates "intentional re-walk for binding" with "redundant duplicate."

The real bugs documented are:
1. `items ~> $filter(fn) ~> $map(fn)` -- chained apply leaks filter predicate paths into subsequent map binding.
2. `data ~> function($d) { $d.count }` -- inline lambda with apply loses parameter binding.

These are NOT dedup bugs in the `new Set()` sense. They are structural bugs in how `walkApply` handles chaining and inline lambdas. The "pipeline duplicate" label is misleading.

The dangerous fix: someone reads "pipeline duplicate" and changes the dedup logic in `extractPaths` (e.g., making it smarter about which duplicates to keep). This breaks the fundamental guarantee that `new Set(rawPaths)` preserves all unique paths.

**Why it happens:**
The bug label "pipeline duplicate path extraction" suggests the problem is in deduplication. It is not. The problem is:
1. In chained `~>`, `walkApply` augments the function arguments with `lhs`, but when `lhs` is itself an apply expression, the augmentation carries forward accumulated predicate paths from prior stages.
2. For inline lambdas (`data ~> function($d) { ... }`), `walkApply` checks `node.rhs.type === "function"` but an inline lambda has `type === "lambda"`, so it falls through to the else branch and walks the lambda normally without binding `$d` to `data`'s paths.

**Consequences:**
- Modifying the dedup logic in `extractPaths` would break the invariant that all unique paths are preserved.
- Existing dedup tests (`"a + a"` and `"(x; x; y)"`) would regress.
- The actual bugs (chained apply accumulation and inline lambda binding) remain unfixed.

**Prevention:**
- Read the BUG comments carefully. The chained-apply bug is in `walkApply` -- it needs to handle the case where `rhs` is a `FunctionNode` whose data argument is itself an apply expression.
- The inline-lambda bug is in `walkApply` -- it needs a branch for `node.rhs.type === "lambda"` that binds the lambda's first parameter to `lhsPaths`.
- Do NOT touch `extractPaths` or the `new Set()` dedup logic.
- The fix for chained apply may require `walkApply` to detect when `lhs` is an apply chain and only pass the "final stage's base paths" (not accumulated predicate paths) to the next function binding.

**Detection (warning signs):**
- The diff modifies `extractPaths` in `index.ts`.
- The diff modifies the `new Set(rawPaths)` line.
- Dedup tests start failing.
- The fix adds string comparison logic to determine which duplicates to remove.

**Phase to address:** Pipeline fix phase. Treat as two separate bugs: chained-apply binding and inline-lambda binding.

---

### Pitfall 6: HOF Argument Fix Breaks Existing $map/$filter/$reduce Behavior

**What goes wrong:**
Multiple bugs touch the higher-order function binding logic (`walkHigherOrderCall`, `walkLambdaWithBindings`). Fixes to these functions risk breaking the 8 passing HOF tests in the unit suite plus 10+ passing integration tests. The specific risk: changing how `dataArgPaths` is computed or passed to `walkLambdaWithBindings` affects EVERY higher-order call, not just the buggy ones.

For example, fixing the filter predicate leak (Pitfall 2) by changing `walkHigherOrderCall` to use only "base paths" for binding would affect `$map(orders.items, fn)` where the data arg walks to `["orders.items"]`. If the fix incorrectly strips the suffix, `$map(orders.items, fn)` would bind `$v` to `["orders"]` instead of `["orders.items"]`, breaking the multi-step path resolution test.

**Why it happens:**
`walkHigherOrderCall` is the single entry point for all HOF binding. It calls `walkNode(dataArg, scope)` to get `dataArgPaths`, then passes ALL of those paths to `walkLambdaWithBindings`. Any change to how `dataArgPaths` is computed or filtered affects `$map`, `$filter`, `$reduce`, `$each`, and `$sift` uniformly.

**Consequences:**
- `$map(items, fn)` starts binding `$v` to `[]` instead of `["items"]` (paths lost).
- `$filter(orders, fn)` stops resolving `$v.total` to `orders.total`.
- `$reduce(values, fn)` stops working entirely.
- Up to 18 existing tests break across unit and integration suites.

**Prevention:**
- Any fix to HOF binding must run the FULL existing test suite after each change. Not just the BUG tests.
- The filter predicate leak fix should NOT modify `walkHigherOrderCall` or `walkLambdaWithBindings` directly. Instead, it should modify how the data argument's paths are COMPUTED before being passed to HOF binding. For instance, create a `walkNodeForBinding(node, scope)` that returns only "collection identity" paths, and use that specifically in `walkHigherOrderCall` for computing `dataArgPaths` while keeping `walkNode` for the result path accumulation.
- Alternatively, fix the leak at the source: change `walkPath` to not include predicate paths in the "base path" result, and instead return them separately. This is more invasive but fundamentally correct.
- Write a dedicated regression test file with ALL existing HOF patterns before making any changes.

**Detection (warning signs):**
- The diff modifies `walkHigherOrderCall` or `walkLambdaWithBindings` function signatures.
- Multiple HOF tests (SCOPE-04 describe blocks) start failing.
- `$v.name` in a `$map` callback stops resolving to `dataArg.name`.
- The fix works for `$map(items[active], fn)` but breaks `$map(orders.items, fn)`.

**Phase to address:** Must be considered simultaneously with Pitfall 2 (filter predicate leak). These are the same fix viewed from different angles.

---

### Pitfall 7: BindNode Scope Fix Breaks Normal Variable Binding

**What goes wrong:**
The standalone `BindNode` handler (`walkBind` at line 354) currently just walks the RHS and returns paths -- it does NOT update the scope. This is correct for standalone binds because the scope change is handled by `walkBlock` when the bind is inside a block. The array constructor scope leak bug needs binds inside array constructors to propagate scope. If the fix modifies `walkBind` itself to always update scope, then standalone binds OUTSIDE blocks AND array constructors will start propagating scope unexpectedly.

For example, consider the expression `$x := items` (a standalone bind at the top level). Currently this produces `["items"]` from walking the RHS. The `$x` variable is NOT stored in any scope because `walkBind` does not modify the scope. If `walkBind` is changed to both walk the RHS AND update the scope, then the returned scope would have `$x := ["items"]`, but the caller (`walkNode`) discards the scope because it only returns `string[]`. The scope change is lost. So the fix to `walkBind` alone cannot solve the array constructor problem -- the scope must be threaded through the array constructor's element processing.

**Why it happens:**
The immutable scope design means scope changes must be threaded through the caller. `walkBind` cannot unilaterally propagate scope because it returns `string[]`, not `ScopeTracker`. The fix must be in the CALLER of `walkBind` (i.e., `walkUnary` for `[` array constructors), not in `walkBind` itself.

**Consequences:**
- If `walkBind` is modified to return scope (changing its signature), every call site must be updated.
- If `walkBind` somehow mutates scope (breaking immutability), the entire scope chain guarantee breaks.
- Tests for `($x := a; ($x := b; $x); $x)` (inner block scope isolation) may regress.
- Variable assignment tracing tests (SCOPE-01) may produce unexpected results.

**Prevention:**
- Do NOT modify `walkBind`'s return type or behavior.
- The fix belongs in `walkUnary` for `[` array constructors. When processing array elements sequentially, check if an element is a `BindNode`. If so, walk the RHS, accumulate the paths, AND create a new scope with the binding before processing subsequent elements.
- This is analogous to what `walkBlock` already does (lines 320-348 of walker.ts). The fix for array constructors should mirror `walkBlock`'s bind handling, but only for the `[` unary case.
- Verify the parser's AST output for `[$x := data.source, $x.field]` to confirm the bind is a direct child of the unary-`[` node.

**Detection (warning signs):**
- The diff modifies `walkBind` function.
- The diff changes `walkBind`'s return type.
- SCOPE-01 tests start producing different results.
- The scope chain is mutated instead of producing new scope objects.

**Phase to address:** Array constructor scope fix. Must be coordinated with Pitfall 1 (same fix, different angle).

---

## Moderate Pitfalls

### Pitfall 8: walkVariable .group Fix Misses Analogous Property Gaps

**What goes wrong:**
The `walkVariable` function handles `node.predicate` (filter stages on variable nodes) but does NOT handle `node.group` (group-by on variable nodes). The fix is straightforward: add `.group` handling to `walkVariable`, mirroring how `walkPath` handles `node.group`. But `walkVariable` may also miss other properties that `walkPath` handles:
- `sort` steps on variable-resolved paths (`$x^(price)` -- the variable-resolved sort bug)
- `keepArray`/`keepSingletonArray` flags (not relevant for path extraction but indicates property awareness gaps)

Fixing ONLY `.group` without auditing for other missing properties leaves the same category of bug latent. The variable-resolved sort bug (`$x^(price)` missing sort term paths) is in the same family -- `walkPath`'s variable branch does not walk sort steps or group-by on the resolved variable.

**Why it happens:**
`walkVariable` was written to handle the simple case (resolve and return paths) and later extended to handle predicates. But the full set of properties that a `VariableNode` can carry (inherited from the parser's treatment of `$x[filter]`, `$x^(sort)`, `$x{group}`) was not systematically audited.

**Prevention:**
- Before fixing `.group`, audit all properties that `VariableNode` can carry by examining the JSONata parser output for expressions like `$x[filter]`, `$x^(sort)`, `$x{group}`, `$x.field`. Compare the AST structure to what `walkVariable` and `walkPath`'s variable branch handle.
- Fix all missing properties in a single pass, not one at a time.
- The variable-resolved sort bug (`($x := items; $x^(price))`) is the same root cause: `walkPath`'s variable branch (lines 102-127) handles predicates and suffix steps but does NOT handle sort steps or group-by on the resolved path. The fix should add sort and group-by handling to the variable branch of `walkPath`, not just to `walkVariable`.

**Detection (warning signs):**
- The fix adds `.group` to `walkVariable` but ignores the analogous gap in `walkPath`'s variable branch.
- After fixing `.group`, a new bug is discovered for `$x^(sort)` -- it should have been fixed in the same pass.
- The variable-resolved sort test still fails after the `.group` fix.

**Phase to address:** walkVariable / walkPath property gap fix. Treat `.group`, sort, and any other missing properties as a single unit of work.

---

### Pitfall 9: $lookup HOF Chaining Fix Introduces Incorrect Path Prefixing

**What goes wrong:**
The `$lookup(inventory, itemCode).quantity` bug occurs because when a `FunctionNode` appears as a step in a `PathNode`, `buildPathString` skips the function step (it only handles `name`, `wildcard`, `descendant`, `parent`), and `walkPath`'s step iteration only walks `name` and `sort` steps. So the function arguments (`inventory`, `itemCode`) are silently dropped, and only the trailing `.quantity` step appears in the base path.

The fix must walk the function step's arguments. But `$lookup` is NOT in `HIGHER_ORDER_SEMANTICS`, so it is treated as a non-HOF built-in. Its arguments are just data reads. The fix in `walkPath` should walk function steps the same way it walks name/sort steps -- by calling `walkNode` on the step.

The danger: if the fix calls `walkNode` on every function step and then ALSO prefixes the function's result paths with the context prefix (as it does for sort and filter), `$lookup(inventory, itemCode).quantity` would produce `orders.inventory` and `orders.itemCode` instead of `inventory` and `itemCode` -- because the function's arguments are independent data reads, not context-relative paths.

**Why it happens:**
The walkPath step iteration loop prefixes sort term paths with the context prefix (steps before the sort). Filter stage paths are also prefixed. Function steps are different: their arguments are absolute references, not relative to the preceding path context. Applying the same prefixing pattern would be incorrect.

**Prevention:**
- When walking function steps in `walkPath`, call `walkNode(step, scope)` to extract argument paths but do NOT prefix them with the context path. Function arguments are absolute, not context-relative.
- The trailing suffix after the function step (`.quantity` in this case) should be treated as an independent path segment. The function's return value is opaque (we can't statically know what `$lookup` returns), so `.quantity` alone is the correct path from the remaining steps.
- Alternatively, emit the function arguments as standalone paths and keep the suffix as a separate path. The expected test output confirms this: `["inventory", "itemCode", "inventory.quantity"]` or `["inventory", "itemCode", "price"]` depending on the test.
- Check both BUG test cases: one expects `inventory.quantity` prefixed to the function's first argument, the other expects `price` unprefixed. The expected outputs may reveal whether the test authors intended prefixing or not.

**Detection (warning signs):**
- The fix adds context prefixing to function step argument paths.
- `$lookup(inventory, itemCode).quantity` produces `items.inventory` instead of `inventory`.
- The fix works for one BUG test but fails the other.

**Phase to address:** $lookup HOF chaining fix. Relatively isolated -- only affects walkPath's step iteration.

---

### Pitfall 10: Chained Apply (~>) Fix Breaks Single-Apply Expressions

**What goes wrong:**
The inline lambda apply bug (`data ~> function($d) { $d.count }`) requires `walkApply` to handle `rhs.type === "lambda"` in addition to `rhs.type === "function"`. The fix adds a new branch in `walkApply` for lambda RHS nodes, binding the first lambda parameter to `lhsPaths`. But the fix must be careful not to also affect thunk lambdas (parser-generated lambdas with `thunk: true` and no arguments).

When JSONata parses `data ~> $map(function($v) { ... })`, the parser may generate a thunk lambda wrapping the inner function call. If `walkApply` sees `rhs.type === "lambda"` and treats it as an inline user lambda, it would try to bind the (nonexistent) first parameter of the thunk to `lhsPaths`, producing incorrect bindings.

**Why it happens:**
The JSONata parser uses thunk lambdas as implementation wrappers for certain expressions. `walkLambda` already handles thunks by unwrapping them (line 423: `if (node.thunk) return walkNode(node.body, scope)`). But if `walkApply` adds a lambda branch before the existing function branch, the thunk case needs explicit handling.

**Prevention:**
- In the new lambda branch of `walkApply`, check `(node.rhs as LambdaNode).thunk`. If it is a thunk, unwrap it and process the body (which is typically a FunctionNode) through the existing function path.
- If it is NOT a thunk (user-written inline lambda), bind the first parameter to `lhsPaths` and walk the body.
- Write regression tests for `items ~> $map(function($v) { $v.name })` (existing passing test) and `data ~> $filter(function($v) { $v.active })` (existing passing test) to ensure thunk handling is not broken.

**Detection (warning signs):**
- The fix adds a lambda branch without checking for thunk.
- `items ~> $map(fn)` tests start failing (the thunk wrapper is mishandled).
- `items ~> $sum()` test regresses (non-HOF apply).

**Phase to address:** Pipeline/apply fix phase.

---

### Pitfall 11: Fix Ordering Creates Cascading Failures

**What goes wrong:**
Several bugs share root causes or interact with the same code paths. Fixing them in the wrong order creates cascading test failures that obscure which fix broke what:

1. Filter predicate leak (4 bugs) and focus variable double-prefix (2 bugs) both involve `walkFilterStages` and `prefixPaths`.
2. walkVariable .group (1 bug) and variable-resolved sort (1 bug, part of "pipeline duplicates") share the same root cause in walkPath's variable branch.
3. Array constructor scope (1 bug) requires understanding how the parser structures `[$x := ..., $x.field]`, which may affect the $lookup chaining fix if $lookup results are used inside array constructors.

If all fixes are attempted simultaneously, a test failure could be caused by any of the 7 interacting changes. Debugging becomes combinatorial.

**Prevention:**
- Fix bugs in dependency order:
  1. **First**: walkPath expansion for object constructor/block steps (Pitfall 4) -- isolated, low risk, no interaction with other fixes.
  2. **Second**: walkVariable .group + walkPath variable branch sort/group (Pitfall 8) -- isolated property additions.
  3. **Third**: $lookup HOF chaining (Pitfall 9) -- isolated walkPath step iteration addition.
  4. **Fourth**: Inline lambda apply fix (Pitfall 10) -- isolated walkApply branch addition.
  5. **Fifth**: Filter predicate leak + focus variable prefix (Pitfalls 2, 3, 6) -- these share code and must be done together. This is the hardest fix with the most regression risk.
  6. **Sixth**: Array constructor scope (Pitfalls 1, 7) -- requires walkUnary change, should be done after filter fixes to avoid confusion.
- Run the FULL test suite (200 tests) after EACH fix. Do not batch fixes.
- Commit each fix separately so that `git bisect` can identify which change caused a regression.

**Detection (warning signs):**
- Multiple fixes are applied in a single commit.
- Test failures appear that seem unrelated to the current fix.
- The developer is debugging filter behavior but the actual regression is in scope propagation.

**Phase to address:** Cross-cutting concern. Roadmap should enforce sequential fix ordering with full test runs between each.

---

## Minor Pitfalls

### Pitfall 12: Regression Tests That Only Cover the Bug, Not the Boundary

**What goes wrong:**
Each BUG(v1.2) test case documents the specific expression and expected output for the bug. Fixing the bug makes that test pass. But the regression test suite (10+ new tests per bug category) needs to cover the BOUNDARIES of the fix, not just the happy path:

- What happens at the transition between "needs prefixing" and "doesn't need prefixing"?
- What happens with zero filter stages? One? Three?
- What happens when the variable resolves to `[]` (empty paths)?
- What happens when the variable resolves to multiple paths?

A regression suite that only tests variations of the BUG expression will pass today and fail to catch tomorrow's regressions.

**Prevention:**
- For each fix, identify the conditional logic added (the `if`/`else`/`switch` branches) and write tests that exercise EACH branch.
- For each fix, identify the boundary between "old behavior" and "new behavior" and write tests on both sides.
- Include negative tests: expressions that should NOT be affected by the fix still produce the same output.

**Detection (warning signs):**
- All regression tests for a bug category use similar expressions (just varying field names).
- No regression test exercises the "this expression is NOT affected" case.
- Mutation testing (mentally: "if I delete this `if` clause, which tests fail?") reveals untested branches.

**Phase to address:** Regression test writing phase. Every bug fix phase should include boundary testing.

---

### Pitfall 13: Over-Approximation Principle Conflict with Precision Fixes

**What goes wrong:**
The project's design principle is "over-approximate: report a superset of actual paths rather than risk missing paths." Several bug fixes REMOVE spurious paths (e.g., removing `items.active.name` from the filter predicate leak, removing double-prefixed `orders.orders.total`). These fixes make the output MORE precise, which conflicts with the over-approximation principle.

If a fix removes a path that is spurious in MOST cases but legitimate in some edge case, the fix violates the over-approximation guarantee. For instance, removing all "predicate-like" paths from HOF bindings might also remove a path that happens to look like a predicate but is actually a legitimate data access.

**Prevention:**
- Each fix should be evaluated against the question: "Does this fix ever cause a real data path to be missed?"
- If the answer is "possibly," the fix should err on the side of keeping the path (with a note explaining why).
- The existing tests serve as the ground truth for "legitimate paths." If a fix removes a path that an existing test expects, that is a regression, not a precision improvement.
- Document which paths each fix removes and why they are guaranteed to be spurious.

**Detection (warning signs):**
- A fix reduces the total number of paths for an expression but no test verifies the removed paths were actually spurious.
- A fix uses aggressive heuristics ("if the path looks like X, remove it") rather than structural analysis.
- Integration tests start failing because the fix removed paths they expected.

**Phase to address:** All fix phases. Every fix should be reviewed against the over-approximation principle.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| walkPath object constructor/block steps | Pitfall 4 (infinite recursion) | Add explicit `unary`/`block` cases, not catch-all default |
| walkVariable .group + walkPath sort/group | Pitfall 8 (missing analogous gaps) | Audit ALL variable/path properties in single pass |
| $lookup HOF chaining | Pitfall 9 (incorrect prefixing) | Function arguments are absolute, not context-relative |
| Inline lambda apply (~>) | Pitfall 10 (thunk lambda confusion) | Check `.thunk` flag before treating as user lambda |
| Filter predicate leak into HOF bindings | Pitfalls 2, 6 (breaks existing HOF tests) | Separate "base paths" from "predicate paths" structurally, not by string matching |
| Focus variable @$v double-prefix | Pitfall 3 (breaks non-focus filter prefixing) | Distinguish variable-resolved paths from context-relative paths in filter walker |
| Array constructor scope leak | Pitfalls 1, 7 (breaks array constructor / BindNode) | Fix in walkUnary for `[`, not in walkBind; verify parser AST shape first |
| Fix ordering | Pitfall 11 (cascading failures) | Sequential fixes with full test runs between each |
| Regression test suite | Pitfall 12 (boundary coverage) | Test conditional branches and negative cases, not just bug variations |
| All fixes | Pitfall 13 (over-approximation conflict) | Verify no fix removes legitimate paths |

## Pitfall Severity Summary

| # | Pitfall | Severity | Regression Risk | Fix Complexity |
|---|---------|----------|----------------|----------------|
| 1 | Scope isolation breaks array constructors | CRITICAL | HIGH (5+ tests) | MEDIUM |
| 2 | Filter predicate fix breaks HOF binding | CRITICAL | HIGH (18+ tests) | HIGH |
| 3 | Prefix fix breaks non-focus variables | CRITICAL | HIGH (6+ tests) | HIGH |
| 4 | walkPath expansion causes infinite recursion | CRITICAL | LOW (isolated) | LOW |
| 5 | Dedup fix targets wrong root cause | CRITICAL | MEDIUM (dedup tests) | LOW (just don't do it) |
| 6 | HOF argument fix breaks $map/$filter/$reduce | CRITICAL | HIGH (18+ tests) | HIGH |
| 7 | BindNode scope fix breaks variable binding | CRITICAL | HIGH (8+ tests) | MEDIUM |
| 8 | .group fix misses analogous property gaps | MODERATE | LOW (isolated) | LOW |
| 9 | $lookup fix introduces incorrect prefixing | MODERATE | LOW (isolated) | MEDIUM |
| 10 | Apply fix breaks thunk lambda handling | MODERATE | MEDIUM (3+ tests) | LOW |
| 11 | Fix ordering creates cascading failures | MODERATE | HIGH (debugging cost) | LOW (planning) |
| 12 | Regression tests miss boundaries | MINOR | LOW (latent risk) | LOW |
| 13 | Over-approximation principle conflict | MINOR | LOW (design tension) | LOW |

## Recommended Fix Ordering (Safest to Riskiest)

```
1. walkPath object constructor/block steps  [ISOLATED, LOW RISK]
2. walkVariable .group + sort property gaps [ISOLATED, LOW RISK]
3. $lookup HOF chaining in walkPath         [ISOLATED, MEDIUM RISK]
4. Inline lambda apply (~>) binding         [ISOLATED, LOW RISK]
5. Filter predicate leak + prefix fix       [COUPLED, HIGH RISK] ← do together
6. Array constructor scope propagation      [MEDIUM RISK]
```

Items 1-4 can be done in any order. Items 5-6 should be done last because they have the highest regression risk and the most interaction with existing passing tests.

## Sources

- Direct source code analysis: `walker.ts` (626 lines), `scope.ts` (97 lines), `index.ts` (46 lines), `types.ts` (212 lines), `builtins.ts` (46 lines), `path-builder.ts` (33 lines) -- HIGH confidence
- All 14 BUG(v1.2) test fixtures across `data-transforms.test.ts`, `business-rules.test.ts`, `api-reshaping.test.ts`, `data-export.test.ts`, `edge-cases.test.ts` -- HIGH confidence
- 105 unit tests in `extract-paths.test.ts` (passing baseline) -- HIGH confidence
- 95 integration tests across 5 files (186 passing + 14 skipped) -- HIGH confidence
- JSONata parser AST structure (inferred from types.ts and actual parser output) -- MEDIUM confidence (parser internals not directly inspected)
- Immutable scope chain design documented in PROJECT.md key decisions -- HIGH confidence

---
*Pitfalls research for: v1.1.1 Bug Fixes milestone*
*Researched: 2026-03-05*
