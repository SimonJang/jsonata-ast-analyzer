# Phase 15: Pipeline and Apply Fixes - Research

**Researched:** 2026-03-06
**Domain:** AST walker bug fixes -- walkApply inline lambda binding and walkPath variable-resolved sort term extraction
**Confidence:** HIGH

## Summary

Phase 15 addresses 2 bugs in `src/walker.ts` that cause the path analyzer to miss extracted paths in pipeline-style expressions. Both bugs share a theme: the walker encounters an AST node in a position it doesn't currently handle and silently drops paths. The fixes are independent of each other and additive -- they add handling for previously-unhandled cases without altering existing behavior.

**Bug 1 (PIPE-01): Inline lambda with apply operator.** The expression `data ~> function($d) { $d.count }` should bind `$d` to `["data"]` and extract `data.count`. Currently, `walkApply` only handles `rhs.type === "function"` (a function call node). When the RHS is a bare lambda (`type: "lambda"`), it falls to the else branch which calls `walkLambda`, which returns `[]` for non-thunk lambdas (they're definitions, not executions). The fix: detect `rhs.type === "lambda"` and bind the lambda's first parameter to the lhs paths before walking the body.

**Bug 2 (PIPE-02): Variable-resolved sort expression.** The expression `($x := items; $x^(price))` should extract `items.price` as a sort key path. Currently, `walkPath`'s variable branch (lines 100-127) resolves `$x` to `["items"]`, handles predicates and builds a suffix from remaining steps. But `buildPathString` skips sort nodes, producing null suffix. Sort terms are never walked. The fix: after building suffix, iterate remaining steps looking for sort nodes and walk their terms prefixed with resolved variable paths.

Both fixes are LOW complexity (5-10 lines each), isolated to two specific code paths in `walker.ts`, and carry minimal regression risk since they only activate for previously-unhandled AST patterns.

**Primary recommendation:** Fix both bugs in a single plan with 2 TDD tasks (one per bug), then add 10+ regression tests as a third task. Total scope is approximately equivalent to one Phase 14 plan.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-01 | Apply operator with inline lambda correctly binds lambda parameter and extracts body paths | Root cause identified: `walkApply` line 684 checks `node.rhs.type === "function"` but inline lambda has `type: "lambda"`. Fix: add `else if (node.rhs.type === "lambda")` branch that binds first parameter to lhs paths and walks body. Verified via AST dump and code trace. |
| PIPE-02 | Variable-resolved sort extracts sort key paths relative to resolved variable | Root cause identified: `walkPath` variable branch (lines 100-127) builds suffix via `buildPathString(suffixSteps)` which skips sort nodes, and never walks sort terms. Fix: iterate suffix steps looking for sort nodes, call `walkSortTerms` with resolved paths as context prefix. Verified via AST dump and code trace. |
| PIPE-03 | Thorough regression suite (10+ tests) covering pipeline and apply operator path extraction | Test patterns identified: multi-arg lambda, multi-term sort, sort-then-property, nested apply chains, apply with various lhs shapes, variable-resolved sort with filter, etc. Tests go in `data-transforms.test.ts` where the PIPE skips live. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.0.18 | Test runner | Already in use, all 251 tests run on it |
| typescript | 5.9.3 | Type checking | Already in use, `pnpm typecheck` validates |
| jsonata | 2.1.0 | Parser (AST source) | Unchanged dependency, parse() wraps it |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsup | 8.5.1 | Build tool | `pnpm build` before CLI tests |

No new dependencies needed. Both fixes are in `src/walker.ts`. All tests use existing `assertFixture()` helper.

## Architecture Patterns

### Relevant Project Structure
```
src/
  walker.ts          # BOTH bug fixes go here (single file)
  types.ts           # AST type definitions (read-only reference)
  scope.ts           # Scope chain utilities (read-only, already correct)
  path-builder.ts    # Path string builder (read-only, already correct)
  builtins.ts        # Built-in function list (read-only reference)
  index.ts           # extractPaths() public API (unchanged)
test/integration/
  data-transforms.test.ts  # BOTH skipped PIPE tests live here, regression tests go here
  helpers.ts               # assertFixture(), IntegrationFixture type
```

### Pattern 1: walkApply Inline Lambda Binding (PIPE-01)

**What:** `walkApply` (line 676) handles the `~>` operator. Currently it only handles `rhs.type === "function"` by creating a synthetic function node with lhs prepended. When rhs is a `lambda` node (inline lambda, not a function call), the lhs data never gets bound to the lambda's parameters.

**Current code (walker.ts lines 676-699):**
```typescript
function walkApply(node: ApplyNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];
  const lhsPaths = walkNode(node.lhs, scope);
  paths.push(...lhsPaths);

  if (node.rhs.type === "function") {
    // ... creates augmented function node -- WORKS
  } else {
    // Falls here for lambda RHS -- walkNode(lambda) returns []
    paths.push(...walkNode(node.rhs, scope));
  }
  return paths;
}
```

**AST for `data ~> function($d) { $d.count }`:**
```json
{
  "type": "apply",
  "lhs": { "type": "path", "steps": [{ "value": "data", "type": "name" }] },
  "rhs": {
    "type": "lambda",
    "arguments": [{ "value": "d", "type": "variable" }],
    "body": {
      "type": "path",
      "steps": [
        { "value": "d", "type": "variable" },
        { "value": "count", "type": "name" }
      ]
    }
  }
}
```

**Fix:** Add an `else if (node.rhs.type === "lambda")` branch before the generic else. In this branch, create a child scope, bind the lambda's first parameter to `lhsPaths`, and walk the lambda body.

### Pattern 2: walkPath Variable Branch Sort Term Extraction (PIPE-02)

**What:** When a variable step is the first step in a path (`$x^(price)`), `walkPath`'s variable branch resolves the variable and builds a suffix from remaining steps. Sort nodes are skipped by `buildPathString`, so they produce no suffix. But sort terms need to be explicitly walked and prefixed with the resolved variable paths.

**Current code (walker.ts lines 98-128):**
```typescript
if (varStepIndex >= 0) {
  // ... resolve variable, handle predicates ...
  const suffixSteps = node.steps.slice(varStepIndex + 1);
  const suffix = buildPathString(suffixSteps);  // sort node -> null
  paths.push(...resolved.map((p) => (suffix ? `${p}.${suffix}` : p)));
  return paths;  // RETURNS WITHOUT WALKING SORT TERMS
}
```

**AST for `($x := items; $x^(price))`:**
The second block expression is a `PathNode` with steps `[variable("x"), sort([{expression: path("price")}])]`.

- Variable step at index 0: resolved to `["items"]`
- `suffixSteps = [sort]`
- `buildPathString([sort])` -> `null` (sort skipped)
- `suffix` is falsy, so `resolved.map(p => p)` -> `["items"]`
- Sort term `price` NEVER walked

**Fix:** After building suffix, iterate `suffixSteps` looking for sort nodes. For each sort node found, call `walkSortTerms(sortNode, resolvedPath, scope)` for each resolved path. This mirrors how the non-variable path code handles sort steps in the step iteration loop (line 166-168).

### Anti-Patterns to Avoid
- **Modifying buildPathString:** The path builder correctly skips sort nodes. The fix is in the walker.
- **Changing walkLambda:** `walkLambda` correctly returns `[]` for non-thunk lambdas (they are definitions). The fix is in `walkApply` which needs to bind parameters when the lambda is being applied.
- **Changing scope.ts:** The scope chain is correct. Bugs are in the walker's failure to use scope binding in specific contexts.
- **Touching the function call augmentation path:** The `rhs.type === "function"` path in `walkApply` works correctly. The fix adds a new branch for a different RHS type.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path prefixing | Custom string concatenation | `prefixPaths()` (already exists, line 89) | Handles empty prefix and empty paths gracefully |
| Sort term walking | Inline sort iteration | `walkSortTerms()` (already exists, line 209) | Already handles multi-term sorts and context prefixing |
| Lambda parameter binding | Custom binding logic | `bindVariable()` from scope.ts + `childScope()` | Immutable scope chain, proven in HOF handling |
| Lambda body walking | Custom expression walker | `walkNode()` (the main dispatcher) | Already handles all expression types correctly |
| Test assertions | Custom expect() chains | `assertFixture()` from helpers.ts | Sorted comparison handles all edge cases |

**Key insight:** Both fixes reuse existing infrastructure. PIPE-01 reuses `childScope` + `bindVariable` + `walkNode` (same pattern as `walkLambdaWithBindings` but simpler). PIPE-02 reuses `walkSortTerms` (already exists for the non-variable sort handling).

## Common Pitfalls

### Pitfall 1: Only Binding First Lambda Parameter in Apply
**What goes wrong:** Only binding the first parameter when the lambda has multiple parameters (e.g., `data ~> function($a, $b) { $a.x }`).
**Why it happens:** The JSONata apply operator pipes lhs as the FIRST argument only. Additional parameters receive no data binding in a direct apply context.
**How to avoid:** Bind only the first parameter (`lambda.arguments[0]`) to `lhsPaths`. Additional parameters (if any) are not bound to data paths in direct apply (they would be `undefined` at runtime). This is correct -- only the first parameter receives the piped data.
**Warning signs:** Attempting to bind all parameters to `lhsPaths` would be wrong for multi-parameter lambdas.

### Pitfall 2: Forgetting to Check lambda.arguments.length
**What goes wrong:** Accessing `lambda.arguments[0]` when the lambda has zero arguments.
**Why it happens:** A lambda with no parameters (e.g., `data ~> function() { 42 }`) would crash if we blindly access `arguments[0]`.
**How to avoid:** Guard with `if (lambda.arguments.length > 0)` before binding.
**Warning signs:** Runtime error on `undefined.value`.

### Pitfall 3: Walking Sort Terms Only for First Resolved Path
**What goes wrong:** If a variable resolves to multiple paths (e.g., `$x` bound to `["a", "b"]`), sort terms should be prefixed with EACH resolved path.
**Why it happens:** Using `resolved[0]` instead of iterating all resolved paths.
**How to avoid:** Iterate `for (const resolvedPath of resolved)` and call `walkSortTerms` for each.
**Warning signs:** Missing sort key paths when variable resolves to multiple source paths.

### Pitfall 4: Variable Branch Also Needs Filter Stage Handling for Sort+Filter Combos
**What goes wrong:** An expression like `$x[active]^(price)` has both predicates AND sort -- the variable branch already handles predicates (lines 110-115), and the sort fix must work alongside, not replace.
**Why it happens:** Adding sort handling could accidentally interfere with the existing predicate handling if placed incorrectly.
**How to avoid:** Add sort handling AFTER the existing predicate handling and AFTER the suffix building, as a separate loop over `suffixSteps`. The predicate handling uses `varStep.predicate` (on the variable node itself), while sort steps are in `suffixSteps`. They're independent.
**Warning signs:** Predicate paths disappearing when sort fix is added.

### Pitfall 5: Not Handling Sort Terms That Are Multi-Step Paths
**What goes wrong:** Sort term expressions can be multi-step paths (e.g., `$x^(details.price)` where the sort key is `details.price`).
**Why it happens:** Assuming sort terms are always single names.
**How to avoid:** `walkSortTerms` already handles this correctly by calling `walkNode(term.expression, scope)` which walks any expression type. No special handling needed.
**Warning signs:** Complex sort key expressions not resolving.

### Pitfall 6: Double Emission of lhsPaths in Apply Fix
**What goes wrong:** `walkApply` already pushes `lhsPaths` at line 681. If the lambda body also resolves to include the same base path, duplicates appear.
**Why it happens:** The lambda parameter `$d` resolves to `["data"]`, and `$d.count` resolves to `["data.count"]`. The body walk produces `["data", "data.count"]` because `walkPath` variable branch returns both the resolved variable path AND the suffixed path.
**How to avoid:** This is actually fine -- `extractPaths()` in `index.ts` deduplicates via `new Set(rawPaths)`. The lhsPaths push and the body walk may both produce `"data"`, but dedup removes the duplicate. However, verify in tests that the expected output counts are correct.
**Warning signs:** Unexpected extra paths in test output.

## Code Examples

### Fix 1: walkApply Inline Lambda (PIPE-01)

```typescript
// In walkApply, replace the current if/else with if/else-if/else:
// walker.ts, approximately line 684

function walkApply(node: ApplyNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];
  const lhsPaths = walkNode(node.lhs, scope);
  paths.push(...lhsPaths);

  if (node.rhs.type === "function") {
    // Existing: create augmented function with lhs prepended
    const funcNode = node.rhs as FunctionNode;
    const augmentedFunc: FunctionNode = {
      ...funcNode,
      arguments: [node.lhs, ...funcNode.arguments],
    };
    paths.push(...walkFunction(augmentedFunc, scope));
  } else if (node.rhs.type === "lambda") {
    // NEW: inline lambda application -- bind first parameter to lhs paths
    const lambda = node.rhs as LambdaNode;
    let lambdaScope = childScope(scope);
    if (lambda.arguments.length > 0) {
      lambdaScope = bindVariable(lambdaScope, lambda.arguments[0].value, lhsPaths);
    }
    paths.push(...walkNode(lambda.body, lambdaScope));
  } else {
    // Fallback: unusual RHS (e.g., variable reference)
    paths.push(...walkNode(node.rhs, scope));
  }
  return paths;
}
```

**Why this works:** For `data ~> function($d) { $d.count }`:
1. `lhsPaths = walkNode(path("data"))` -> `["data"]`
2. `node.rhs.type === "lambda"` -> TRUE
3. Create child scope, bind `d` to `["data"]`
4. Walk body `$d.count` -> variable branch resolves `$d` to `["data"]`, suffix is `.count` -> `["data.count"]`
5. Also pushes resolved variable path `"data"` (deduped with lhsPaths)
6. Final: `["data", "data.count"]` (after dedup in extractPaths)

### Fix 2: walkPath Variable Branch Sort Terms (PIPE-02)

```typescript
// In walkPath, inside the variable branch, after the suffix/resolved push:
// walker.ts, approximately line 122 (after the existing push)

const suffixSteps = node.steps.slice(varStepIndex + 1);
const suffix = buildPathString(suffixSteps);
paths.push(...resolved.map((p) => (suffix ? `${p}.${suffix}` : p)));

// NEW: Walk sort terms in remaining steps, prefixed with resolved paths
for (const remainStep of suffixSteps) {
  if (remainStep.type === "sort") {
    for (const resolvedPath of resolved) {
      paths.push(...walkSortTerms(remainStep as SortNode, resolvedPath, scope));
    }
  }
}

return paths;
```

**Why this works:** For `($x := items; $x^(price))`:
1. `varStepIndex = 0`, `resolved = ["items"]`
2. `suffixSteps = [sort({terms: [{expression: path("price")}]})]`
3. `suffix = buildPathString([sort])` -> `null`
4. Pushes `["items"]` (resolved without suffix)
5. NEW: Iterates `suffixSteps`, finds sort step
6. Calls `walkSortTerms(sortNode, "items", scope)` -> walks `price` -> prefixes with `items` -> `["items.price"]`
7. Final: `["items", "items.price"]`

**Multi-term case** `($x := items; $x^(>price, <date))`:
- Same flow, but sort has 2 terms
- `walkSortTerms` iterates both -> `["items.price", "items.date"]`
- Final: `["items", "items.price", "items.date"]`

**Sort-then-property case** `($x := items; $x^(price).name)`:
- `suffixSteps = [sort, name("name")]`
- `suffix = buildPathString([sort, name])` -> `"name"` (sort skipped, name kept)
- Pushes `["items.name"]` (resolved + suffix)
- Iterates suffixSteps: finds sort -> `walkSortTerms` -> `["items.price"]`
- Final: `["items.name", "items.price"]`

## Detailed Root Cause Analysis

### Bug 1: walkApply Inline Lambda (PIPE-01)

**Root cause:** `walkApply` (line 676-699) dispatches on `node.rhs.type`. It handles:
- `"function"` (line 684): Creates synthetic augmented function with lhs prepended to args -> `walkFunction` handles HOF binding
- Everything else (line 695): Falls to `walkNode(node.rhs, scope)` -> for lambda, this calls `walkLambda` which returns `[]` for non-thunk lambdas

The key insight: `walkLambda` returning `[]` is correct in general -- a lambda DEFINITION doesn't execute. But in `~>` context, the lambda IS being executed with the lhs as its first argument. The apply operator needs to detect this case and perform the binding.

**Current output for `data ~> function($d) { $d.count }`:** `[{path: "data", confidence: "static"}]`
**Expected output:** `[{path: "data", confidence: "static"}, {path: "data.count", confidence: "static"}]`

**Files modified:** `src/walker.ts` (walkApply function only)
**Complexity:** LOW -- 6 lines added, no existing code changed.
**Regression risk:** MINIMAL -- the new `else if` branch only activates when `rhs.type === "lambda"`, which was previously handled by the generic else branch returning `[]`. All existing tests have `rhs.type === "function"` and hit the first branch.

### Bug 2: walkPath Variable-Resolved Sort (PIPE-02)

**Root cause:** `walkPath`'s variable branch (lines 100-127) handles paths that start with a variable step. It:
1. Resolves the variable to paths (line 104)
2. Handles predicates on the variable node (lines 110-115)
3. Builds suffix from remaining steps via `buildPathString` (line 119)
4. Concatenates resolved paths with suffix (line 122)

Step 3 is where the bug occurs: `buildPathString` skips sort nodes (they're not path segments). So for `$x^(price)`, the suffix is null and the sort term `price` is never walked.

The NON-variable path code (lines 157-194) handles sort correctly: the step iteration loop checks for `step.type === "sort"` (line 166) and calls `walkSortTerms`. But the variable branch returns early (line 127) before reaching the step iteration loop.

**Current output for `($x := items; $x^(price))`:** `[{path: "items", confidence: "static"}]`
**Expected output:** `[{path: "items", confidence: "static"}, {path: "items.price", confidence: "static"}]`

**Files modified:** `src/walker.ts` (walkPath variable branch only)
**Complexity:** LOW -- 5-7 lines added, no existing code changed.
**Regression risk:** MINIMAL -- the new sort handling only activates when a sort node appears in suffix steps after a variable. Existing variable-path tests don't have sort steps.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `walkApply` only handles function RHS | Needs to also handle lambda RHS | Phase 15 (this fix) | Enables inline lambda with apply operator |
| `walkPath` variable branch ignores sort | Needs to walk sort terms after variable resolution | Phase 15 (this fix) | Enables variable-resolved sort extraction |

## Skipped Test Inventory

The 2 BUG(v1.2) tests this phase must unskip (out of 8 remaining):

| File | Line | Bug ID | Expression | Category |
|------|------|--------|------------|----------|
| `data-transforms.test.ts` | 66 | PIPE-02 | `($x := items; $x^(price))` | Variable-resolved sort |
| `data-transforms.test.ts` | 134 | PIPE-01 | `data ~> function($d) { $d.count }` | Inline lambda apply |

**Note:** The remaining 6 skipped tests belong to filter predicate leak (4 tests) and focus variable double-prefix (2 tests) categories and are addressed in Phase 16. They must NOT be unskipped in this phase.

## Regression Test Patterns

Suggested regression test expressions for PIPE-03 (10+ new tests in `data-transforms.test.ts`):

### Apply/Lambda Patterns
1. **Multi-arg inline lambda:** `data ~> function($a, $b) { $a.x }` -> `["data", "data.x"]` -- only first param bound
2. **Inline lambda with complex body:** `data ~> function($d) { $d.a + $d.b }` -> `["data", "data.a", "data.b"]`
3. **Inline lambda with object constructor body:** `data ~> function($d) { {"name": $d.x, "val": $d.y} }` -> `["data", "data.x", "data.y"]`
4. **Nested apply with inline lambda:** `data ~> function($d) { $d.items } ~> $map(function($v) { $v.name })` -> complex chain
5. **Inline lambda with no params:** `data ~> function() { 42 }` -> `["data"]` -- no binding, no body paths

### Sort Patterns
6. **Multi-term variable-resolved sort:** `($x := items; $x^(>price, <date))` -> `["items", "items.date", "items.price"]`
7. **Variable-resolved sort then property:** `($x := items; $x^(price).name)` -> `["items.name", "items.price"]`
8. **Variable-resolved sort with deep path sort key:** `($x := records; $x^(details.score))` -> `["records", "records.details.score"]`
9. **Multi-hop variable with sort:** `($a := data.items; $b := $a; $b^(price))` -> `["data.items", "data.items.price"]` -- verify sort through variable chain
10. **Sort with filter combo on variable:** `($x := items; $x[active]^(price))` -- if parser puts filter as predicate on variable + sort as step

### Edge Cases
11. **Apply with literal lhs:** `42 ~> function($x) { $x }` -> `[]` -- no data paths from numeric literal
12. **Apply preserving existing function call behavior:** `items ~> $map(function($v) { $v.price })` -> `["items", "items.price"]` -- existing passing test pattern, verify no regression

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
| PIPE-01 | walkApply binds inline lambda parameter to lhs paths | integration | `pnpm vitest run test/integration/data-transforms.test.ts -x` | Fixture exists (skipped at line 134) |
| PIPE-02 | walkPath variable branch walks sort terms | integration | `pnpm vitest run test/integration/data-transforms.test.ts -x` | Fixture exists (skipped at line 66) |
| PIPE-03 | 10+ regression tests covering apply/sort patterns | integration | `pnpm vitest run test/integration/data-transforms.test.ts -x` | Tests to add |

### Sampling Rate
- **Per task commit:** `pnpm test` (full 251+ test suite, completes in ~300ms)
- **Per wave merge:** `pnpm test` (same -- fast enough to run every time)
- **Phase gate:** Full suite green, 0 skipped BUG(v1.2) tests in PIPE category, 10+ new tests passing, total skipped count drops from 8 to 6

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. The `assertFixture()` helper, `IntegrationFixture` type, and `data-transforms.test.ts` file already exist with the correct test structure.

## Open Questions

1. **Apply with variable RHS resolving to lambda**
   - What we know: `($fn := function($x) { $x.name }; data ~> $fn)` produces `data` only (missing `data.name`). The RHS is `type: "variable"` which `walkApply` passes to `walkNode` -> `walkVariable` -> resolves to `[]` (lambda RHS produces no data paths).
   - What's unclear: Whether this edge case should be fixed in Phase 15 or deferred.
   - Recommendation: This is NOT in the PIPE requirements. The case `data ~> $fn()` (function CALL) already works via the existing `rhs.type === "function"` path. The bare variable case (`data ~> $fn`) is unusual and would require `walkApply` to resolve the variable, look up the lambda in scope via `resolveLambda()`, and then do the binding. This is more complex and not explicitly required. Defer unless it comes up during planning.

2. **Sort handling on variable node predicates (not suffix steps)**
   - What we know: Filter predicates can appear on the variable node itself (`varStep.predicate`), already handled at lines 110-115. Sort steps appear as separate steps after the variable in `node.steps`, not as predicates.
   - What's unclear: Could sort ever appear as a predicate on the variable node? Based on AST dumps, NO -- sort is always a separate step. But this should be verified during implementation.
   - Recommendation: Implement sort handling only for suffix steps (as shown in the code example). If edge cases emerge, add handling.

## Sources

### Primary (HIGH confidence)
- `src/walker.ts` -- Direct code reading, both bug root causes traced through actual code paths (lines 676-699 for PIPE-01, lines 98-128 for PIPE-02)
- `src/types.ts` -- AST type definitions confirming ApplyNode, LambdaNode, SortNode structures
- `test/integration/data-transforms.test.ts` -- Both skipped BUG(v1.2) fixtures with expected outputs (lines 66 and 134)
- AST dumps via `jsonata().ast()` -- Verified exact parser output for all buggy and edge case expressions
- `extractPaths()` output -- Confirmed current buggy behavior matches root cause analysis
- `.planning/research/ARCHITECTURE.md` -- Prior root cause analysis corroborates findings
- `.planning/research/FEATURES.md` -- Prior feature analysis corroborates findings

### Secondary (MEDIUM confidence)
- Edge case AST analysis for multi-arg lambda, sort-then-property, and variable RHS patterns -- derived from parser behavior, not from documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all tools already in project
- Architecture: HIGH -- both bugs have exact root causes traced through code and AST dumps, with fix patterns verified
- Pitfalls: HIGH -- all pitfalls derived from direct code analysis and edge case testing
- Regression test patterns: HIGH -- all expressions verified parseable, expected outputs derived from fix logic

**Research date:** 2026-03-06
**Valid until:** indefinite (fixing bugs in project's own code, no external dependency changes)
