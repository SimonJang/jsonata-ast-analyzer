# Phase 6: ADV-02 Edge Case Fix - Research

**Researched:** 2026-03-03
**Domain:** AST walker bug fix -- variable-resolution branch skips filter predicate inspection
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Emit BOTH the dynamic wildcard path (`orders[*]`, confidence: dynamic) AND the resolved path (`orders.price`, confidence: static)
- This matches existing behavior for `orders[$field].price` which emits both `item[*]` and `item` -- the composed variable case should be consistent
- Over-approximation is the project's design principle: better to report a path that isn't used than miss one that is
- Fix the identified scenario: single filter predicate on a resolved variable step (`$var[$field].prop`)
- Multi-filter composed cases (`$var[$f1][$f2]`) are out of scope unless they naturally fall out of the fix
- If the fix generalizes cleanly to multi-filter cases, that's fine -- but don't over-engineer for it
- Use confidence: `dynamic` for the wildcard path -- matches existing ADV-02 behavior for `item[$field]`
- No new confidence levels needed for the composed case

### Claude's Discretion
- Exact placement of the filter-stage inspection (modify early-return branch vs restructure walkPath)
- Whether to extract a helper function or inline the fix
- Any additional test cases beyond the required composed variable-filter scenario

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ADV-02 (gap closure) | When `walkPath` resolves a variable step and returns early, filter predicates on the resolved VariableNode are not inspected for unresolvable `$variable` expressions | Root cause identified in walker.ts lines 103-117; fix strategy documented below with AST evidence |
</phase_requirements>

## Summary

The bug is precisely located in `walkPath()` (walker.ts, lines 99-117). When a path step is a `VariableNode`, the function resolves the variable, concatenates resolved paths with the suffix, and returns early at line 113. The filter-stage inspection loop (lines 127-139) is never reached because the early return bypasses it. This means predicates on the VariableNode (e.g., `$data[$field]`) are never checked for unresolvable `$variable` expressions that should trigger ADV-02's `[*]` wildcard emission.

The JSONata parser stores filter stages on VariableNode under the property name `predicate` (an array of FilterStage-like objects), whereas NameNode uses `stages`. The existing `walkFilterStages` function operates on `NameNode` and reads from `nameStep.stages`. The fix must inspect `varStep.predicate` (same structure, different property name) before the early return, using the resolved variable paths as context prefix.

**Primary recommendation:** Add filter predicate inspection to the variable-resolution early-return branch in `walkPath`, reusing the ADV-02 logic from `walkFilterStages` by either (a) refactoring `walkFilterStages` to accept a generic stages array + context prefix, or (b) directly iterating `varStep.predicate` with inline ADV-02 checks before the early return.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test runner | Already in use -- all 101 existing tests |
| typescript | ~5.9.3 | Type checking | Already in use |
| jsonata | 2.1.0 | JSONata parser (AST source) | Already in use -- provides `predicate` property on VariableNode |

### Supporting
No new libraries needed. This is a pure bug fix within existing code.

### Alternatives Considered
None -- this is a localized fix within the existing architecture.

**Installation:**
No new packages needed.

## Architecture Patterns

### Existing Code Structure (Relevant Files)
```
src/
  walker.ts        # Contains the bug -- walkPath() and walkFilterStages()
  types.ts         # VariableNode interface (missing `predicate` declaration)
  scope.ts         # resolveVariable() -- already correct
  path-builder.ts  # buildPathString() -- already correct
  index.ts         # extractPaths() + deriveConfidence() -- already handles [*] -> "dynamic"
test/
  extract-paths.test.ts  # 101 tests, needs new test(s) for this case
```

### Pattern 1: The Bug -- Early Return Skips Filter Inspection

**What:** `walkPath` lines 103-117 resolve a variable step and return immediately, never reaching the filter-stage loop at lines 127-139.

**Current broken code (walker.ts lines 99-117):**
```typescript
function walkPath(node: PathNode, scope: ScopeTracker): string[] {
  const varStepIndex = node.steps.findIndex((s) => s.type === "variable");

  if (varStepIndex >= 0) {
    const varStep = node.steps[varStepIndex] as VariableNode;
    const resolved = resolveVariable(scope, varStep.value);

    if (resolved && resolved.length > 0) {
      const suffixSteps = node.steps.slice(varStepIndex + 1);
      const suffix = buildPathString(suffixSteps);
      // BUG: returns here without checking varStep.predicate
      return resolved.map((p) => (suffix ? `${p}.${suffix}` : p));
    }
    return [];
  }
  // ... filter-stage loop (lines 127-139) is only reached for non-variable paths
```

**Why it fails:** The variable-resolution branch at line 113 returns `resolved.map(...)` directly. The VariableNode may carry `.predicate` (an array of filter stages from the parser), but these are never inspected.

### Pattern 2: The Working Case -- NameNode Filter Stage Inspection

**What:** For non-variable paths, `walkPath` iterates each step and calls `walkFilterStages` on NameNode steps that have `.stages`.

**Working code (walker.ts lines 127-139):**
```typescript
for (let i = 0; i < node.steps.length; i++) {
  const step = node.steps[i];
  if (step.type === "name") {
    const nameStep = step as NameNode;
    if (nameStep.stages && nameStep.stages.length > 0) {
      const contextPrefix = buildPathString(node.steps.slice(0, i + 1)) ?? "";
      paths.push(...walkFilterStages(nameStep, contextPrefix, scope));
    }
  }
  // ...
}
```

### Pattern 3: ADV-02 Logic Inside walkFilterStages

**What:** `walkFilterStages` (lines 196-239) handles the ADV-02 wildcard emission.

**Key logic (walker.ts lines 224-231):**
```typescript
// ADV-02: pure $variable in bracket position with no resolved data paths -> dynamic wildcard
if (filterStage.expr.type === "variable") {
  const varNode = filterStage.expr as VariableNode;
  const resolved = resolveVariable(filterScope, varNode.value);
  if (!resolved || resolved.length === 0) {
    paths.push(`${contextPrefix}[*]`);
    continue;
  }
}
```

### Pattern 4: AST Property Difference -- `stages` vs `predicate`

**Critical finding:** The JSONata parser uses **different property names** for filter stages depending on the node type:

| Node Type | Property | Example |
|-----------|----------|---------|
| NameNode | `stages` | `orders[$field]` -> `stages: [{type:"filter", expr:...}]` |
| VariableNode | `predicate` | `$data[$field]` -> `predicate: [{type:"filter", expr:...}]` |

Both properties contain arrays of the same FilterStage structure (`{type: "filter", expr: AstNode}`).

**AST evidence (verified via parser output):**

Input: `($data := orders; $data[$field].price)`
```json
{
  "type": "path",
  "steps": [
    {
      "value": "data",
      "type": "variable",
      "position": 23,
      "predicate": [
        {
          "type": "filter",
          "expr": { "value": "field", "type": "variable", "position": 30 },
          "position": 24
        }
      ]
    },
    { "value": "price", "type": "name", "position": 37 }
  ]
}
```

Input: `orders[$field].price`
```json
{
  "type": "path",
  "steps": [
    {
      "value": "orders",
      "type": "name",
      "position": 6,
      "stages": [
        {
          "type": "filter",
          "expr": { "value": "field", "type": "variable", "position": 13 },
          "position": 7
        }
      ]
    },
    { "value": "price", "type": "name", "position": 20 }
  ]
}
```

### Pattern 5: VariableNode Can Also Have `focus` Property

VariableNode steps can carry `focus` (for `@$v` binding) and `tuple` properties, just like NameNode. Example: `$data@$v[$v.active]` produces:
```json
{
  "value": "data",
  "type": "variable",
  "focus": "v",
  "tuple": true,
  "predicate": [...]
}
```

The fix should handle this case as well -- bind the focus variable before walking predicates, consistent with how `walkFilterStages` handles `nameStep.focus`.

### Anti-Patterns to Avoid
- **Don't restructure walkPath entirely:** The early-return optimization for variable steps is correct and efficient -- just add predicate inspection before the return.
- **Don't duplicate ADV-02 logic:** Reuse the existing pattern from `walkFilterStages` rather than reimplementing the wildcard emission check.
- **Don't modify VariableNode TypeScript interface without understanding GenericNode:** The `predicate` property is not declared in the `VariableNode` interface in types.ts. The code uses `GenericNode` as a catch-all. Access via cast or index access is the established pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filter stage walking | New filter iteration logic | Refactored `walkFilterStages` or shared helper | Existing function handles numeric index guard, ADV-02 check, focus variable binding, and normal predicate walking |
| Context prefix computation | Custom path building | `buildPathString` or resolved variable paths | Resolved paths from scope ARE the context prefix for the variable step |

**Key insight:** The resolved variable paths (e.g., `["orders"]` from resolving `$data`) serve as the context prefix for filter stage walking. No new path-building logic is needed -- the resolved paths already provide what `buildPathString(node.steps.slice(0, i + 1))` computes for NameNode steps.

## Common Pitfalls

### Pitfall 1: Using `stages` Instead of `predicate`
**What goes wrong:** Checking `varStep.stages` on a VariableNode returns `undefined`. The parser stores filter stages under `predicate` for VariableNode.
**Why it happens:** NameNode uses `stages`, VariableNode uses `predicate` -- inconsistent naming in the JSONata parser.
**How to avoid:** Access `(varStep as any).predicate` or use an indexed access. Verify at runtime that `predicate` exists and is an array.
**Warning signs:** Tests pass but the fix has no effect -- `varStep.stages` is always falsy.

### Pitfall 2: Forgetting the Context Prefix is the Resolved Path
**What goes wrong:** Using `buildPathString` on path steps to compute the context prefix for a variable step, which doesn't work because the variable step is not a name step.
**Why it happens:** For NameNode, context prefix = `buildPathString(steps.slice(0, i+1))`. For resolved VariableNode, context prefix = the resolved path strings.
**How to avoid:** Use each resolved path string directly as the context prefix when walking predicates.
**Warning signs:** Emitted paths have wrong or empty prefix (e.g., `[*]` instead of `orders[*]`).

### Pitfall 3: Multi-Value Variable Resolution
**What goes wrong:** If a variable resolves to multiple paths (e.g., `$x := a > 0 ? b : c` resolves to `["b", "c"]`), the wildcard emission must happen for EACH resolved path as context prefix.
**Why it happens:** `walkFilterStages` takes a single `contextPrefix` string. With multiple resolved paths, each needs its own filter-stage walk.
**How to avoid:** Loop over resolved paths and walk predicates once per resolved path as context prefix.
**Warning signs:** Only the first resolved path gets the `[*]` wildcard emission.

### Pitfall 4: Not Handling the Focus Variable on VariableNode
**What goes wrong:** If the VariableNode has `focus` (from `@$v` binding), the focus variable must be bound in a child scope before walking predicates -- otherwise, `$v.field` references inside predicates won't resolve.
**Why it happens:** `walkFilterStages` binds `nameStep.focus` into a child scope. If you bypass `walkFilterStages`, you might forget to handle `varStep.focus`.
**How to avoid:** Check for `(varStep as any).focus` and bind it in a child scope, using the resolved path as the binding value.
**Warning signs:** Tests with focus variables on resolved variable steps fail.

### Pitfall 5: TypeScript Interface Mismatch
**What goes wrong:** TypeScript compiler errors because `VariableNode` doesn't declare `predicate` or `focus` properties.
**Why it happens:** The `VariableNode` interface in types.ts only declares `type`, `value`, and `position`. The parser adds undeclared properties at runtime.
**How to avoid:** Either (a) add `predicate` and `focus` to the `VariableNode` interface, or (b) cast to `any` / use indexed access. Approach (a) is cleaner. The `stages` property on `NameNode` is already an `AstNode[]` optional, so `predicate` should follow the same pattern.
**Warning signs:** TypeScript typecheck fails.

### Pitfall 6: Emitting Duplicate Paths
**What goes wrong:** The fixed code emits `orders[*]` AND the variable-resolution code already emits `orders.price`, but if filter walking also re-emits the base path, deduplication in `extractPaths()` handles it. However, path ORDER matters for test assertions.
**Why it happens:** `extractPaths` deduplicates via `new Set(rawPaths)`, so duplicates are harmless. But test `toEqual` checks order.
**How to avoid:** Be aware that emitted paths from the predicate walk will appear AFTER the resolved suffix paths in the output array. Tests should account for this ordering.
**Warning signs:** Tests fail on path ordering even though all expected paths are present.

## Code Examples

### Fix Strategy A: Refactor walkFilterStages to Accept Generic Stages Array

```typescript
// Generalize walkFilterStages to accept stages from either NameNode or VariableNode
function walkFilterStages(
  stages: AstNode[],       // was nameStep.stages, now any filter stage array
  contextPrefix: string,
  scope: ScopeTracker,
  focus?: string,          // optional focus variable name
): string[] {
  const paths: string[] = [];
  let filterScope = childScope(scope);

  if (focus) {
    filterScope = bindVariable(filterScope, focus, contextPrefix ? [contextPrefix] : []);
  }

  for (const stage of stages) {
    if (stage.type !== "filter") continue;
    const filterStage = stage as unknown as FilterStage;
    if (isNumericIndex(filterStage.expr)) continue;

    // ADV-02: pure $variable check
    if (filterStage.expr.type === "variable") {
      const varNode = filterStage.expr as VariableNode;
      const resolved = resolveVariable(filterScope, varNode.value);
      if (!resolved || resolved.length === 0) {
        paths.push(`${contextPrefix}[*]`);
        continue;
      }
    }

    const filterPaths = walkNode(filterStage.expr, filterScope);
    paths.push(...prefixPaths(contextPrefix, filterPaths));
  }

  return paths;
}
```

Then in `walkPath`, before the early return:
```typescript
if (resolved && resolved.length > 0) {
  const predicates = (varStep as any).predicate as AstNode[] | undefined;
  if (predicates && predicates.length > 0) {
    const focus = (varStep as any).focus as string | undefined;
    for (const resolvedPath of resolved) {
      paths.push(...walkFilterStages(predicates, resolvedPath, scope, focus));
    }
  }
  // ... existing suffix concatenation
}
```

### Fix Strategy B: Inline Filter Check in Early Return Branch

```typescript
if (resolved && resolved.length > 0) {
  const paths: string[] = [];
  const predicates = (varStep as any).predicate as AstNode[] | undefined;

  if (predicates && predicates.length > 0) {
    for (const resolvedPath of resolved) {
      let filterScope = childScope(scope);
      const focus = (varStep as any).focus as string | undefined;
      if (focus) {
        filterScope = bindVariable(filterScope, focus, [resolvedPath]);
      }
      for (const stage of predicates) {
        if (stage.type !== "filter") continue;
        const filterStage = stage as unknown as FilterStage;
        if (isNumericIndex(filterStage.expr)) continue;
        if (filterStage.expr.type === "variable") {
          const varNode = filterStage.expr as VariableNode;
          const varResolved = resolveVariable(filterScope, varNode.value);
          if (!varResolved || varResolved.length === 0) {
            paths.push(`${resolvedPath}[*]`);
            continue;
          }
        }
        const filterPaths = walkNode(filterStage.expr, filterScope);
        paths.push(...prefixPaths(resolvedPath, filterPaths));
      }
    }
  }

  const suffixSteps = node.steps.slice(varStepIndex + 1);
  const suffix = buildPathString(suffixSteps);
  paths.push(...resolved.map((p) => (suffix ? `${p}.${suffix}` : p)));
  return paths;
}
```

### Recommended Approach: Strategy A (Refactor walkFilterStages)

Strategy A is recommended because:
1. It reuses existing tested logic rather than duplicating it
2. The refactoring is minimal (change signature from `NameNode` to stages array + focus)
3. All callers of `walkFilterStages` can be updated trivially
4. The fix naturally generalizes to multi-filter cases (`$var[$f1][$f2]`)

### Test Pattern

```typescript
// Required test: composed variable-filter scenario
it('resolved variable with unbound filter: "($data := orders; $data[$field].price)" emits dynamic wildcard', () => {
  const result = extractPaths("($data := orders; $data[$field].price)");
  expect(result).toContainEqual({ path: "orders[*]", confidence: "dynamic" });
  expect(result).toContainEqual({ path: "orders.price", confidence: "static" });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Filter stages only inspected on NameNode | Must also inspect on resolved VariableNode | This phase | Closes ADV-02 gap for composed variable-filter scenarios |

**Not deprecated/outdated:** The existing ADV-02 logic in `walkFilterStages` is correct and should be preserved unchanged. The issue is solely that the variable-resolution early-return branch bypasses it.

## Open Questions

1. **Should `VariableNode` interface in types.ts be extended with `predicate` and `focus`?**
   - What we know: The JSONata parser adds these properties at runtime. The `NameNode` interface declares `stages` and `focus`. The `GenericNode` catch-all allows arbitrary properties.
   - What's unclear: Whether adding them to the interface is the project's preferred pattern or if `as any` / `as unknown` casts are preferred.
   - Recommendation: Add `predicate?: AstNode[]` and `focus?: string` to `VariableNode` for type safety and consistency with NameNode. This is the cleaner approach and matches the project's pattern of declaring known parser properties on interfaces.

2. **Should `walkFilterStages` callers at the NameNode call site (line 134) also be updated?**
   - What we know: The current NameNode call passes the whole `nameStep` object. Refactoring to pass `stages` + `focus` separately changes the call signature.
   - What's unclear: Whether the refactor should touch the existing NameNode call site or leave it unchanged and create a new function.
   - Recommendation: Refactor the signature to accept `(stages, contextPrefix, scope, focus?)` and update both call sites. This is a clean, minimal change.

## Sources

### Primary (HIGH confidence)
- `src/walker.ts` -- Direct code analysis of `walkPath` and `walkFilterStages` functions
- `src/types.ts` -- `VariableNode`, `NameNode`, `FilterStage` interface definitions
- `src/scope.ts` -- `resolveVariable` function behavior
- JSONata parser AST output -- Verified via `jsonata("...").ast()` for all relevant expressions

### Secondary (MEDIUM confidence)
- `.planning/v1.0-MILESTONE-AUDIT.md` -- Gap identification and tech debt documentation
- `.planning/phases/06-adv02-edge-case-fix/06-CONTEXT.md` -- User decisions and code context

### Tertiary (LOW confidence)
None -- all findings verified directly from source code and parser output.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, pure bug fix
- Architecture: HIGH -- root cause verified via AST inspection and runtime testing
- Pitfalls: HIGH -- all pitfalls identified from direct code analysis and AST property inspection

**Research date:** 2026-03-03
**Valid until:** Indefinite -- this is a bug fix in existing code, not subject to external changes
