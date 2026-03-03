# Phase 4: Advanced Analysis - Research

**Researched:** 2026-03-03
**Domain:** JSONata AST parent operator, dynamic bracket paths, confidence annotations
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Dynamic path notation (ADV-02)**
- Only `$variable` in bracket position triggers dynamic treatment: `item[$field]` where `$field` is unresolved -> produces `item[*]`
- Bare name filters (`item[fieldName]`) keep current behavior: produces `item` + `item.fieldName` (fieldName is a field reference, not a computed key)
- The `[*]` notation is bracket-wildcard — a new notation distinct from dot-wildcard (`item.*`)

**Parent operator output (ADV-01)**
- `%` is kept as a literal path segment
- Standalone `%` -> `"%"`
- `%.name` -> `"%.name"`
- `item.%.name` -> `"item.%.name"`
- The `%` segment propagates through path building like any other segment

**Confidence field API shape (ADV-03)**
- `confidence` is always required on `PathResult` — no optional/nullable
- Type: `"static" | "dynamic" | "partial"` string union
- Full interface: `{ path: string; confidence: "static" | "dynamic" | "partial" }`
- Meaning:
  - `"static"` — fully resolvable at analysis time (no unknowns)
  - `"dynamic"` — contains a computed/unresolvable segment (`[*]`)
  - `"partial"` — contains a parent-operator segment (`%`), parent context unresolvable

**Confidence propagation rules**
- Priority order: `"partial"` > `"dynamic"` > `"static"`
- Any path containing a `%` segment -> `"partial"` (regardless of other segments)
- Any path containing a `[*]` segment (but no `%`) -> `"dynamic"`
- All other paths -> `"static"` (including explicit dot-wildcards like `item.*` and `**.price`, which are written by the author and fully known at analysis time)

### Claude's Discretion
- Internal representation change: `walkNode` currently returns `string[]` — implementation may change internal type to carry confidence alongside path strings, or use a post-processing pass (mark strings containing `[*]` as dynamic, `%` as partial)
- Exact deduplication behavior when same path appears with different confidence levels (e.g., same path derived via two routes — one static, one dynamic)
- Whether `buildPathString` needs to understand `[*]` notation or if `[*]` is injected at the walker level

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ADV-01 | Resolve parent operator (`%`) with symbolic markers or path backtracking | Confirmed AST shape: `type:"parent"` step in PathNode.steps; requires `buildPathString` + `walkNode` additions; two code sites must emit `%` as a literal segment |
| ADV-02 | Mark dynamically computed paths with wildcards (`item[$field]` -> `item[*]`) | Confirmed: pure `VariableNode` as filter stage `expr` is the precise trigger; detection is at `walkFilterStages`; ADV-02 fires when resolved paths are null or empty |
| ADV-03 | Annotate extracted paths with confidence level (static vs dynamic/partial) | Confirmed: post-processing approach is viable; confidence derived from path string markers `%` (whole segment) and `[*]` (bracket suffix); no walker refactor needed |
</phase_requirements>

## Summary

Phase 4 adds three closely-related capabilities to the existing path extractor: correct handling of the JSONata parent operator (`%`), emission of `[*]` bracket-wildcard markers for dynamically computed filters, and a required `confidence` field on every `PathResult`. All three are implementable through targeted, localized changes — no architectural refactor is required.

The JSONata 2.1.0 parser emits the parent operator as a distinct `type:"parent"` step node (not a `BinaryNode` with `value:"%"` as CONTEXT.md speculated). This node appears in `PathNode.steps` alongside `name`, `wildcard`, and `descendant` nodes, and it can also appear directly as a filter stage `expr`. Both sites — `buildPathString` and `walkNode` — need a `"parent"` case that emits `"%"` as a string segment. The preceding name step gets `ancestor` and `tuple` properties added by the parser but these do not affect path extraction.

For dynamic paths (ADV-02), the trigger is precisely a filter stage whose `expr` is a standalone `VariableNode` and the variable either is unbound in scope or resolves to an empty path array. The `walkFilterStages` function is the correct change site. The `[*]` string is injected there as `contextPrefix + "[*]"`. For confidence annotation (ADV-03), string-based post-processing in `extractPaths` is the recommended approach: after deduplication, derive confidence by splitting the path string on `"."` and checking for a whole `"%"` segment (partial) or checking for `"[*]"` anywhere in the string (dynamic). This works correctly for all ordinary cases; the edge case of backtick-escaped field names that happen to be named literally `%` or `[*]` is a known limitation that matches the project's existing precedent for pragmatic tradeoffs.

**Primary recommendation:** Implement in two tasks — (1) parent operator handling in `buildPathString` + `walkNode` + new `ParentNode` type, plus `[*]` injection in `walkFilterStages`; (2) confidence annotation via post-processing in `extractPaths` + `PathResult` type update + full existing test suite update to `confidence:"static"`.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jsonata | 2.1.0 | JSONata expression parser (existing dependency) | Already in use; provides `type:"parent"` AST nodes for Phase 4 |
| vitest | ^4.0.18 | Test runner (existing dev dependency) | Already configured; all phase tests go into existing test file |
| typescript | ~5.9.3 | Type system (existing) | All new types follow existing discriminated union pattern |

### Supporting

No new dependencies required. All Phase 4 work is pure code changes to existing files.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Post-processing confidence derivation | `{path, confidence}[]` wrapper type throughout walker | Wrapper type is more precise (handles backtick edge case) but requires changing ~15 function signatures; post-processing achieves the same for all real-world inputs |
| Injecting `[*]` at walker level | Adding `[*]` handling to `buildPathString` | `buildPathString` builds from AST steps; `[*]` is not an AST step but a synthetic emission from walker logic — keeping it in the walker is architecturally cleaner |

**Installation:** No new packages.

## Architecture Patterns

### Recommended Project Structure

No new files needed. All changes go to existing files:

```
src/
├── types.ts          # Add ParentNode interface, add to AstNode union, add confidence to PathResult
├── path-builder.ts   # Add case "parent" -> push("%")
├── walker.ts         # Add case "parent" in walkNode; modify walkFilterStages for [*] emission
└── index.ts          # Compute confidence per path in extractPaths
test/
└── extract-paths.test.ts  # Update all 87 existing assertions + add ADV-01/02/03 tests
```

### Pattern 1: Parent Node Handling in buildPathString

**What:** Add a `"parent"` case to `buildPathString` that pushes `"%"` as a segment.
**When to use:** Called whenever a path step has `type:"parent"`.
**Example:**
```typescript
// In src/path-builder.ts, inside the switch on step.type:
case "parent":
  segments.push("%");
  break;
```

This change causes `buildPathString([items, parent, name])` to produce `"items.%.name"` instead of the current `"items.name"` (which silently drops the parent step).

### Pattern 2: Parent Node Handling in walkNode

**What:** Add a `"parent"` case to the `walkNode` switch that returns `["%"]`.
**When to use:** Called when a `parent` node appears as a standalone expression (e.g., inside a filter predicate: `products[%]`).
**Example:**
```typescript
// In src/walker.ts, inside the walkNode switch:
case "parent":
  return ["%"];
```

This case is necessary because `parent` nodes can appear directly as filter stage `expr` values — not just as steps inside a `PathNode`. Without this, `walkFilterStages` calls `walkNode(filterStage.expr, scope)` and gets `[]` instead of `["%"]`.

### Pattern 3: Dynamic Variable Detection in walkFilterStages

**What:** Before calling `walkNode` on a filter stage expression, check if it is a pure `VariableNode` with no resolved data paths. If so, emit `contextPrefix + "[*]"` and skip normal predicate walking.
**When to use:** Trigger condition: `filterStage.expr.type === "variable"` AND `(resolved === null || resolved.length === 0)`.
**Example:**
```typescript
// In src/walker.ts, inside the for-loop in walkFilterStages:
if (stage.type !== "filter") continue;
const filterStage = stage as unknown as FilterStage;
if (isNumericIndex(filterStage.expr)) continue;

// ADV-02: pure variable in bracket position with no resolved data paths -> dynamic
if (filterStage.expr.type === "variable") {
  const varNode = filterStage.expr as VariableNode;
  const resolved = resolveVariable(filterScope, varNode.value);
  if (!resolved || resolved.length === 0) {
    paths.push(`${contextPrefix}[*]`);
    continue; // do not also walk as predicate
  }
}

// existing predicate walking continues below...
const filterPaths = walkNode(filterStage.expr, filterScope);
paths.push(...prefixPaths(contextPrefix, filterPaths));
```

**Important:** The `continue` after pushing `[*]` prevents also walking the predicate expression — the `[*]` replaces the predicate path, it does not supplement it.

**What about resolved variables?** If `$field` is bound to data paths (e.g., `$field := account.name`), `resolved.length > 0` and the existing predicate-walking path runs instead. The `[*]` emission only fires when the variable carries no data-path meaning.

### Pattern 4: Confidence Post-Processing in extractPaths

**What:** After deduplication, derive `confidence` from the path string and return `PathResult[]` with the `confidence` field.
**When to use:** In `src/index.ts`, replacing the current `unique.map((path) => ({ path }))`.
**Example:**
```typescript
// In src/index.ts:
function deriveConfidence(path: string): "static" | "dynamic" | "partial" {
  // Check for whole "%" segment (parent operator marker)
  const segments = path.split(".");
  if (segments.includes("%")) return "partial";
  // Check for bracket-wildcard notation
  if (path.includes("[*]")) return "dynamic";
  return "static";
}

export function extractPaths(expression: string): PathResult[] {
  const ast = parse(expression);
  const scope = createScope();
  const rawPaths = walkNode(ast, scope);
  const unique = [...new Set(rawPaths)];
  return unique.map((path) => ({ path, confidence: deriveConfidence(path) }));
}
```

**Why split on "."?** A path like `"field%name"` is a single segment (no dot) and `segments.includes("%")` returns false — no false positive. A genuine parent segment `"items.%.name"` splits to `["items", "%", "name"]` and `includes("%")` returns true. This correctly distinguishes backtick-escaped field names from actual parent segments.

**Why `path.includes("[*]")` not split-based?** The `[*]` marker is appended directly to the context prefix (e.g., `"items[*]"`), not as a dot-separated segment. Splitting on `.` would give `["items[*]"]` and checking `includes("[*]")` at the segment level adds no benefit over the string-level check. The edge case of a backtick-escaped field named literally `[*]` (e.g., `` items.`[*]` ``) is a theoretical concern only; in practice field names are valid identifiers.

### Pattern 5: PathResult Type Update

**What:** Add required `confidence` field to `PathResult` in `src/types.ts`.
**Example:**
```typescript
// In src/types.ts:
export type Confidence = "static" | "dynamic" | "partial";

export interface PathResult {
  path: string;
  confidence: Confidence;
}
```

Adding `Confidence` as a named type alias is optional but makes the type easier to reference from `extractPaths` and future phases.

### Anti-Patterns to Avoid

- **Handling `[*]` inside `buildPathString`:** The `[*]` marker is not an AST node type — it is a synthetic string injected by walker logic when a variable filter is unresolvable. Adding `buildPathString` logic for it would require passing non-AST data to that function, breaking its pure step-to-string contract.
- **Adding confidence as a parameter to `walkNode`:** Threading confidence through all 15+ walker functions would be a large refactor and is not warranted given that confidence can be derived from the final string markers alone.
- **Checking `BinaryNode.value === "%"` for the parent operator:** The JSONata 2.1.0 parser does NOT emit parent as a BinaryNode. It emits `type:"parent"` as a distinct step node. Checking binary value would miss parent entirely.
- **Emitting `[*]` for resolved variables in filter position:** Only unresolvable or empty-resolved variables get `[*]`. A variable like `$i` bound to an integer literal index emits nothing (existing behavior: numeric index skip handles it) or falls through to the existing filter walker.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parent operator detection | Custom BinaryNode parsing for `%` | `case "parent"` in existing switch dispatch | JSONata emits a dedicated `type:"parent"` node, not a BinaryNode |
| Dynamic confidence annotation | Complex graph traversal to track path origins | String marker detection on final path strings | Markers `%` and `[*]` are unique enough in practice; post-processing is O(n) and correct |
| New test infrastructure | Custom test utilities for confidence | Vitest `toEqual` with inline objects `{ path, confidence }` | Existing pattern in the 87-test suite; no custom matchers needed |

**Key insight:** All three ADV requirements are detective in nature — each is a detection (is this a parent step? is this an unresolved variable filter? what markers are in this path string?). None requires new data structures or algorithms.

## Common Pitfalls

### Pitfall 1: Parent Node Is Not a BinaryNode

**What goes wrong:** Code checks `node.type === "binary" && node.value === "%"` and finds nothing, treating parent operator expressions as silent skips.
**Why it happens:** CONTEXT.md noted this as speculation; the actual JSONata parser emits `type:"parent"` as a dedicated node type. `BinaryNode.value` can equal `%` for the modulo operator, not the parent operator.
**How to avoid:** Use `case "parent"` in `walkNode`; add `case "parent"` in `buildPathString`. Never check for `%` in binary values.
**Warning signs:** `items.%.name` extracting as `["items.name"]` (dropping the parent segment entirely).

### Pitfall 2: Forgetting walkNode case for Standalone Parent Nodes

**What goes wrong:** Only `buildPathString` is updated; `walkNode` still falls to `default` for `"parent"` type. Filter predicates like `products[%]` or `products[%.category = "A"]` silently skip the parent reference.
**Why it happens:** Parent nodes appear in TWO code paths: as steps in `PathNode.steps` (handled by `buildPathString`) AND as direct filter stage `expr` values (handled by `walkNode` dispatch).
**How to avoid:** Add BOTH changes: `buildPathString` case AND `walkNode` case.
**Warning signs:** `products[%]` returns `["products"]` instead of `["products", "products.%"]`.

### Pitfall 3: Missing `continue` After `[*]` Emission

**What goes wrong:** After emitting `contextPrefix + "[*]"` for an unresolvable variable filter, the code falls through to `walkNode(filterStage.expr, scope)` which returns `[]` (unresolvable variable silently skips). Net result is correct but wastes a walkNode call. More critically, if the variable somehow resolves later (scope change), the fall-through would also add paths from the variable, double-counting.
**Why it happens:** `continue` statement forgotten after the ADV-02 guard.
**How to avoid:** Always `continue` after pushing `[*]` — the `[*]` emission is the complete response for that filter stage.

### Pitfall 4: Breaking All 87 Existing Tests

**What goes wrong:** Adding `confidence` as a required field to `PathResult` causes all 87 existing test assertions like `toEqual([{ path: "items.price" }])` to fail — the received objects have `confidence: "static"` but expected objects have no `confidence` key.
**Why it happens:** `toEqual` in Vitest performs deep exact equality; extra fields on received objects cause failures.
**How to avoid:** Update ALL existing test assertions to include `confidence: "static"`. This is mechanical but mandatory. Use a search-and-replace pass on the test file: every `{ path: "..." }` becomes `{ path: "...", confidence: "static" }`.
**Warning signs:** Test run shows 87 failures immediately after adding the confidence field.

### Pitfall 5: False Positive Confidence for Backtick-Escaped Field Names

**What goes wrong:** A field named `%` (via backticks: `` `%` ``) produces a path like `"items.%"` which the post-processor incorrectly classifies as `"partial"` even though it is a static field reference.
**Why it happens:** Post-processing uses `segments.includes("%")` which cannot distinguish a true parent segment from an escaped field name that happens to be `%`.
**How to avoid:** Accept this as a known edge case. Document in code. In practice, JSONata expressions with backtick-escaped `%` field names are vanishingly rare. The project precedent supports pragmatic tradeoffs for uncommon edge cases.
**Warning signs:** Only relevant if a user reports unexpected `"partial"` confidence on a static path that happens to contain a field literally named `%`.

### Pitfall 6: Confidence for `item[$field].name` — What Are the Emitted Paths?

**What goes wrong:** Developer assumes `item[$field].name` only produces `["item[*]"]` and is surprised that `["item.name", "item[*]"]` are both emitted.
**Why it happens:** `walkPath` emits the BASE path `buildPathString([item, name])` = `"item.name"` first, then `walkFilterStages` emits the ADV-02 `[*]` path. Both come from the same expression.
**How to avoid:** This is correct behavior — `"item.name"` is the statically resolvable base access, `"item[*]"` is the dynamic key. Both carry different confidence levels. Ensure tests reflect both outputs.

## Code Examples

Verified against actual JSONata 2.1.0 AST output from direct probing:

### Parent Node AST Shape

```
// Input: "items.%.name"
// JSONata 2.1.0 AST:
{
  type: "path",
  steps: [
    { value: "items", type: "name", position: 5, ancestor: {...}, tuple: true },
    { type: "parent", slot: { label: "!0", level: 0, index: 0 } },  // <- parent node
    { value: "name", type: "name", position: 12 }
  ]
}
// The "ancestor" and "tuple" on the preceding name step are parser bookkeeping for
// runtime parent resolution. Not relevant to path extraction.
```

### Standalone Parent Node in Filter

```
// Input: "products[%]"
// Filter stage expr IS the parent node directly (not wrapped in a path):
{
  type: "path",
  steps: [{
    value: "products", type: "name",
    stages: [{
      type: "filter",
      expr: { type: "parent", slot: { label: "!0", level: 1, index: 0 } }
      //     ^^^^ pure parent node, not a PathNode containing a parent step
    }]
  }]
}
```

### Variable-in-Filter AST Shape (ADV-02 trigger)

```
// Input: "item[$field]"
// The FILTER STAGE expr is a plain VariableNode:
{
  type: "path",
  steps: [{
    value: "item", type: "name",
    stages: [{
      type: "filter",
      expr: { value: "field", type: "variable", position: 11 }
      //     ^^^^ standalone VariableNode — this is the ADV-02 trigger
    }]
  }]
}

// Contrast with "item[$x.name]" — NOT a trigger:
// filter expr is a PathNode (type:"path"), not a VariableNode directly
```

### ADV-02 vs Non-Trigger Comparison

```typescript
// Trigger conditions (emit [*]):
// filterStage.expr.type === "variable"
// AND resolveVariable(filterScope, varNode.value) returns null or []

// Examples that trigger:
// item[$field]            -- $field not in scope
// item[$computed]         -- $computed not in scope
// ($k := "price"; items[$k])  -- $k bound to literal string -> resolves to []

// Examples that do NOT trigger (existing behavior):
// item[fieldName]         -- expr is a PathNode(name), not a VariableNode
// item[$x.active]         -- expr is a PathNode with variable step, not VariableNode
// item[$i]                -- $i bound to a path -> resolves to non-empty -> falls through
// item[0]                 -- numeric index guard fires first
```

### Complete deriveConfidence Implementation

```typescript
// Source: derived from research (no external library)
function deriveConfidence(path: string): "static" | "dynamic" | "partial" {
  // Check for whole "%" segment — parent operator marker
  // Split on "." so "field%name" (backtick-escaped field with %) is NOT classified as partial
  const segments = path.split(".");
  if (segments.includes("%")) return "partial";
  // Check for bracket-wildcard notation anywhere in path string
  if (path.includes("[*]")) return "dynamic";
  return "static";
}
```

### ParentNode Type Addition

```typescript
// In src/types.ts:
export interface ParentNode {
  type: "parent";
  slot: { label: string; level: number; index: number };
  position?: number;
}

// Add to AstNode union:
export type AstNode =
  | PathNode
  | NameNode
  | WildcardNode
  | DescendantNode
  | BinaryNode
  | ConditionNode
  | BlockNode
  | UnaryNode
  | StringNode
  | NumberNode
  | ValueNode
  | VariableNode
  | RegexNode
  | BindNode
  | FunctionNode
  | LambdaNode
  | ApplyNode
  | SortNode
  | TransformNode
  | ParentNode    // <- new
  | GenericNode;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Parent operator silently skipped (falls to `default` in `walkNode`) | Handled via `case "parent"` in both `walkNode` and `buildPathString` | Phase 4 | `items.%.name` correctly produces `"items.%.name"` instead of `"items.name"` |
| Unresolvable variable in filter silently drops (returns `[]`) | ADV-02: emits `contextPrefix + "[*]"` | Phase 4 | `item[$field]` produces `"item[*]"` instead of nothing |
| `PathResult` has only `{ path: string }` | `PathResult` gains required `confidence: "static" \| "dynamic" \| "partial"` | Phase 4 | All callers get classification; all existing tests need updating |

**Deprecated/outdated:**
- Comment in `types.ts` line 3-4: "Phase 4 will add confidence annotations without breaking the contract" — this is now the Phase 4 work. Remove the comment when implementing.

## Open Questions

1. **Deduplication when the same path appears with different confidence from two derivation routes**
   - What we know: The current deduplication is `[...new Set(rawPaths)]` on path strings. If `"items[*]"` were derived twice (hypothetically), Set deduplication handles it. Since confidence is derived from the string AFTER dedup, a path can only have one confidence value.
   - What's unclear: Can the same path string be emitted with logically different confidences? E.g., could `"items"` be emitted both as a static base path and as something requiring dynamic annotation? No — `"items"` is always static; `"items[*]"` is always dynamic. Different confidence always means different path strings.
   - Recommendation: No special dedup handling needed. Dedup by string, then derive confidence from string. One confidence per unique path string is always correct.

2. **What confidence for `item[$field].name`?**
   - What we know: This expression emits BOTH `"item.name"` (static base path) AND `"item[*]"` (dynamic bracket access). These are two different paths with two different confidences.
   - What's unclear: Should there also be an `"item[*].name"` path? No — the `[*]` represents the dynamic key at `item`, not a step toward `.name`. The base path `"item.name"` covers the `.name` access; `"item[*]"` covers the dynamic key access itself.
   - Recommendation: Two paths emitted, correct as-is. Ensure tests explicitly assert both.

3. **Should ADV-02 also apply inside complex expressions (e.g., `item[$a + $b]`)?**
   - What we know: The locked decision says "Only `$variable` in bracket position triggers dynamic treatment" — singular variable, not complex expressions involving variables.
   - What's unclear: `item[$a + $b]` has a `BinaryNode` as filter expr, not a `VariableNode`. Under the locked decision, this falls through to existing predicate walking (which walks both `$a` and `$b` as unresolved variables, returning `[]`). Net result: only `"item"` as base path, no `[*]`.
   - Recommendation: Keep the trigger condition strict — only pure `VariableNode` as filter expr. Complex expressions are handled by the existing predicate walker.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADV-01 | `items.%.name` -> `[{ path: "items.%.name", confidence: "partial" }]` | unit | `npx vitest run --reporter=verbose` | Wave 0 |
| ADV-01 | `Account.Order.Product.%.OrderID` -> partial confidence path | unit | `npx vitest run --reporter=verbose` | Wave 0 |
| ADV-01 | `products[%]` -> `products.%` with partial confidence | unit | `npx vitest run --reporter=verbose` | Wave 0 |
| ADV-02 | `item[$field]` -> `item[*]` with dynamic confidence | unit | `npx vitest run --reporter=verbose` | Wave 0 |
| ADV-02 | `item[$field].name` -> `["item.name" static, "item[*]" dynamic]` | unit | `npx vitest run --reporter=verbose` | Wave 0 |
| ADV-02 | `item[fieldName]` keeps static behavior (no `[*]`) | unit | `npx vitest run --reporter=verbose` | Wave 0 |
| ADV-03 | All existing 87 test paths carry `confidence: "static"` | unit | `npx vitest run --reporter=verbose` | Wave 0 (update) |
| ADV-03 | `item.*` -> static (explicit wildcard, fully known) | unit | `npx vitest run --reporter=verbose` | Wave 0 |
| ADV-03 | `**.price` -> static (descendant wildcard, fully known) | unit | `npx vitest run --reporter=verbose` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] Update all 87 existing test assertions to include `confidence: "static"` — every `{ path: "..." }` in `test/extract-paths.test.ts` becomes `{ path: "...", confidence: "static" }`. This is mechanical. Use a targeted search-and-replace that handles the `toEqual([...])`, `toContainEqual(...)`, and `expect.arrayContaining([...])` patterns.
- [ ] Add ADV-01 tests (3+ cases: mid-path parent, end-path parent, parent-in-filter)
- [ ] Add ADV-02 tests (3+ cases: unbound variable, bound-to-literal variable, bare-name non-trigger)
- [ ] Add ADV-03 tests (confidence field on wildcard paths, mixed confidence in one expression)

## Sources

### Primary (HIGH confidence)

- Direct JSONata 2.1.0 AST probing via `jsonata(expr).ast()` in Node.js — all parent node shapes, filter variable shapes, and current extractor behaviors verified by running against the actual installed library version.
- `src/walker.ts`, `src/types.ts`, `src/path-builder.ts`, `src/index.ts`, `src/scope.ts` — full read of all existing source files to map exact change sites.
- `test/extract-paths.test.ts` — counted 87 existing tests; confirmed all use `{ path: string }` pattern without confidence.

### Secondary (MEDIUM confidence)

- `.planning/phases/04-advanced-analysis/04-CONTEXT.md` — user decisions from `/gsd:discuss-phase`; all locked decisions treated as authoritative constraints.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing libraries verified by direct execution
- Architecture: HIGH — change sites confirmed by source file reads and live AST probing
- Pitfalls: HIGH — tested and confirmed by running actual expressions through `jsonata(expr).ast()` and tracing through `extractPaths` source

**Research date:** 2026-03-03
**Valid until:** 2026-06-03 (stable — JSONata 2.1.0 is a pinned dependency)
