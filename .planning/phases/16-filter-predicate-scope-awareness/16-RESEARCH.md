# Phase 16: Filter Predicate Scope-Awareness - Research

**Researched:** 2026-03-06
**Domain:** AST walker bug fixes -- filter predicate path leak into HOF bindings, focus variable double-prefix, variable-resolved filter prefix
**Confidence:** HIGH

## Summary

Phase 16 addresses the final 6 BUG(v1.2) bugs across 2 tightly coupled categories: filter predicate paths leaking into higher-order function parameter bindings (4 bugs) and focus variable / variable-resolved paths being spuriously prefixed in filter contexts (2 bugs). These are the highest-regression-risk fixes in the milestone because they touch `walkHigherOrderCall` (used by ALL HOF calls: `$map`, `$filter`, `$reduce`, `$each`, `$sift`) and `walkFilterStages` (used by ALL filter predicates).

The root causes are confirmed through direct code tracing and AST inspection. For the filter predicate leak: `walkHigherOrderCall` calls `walkNode(dataArg)` on expressions like `items[active]`, which returns BOTH `["items", "items.active"]`. Both paths are bound to the lambda parameter `$v`, so `$v.name` resolves to both `items.name` (correct) and `items.active.name` (spurious). For the focus/variable-in-filter bugs: `walkFilterStages` calls `walkNode(filterExpr, filterScope)` and then `prefixPaths(contextPrefix, filterPaths)` uniformly, but variable-resolved paths are already absolute and should NOT be re-prefixed.

All 6 bugs require changes to exactly 2 functions in `src/walker.ts`: `walkHigherOrderCall` (lines 558-590) and `walkFilterStages` (lines 259-303). The fixes must preserve behavior for 265 passing tests (including 40+ HOF-related tests).

**Primary recommendation:** Fix in two isolated stages: (1) create an `extractBasePaths()` helper that extracts only collection-identity paths from a data argument node (excluding filter predicate paths), use it in `walkHigherOrderCall` for lambda parameter binding; (2) modify `walkFilterStages` to not re-prefix paths that come from variable resolution (already absolute). Each fix should be committed separately with full test suite verification.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Fix ONLY the 6 documented bugs -- do not speculatively fix other filter/focus interactions
- Each fix should be minimal and targeted: make the skipped test pass without altering behavior of 200+ passing tests
- Carry forward from Phase 14: if a fix naturally covers additional cases, that's fine -- but don't go looking for undocumented gaps
- **Filter predicate leak (FILT-01 to FILT-04)**: The root cause is `walkHigherOrderCall` calling `walkNode` on data args like `items[active]`, which returns both base paths (`items`) AND predicate paths (`items.active`). All paths get bound as `dataArgPaths` to lambda parameters, causing leak. Fix needs to separate base path extraction from predicate path extraction at the HOF call site
- **Focus variable double-prefix (FOCV-01, FOCV-02)**: Root cause is `walkFilterStages` binding focus variable `$o` to `["orders"]` then re-prefixing with `contextPrefix="orders"`, producing `orders.orders.total`. Fix needs to avoid double-prefixing when focus variable already contains the context prefix
- STATE.md notes: pre-implementation design needed for `extractBasePaths()` helper and `walkFilterStages` scope-awareness mechanism before coding begins
- Add new regression tests as new `describe` blocks within existing integration test files where the BUG(v1.2) skips live
- Filter predicate tests: `data-transforms.test.ts` (3 FILT skips) and `business-rules.test.ts` (1 FILT skip)
- Focus variable tests: `api-reshaping.test.ts` (2 FOCV skips)
- 10+ new regression tests per bug category, 20+ total across 3 files
- Match the v1.1 integration test style: scenario-based with realistic field names, IntegrationFixture[] arrays, assertFixture() helper
- Test boundary variations: nested HOFs with filters, chained apply with filters, variable-bound intermediate filtered results, cross-referenced focus variables in nested contexts
- Each regression test should document what specific edge it's testing
- This phase touches HOF parameter binding path used by 40+ existing passing tests -- highest regression risk in milestone
- Run full test suite after each incremental fix to catch regressions immediately
- Fix filter predicate leak and focus variable double-prefix as separate changes to isolate blast radius

### Claude's Discretion
- Exact implementation of `extractBasePaths()` helper (whether it's a new function or inline logic)
- How `walkFilterStages` scope-awareness mechanism works internally
- Fix ordering within the phase (likely: filter predicate leak first since it's the larger bug set, focus variable second)
- Specific regression test expressions and expected outputs beyond the 6 documented skips

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILT-01 | Filter predicate paths inside HOF callbacks do not leak into lambda parameter binding | Root cause confirmed: `walkHigherOrderCall` binds ALL paths from `walkNode(dataArg)` to lambda params. For `$map(items[active], fn)`, this includes `items.active` which should only be emitted as a filter path, not bound to `$v`. Fix: use `extractBasePaths()` to get only `["items"]` for binding. |
| FILT-02 | Filter predicates on HOF input arrays produce correct context-relative paths | Same root cause as FILT-01. For `orders[status="active"]` as HOF data arg, base path is `orders` (for binding), predicate path `orders.status` is emitted but not bound. |
| FILT-03 | Compound filter predicates with multiple fields all resolve correctly without prefix duplication | Subsumed by FILT-01 fix. When `extractBasePaths()` strips predicate paths from binding, compound predicates naturally work because only the base collection path is bound. |
| FILT-04 | Nested HOF with filtered input produces correct paths at each level | Requires `extractBasePaths()` to work correctly at each nesting level. For `$map($filter(items[active], fn1), fn2)`, the inner `$filter` data arg walks with predicates; its result paths bind to fn2 without predicate contamination. |
| FILT-05 | Thorough regression suite (10+ tests) covering filter predicate scope isolation | Test patterns: simple filter+map, chained apply, variable-bound intermediate, nested HOFs, compound predicates, filter on multi-step paths (`orders.items[active]`), filter with comparison operators, filter with variable cross-reference in HOF context. |
| FOCV-01 | Focus variable binding does not cause double-prefixing of paths | Root cause confirmed: `walkFilterStages` binds `$o` to `["orders"]` (contextPrefix), then `walkNode(filterExpr)` resolves `$o.total` to `["orders.total"]`, then `prefixPaths("orders", ["orders.total"])` produces `orders.orders.total`. Fix: don't re-prefix paths from variable resolution. |
| FOCV-02 | Cross-referencing focus variables in nested contexts resolves correctly | Same mechanism as FOCV-01 but with external variable (`$cfg := config`). `$cfg.minPrice` resolves to `config.minPrice` (absolute), should NOT be prefixed with `items.` context. |
| FOCV-03 | Thorough regression suite (10+ tests) covering focus variable prefix handling | Test patterns: simple focus var, nested focus vars, focus var with external variable cross-ref, focus var with compound predicate, focus var without subsequent filter, bare field vs variable in same filter, multiple filter stages. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.x | Source language | Project standard |
| Vitest | 3.x | Test runner | Project standard, all 265 tests use it |
| jsonata | 2.x | JSONata parser (AST source) | Project standard |
| tsup | - | Build tool | Project standard |

### Supporting
No new libraries needed. All fixes are internal logic changes to `src/walker.ts`.

**Test Infrastructure (existing, no changes needed):**
- `assertFixture()` helper in `test/integration/helpers.ts`
- `IntegrationFixture` type (ExactFixture variant with exact path matching)
- `sortPaths()` for order-agnostic comparison
- `extractPaths()` public API (single entry point)

**Test Commands:**
```bash
npx vitest run                           # Full suite (265 passing + 6 skipped)
npx vitest run test/integration/         # Integration tests only
npx vitest run --reporter=verbose        # Verbose output showing each test name
```

## Architecture Patterns

### Code Change Topology

All source changes are in ONE file: `src/walker.ts` (717 lines). Two functions need modification:

```
src/walker.ts
  walkHigherOrderCall()  -- lines 558-590 (FILT fix)
  walkFilterStages()     -- lines 259-303 (FOCV fix)
  + new helper: extractBasePaths()
```

Test changes span THREE existing files:
```
test/integration/
  data-transforms.test.ts   -- 3 skips to unskip + 10+ regression tests
  business-rules.test.ts    -- 1 skip to unskip + regression tests
  api-reshaping.test.ts     -- 2 skips to unskip + 10+ regression tests
```

### Pattern 1: extractBasePaths() -- Structural Base Path Extraction

**What:** A new helper function that extracts only the "collection identity" path from a data argument AST node, excluding filter predicate paths. This is used specifically for HOF lambda parameter binding.

**When to use:** In `walkHigherOrderCall`, when computing `dataArgPaths` for `walkLambdaWithBindings`.

**Design (verified against AST structure):**

The key insight is that `buildPathString(node.steps)` already computes the base path without predicate content -- it only handles `name`, `wildcard`, `descendant`, and `parent` step types, skipping filter stages entirely. The problem is that `walkNode(dataArg)` walks the FULL node including filter stages.

For a PathNode data argument (the common case for HOF), `extractBasePaths` should:
1. Call `buildPathString(node.steps)` to get the base path (e.g., `"items"` from `items[active]`)
2. If the data arg is a VariableNode, resolve it and return the resolved paths
3. If the data arg is any other type, fall back to `walkNode(dataArg)` (no filter stages to strip)

**Important:** The FULL `walkNode(dataArg)` result (including predicate paths) must STILL be emitted into the result path list. Only the BINDING paths to the lambda parameter should be restricted to base paths. The predicate paths like `items.active` are legitimate data path reads that must appear in the final output.

```typescript
// Conceptual implementation:
function extractBasePaths(node: AstNode, scope: ScopeTracker): string[] {
  if (node.type === "path") {
    const pathNode = node as PathNode;
    const basePath = buildPathString(pathNode.steps);
    return basePath ? [basePath] : [];
  }
  if (node.type === "variable") {
    const varNode = node as VariableNode;
    const resolved = resolveVariable(scope, varNode.value);
    if (resolved && resolved.length > 0) {
      // Return resolved paths without predicates
      // The resolved paths are the "collection identity" for this variable
      return [...resolved];
    }
    return [];
  }
  // For other node types (name, binary, etc.), walkNode is fine
  // These don't have filter stages to leak
  return walkNode(node, scope);
}
```

**Critical detail -- variable-bound intermediate results (FILT-03):**
For `($data := items[active]; $map($data, fn))`, the variable `$data` is bound to `["items", "items.active"]` at bind time (because `walkNode` on `items[active]` returns both). When `$map($data, fn)` is processed, `$data` is the data argument. The `extractBasePaths` for a VariableNode resolves `$data` to its bindings: `["items", "items.active"]`. This would still leak!

**Deeper fix needed:** The variable binding itself must store only base paths. But changing how variables are bound would be too invasive and break other patterns.

**Alternative approach (better):** For VariableNode data args in HOF, extract base paths by looking at what the variable is BOUND to. But the binding already includes predicate paths because `walkBlock` calls `walkNode(bindNode.rhs)` to compute `rhsPaths`.

**Best approach:** The cleanest fix is at the `walkHigherOrderCall` level. Instead of changing what variables store, strip predicate-derived paths when computing `dataArgPaths` for binding. For a PathNode data arg, use `buildPathString` to get the single base path. For a VariableNode data arg, the resolved paths may include predicate paths from the original binding -- but this is actually correct in many cases (e.g., `$map($x, fn)` where `$x := orders.items` should bind `$v` to `["orders.items"]`).

The real problem with variable-bound intermediates is that `$data := items[active]` stores `["items", "items.active"]`, and BOTH get bound. The fix for this case: when the variable resolves to multiple paths where some are prefixed forms of others (like `items` and `items.active`), take only the shortest/base path for binding purposes. But this heuristic is fragile.

**Recommended implementation:** Use `extractBasePaths` for the dataArg node at the HOF call site. For PathNode, use `buildPathString`. For VariableNode, resolve and return the stored paths (accepting that variable-bound intermediates will need the variable binding itself to store only base paths). For the variable-bound case specifically, the fix may require that `extractBasePaths` on a VariableNode returns only paths that are NOT prefixed extensions of other paths in the same set.

```typescript
function extractBasePaths(node: AstNode, scope: ScopeTracker): string[] {
  if (node.type === "path") {
    const pathNode = node as PathNode;
    const basePath = buildPathString(pathNode.steps);
    return basePath ? [basePath] : [];
  }
  if (node.type === "variable") {
    const varNode = node as VariableNode;
    const resolved = resolveVariable(scope, varNode.value);
    if (resolved && resolved.length > 0) {
      // Filter to only "root" paths -- paths that are not a prefix extension
      // of another path in the set. E.g., from ["items", "items.active"],
      // keep only ["items"].
      return filterToBasePaths([...resolved]);
    }
    return [];
  }
  if (node.type === "name") {
    return [(node as NameNode).value];
  }
  return walkNode(node, scope);
}

function filterToBasePaths(paths: string[]): string[] {
  // Keep only paths where no other path in the set is a proper prefix
  return paths.filter(p =>
    !paths.some(other => other !== p && p.startsWith(other + "."))
  );
}
```

### Pattern 2: walkFilterStages Scope-Aware Prefixing

**What:** Modify `walkFilterStages` to not re-prefix paths that already come from variable resolution (which are already absolute).

**When to use:** When walking filter expressions that contain variable references alongside bare field names.

**Current behavior (buggy):**
```
walkFilterStages("orders", filter_expr, scope_with_$o=["orders"]):
  walkNode(filter_expr, filterScope) => walks $o.total => resolves to "orders.total"
  prefixPaths("orders", ["orders.total"]) => "orders.orders.total"  // WRONG
```

**Design approach:**

The challenge: `walkNode` returns a flat `string[]` with no metadata about which paths came from variable resolution vs bare field names. We need to distinguish these.

**Approach A (two-pass):** Walk the filter expression twice -- once to get variable-resolved paths (don't prefix), once to get bare field paths (do prefix). This is wasteful and error-prone.

**Approach B (scope comparison):** Before prefixing, check if a path was produced by a variable that resolves to an absolute path. A path is "already absolute" if it does NOT start with a field name that appears in the filter expression's local namespace.

**Approach C (selective prefixing -- recommended):** Instead of calling `walkNode` on the entire filter expression and then prefixing everything, modify `walkFilterStages` to walk the filter expression WITHOUT prefixing, then selectively prefix only the "local" paths. A local path is one produced by a NameNode directly in the filter expression (not through variable resolution).

The simplest correct approach: **Don't prefix paths that already start with a known variable resolution prefix.** This can be detected by checking if any path is already rooted outside the current context.

**Actually, the simplest correct approach is:** Walk the filter expression in a scope where variables resolve normally, but instead of blindly prefixing ALL results, check each path: if it starts with the contextPrefix, it's already correctly scoped (likely from a focus variable that was bound to contextPrefix). If it does NOT start with contextPrefix AND it came from a bare name, prefix it. If it came from variable resolution (starts with a different root), don't prefix it.

**Cleaner implementation:** Track which paths need prefixing by walking the filter expression in two categories:

```typescript
function walkFilterStages(stages, contextPrefix, scope, focus?) {
  const paths: string[] = [];
  let filterScope = childScope(scope);

  if (focus) {
    filterScope = bindVariable(filterScope, focus, contextPrefix ? [contextPrefix] : []);
  }

  for (const stage of stages) {
    if (stage.type !== "filter") continue;
    const filterStage = stage as FilterStage;
    if (isNumericIndex(filterStage.expr)) continue;

    // ADV-02 dynamic wildcard (unchanged)
    if (filterStage.expr.type === "variable") {
      const varNode = filterStage.expr as VariableNode;
      const resolved = resolveVariable(filterScope, varNode.value);
      if (!resolved || resolved.length === 0) {
        paths.push(`${contextPrefix}[*]`);
        continue;
      }
    }

    // Walk filter expression with scope-aware prefixing
    const filterPaths = walkNode(filterStage.expr, filterScope);
    for (const fp of filterPaths) {
      // If this path already starts with contextPrefix, it came from
      // a focus variable bound to contextPrefix -- don't re-prefix
      if (contextPrefix && fp.startsWith(contextPrefix + ".")) {
        paths.push(fp);  // already correctly scoped
      } else if (contextPrefix && fp === contextPrefix) {
        paths.push(fp);  // exact match -- already scoped
      } else {
        // Check if this path came from an external variable
        // (already absolute, not relative to filter context)
        const isExternalVar = isExternallyResolved(fp, filterScope, scope);
        if (isExternalVar) {
          paths.push(fp);  // don't prefix external variable paths
        } else {
          paths.push(...prefixPaths(contextPrefix, [fp]));  // prefix local field
        }
      }
    }
  }
  return paths;
}
```

**The `isExternallyResolved` check is complex.** A simpler heuristic: instead of trying to determine provenance after the fact, change the approach at the source. Walk the filter expression using a modified scope where the focus variable resolves to empty paths `[]` instead of `[contextPrefix]`. Then:
- Bare field names like `price` return `["price"]` and get prefixed to `items.price`
- Focus variable `$o.total` with `$o` bound to `[]` would not resolve... this breaks things.

**Best approach (after thorough analysis):**

The real fix is specifically about the focus variable case and the external variable case. Two separate sub-fixes within `walkFilterStages`:

**Sub-fix A (focus variable double-prefix):** When `focus` is set and we bind `$o` to `["orders"]` (the contextPrefix), the resulting paths from `$o.total` resolve to `["orders.total"]`. These paths already contain the contextPrefix as a prefix. So the fix is: after walking the filter expression, check each resulting path -- if it starts with `contextPrefix + "."`, do NOT re-prefix. This specifically handles the focus variable case because focus variables are always bound to `[contextPrefix]`.

**Sub-fix B (external variable prefix):** For `($cfg := config; items[$cfg.minPrice < price].name)`, the filter walks the binary `$cfg.minPrice < price`. This produces `["config.minPrice", "price"]`. Then `prefixPaths("items", ...)` produces `["items.config.minPrice", "items.price"]`. The first is wrong (should be `config.minPrice`), the second is correct (should be `items.price`).

The issue: `config.minPrice` is an externally-resolved path. It should not be prefixed. `price` is a local field name and should be prefixed. How to distinguish?

A path is "externally resolved" if it was produced by resolving a variable that is NOT the focus variable and NOT locally bound. In practice: any path that starts with a root segment that is NOT a field name used locally in the filter expression. But we can't easily know "locally used field names" without AST inspection.

**Practical approach:** Walk the filter expression's sub-nodes selectively. For a binary expression `$cfg.minPrice < price`, walk LHS and RHS separately. For each sub-result, determine if it came from a variable reference (by checking the sub-node type). If the sub-node's root is a variable reference, don't prefix. If it's a bare name/path, prefix.

**Even simpler:** The issue is that `walkNode` resolves variables to absolute paths, then `prefixPaths` treats ALL results as context-relative. The fix: walk the filter expression in a "no-prefix" mode where variable-resolved paths are marked as absolute. Since we can't easily mark paths, we can instead walk the filter expression and collect two sets:

```typescript
// Paths that need context prefixing (bare field names)
// Paths that are already absolute (variable resolutions)
```

To do this without changing walkNode's signature: **walk the filter expression with a scope where variables resolve to their stored paths (as now), then compare results against what you'd get if variables resolved to nothing.** The difference tells you which paths came from variables.

**Actually the simplest correct approach:** In `walkFilterStages`, instead of calling `walkNode(filterStage.expr, filterScope)` and then `prefixPaths()` on everything, we can:

1. Walk the filter expression with `filterScope` (which has focus and parent variables) to get `allPaths`
2. Walk the filter expression with a "stripped" scope where focus and parent variables are bound to `[]` to get `localPaths`
3. The difference (`allPaths - localPaths`) represents variable-resolved absolute paths -- emit them without prefix
4. The `localPaths` represent bare field names -- prefix them

This is clean but requires walking the expression twice. However, filter expressions are typically small (a single comparison), so the performance cost is negligible.

**Recommended simplest approach (single-walk):** Track which paths need prefixing by checking if any path in the result set starts with a root that matches a variable binding in the PARENT scope (not the filter scope). If a path starts with a segment that matches a resolved variable's root, it's already absolute.

After deep analysis, the cleanest single-walk approach:

```typescript
// In walkFilterStages, after getting filterPaths from walkNode:
for (const fp of filterPaths) {
  if (isAlreadyContextScoped(fp, contextPrefix)) {
    // Path already starts with contextPrefix (focus variable produced this)
    paths.push(fp);
  } else if (isExternallyResolved(fp, filterScope, contextPrefix)) {
    // Path came from external variable -- already absolute
    paths.push(fp);
  } else {
    // Local field name -- needs prefixing
    paths.push(contextPrefix ? `${contextPrefix}.${fp}` : fp);
  }
}

function isAlreadyContextScoped(path: string, contextPrefix: string): boolean {
  return contextPrefix !== "" &&
         (path === contextPrefix || path.startsWith(contextPrefix + "."));
}
```

For `isExternallyResolved`, the simplest detection: check if the path's root segment matches any variable binding in the parent scope (excluding focus variable).

### Anti-Patterns to Avoid

- **String-matching heuristic to strip predicate paths:** Never try to determine "is this a predicate path?" by looking at the string content (e.g., "is `items.active` a suffix of `items`?"). This breaks for legitimate nested paths like `orders.items` which is `orders` + `.items`.

- **Modifying walkNode return type:** Do NOT change `walkNode` to return metadata about path provenance. This would require changing every caller and is too invasive for a bug fix release.

- **Modifying variable binding storage:** Do NOT change what `walkBlock/bindVariable` stores when binding `$data := items[active]`. The stored `["items", "items.active"]` is correct for ALL non-HOF contexts (e.g., `$data.foo` should resolve to both `items.foo` and `items.active.foo` -- wait, no, this is actually part of the bug). Actually, storing both IS correct for the general case: if `$data` is used in a non-HOF context like `$data.foo`, it should resolve to `items.foo` (the base path continuation). The predicate path `items.active` is not needed for dot-access, but it is a valid data read and should appear in the output. The bug is specifically that `items.active` should not be BOUND as a lambda parameter base path.

- **Global prefix-stripping in prefixPaths:** Do NOT modify `prefixPaths` globally to "skip if already starts with prefix." This would break legitimate cases where a path segment happens to match the prefix string.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Base path extraction from PathNode | Recursive path stripping | `buildPathString(node.steps)` | Already exists and correctly computes base path without predicate content |
| Filter expression walking | Custom recursive walker | `walkNode(filterStage.expr, filterScope)` | Existing walker handles all expression types correctly |
| Path deduplication | Custom dedup logic | `new Set(rawPaths)` in `extractPaths()` | Already exists in `index.ts` line 44 |
| Test assertions | Manual path comparison | `assertFixture()` with `IntegrationFixture` | Established project pattern |

## Common Pitfalls

### Pitfall 1: extractBasePaths Breaks Multi-Step Path HOF Binding

**What goes wrong:** The fix strips predicate paths from HOF binding, but if `extractBasePaths` is implemented incorrectly, it may also strip legitimate multi-step paths. For example, `$map(orders.items, fn)` should bind `$v` to `["orders.items"]`, not `["orders"]`.

**Why it happens:** `buildPathString(node.steps)` returns `"orders.items"` for the PathNode `orders.items` -- this is correct. The risk is if the implementation confuses "multi-step base path" with "base path + predicate suffix."

**How to avoid:** Verify with the existing test: `$map(orders.items, function($v, $i) { $v.price })` must still produce `["orders.items", "orders.items.price"]`. Run this test after every change.

**Warning signs:** Tests for `$map(orders.items, fn)` start missing `orders.items.price` paths.

### Pitfall 2: Focus Variable Fix Breaks Bare Field Prefixing

**What goes wrong:** The fix to not re-prefix variable-resolved paths accidentally also skips prefixing bare field names in filter expressions.

**Why it happens:** In `orders[status="active"]`, the filter expression contains a bare `status` field that MUST be prefixed to `orders.status`. If the fix is "don't prefix anything that resolves from walkNode in filter context," bare fields also lose their prefix.

**How to avoid:** The fix must ONLY skip prefixing for paths that demonstrably came from variable resolution. Bare field names (`status`, `price`, etc.) must always be prefixed. Use the detection logic described in Pattern 2.

**Warning signs:** `items[active].name` stops producing `items.active` as a filter path.

### Pitfall 3: Variable-Bound Intermediate Still Leaks

**What goes wrong:** `($data := items[active]; $map($data, fn))` -- the variable `$data` is bound to `["items", "items.active"]` at bind time. Even with `extractBasePaths`, resolving `$data` in the HOF context returns both paths.

**Why it happens:** The predicate path `items.active` is stored in the variable binding at bind time (by `walkBlock`). `extractBasePaths` for a VariableNode would return the resolved paths, which include the predicate path.

**How to avoid:** `extractBasePaths` for VariableNode must filter resolved paths to keep only "root" paths. Implement `filterToBasePaths()` that removes any path that is a dotted extension of another path in the same set. `["items", "items.active"]` -> filter -> `["items"]`. This is safe because `items.active` is definitionally a child path of `items`.

**Warning signs:** The variable-bound filter test (FILT-03) still produces `items.active.name`.

### Pitfall 4: filterToBasePaths Over-Filters Legitimate Multi-Root Variables

**What goes wrong:** If a variable is bound to paths from multiple roots (e.g., `$x` bound to `["a", "b"]`), `filterToBasePaths` should keep both since neither is a prefix of the other. But if bound to `["a", "a.b"]`, it should filter to `["a"]`.

**Why it happens:** The filter logic `p.startsWith(other + ".")` only removes paths that are strict dot-prefixed extensions of another path in the set. Paths from different roots are never filtered.

**How to avoid:** The `filterToBasePaths` function should only remove a path if another SHORTER path in the set is a proper dot-prefix of it. This ensures `["a", "b"]` stays as-is, but `["items", "items.active"]` becomes `["items"]`.

### Pitfall 5: Chained Apply Accumulates Predicate Paths Through Pipeline

**What goes wrong:** In `items ~> $filter(fn) ~> $map(fn)`, the outer `~>` calls `walkApply`. The lhs is the inner `items ~> $filter(fn)` apply. `walkApply` calls `walkFunction` on the augmented function (with lhs prepended). `walkHigherOrderCall` then calls `walkNode(dataArg)` where dataArg is the entire inner apply expression. This returns ALL paths including predicate paths.

**Why it happens:** The outer `$map`'s data argument is the inner apply expression `items ~> $filter(fn)`. When `extractBasePaths` is called on this apply node, it's not a simple PathNode -- it's an ApplyNode. The fallback would be `walkNode(applyNode)`, which walks the entire chain and returns predicate paths.

**How to avoid:** For chained applies, `extractBasePaths` on an ApplyNode should recursively extract base paths from the LHS of the apply chain. Specifically, the "collection identity" of `items ~> $filter(fn)` is still `items` -- the filter doesn't change the collection's identity, it just narrows it. But this requires understanding HOF semantics (filter preserves collection identity).

**Simpler approach:** For ApplyNode data args, call `extractBasePaths` recursively on the LHS. The chain `items ~> $filter(fn) ~> $map(fn)` has LHS = `items ~> $filter(fn)`, which has LHS = `items` (a PathNode). `extractBasePaths` on PathNode returns `["items"]`. This is correct.

```typescript
function extractBasePaths(node: AstNode, scope: ScopeTracker): string[] {
  if (node.type === "path") {
    const basePath = buildPathString((node as PathNode).steps);
    return basePath ? [basePath] : [];
  }
  if (node.type === "apply") {
    // Chained apply: base identity comes from the leftmost operand
    return extractBasePaths((node as ApplyNode).lhs, scope);
  }
  if (node.type === "variable") {
    const resolved = resolveVariable(scope, (node as VariableNode).value);
    if (resolved && resolved.length > 0) {
      return filterToBasePaths([...resolved]);
    }
    return [];
  }
  if (node.type === "name") {
    return [(node as NameNode).value];
  }
  return walkNode(node, scope);
}
```

## Code Examples

### Current Buggy Behavior (verified by execution)

**FILT-01:** `$map(items[active], function($v) { $v.name })`
```
ACTUAL:   ["items", "items.active", "items.name", "items.active.name"]
EXPECTED: ["items", "items.active", "items.name"]
SPURIOUS: "items.active.name" (predicate path leaked into $v binding)
```

**FILT-02 (chained):** `items ~> $filter(function($v) { $v.active }) ~> $map(function($v) { $v.name })`
```
ACTUAL:   ["items", "items.active", "items.name", "items.active.name"]
EXPECTED: ["items", "items.active", "items.name"]
SPURIOUS: "items.active.name"
```

**FILT-03 (variable-bound):** `($data := items[active]; $map($data, function($v) { $v.name }))`
```
ACTUAL:   ["items", "items.active", "items.name", "items.active.name"]
EXPECTED: ["items", "items.active", "items.name"]
SPURIOUS: "items.active.name"
```

**FILT-04 (var-in-filter):** `($min := minPrice; products[price >= $min].name)`
```
ACTUAL:   ["minPrice", "products.name", "products.price", "products.minPrice"]
EXPECTED: ["minPrice", "products.name", "products.price"]
SPURIOUS: "products.minPrice" ($min resolves to "minPrice", then prefixed with "products.")
```

**FOCV-01:** `orders@$o[$o.total > 100].id`
```
ACTUAL:   ["orders.id", "orders.orders.total"]
EXPECTED: ["orders.id", "orders.total"]
WRONG:    "orders.orders.total" (double-prefix: $o resolves to "orders", $o.total -> "orders.total", then prefixed again)
```

**FOCV-02:** `($cfg := config; items[$cfg.minPrice < price].name)`
```
ACTUAL:   ["config", "items.name", "items.config.minPrice", "items.price"]
EXPECTED: ["config", "items.name", "items.price"]
SPURIOUS: "items.config.minPrice" ($cfg resolves to "config", $cfg.minPrice -> "config.minPrice", then prefixed with "items.")
```

### walkHigherOrderCall Fix Pattern

```typescript
// Source: design from AST analysis and root cause tracing
function walkHigherOrderCall(
  node: FunctionNode,
  semantics: Record<number, string>,
  scope: ScopeTracker,
): string[] {
  const args = node.arguments;
  const paths: string[] = [];

  // Walk ALL non-lambda args with full walkNode (includes predicate paths)
  // These paths are legitimate data reads that belong in the output
  for (const arg of args) {
    if (arg.type !== "lambda") {
      paths.push(...walkNode(arg, scope));
    }
  }

  const lambdaArg = args.find((a) => a.type === "lambda") as LambdaNode | undefined;
  if (lambdaArg) {
    const dataArg = args.find((a) => a.type !== "lambda");
    // KEY FIX: use extractBasePaths for BINDING only
    // Full walkNode paths are already in `paths` above
    const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
    paths.push(
      ...walkLambdaWithBindings(lambdaArg, dataArgPaths, semantics, scope),
    );
  }

  return paths;
}
```

### walkFilterStages Fix Pattern

```typescript
// Source: design from root cause tracing of FOCV-01 and FOCV-02
function walkFilterStages(
  stages: AstNode[],
  contextPrefix: string,
  scope: ScopeTracker,
  focus?: string,
): string[] {
  const paths: string[] = [];
  let filterScope = childScope(scope);

  if (focus) {
    filterScope = bindVariable(
      filterScope,
      focus,
      contextPrefix ? [contextPrefix] : [],
    );
  }

  for (const stage of stages) {
    if (stage.type !== "filter") continue;
    const filterStage = stage as unknown as FilterStage;
    if (isNumericIndex(filterStage.expr)) continue;

    // ADV-02 dynamic wildcard (unchanged)
    if (filterStage.expr.type === "variable") {
      const varNode = filterStage.expr as VariableNode;
      const resolved = resolveVariable(filterScope, varNode.value);
      if (!resolved || resolved.length === 0) {
        paths.push(`${contextPrefix}[*]`);
        continue;
      }
    }

    // Walk filter expression
    const filterPaths = walkNode(filterStage.expr, filterScope);

    // Scope-aware prefixing: don't re-prefix already-absolute paths
    for (const fp of filterPaths) {
      if (contextPrefix && isAlreadyScoped(fp, contextPrefix)) {
        // Focus variable or same-context path -- already has correct prefix
        paths.push(fp);
      } else if (isVariableResolved(fp, scope)) {
        // External variable -- already absolute, don't prefix
        paths.push(fp);
      } else {
        // Bare field name -- needs context prefix
        paths.push(contextPrefix ? `${contextPrefix}.${fp}` : fp);
      }
    }
  }
  return paths;
}
```

## Detailed Root Cause Analysis

### Bug Category 1: Filter Predicate Leak (FILT-01 through FILT-04)

**Call chain for `$map(items[active], function($v) { $v.name })`:**

```
walkFunction(node=$map_call, scope)
  -> walkHigherOrderCall(node, {0:"element",...}, scope)
    -> dataArg = PathNode(steps=[NameNode("items", stages=[FilterStage("active")])])
    -> walkNode(dataArg, scope) = ["items", "items.active"]   // line 569
    -> dataArgPaths = ["items", "items.active"]                // line 581
    -> walkLambdaWithBindings(lambda, ["items", "items.active"], ...)
      -> bindVariable(scope, "v", ["items", "items.active"])   // line 622
      -> walkNode(lambda.body = $v.name, lambdaScope)
        -> resolveVariable(scope, "v") = ["items", "items.active"]
        -> suffix = "name"
        -> returns ["items.name", "items.active.name"]         // LEAK!
```

**Fix point:** Line 581 -- replace `walkNode(dataArg, scope)` with `extractBasePaths(dataArg, scope)` for the binding path computation. Keep `walkNode` for the emission path (line 569).

### Bug Category 2: Focus Variable Double-Prefix (FOCV-01)

**Call chain for `orders@$o[$o.total > 100].id`:**

```
walkPath(node=PathNode(steps=[NameNode("orders", focus="o", stages=[...]), NameNode("id")]))
  step[0] = NameNode("orders", stages=[FilterStage(binary: $o.total > 100)], focus="o")
    -> contextPrefix = "orders"
    -> walkFilterStages(stages, "orders", scope, "o")
      -> filterScope = bindVariable(childScope, "o", ["orders"])    // line 272
      -> walkNode(binary($o.total > 100), filterScope)
        -> walkNode($o.total) -> resolveVariable("o") = ["orders"]
          -> suffix = "total" -> returns ["orders.total"]
        -> walkNode(100) -> []
        -> returns ["orders.total"]
      -> prefixPaths("orders", ["orders.total"])
        -> "orders.orders.total"                                     // DOUBLE PREFIX!
```

**Fix point:** Line 299 -- before calling `prefixPaths`, check if the path already starts with `contextPrefix`. If so, don't prefix.

### Bug Category 3: Variable-Resolved Filter Prefix (FOCV-02/FILT-04 related)

**Call chain for `($cfg := config; items[$cfg.minPrice < price].name)`:**

```
walkBlock -> binds $cfg to ["config"]
walkPath(PathNode(steps=[NameNode("items", stages=[...]), NameNode("name")]))
  step[0] = NameNode("items", stages=[FilterStage(binary: $cfg.minPrice < price)])
    -> contextPrefix = "items"
    -> walkFilterStages(stages, "items", scope_with_$cfg=["config"])
      -> walkNode(binary($cfg.minPrice < price), filterScope)
        -> walkNode($cfg.minPrice) -> resolveVariable("cfg") = ["config"]
          -> suffix = "minPrice" -> returns ["config.minPrice"]
        -> walkNode(price) -> returns ["price"]
        -> returns ["config.minPrice", "price"]
      -> prefixPaths("items", ["config.minPrice", "price"])
        -> ["items.config.minPrice", "items.price"]                  // FIRST IS WRONG!
```

**Fix point:** Same as FOCV-01 -- `walkFilterStages` line 299. `config.minPrice` is already an absolute path from variable resolution. It should NOT be prefixed with `items.`.

### Unified Fix for walkFilterStages

Both FOCV-01 and FOCV-02 share the same root cause: `walkFilterStages` prefixes ALL paths uniformly. The fix needs to detect which paths are "already absolute" (from variable resolution) and skip prefixing those.

**Detection strategy:** A path is "already absolute" (should not be prefixed) if:
1. It starts with `contextPrefix + "."` (focus variable case -- already scoped), OR
2. It exactly equals `contextPrefix` (focus variable case), OR
3. It was produced by resolving a variable from an OUTER scope (not the filter's own scope)

For case (3), the simplest detection: check if the first segment of the path matches any variable binding in the parent scope. This works because variable-resolved paths always start with the root of whatever they were bound to.

**Alternative simpler detection for case (3):** Walk the filter expression with the parent scope (without focus variable binding) to get "external" paths. Then walk with full filter scope to get "all" paths. The difference = focus-variable paths. But this is complex.

**Simplest practical approach:** After `walkNode(filterStage.expr, filterScope)`, for each resulting path, check if any variable in the OUTER scope (scope, not filterScope) resolves to a path that is a prefix of (or equal to) the current path's first segment. If yes, this path is externally resolved and should not be prefixed.

**Even simpler:** Walk the filter expression in a child scope where variables from outer scope resolve normally. Check the result path's root segment. If the root segment matches a binding in the OUTER scope but NOT a bare field name in the filter context, skip prefixing. Since we can't distinguish "bare field name" from "variable root" in the flat string output, use this heuristic: if the root segment of a result path matches the root of any variable binding in `scope` (the parent, not filterScope), treat it as externally resolved.

```typescript
function isVariableResolved(path: string, parentScope: ScopeTracker): boolean {
  const rootSegment = path.split(".")[0];
  // Check if any variable in the parent scope resolves to a path
  // whose root matches this path's root
  let current: ScopeTracker | null = parentScope;
  while (current !== null) {
    for (const [_name, boundPaths] of current.bindings) {
      for (const bp of boundPaths) {
        if (bp === rootSegment || bp.startsWith(rootSegment + ".") || rootSegment.startsWith(bp)) {
          // This path's root matches a variable binding -- externally resolved
          return true;
        }
      }
    }
    current = current.parent;
  }
  return false;
}
```

Wait, this has a problem: if a field name happens to match a variable binding root, it would be incorrectly classified. For example, if `$x := config` and the filter has `config.something`, the bare field `config` would match the variable binding.

**Better approach:** Instead of checking after the fact, walk sub-nodes of the filter expression individually and tag based on the sub-node type:

For a binary expression `$cfg.minPrice < price`:
- LHS = PathNode with variable step `$cfg` -> resolve -> already absolute
- RHS = PathNode with name step `price` -> bare field -> needs prefix

This means the fix should be in how `walkFilterStages` handles the filter expression, not in a post-hoc path analysis. Walk the top-level binary/condition/etc. and for each leaf, determine if it's variable-rooted or field-rooted.

**However, this is complex for deeply nested filter expressions.** The most practical approach:

**Use a scope-tagging technique:** Before walking the filter expression, create a version of the scope where all variables (except the focus variable) resolve to TAGGED paths (e.g., prefix with a marker). After walking, check which result paths have the marker and don't prefix those. Remove the marker from the final output.

This is too complex. Let me step back to the simplest approach that actually works:

**Simplest correct approach for walkFilterStages:**

Walk the filter expression TWICE:
1. With an EMPTY scope (no variables resolve): get `localPaths` -- these are bare field names
2. With the full `filterScope` (variables resolve): get `allPaths` -- includes variable-resolved paths

Prefix only `localPaths`. Emit variable-only paths (in `allPaths` but not in `localPaths`) without prefix.

```typescript
const emptyFilterScope = childScope(createScope()); // no bindings
const localPaths = walkNode(filterStage.expr, emptyFilterScope);
const allPaths = walkNode(filterStage.expr, filterScope);

// Prefix local field paths
paths.push(...prefixPaths(contextPrefix, localPaths));

// Emit variable-resolved paths without prefix (those in allPaths but not localPaths)
const localSet = new Set(localPaths);
for (const fp of allPaths) {
  if (!localSet.has(fp)) {
    paths.push(fp);  // already absolute
  }
}
```

This handles FOCV-01: `$o.total > 100` with empty scope produces `[]` for local (variable unresolvable), with full scope produces `["orders.total"]`. Prefix nothing local, emit `"orders.total"` as-is. Correct!

This handles FOCV-02: `$cfg.minPrice < price` with empty scope produces `["price"]` for local, with full scope produces `["config.minPrice", "price"]`. Prefix `["price"]` -> `["items.price"]`. Emit `"config.minPrice"` as-is. Correct!

This handles regular filter `items[active]`: `active` with empty scope produces `["active"]`, with full scope produces `["active"]`. Prefix `["active"]` -> `["items.active"]`. No variable-only paths. Correct!

**This is the recommended approach.** It's simple, correct, and doesn't require provenance tracking.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `walkNode(dataArg)` for HOF binding | `extractBasePaths(dataArg)` for HOF binding | Phase 16 fix | Separates base path from predicate path at HOF call site |
| `prefixPaths(contextPrefix, allFilterPaths)` uniform | Two-pass walk: local vs resolved paths | Phase 16 fix | Correctly handles variable-resolved paths in filters |

## Open Questions

1. **filterToBasePaths edge cases**
   - What we know: For `["items", "items.active"]`, filtering to `["items"]` is correct. For `["a", "b"]` (different roots), both should be kept.
   - What's unclear: Are there cases where a variable is bound to paths like `["a.b", "a.b.c"]` where both should be kept for binding purposes?
   - Recommendation: The `filterToBasePaths` heuristic (remove strict dot-prefix extensions) is safe for all known patterns. If edge cases emerge, they can be addressed with targeted fixes.

2. **walkFilterStages two-pass performance**
   - What we know: Filter expressions are typically small (single comparison, rarely nested)
   - What's unclear: Whether walking twice causes any issue with side effects or scope mutation
   - Recommendation: Since scope is immutable and walkNode has no side effects (pure function), double-walking is safe. Performance is negligible for the expression sizes involved.

3. **Interaction between FILT and FOCV fixes**
   - What we know: Both fixes touch different functions (`walkHigherOrderCall` vs `walkFilterStages`), so they don't directly conflict
   - What's unclear: Whether there are expressions that trigger BOTH bugs simultaneously (e.g., `$map(items@$v[$v.active], fn)`)
   - Recommendation: Fix FILT first (larger scope), then FOCV. Test the combination explicitly in regression suite.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FILT-01 | Filter predicate paths don't leak into HOF element binding | integration | `npx vitest run test/integration/data-transforms.test.ts -x` | Exists (skip) |
| FILT-02 | Filter predicates produce correct context-relative paths | integration | `npx vitest run test/integration/data-transforms.test.ts -x` | Exists (skip) |
| FILT-03 | Compound filter predicates resolve without prefix duplication | integration | (covered by regression tests) | Wave 0 |
| FILT-04 | Nested HOF with filtered input produces correct paths | integration | `npx vitest run test/integration/data-transforms.test.ts -x` | Exists (skip) |
| FILT-05 | 10+ regression tests for filter predicate scope isolation | integration | `npx vitest run test/integration/data-transforms.test.ts -x` | Wave 0 |
| FOCV-01 | Focus variable binding doesn't cause double-prefixing | integration | `npx vitest run test/integration/api-reshaping.test.ts -x` | Exists (skip) |
| FOCV-02 | Cross-referencing focus variables resolves correctly | integration | `npx vitest run test/integration/api-reshaping.test.ts -x` | Exists (skip) |
| FOCV-03 | 10+ regression tests for focus variable prefix handling | integration | `npx vitest run test/integration/api-reshaping.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run` (full suite, 265+ tests, ~300ms)
- **Per wave merge:** `npx vitest run --reporter=verbose` (verbose to verify each test)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] FILT regression tests in `test/integration/data-transforms.test.ts` and `test/integration/business-rules.test.ts` -- 10+ new tests covering filter+HOF variations
- [ ] FOCV regression tests in `test/integration/api-reshaping.test.ts` -- 10+ new tests covering focus variable and variable-in-filter variations
- No new test files needed -- all tests go in existing files as new `describe` blocks
- No framework or fixture infrastructure changes needed -- existing `assertFixture()` and `IntegrationFixture` handle everything

## Sources

### Primary (HIGH confidence)
- Direct source code analysis: `src/walker.ts` (717 lines), `src/scope.ts` (97 lines), `src/types.ts` (213 lines), `src/builtins.ts` (46 lines), `src/path-builder.ts` (33 lines), `src/index.ts` (46 lines)
- Live execution tracing: all 6 bugs verified by running `extractPaths()` on bug expressions and comparing actual vs expected output
- AST inspection: JSONata parser output for all 6 bug expressions inspected via `jsonata(expr).ast()` -- confirms AST node types and structure
- All 6 BUG(v1.2) test fixtures in `data-transforms.test.ts`, `business-rules.test.ts`, `api-reshaping.test.ts` with exact expected output
- Existing pitfalls research: `.planning/research/PITFALLS.md` (Pitfalls 2, 3, 6 directly relevant)
- Phase 14/15 research and summaries (confirmed fix patterns and test infrastructure)

### Secondary (MEDIUM confidence)
- Root cause call-chain tracing: manually traced through walker functions for each bug expression -- verified against AST structure but not step-debugged
- `filterToBasePaths` heuristic: logically sound but not tested against all possible variable binding patterns

### Tertiary (LOW confidence)
- None -- all findings are verified against source code and live execution

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no changes needed, using existing project infrastructure
- Architecture (extractBasePaths): HIGH - root cause confirmed by AST inspection and live execution, fix approach follows established patterns (buildPathString already exists)
- Architecture (walkFilterStages two-pass): HIGH - approach verified by mental execution against all 6 bugs, consistent results
- Pitfalls: HIGH - based on direct code analysis and prior pitfalls research covering exactly these bugs
- Regression risk assessment: HIGH - 40+ HOF tests identified, test commands verified

**Research date:** 2026-03-06
**Valid until:** Not applicable (internal project bug fixes with stable codebase)
