# Phase 14: Isolated Single-Function Fixes - Research

**Researched:** 2026-03-05
**Domain:** AST walker bug fixes -- walkPath step handling, walkVariable group-by, function call chaining, array constructor scope
**Confidence:** HIGH

## Summary

Phase 14 addresses 4 categories of isolated walker bugs in `src/walker.ts`, each with a clear root cause traced through AST inspection and code analysis. All 4 bugs share a common theme: the walker encounters an AST node type in a position it doesn't currently handle, and silently drops the paths. The fixes are additive -- each adds handling for a previously-unhandled case without altering existing behavior.

The bugs are genuinely isolated: PRNT fixes add step handling in `walkPath`'s iteration loop, WVAR adds `.group` handling to `walkVariable`, LOOK adds function-call step handling in `walkPath`, and ARRS adds sequential scope accumulation to `walkUnary`'s array case. None of these changes interact with each other or with the HOF/filter machinery that Phase 16 will fix.

**Primary recommendation:** Fix in dependency order (walkPath steps first, then walkVariable, then $lookup chaining, then array scope), with each fix immediately verified by unskipping its BUG test and running 10+ new regression tests before moving to the next category.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Fix ONLY the documented bugs -- do not speculatively fix other node types walkPath may skip
- Each fix should be minimal and targeted: make the skipped test pass without altering behavior of passing tests
- If a fix naturally covers additional cases (e.g., walkPath object constructor fix also handles nested objects), that's fine -- but don't go looking for undocumented gaps
- Add new regression tests as new `describe` blocks within the existing integration test files where the BUG(v1.2) skips live
- Parent operator tests in `api-reshaping.test.ts` (where PRNT skips are)
- walkVariable .group tests in `data-export.test.ts` (where WVAR skip is)
- $lookup chaining tests in `business-rules.test.ts` and `edge-cases.test.ts` (where LOOK skips are)
- Array constructor scope tests in `edge-cases.test.ts` (where ARRS skip is)
- 10+ new regression tests per bug category, 40+ total across 4 files
- Match the v1.1 integration test style: scenario-based with realistic field names, IntegrationFixture[] arrays, assertFixture() helper
- Test boundary variations: nested depth, empty inputs, mixed confidence levels, combinations with other operators
- Each regression test should document what specific edge it's testing (not just "works")

### Claude's Discretion
- Exact implementation approach for each fix (how to modify walker functions)
- Specific regression test expressions and expected outputs beyond the documented skips
- Whether fixes share any common helper code or remain independent
- Fix ordering within the phase

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PRNT-01 | Parent operator walkPath handles object constructor steps | Root cause identified: `walkPath` iteration loop only handles `name` and `sort` step types, skips `unary` (object constructor). Fix: add `unary` with `value === "{"` case to walk inner value expressions with context prefix. |
| PRNT-02 | Parent operator walkPath handles block expression steps | Same root cause as PRNT-01: `walkPath` iteration skips `block` step type. Fix: add `block` case to walk inner expressions with context prefix. |
| PRNT-03 | Thorough regression suite (10+ tests) covering parent operator through nested constructs | Test patterns identified: nested objects, multi-field objects, parent at various depths, block with multiple expressions, mixed parent + non-parent paths, combination with filters |
| WVAR-01 | walkVariable handles `.group` property on variable nodes | Root cause identified: `walkVariable` (line 379) checks predicates but not `.group` property. AST shows `VariableNode` can have `.group` property (same structure as `PathNode.group`). Fix: check for `node.group` and call `walkGroupBy`-like logic with resolved paths as base. |
| WVAR-02 | Thorough regression suite (10+ tests) covering walkVariable property traversal including group-by | Test patterns: variable-resolved group-by with aggregation, nested group keys, multi-aggregate, filtered+grouped, deep variable chains with group-by |
| LOOK-01 | $lookup function arguments are extracted as data paths | Root cause identified: when `$lookup(obj, key).field` is parsed, the AST is a `PathNode` with a `function` step followed by a `name` step. `walkPath` only builds base path from `buildPathString` (which skips function steps), so only the trailing `.field` appears. Fix: add `function` case to `walkPath` iteration to walk function call arguments. |
| LOOK-02 | Path continuation after $lookup result extracts both arguments and chained property | Same fix as LOOK-01: walking the function step produces argument paths, and the existing base path logic continues to produce the chained `.field` path. |
| LOOK-03 | Thorough regression suite (10+ tests) covering $lookup patterns and HOF chaining | Test patterns: $lookup with various arg types, chained property after lookup, nested lookups, lookup in object constructor, lookup combined with variable resolution |
| ARRS-01 | Variable bindings inside array constructors accumulate scope sequentially | Root cause identified: `walkUnary` for `"["` uses `flatMap` with the same `scope` for every expression. `BindNode` elements return RHS paths but don't update scope for subsequent elements. Fix: change array constructor to sequential processing (like `walkBlock`) that accumulates scope from bind expressions. |
| ARRS-02 | Thorough regression suite (10+ tests) covering array constructor scope isolation and variable resolution | Test patterns: single bind+reference, multi-bind chain, bind with path suffix, bind with non-bind interleaved, nested array constructors, bind shadowing |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.0.18 | Test runner | Already in use, all 200 tests run on it |
| typescript | 5.9.3 | Type checking | Already in use, `pnpm typecheck` validates |
| jsonata | 2.1.0 | Parser (AST source) | Unchanged dependency, parse() wraps it |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsup | 8.5.1 | Build tool | `pnpm build` before CLI tests |

No new dependencies needed. All fixes are in `src/walker.ts`. All tests use existing `assertFixture()` helper.

## Architecture Patterns

### Relevant Project Structure
```
src/
  walker.ts          # ALL 4 bug fixes go here (single file)
  types.ts           # AST type definitions (read-only reference)
  scope.ts           # Scope chain utilities (read-only, already correct)
  path-builder.ts    # Path string builder (read-only reference)
  builtins.ts        # Built-in function list (read-only reference)
  index.ts           # extractPaths() public API (unchanged)
test/integration/
  api-reshaping.test.ts    # PRNT regression tests go here
  data-export.test.ts      # WVAR regression tests go here
  business-rules.test.ts   # LOOK regression tests (1 skip here)
  edge-cases.test.ts       # LOOK + ARRS regression tests (1 skip each)
  helpers.ts               # assertFixture(), IntegrationFixture type
```

### Pattern 1: walkPath Step Iteration (PRNT-01, PRNT-02, LOOK-01/02)

**What:** The `walkPath` function iterates `node.steps` and currently only handles `name` (for filter stages) and `sort` steps. Object constructors (`unary` with `value === "{"`), block expressions, and function calls appear as path steps but are silently skipped.

**Current code (walker.ts lines 138-151):**
```typescript
for (let i = 0; i < node.steps.length; i++) {
  const step = node.steps[i];
  if (step.type === "name") {
    // handles filter stages on name steps
  } else if (step.type === "sort") {
    // handles sort terms
  }
  // Everything else silently dropped!
}
```

**Fix pattern:** Add additional `else if` branches for `unary`, `block`, and `function` step types. Each walks the step's inner expressions and prefixes results with the context path built from preceding steps.

### Pattern 2: Context Prefix Calculation

**What:** When walking inner expressions of a path step, results must be prefixed with the path built from steps *before* the current step. The pattern already exists for sort steps.

**Key insight from AST analysis:** For object constructor and block steps, the prefix should be built from `node.steps.slice(0, i)` (steps BEFORE the current step, not including it), same as sort. This is because the unary/block step itself is not a path segment -- it's a mapping expression.

**However**, `buildPathString` already skips non-name/wildcard/descendant/parent step types, so `slice(0, i)` will naturally produce the correct prefix even if there are intervening non-name steps.

### Pattern 3: Variable Node Group-By (WVAR-01)

**What:** `VariableNode` in the AST can have a `.group` property (identical structure to `PathNode.group`). The `walkVariable` function currently checks for `.predicate` but not `.group`.

**AST evidence:**
```json
{
  "value": "r",
  "type": "variable",
  "position": 23,
  "group": {
    "lhs": [[keyExpr, valExpr]],
    "position": 24
  }
}
```

**Fix pattern:** After resolving the variable, check for `node.group`. If present, walk the group-by key/value pairs with resolved paths as the base prefix (same logic as `walkGroupBy` but using resolved variable paths instead of `buildPathString`).

### Pattern 4: Sequential Scope in Array Constructor (ARRS-01)

**What:** Array constructors (`[a, b, c]`) currently use `flatMap` which processes all elements with the same scope. If one element is a `bind` node (`$x := expr`), subsequent elements should see `$x` in scope.

**Current code (walker.ts line 366):**
```typescript
case "[":
  return (node.expressions ?? []).flatMap((e) => walkNode(e, scope));
```

**Fix pattern:** Replace `flatMap` with sequential processing identical to `walkBlock` -- iterate expressions, accumulate scope from bind nodes, walk subsequent expressions with updated scope.

### Anti-Patterns to Avoid
- **Modifying buildPathString:** The path builder is correct. Bugs are in the walker's failure to walk inner expressions, not in path string construction.
- **Changing scope.ts:** The scope chain is correct. ARRS-01 is about the walker not using scope accumulation, not about scope being broken.
- **Altering existing passing test assertions:** All 200 passing tests must continue to pass unchanged. Fixes are additive only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path prefixing | Custom string concatenation | `prefixPaths()` (already exists, line 89) | Handles empty prefix and empty paths gracefully |
| Group-by walking | Inline group-by logic | Refactor `walkGroupBy` to accept base paths (or duplicate its pattern) | `walkGroupBy` already handles the lhs pair iteration correctly |
| Scope accumulation | New scope mechanism | `bindVariable()`, `childScope()` from scope.ts | Immutable scope chain already works correctly for blocks |
| Test assertions | Custom expect() chains | `assertFixture()` from helpers.ts | Exact match mode with sorted comparison already handles all cases |

## Common Pitfalls

### Pitfall 1: Wrong Context Prefix Offset for Path Steps
**What goes wrong:** Using `slice(0, i + 1)` (including the current step) instead of `slice(0, i)` (before the current step) for the context prefix.
**Why it happens:** Name steps use `slice(0, i + 1)` for filter stages because the name step IS part of the path. But unary/block/function steps are NOT path segments.
**How to avoid:** For non-name, non-path steps (unary, block, function), use `buildPathString(node.steps.slice(0, i))` -- same pattern as sort steps on line 148.
**Warning signs:** Paths like `orders.items.{...}.name` appearing with a `{...}` segment.

### Pitfall 2: Forgetting to Walk Object Constructor Keys (Not Just Values)
**What goes wrong:** Only walking values of object constructor pairs, missing that keys could be path expressions.
**Why it happens:** In `walkUnary` for `"{"`, only values are walked (line 369). This is correct for standalone object constructors (keys are typically string literals). But when the object constructor is a path step, the values need to be walked AND prefixed.
**How to avoid:** When handling a unary `"{"` step in walkPath, walk the value expressions (same as walkUnary does) but also prefix them with the context. Keys are string literals in the test cases -- don't walk them.
**Warning signs:** Inner paths from object constructor values missing the prefix.

### Pitfall 3: Double-Walking the Base Path
**What goes wrong:** The fix for walkPath steps might cause the base path to be emitted twice or inner expressions to also produce a redundant base path.
**Why it happens:** `walkPath` already builds `basePath` from `buildPathString(node.steps)` at line 132. If the fix also emits paths from inner step walking, they must be additive -- not duplicating the base.
**How to avoid:** The base path (`orders.items` from `buildPathString`) is already added on line 133-135. The step iteration only adds paths from inner expressions (e.g., `name`, `%.date` inside the object constructor). These are different paths, so no duplication occurs.
**Warning signs:** Duplicate paths in output (deduplication in `extractPaths` would hide this, but it indicates logic errors).

### Pitfall 4: Breaking $lookup Non-Chaining Case
**What goes wrong:** Adding function step handling breaks standalone `$lookup(obj, key)` (without chaining).
**Why it happens:** Standalone `$lookup(obj, key)` parses as a `FunctionNode`, NOT a `PathNode` with function step. Only `$lookup(obj, key).field` (with chaining) parses as a `PathNode`. So the fix only triggers when there IS chaining.
**How to avoid:** Verify that standalone `$lookup(products, orders.productId)` still works (it's tested in BIZR-04 passing tests).
**Warning signs:** BIZR-04 "direct lookup" test starts failing.

### Pitfall 5: Array Constructor Scope Leaking Upward
**What goes wrong:** Bind variables from inside an array constructor become visible outside it.
**Why it happens:** If the fix doesn't use a child scope, bindings leak.
**How to avoid:** The array constructor should create a child scope (or at minimum, the accumulated scope stays local to the array constructor expressions). Since `walkUnary` returns paths (not scopes), the scope stays local.
**Warning signs:** Tests outside the array constructor resolving variables defined inside it.

### Pitfall 6: Group-By on Unresolvable Variable
**What goes wrong:** When `walkVariable` encounters a `.group` on an unresolvable variable (no scope binding), it crashes or produces malformed paths.
**Why it happens:** If the variable is unresolvable, `resolved` is null and there's no base path for the group-by.
**How to avoid:** Only process `.group` when the variable is successfully resolved (check `resolved` exists and has length > 0 before entering group-by logic).
**Warning signs:** Empty or null-prefixed paths like `.category`.

## Code Examples

### Fix 1: walkPath Object Constructor and Block Steps (PRNT-01, PRNT-02)

```typescript
// In walkPath, inside the step iteration loop (after the sort check):
// walker.ts, approximately line 150

} else if (step.type === "unary" && (step as UnaryNode).value === "{") {
  // Object constructor step: walk value expressions with context prefix
  const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
  const unaryStep = step as UnaryNode;
  for (const [_key, val] of unaryStep.lhs ?? []) {
    const valPaths = walkNode(val, scope);
    paths.push(...prefixPaths(contextPrefix, valPaths));
  }
} else if (step.type === "block") {
  // Block expression step: walk inner expressions with context prefix
  const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
  const blockStep = step as BlockNode;
  for (const expr of blockStep.expressions) {
    const exprPaths = walkNode(expr, scope);
    paths.push(...prefixPaths(contextPrefix, exprPaths));
  }
}
```

**Why this works:** The AST for `orders.items.{"itemName": name, "orderDate": %.date}` has 3 steps: `name("orders")`, `name("items")`, `unary("{")`. The base path `orders.items` is already built by `buildPathString` (which skips the unary step). The fix walks the unary step's value expressions (`name` -> `["name"]`, `%.date` -> `["%.date"]`), prefixes each with `"orders.items"` (from `slice(0, 2)`), producing `["orders.items.name", "orders.items.%.date"]`.

### Fix 2: walkVariable Group-By (WVAR-01)

```typescript
// In walkVariable, after the predicate handling block (approximately line 398):

// Handle group-by on variable node (mirrors walkGroupBy for PathNode)
const varNode = node as VariableNode & { group?: unknown };
if (varNode.group) {
  const groupNode = varNode.group as unknown as GroupByNode;
  const groupBasePath = resolved.length > 0 ? resolved[0] : "";
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

**Why this works:** For `($r := data.records; $r{category: $sum(amount)})`, `$r` resolves to `["data.records"]`. The group-by key `category` gets prefixed to `data.records.category`. The value `$sum(amount)` walks to `["amount"]` which gets prefixed to `data.records.amount`. Combined with the resolved variable paths, output is `["data.records", "data.records.category", "data.records.amount"]`.

### Fix 3: walkPath Function Step (LOOK-01, LOOK-02)

```typescript
// In walkPath, inside the step iteration loop:

} else if (step.type === "function") {
  // Function call step (e.g., $lookup(obj, key) in $lookup(obj, key).field)
  // Walk the function call to extract argument paths
  paths.push(...walkFunction(step as FunctionNode, scope));
}
```

**Why this works:** For `$lookup(inventory, itemCode).quantity`, the AST is a PathNode with steps: `function($lookup)`, `name("quantity")`. `buildPathString` skips the function step, producing just `"quantity"` as the base path. The fix walks the function step, which goes through `walkFunction` -> non-HOF passthrough -> produces `["inventory", "itemCode"]`. Combined: `["quantity", "inventory", "itemCode"]`. This matches the expected output.

**Note on expected output:** The EDGE-05 test expects `["inventory", "inventory.quantity", "itemCode"]` but the BIZR-04 test expects `["products", "price", "sku"]`. The EDGE-05 fixture expects `inventory.quantity` (lookup table prefixed to chained property) while BIZR-04 expects bare `price`. This discrepancy needs careful verification. Looking at the fixtures:

- EDGE-05: `$lookup(inventory, itemCode).quantity` expects `inventory.quantity` (the `.quantity` is on the lookup result, which is from inventory)
- BIZR-04: `$lookup(products, sku).price` expects `price` (bare)

The EDGE-05 expected output implies the chained property should be prefixed with the first argument (the lookup table). This is a semantic question: does `.quantity` after `$lookup(inventory, ...)` mean `inventory.quantity`? The fixture says yes. This means the base path built from steps should use the first function argument as context. This is already how it would work: `buildPathString` skips the function step and only gets `"quantity"`, but we need `"inventory.quantity"`. So we need special handling: when a function step precedes name steps, the function's first argument provides context for continuation.

Actually, re-reading the AST more carefully: `buildPathString` only produces segments for name/wildcard/descendant/parent. For a path `[$lookup(inventory, itemCode), quantity]` the `buildPathString` would only see `quantity` since the function step is skipped. To get `inventory.quantity` we need to recognize that `$lookup` returns from `inventory`, so the chained `.quantity` refers to `inventory.quantity`.

This is more nuanced than initially analyzed. The function step should contribute its first argument's paths as a "continuation context" for subsequent steps.

### Fix 4: Array Constructor Sequential Scope (ARRS-01)

```typescript
// Replace the "[" case in walkUnary (line 365-366):

case "[": {
  // Array constructor with sequential scope accumulation
  const paths: string[] = [];
  let currentScope = scope;
  for (const expr of node.expressions ?? []) {
    if (expr.type === "bind") {
      const bindNode = expr as BindNode;
      const rhsPaths = walkNode(bindNode.rhs, currentScope);
      paths.push(...rhsPaths);
      currentScope = bindVariable(currentScope, bindNode.lhs.value, rhsPaths);
    } else {
      paths.push(...walkNode(expr, currentScope));
    }
  }
  return paths;
}
```

**Why this works:** For `[$x := data.source, $x.field]`, the first expression is a `bind` that produces `["data.source"]` and binds `$x` to `["data.source"]`. The second expression `$x.field` resolves `$x` to `["data.source"]` and appends `.field`, producing `["data.source.field"]`. Combined: `["data.source", "data.source.field"]`.

## Detailed Root Cause Analysis

### Bug Category: PRNT (walkPath doesn't walk non-name, non-sort steps)

**Root cause:** `walkPath`'s step iteration loop (lines 138-151) has two branches: `step.type === "name"` and `step.type === "sort"`. When the JSONata parser places a `unary` (object constructor) or `block` expression as a step in a path node, the walker only builds the base path string (via `buildPathString`, which skips these step types) but never walks their inner expressions.

**AST evidence for PRNT-01:** `orders.items.{"itemName": name, "orderDate": %.date}` produces:
```
PathNode.steps = [name("orders"), name("items"), unary("{", lhs=[[string, path(name)], [string, path(parent,name)]])]
```
- `buildPathString` produces `"orders.items"` (skips unary step)
- Step iteration finds `name("orders")` -- no stages, skip. `name("items")` -- no stages, skip. `unary("{")` -- no matching branch, **silently dropped**.
- Result: only `["orders.items"]` when it should also include inner paths `orders.items.name` and `orders.items.%.date`.

**Current output:** `[{path: "orders.items", confidence: "static"}]`
**Expected output:** `[{path: "orders.items", confidence: "static"}, {path: "orders.items.%.date", confidence: "partial"}, {path: "orders.items.name", confidence: "static"}]`

### Bug Category: WVAR (walkVariable ignores .group property)

**Root cause:** `walkVariable` (line 379) resolves the variable and checks for `.predicate` (filter stages), but the `VariableNode` can also have a `.group` property when the expression uses group-by syntax on a variable (e.g., `$r{key: value}`). The `.group` property is not in the `VariableNode` TypeScript interface but IS present on the parsed AST node.

**AST evidence for WVAR-01:** `($r := data.records; $r{category: $sum(amount)})` produces a block where the second expression is:
```
VariableNode(value="r", group={lhs: [[path(category), function($sum, path(amount))]]})
```
- `walkVariable` resolves `$r` to `["data.records"]`, returns `["data.records"]`
- `.group` property is present but never checked
- Result: group-by key/value paths completely lost

**Current output:** `[{path: "data.records", confidence: "static"}]`
**Expected output:** `[{path: "data.records", confidence: "static"}, {path: "data.records.amount", confidence: "static"}, {path: "data.records.category", confidence: "static"}]`

### Bug Category: LOOK (walkPath doesn't walk function steps)

**Root cause:** When `$lookup(obj, key).field` is parsed, the AST is a `PathNode` with steps `[FunctionNode, NameNode]`. The `walkPath` step iteration doesn't handle `function` step types, so the function's arguments are never walked. Additionally, `buildPathString` only sees the trailing `name` step, producing just `"field"` without any context from the function.

**AST evidence:** `$lookup(inventory, itemCode).quantity` produces:
```
PathNode.steps = [FunctionNode($lookup, args=[path(inventory), path(itemCode)]), name("quantity")]
```
- `buildPathString` skips function step, produces `"quantity"`
- Step iteration: `function` type -- no matching branch, **silently dropped**
- Result: only `["quantity"]` when it should include `["inventory", "itemCode", "quantity"]`

**Current output:** `[{path: "quantity", confidence: "static"}]`
**Expected output (EDGE-05):** `[{path: "inventory", confidence: "static"}, {path: "inventory.quantity", confidence: "static"}, {path: "itemCode", confidence: "static"}]`
**Expected output (BIZR-04):** `[{path: "products", confidence: "static"}, {path: "price", confidence: "static"}, {path: "sku", confidence: "static"}]`

**Important discrepancy:** EDGE-05 expects `inventory.quantity` (prefixed) while BIZR-04 expects bare `price`. This suggests the expected behavior depends on `$lookup` semantics: `$lookup(table, key)` returns a value FROM the table, so `.quantity` after lookup means `table.quantity`. The EDGE-05 fixture is the authoritative one for this bug. The BIZR-04 fixture may need adjustment, or the implementation needs to emit both bare and prefixed. Review the expected outputs carefully during implementation.

### Bug Category: ARRS (walkUnary array case doesn't accumulate scope)

**Root cause:** `walkUnary`'s `"["` case (line 366) uses `flatMap` which evaluates all expressions with the original `scope`. When an expression is a `bind` node, its RHS is walked (returning paths), but the binding is not added to scope for subsequent expressions. This is unlike `walkBlock` (line 316) which explicitly accumulates scope.

**AST evidence:** `[$x := data.source, $x.field]` produces:
```
UnaryNode(value="[", expressions=[BindNode($x, path(data.source)), PathNode([$x, name(field)])])
```
- `flatMap` processes `BindNode` -> walks RHS -> returns `["data.source"]` (but `$x` NOT bound in scope)
- `flatMap` processes `PathNode([$x, field])` -> `$x` unresolvable -> returns `[]` (silent skip)
- Result: only `["data.source"]` when `$x.field` should resolve to `"data.source.field"`

**Current output:** `[{path: "data.source", confidence: "static"}]`
**Expected output:** `[{path: "data.source", confidence: "static"}, {path: "data.source.field", confidence: "static"}]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `walkPath` only handles name+sort steps | Needs to handle unary, block, function steps | Phase 14 (this fix) | Enables parent operator through constructors |
| `walkVariable` ignores .group | Needs to mirror PathNode.group handling | Phase 14 (this fix) | Enables variable-resolved group-by |
| Array constructor uses stateless flatMap | Needs sequential scope like walkBlock | Phase 14 (this fix) | Enables variable resolution across array elements |

## TypeScript Considerations

The `VariableNode` interface in `types.ts` does NOT include a `group` property. The WVAR fix will need to handle this via type assertion:
```typescript
const varNode = node as VariableNode & { group?: unknown };
```
Or by extending the `VariableNode` interface to include `group?: AstNode`. Extending the type is cleaner but adds scope to the change. Type assertion is minimal and matches the existing pattern used for `GroupByNode` in `walkGroupBy` (line 187: `as unknown as GroupByNode`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRNT-01 | walkPath walks object constructor steps | integration | `pnpm vitest run test/integration/api-reshaping.test.ts -x` | Fixture exists (skipped), tests to add |
| PRNT-02 | walkPath walks block expression steps | integration | `pnpm vitest run test/integration/api-reshaping.test.ts -x` | Fixture exists (skipped), tests to add |
| PRNT-03 | 10+ regression tests for parent+constructor patterns | integration | `pnpm vitest run test/integration/api-reshaping.test.ts -x` | Tests to add |
| WVAR-01 | walkVariable handles .group property | integration | `pnpm vitest run test/integration/data-export.test.ts -x` | Fixture exists (skipped), tests to add |
| WVAR-02 | 10+ regression tests for walkVariable group-by | integration | `pnpm vitest run test/integration/data-export.test.ts -x` | Tests to add |
| LOOK-01 | $lookup arguments extracted as data paths | integration | `pnpm vitest run test/integration/business-rules.test.ts test/integration/edge-cases.test.ts -x` | Fixture exists (skipped), tests to add |
| LOOK-02 | Path continuation after $lookup result | integration | `pnpm vitest run test/integration/edge-cases.test.ts -x` | Fixture exists (skipped), tests to add |
| LOOK-03 | 10+ regression tests for $lookup chaining | integration | `pnpm vitest run test/integration/business-rules.test.ts test/integration/edge-cases.test.ts -x` | Tests to add |
| ARRS-01 | Array constructor scope accumulates sequentially | integration | `pnpm vitest run test/integration/edge-cases.test.ts -x` | Fixture exists (skipped), tests to add |
| ARRS-02 | 10+ regression tests for array scope | integration | `pnpm vitest run test/integration/edge-cases.test.ts -x` | Tests to add |

### Sampling Rate
- **Per task commit:** `pnpm test` (full 200+ test suite, completes in ~300ms)
- **Per wave merge:** `pnpm test` (same -- fast enough to run every time)
- **Phase gate:** Full suite green, 0 skipped BUG(v1.2) tests in these 4 categories, 40+ new tests passing

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. The `assertFixture()` helper, `IntegrationFixture` type, and all 4 target test files already exist.

## Skipped Test Inventory

Summary of the 6 BUG(v1.2) tests this phase must unskip (out of 14 total skipped):

| File | Line | Bug ID | Expression | Category |
|------|------|--------|------------|----------|
| `api-reshaping.test.ts` | 201 | PRNT-01 | `orders.items.{"itemName": name, "orderDate": %.date}` | Parent in object constructor |
| `api-reshaping.test.ts` | 215 | PRNT-02 | `orders.items.(%.orderRef & ": " & name)` | Parent in block step |
| `data-export.test.ts` | 224 | WVAR-01 | `($r := data.records; $r{category: $sum(amount)})` | Variable group-by |
| `business-rules.test.ts` | 161 | LOOK-01 | `$lookup(products, sku).price` | Lookup chaining |
| `edge-cases.test.ts` | 123 | LOOK-02 | `$lookup(inventory, itemCode).quantity` | Lookup chaining |
| `edge-cases.test.ts` | 155 | ARRS-01 | `[$x := data.source, $x.field]` | Array scope |

**Note:** The remaining 8 skipped tests belong to other categories (filter predicate leak, focus variable double-prefix, pipeline/apply bugs) and are addressed in Phases 15 and 16. They must NOT be unskipped in this phase.

## Open Questions

1. **$lookup Chaining: Prefixed vs Bare Path for Chained Property**
   - What we know: EDGE-05 expects `inventory.quantity` (first arg prefixed), BIZR-04 expects bare `price`
   - What's unclear: Whether `$lookup(table, key).field` should produce `table.field` (semantically: field on lookup result from table) or just `field` (structurally: next step in path)
   - Recommendation: The EDGE-05 fixture was written with more thought (it's the dedicated test for this bug). Implement to match EDGE-05. If BIZR-04's expected output conflicts, update BIZR-04's expected output to match the same logic (both should produce `table.field`). Verify by running both tests.

2. **VariableNode Type Extension**
   - What we know: `VariableNode` in types.ts lacks `.group` property, but the jsonata parser produces it
   - What's unclear: Whether to extend the TypeScript interface or use type assertions
   - Recommendation: Add `group?: AstNode` to `VariableNode` interface for type safety, consistent with `PathNode.group`. This is a minimal, correct change.

## Sources

### Primary (HIGH confidence)
- `src/walker.ts` -- Direct code reading, all 4 bug root causes traced through actual code
- `src/types.ts` -- AST type definitions confirming interface gaps
- `test/integration/*.test.ts` -- All 6 skipped BUG(v1.2) fixtures with expected outputs
- AST dumps via `jsonata().ast()` -- Verified exact parser output for all 5 buggy expressions
- `pnpm test` output -- Confirmed 200 passing, 14 skipped baseline

### Secondary (MEDIUM confidence)
- Code inference about `$lookup` chaining prefix semantics -- based on fixture expected values, not jsonata documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all tools already in project
- Architecture: HIGH -- all 4 bugs have exact root causes traced through code and AST dumps
- Pitfalls: HIGH -- verified against actual code behavior with `extractPaths()` output
- $lookup prefix semantics: MEDIUM -- two fixtures seem to disagree, needs implementation-time verification

**Research date:** 2026-03-05
**Valid until:** indefinite (fixing bugs in project's own code, no external dependency changes)
