# Phase 2: Scope Infrastructure and Variable Tracing - Research

**Researched:** 2026-03-02
**Domain:** Static scope analysis / variable resolution in JSONata AST
**Confidence:** HIGH

## Summary

Phase 2 transforms the walker from a stateless path extractor into a scope-aware analyzer. The core challenge is threading a scope context (`Map<string, string[]>`) through the existing walker so that variable references (`$x`) resolve back to their source data paths. This requires handling five AST node types that Phase 1 skips: `bind`, `function`, `lambda`, `apply`, and the `focus`/`index` properties on `NameNode` for context/positional variables.

The JSONata AST shapes have been empirically verified. All six node types have consistent, predictable structures. The `bind` node has `lhs` (variable) and `rhs` (expression). The `function` node has `procedure` (variable naming the function), `arguments` (array of argument expressions). The `lambda` node has `arguments` (array of parameter variables) and `body` (expression). The `apply` node has `lhs` and `rhs` like a binary operator. Context bindings (`@$v`) appear as a `focus` property on `NameNode`, and positional variables (`#$i`) appear as an `index` property.

**Primary recommendation:** Build a `ScopeTracker` class (immutable per scope level) that maps variable names to resolved path arrays. Thread it through `walkNode` as a second parameter. Process block expressions sequentially (not via flatMap) to accumulate bindings. Use the existing `buildPathString` for path concatenation when resolving variables within path steps.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Silent skip for variables that can't be traced -- return no paths (consistent with Phase 1 behavior where variables return `[]`)
- Recognize JSONata built-in variables/functions ($sum, $map, $now, etc.) via a maintained list -- enables smarter handling
- Extract arguments from unknown function calls as pass-through data paths -- `$unknownFunc(a.b)` -> `["a.b"]` (over-approximation: arguments are data paths regardless)
- Over-approximate: report ALL possible paths from conditional assignments -- `$x := cond ? a.b : c.d; $x` -> `["a.b", "c.d"]`
- Merge all possible bindings when variable is assigned in multiple code paths
- Proper lexical scoping with shadowing -- inner blocks shadow outer bindings, matching JSONata's actual semantics
- No artificial depth limit on multi-hop chains -- resolve to full depth with cycle detection as safety net
- Core set for lambda-aware resolution: `$map`, `$filter`, `$reduce`, `$each` -- covers 90%+ of real-world usage
- Resolve ALL lambda parameters with known semantics -- $v = element, $i = index (non-data), $a = full array
- Pass-through extraction for non-higher-order built-ins -- `$sum(items.price)` -> `["items.price"]` without function-specific awareness
- Full closure resolution -- lambdas capture enclosing scope, outer variables used inside lambda body are resolved
- Last-write-wins for variable resolution -- `($x := a; $x := b; $x)` resolves $x to `["b"]` only
- BUT all RHS paths are extracted as data reads -- `a` WAS read from input even if $x is later reassigned, so `["a", "b"]` appear in overall output
- Scope carries across block boundaries -- `($x := a.b); $x.name` resolves to `["a.b.name"]`, matching JSONata's actual semantics

### Claude's Discretion
- Partial path handling for unresolvable variables in path context (drop vs. wildcard prefix)
- Bind operator (`~>`) variable passing -- whether to handle in Phase 2 or defer
- Exact scope tracker data structure design
- Cycle detection strategy for variable chains
- How to thread scope state through the walker (parameter, class, or other pattern)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCOPE-01 | Trace variable assignments back to source data paths (`$x := account.name` -> `account.name`) | Bind node AST shape verified; scope tracker design documented; path resolution through variable chain pattern established |
| SCOPE-02 | Track context variable binding (`@$v`) and resolve paths through them | `focus` property on NameNode verified empirically; binds variable to the array element at that path step |
| SCOPE-03 | Recognize positional variables (`#$i`) as non-data-path references | `index` property on NameNode verified empirically; these are loop counters, not data paths |
| SCOPE-04 | Track lambda/higher-order function context (`$map(items, function($v) { $v.name })` -> `items.name`) | Function+lambda AST shapes verified for $map, $filter, $reduce, $each; lambda parameter semantics documented |
| SCOPE-05 | Handle custom function calls by tracing arguments into function body definitions | Function node `procedure` points to variable name; can look up lambda in scope and bind call-site arguments to lambda parameters |
| EXPR-05 | Extract paths from function arguments (`$sum(items.price)` -> `items.price`) | Function node `arguments` array contains argument expressions; pass-through extraction walks each argument |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jsonata | 2.1.0 | AST parser (existing dependency) | Official parser, already in use |
| vitest | 4.0.18 | Test runner (existing) | Already configured, fast |
| typescript | 5.9.3 | Type system (existing) | Already configured with strict mode |

### Supporting
No new dependencies needed. Phase 2 is purely internal logic added to existing modules.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Immutable scope (new obj per level) | Mutable scope with push/pop | Immutable is simpler to reason about, no mutation bugs; mutable saves allocation but adds complexity |
| Map<string, string[]> | Class with methods | Plain Map is sufficient; class adds ceremony without benefit at this scale |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Changes to Existing Structure
```
src/
├── types.ts          # ADD: BindNode, FunctionNode, LambdaNode, ApplyNode interfaces
├── scope.ts          # NEW: ScopeTracker class (create, bind, resolve, child)
├── builtins.ts       # NEW: BUILTIN_FUNCTIONS set + HIGHER_ORDER_MAP config
├── walker.ts         # MODIFY: add scope parameter, new case handlers
├── path-builder.ts   # MODIFY: handle variable steps via scope resolution
├── index.ts          # MODIFY: initialize scope before walkNode call
└── parser.ts         # UNCHANGED
```

### Pattern 1: Immutable Scope Chain
**What:** Each block/lambda creates a child scope that inherits from parent but doesn't modify it. Variable bindings are added to the current scope level. Lookups walk up the chain.
**When to use:** Every block expression, every lambda body, every `bind` node
**Example:**
```typescript
// Scope is a linked list of Maps
interface ScopeTracker {
  readonly bindings: Map<string, string[]>;
  readonly parent: ScopeTracker | null;
}

function createScope(parent?: ScopeTracker): ScopeTracker {
  return { bindings: new Map(), parent: parent ?? null };
}

function bindVariable(scope: ScopeTracker, name: string, paths: string[]): ScopeTracker {
  // Last-write-wins: replace in current scope level
  const newBindings = new Map(scope.bindings);
  newBindings.set(name, paths);
  return { bindings: newBindings, parent: scope.parent };
}

function resolveVariable(scope: ScopeTracker, name: string): string[] | null {
  if (scope.bindings.has(name)) return scope.bindings.get(name)!;
  if (scope.parent) return resolveVariable(scope.parent, name);
  return null; // unresolvable
}
```

### Pattern 2: Sequential Block Processing
**What:** Block expressions MUST be processed sequentially (not via flatMap) because earlier expressions create bindings used by later ones. Each bind node adds to the running scope, and all RHS paths are collected as data reads.
**When to use:** Every `block` node
**Example:**
```typescript
function walkBlock(node: BlockNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];
  let currentScope = scope;

  for (const expr of node.expressions) {
    if (expr.type === "bind") {
      // 1. Walk the RHS to get data paths AND resolved paths
      const rhsPaths = walkNode(expr.rhs, currentScope);
      paths.push(...rhsPaths);  // RHS paths are always data reads

      // 2. Bind the variable name to the resolved paths
      const varName = expr.lhs.value;
      currentScope = bindVariable(currentScope, varName, rhsPaths);
    } else {
      // Normal expression: walk with current accumulated scope
      paths.push(...walkNode(expr, currentScope));
    }
  }
  return paths;
}
```

### Pattern 3: Higher-Order Function Lambda Resolution
**What:** For known higher-order built-ins ($map, $filter, $reduce, $each), bind the lambda's first parameter to the array argument's element paths, then walk the lambda body with that binding.
**When to use:** Function nodes where `procedure.value` is in the HIGHER_ORDER set and an argument is a lambda
**Example:**
```typescript
// $map(items, function($v) { $v.name })
// 1. Extract paths from first argument: ["items"]
// 2. Bind $v -> ["items"] (element of the array)
// 3. Walk lambda body with $v in scope
// 4. When body accesses $v.name, resolve to ["items.name"]

const HIGHER_ORDER_SEMANTICS: Record<string, LambdaSemantics> = {
  map:    { element: 0, index: 1, array: 2 },  // $v=element, $i=index, $a=array
  filter: { element: 0, index: 1, array: 2 },
  each:   { value: 0, key: 1 },                 // $v=value, $k=key
  reduce: { prev: 0, curr: 1 },                 // $prev=accumulator, $curr=element
};
```

### Pattern 4: Variable-in-Path Resolution
**What:** When a variable appears as a step in a path node, resolve it and prepend the resolved paths to the remaining steps. This handles `($x := account; $x.name)` -> `["account.name"]`.
**When to use:** Path nodes where a step has `type: "variable"`
**Example:**
```typescript
function walkPath(node: PathNode, scope: ScopeTracker): string[] {
  // Check if any step is a variable
  const varStepIndex = node.steps.findIndex(s => s.type === "variable");

  if (varStepIndex >= 0) {
    const varStep = node.steps[varStepIndex] as VariableNode;
    const resolved = resolveVariable(scope, varStep.value);

    if (resolved) {
      // Build suffix from remaining name steps after the variable
      const suffixSteps = node.steps.slice(varStepIndex + 1);
      const suffix = buildPathString(suffixSteps);

      // Concatenate resolved paths with suffix
      return resolved.map(p => suffix ? `${p}.${suffix}` : p);
    }
    // Unresolvable variable: drop paths (silent skip per decision)
    // But still extract paths from non-variable steps before/after
  }

  // No variable steps: original behavior
  const path = buildPathString(node.steps);
  return path ? [path] : [];
}
```

### Anti-Patterns to Avoid
- **Mutating parent scope from child:** Blocks create child scopes. The inner `($x := b)` must NOT change the outer scope's `$x`. Empirically verified: JSONata does NOT leak inner bindings to outer scope.
- **Processing block expressions with flatMap:** `flatMap(walkNode)` loses sequential binding information. Blocks MUST be processed with a for-loop to accumulate scope.
- **Resolving variables eagerly during binding:** `$b := $a.z` should resolve `$a` at the point of binding, not lazily. JSONata evaluates sequentially, so `$a` is already bound when `$b` is assigned.
- **Forgetting to collect RHS paths as data reads:** Even if `$x := a` is later overwritten, `a` was read from input and must appear in the output.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path string concatenation | Manual string joining with "." | `buildPathString()` (existing) | Already handles wildcards, descendants, edge cases |
| JSONata expression parsing | Custom tokenizer/parser | `jsonata` package `ast()` | Official parser handles all syntax edge cases |

**Key insight:** The scope tracker is genuinely novel to this project -- no existing library solves "resolve JSONata variable bindings to data paths." But the scope chain pattern itself (linked list of maps with parent lookup) is well-established in compiler/interpreter design and straightforward to implement.

## Common Pitfalls

### Pitfall 1: Block Processing Order
**What goes wrong:** Using `flatMap(walkNode)` on block expressions (as Phase 1 does) loses variable binding context. `($x := a.b; $x)` would return `["a.b"]` for the bind but `[]` for the variable reference.
**Why it happens:** Phase 1 had no scope concept, so flatMap was correct. Phase 2 requires sequential processing.
**How to avoid:** Replace the block handler with a for-loop that accumulates scope. The bind node extracts RHS paths AND adds the binding to scope before processing subsequent expressions.
**Warning signs:** Variable references returning `[]` despite having a bind in the same block.

### Pitfall 2: Inner Scope Leaking to Outer
**What goes wrong:** `($x := a; ($x := b; $x); $x)` incorrectly returns `["b"]` for the outer `$x`.
**Why it happens:** If scope is mutable and shared, the inner block's reassignment affects the outer block.
**How to avoid:** Create a child scope for each nested block. The child inherits from parent but modifications don't propagate back.
**Warning signs:** Test case `($x := a; ($x := b); $x)` returning paths from `b` instead of `a`. Empirically verified: JSONata returns `a`=1 for the outer `$x`, confirming lexical scoping with no leakage.

### Pitfall 3: Variable Steps in Multi-Variable Paths
**What goes wrong:** A path like `$prefix.$v.name` has TWO variable steps. Naive single-variable resolution misses the second.
**Why it happens:** The path builder only handles name/wildcard/descendant steps. Variables in path steps require iterative resolution.
**How to avoid:** When building paths, resolve each variable step to its bound paths, then compute the cross-product (or flat concatenation) with remaining steps.
**Warning signs:** Paths with multiple variables producing incorrect or partial results.

### Pitfall 4: Forgetting apply (~>) Injects First Argument
**What goes wrong:** `items ~> $map(function($v) { $v.name })` is equivalent to `$map(items, function($v) { $v.name })`. If the apply operator is treated as just "walk both sides," the lambda parameter resolution won't fire.
**Why it happens:** The `apply` node's `lhs` becomes the first argument to the function on the `rhs`.
**How to avoid:** When handling an `apply` node, prepend `lhs` to the function's `arguments` array before processing.
**Warning signs:** Apply-chained expressions missing paths that the non-apply equivalent extracts correctly.

### Pitfall 5: Cycle in Variable Resolution
**What goes wrong:** `($x := $x.y; $x)` or `($a := $b; $b := $a; $a)` causes infinite recursion.
**Why it happens:** Variable resolution follows chains without cycle detection.
**How to avoid:** Track a "resolution stack" (Set of variable names currently being resolved). If a name appears while already being resolved, return `[]` (unresolvable).
**Warning signs:** Stack overflow errors during variable resolution.

### Pitfall 6: Lambda Parameter Shadowing Built-in Detection
**What goes wrong:** A lambda parameter named `$sum` (unusual but legal) shadows the built-in. If the built-in check runs before scope lookup, the parameter's binding is ignored.
**Why it happens:** Checking "is this a built-in?" before "is this in scope?" inverts the correct priority.
**How to avoid:** Always check scope first, then fall back to built-in detection. Scope bindings shadow built-ins.
**Warning signs:** Lambda parameters that happen to share built-in names not resolving correctly.

## Code Examples

### AST Node Shapes (Verified Empirically)

#### Bind Node: `($x := account.name; $x)`
```typescript
// In block.expressions[0]:
{
  type: "bind",
  value: ":=",
  position: 6,
  lhs: { type: "variable", value: "x", position: 3 },       // variable name (without $)
  rhs: { type: "path", steps: [/* name nodes */] }           // any expression
}
```

#### Function Node: `$sum(items.price)`
```typescript
{
  type: "function",
  value: "(",
  position: 5,
  procedure: { type: "variable", value: "sum", position: 4 },  // function name (without $)
  arguments: [
    { type: "path", steps: [/* items, price */] }               // argument expressions
  ]
}
```

#### Lambda Node: `function($v, $i) { $v.name }`
```typescript
{
  type: "lambda",
  arguments: [
    { type: "variable", value: "v", position: 23 },   // parameter names (without $)
    { type: "variable", value: "i", position: 27 }
  ],
  position: 21,
  body: { type: "path", steps: [/* $v, name */] }     // body expression
}
```

#### Apply Node: `items ~> $sum()`
```typescript
{
  type: "apply",
  value: "~>",
  position: 8,
  lhs: { type: "path", steps: [/* items */] },        // input expression
  rhs: {                                                // function call
    type: "function",
    procedure: { value: "sum", type: "variable" },
    arguments: []                                       // lhs is implicitly prepended
  }
}
```

#### Context Binding: `items@$v` (focus property on NameNode)
```typescript
{
  type: "path",
  steps: [{
    type: "name",
    value: "items",
    position: 5,
    focus: "v",      // <-- context variable name (without $)
    tuple: true
  }]
}
```

#### Positional Variable: `items#$i` (index property on NameNode)
```typescript
{
  type: "path",
  steps: [{
    type: "name",
    value: "items",
    position: 5,
    index: "i",      // <-- positional variable name (without $)
    tuple: true
  }]
}
```

### Type Definitions Needed

```typescript
// New typed nodes for Phase 2 (currently fall through to GenericNode)
interface BindNode {
  type: "bind";
  value: ":=";
  position: number;
  lhs: VariableNode;   // the variable being assigned
  rhs: AstNode;        // the value expression
}

interface FunctionNode {
  type: "function";
  value: "(";
  position: number;
  procedure: VariableNode;  // function name
  arguments: AstNode[];     // call arguments
}

interface LambdaNode {
  type: "lambda";
  arguments: VariableNode[];  // parameter names
  position: number;
  body: AstNode;              // lambda body expression
  signature?: { definition: string };  // optional type signature
}

interface ApplyNode {
  type: "apply";
  value: "~>";
  position: number;
  lhs: AstNode;   // input (becomes first argument)
  rhs: AstNode;   // function call (typically FunctionNode)
}
```

### NameNode Extension for Context/Positional Variables
```typescript
// Existing NameNode already has optional properties, but needs:
interface NameNode {
  type: "name";
  value: string;
  position: number;
  stages?: AstNode[];    // existing (Phase 3)
  keepArray?: boolean;   // existing
  tuple?: boolean;       // existing
  focus?: string;        // NEW: context variable name from @$v (without $)
  index?: string;        // NEW: positional variable name from #$i (without $)
}
```

### Built-in Functions List (59 verified)
```typescript
const BUILTIN_FUNCTIONS = new Set([
  // Aggregation
  "sum", "count", "max", "min", "average",
  // String
  "string", "length", "substring", "substringBefore", "substringAfter",
  "uppercase", "lowercase", "trim", "pad", "contains", "split", "join",
  "match", "replace",
  // Numeric
  "number", "floor", "ceil", "round", "power", "sqrt", "random",
  // Boolean
  "boolean", "not", "exists",
  // Array
  "append", "sort", "reverse", "shuffle", "distinct", "zip",
  // Object
  "keys", "values", "spread", "merge", "each", "error",
  // Type
  "type", "clone",
  // Higher-order
  "map", "filter", "reduce", "sift", "lookup",
  // Date/Time
  "now", "millis", "fromMillis", "toMillis",
  // Encoding
  "base64encode", "base64decode",
  "encodeUrlComponent", "encodeUrl", "decodeUrlComponent", "decodeUrl",
  // Other
  "assert",
]);
```

### Higher-Order Function Semantics (Verified)
```typescript
// Maps function name -> parameter semantics
// Each key is a parameter position index, value is the semantic role
const HIGHER_ORDER_SEMANTICS = {
  map:    { 0: "element", 1: "index", 2: "array" },
  filter: { 0: "element", 1: "index", 2: "array" },
  each:   { 0: "value", 1: "key" },
  reduce: { 0: "accumulator", 1: "element", 2: "array" },
  sift:   { 0: "value", 1: "key" },
  sort:   { 0: "left", 1: "right" },  // comparator lambda
} as const;

// For path resolution:
// - "element"/"value"/"left"/"right"/"curr" -> bound to first function argument's paths
// - "index"/"key" -> non-data-path (skip, like positional variables)
// - "array"/"accumulator" -> bound to first function argument's paths (full array)
```

### Scoping Semantics (Empirically Verified)

| Scenario | Expression | Result | Verified |
|----------|-----------|--------|----------|
| Inner block does NOT leak | `($x := a; ($x := b); $x)` | outer `$x` = `a` | YES (returns 1 with {a:1,b:2}) |
| Reassignment overwrites | `($x := a; $x := b; $x)` | `$x` = `b` | YES (returns 2) |
| Multi-hop chain | `($a := x.y; $b := $a.z; $b)` | `$b` = `x.y.z` | YES (returns 42) |
| Variable in path context | `($x := account; $x.name)` | resolves to `account.name` | YES (returns "test") |
| Context binding @$v | `items@$v` | `focus: "v"` property on step | YES (AST verified) |
| Positional variable #$i | `items#$i` | `index: "i"` property on step | YES (AST verified) |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stateless walker (Phase 1) | Scope-threaded walker (Phase 2) | This phase | Variables become resolvable; function args become extractable |
| GenericNode catch-all for bind/function/lambda | Typed nodes with explicit interfaces | This phase | Type-safe handling of all scope-related nodes |
| flatMap for block expressions | Sequential for-loop with scope accumulation | This phase | Bindings propagate correctly within blocks |

## Open Questions

1. **Partial path handling for unresolvable variables in path context**
   - What we know: `($x := ???; $x.name)` where `$x` is unresolvable. User marked as Claude's discretion.
   - Options: (a) Drop the entire path (silent skip), (b) Emit `.name` alone (suffix only), (c) Emit `*.name` (wildcard prefix)
   - Recommendation: **Drop the entire path** (option a). Consistent with the "silent skip for unresolvable" decision. A partial path like `*.name` could match too broadly and is misleading. The suffix `.name` alone loses context. Dropping is the safest over-approximation-compatible choice (we're not claiming a path exists when we can't verify it).

2. **Apply operator (~>) handling**
   - What we know: `apply` node is structurally simple (lhs + rhs). The lhs becomes the first argument to the function on rhs. User marked as Claude's discretion.
   - Recommendation: **Handle in Phase 2.** The apply operator is common in real-world JSONata (`items ~> $map(...)` is idiomatic). The implementation is straightforward: prepend `lhs` to `rhs.arguments` and process as a normal function call. Deferring would leave a common pattern broken.

3. **Scope tracker threading approach**
   - What we know: Current `walkNode(node: AstNode): string[]` has no scope parameter. Adding scope changes the signature.
   - Recommendation: Add `scope` as an optional second parameter with a default empty scope: `walkNode(node: AstNode, scope: ScopeTracker = emptyScope): string[]`. This preserves backward compatibility (callers without scope still work) while enabling scope threading internally. The `extractPaths` entry point initializes the root scope.

4. **Cycle detection strategy**
   - What we know: `($x := $x.y; $x)` or `($a := $b; $b := $a; $a)` could cause infinite loops.
   - Recommendation: Pass a `Set<string>` of "currently resolving" variable names through the resolution chain. If a name is already in the set, return `[]` (unresolvable). This is O(1) per check and prevents infinite recursion without artificial depth limits.

## Sources

### Primary (HIGH confidence)
- JSONata parser AST output -- empirically verified by running `jsonata(expr).ast()` for all relevant node types (bind, function, lambda, apply, context binding, positional variable)
- JSONata runtime scoping semantics -- empirically verified by evaluating expressions with `jsonata(expr).evaluate(data)` for shadowing, reassignment, multi-hop chains, and scope isolation
- Existing codebase (`src/types.ts`, `src/walker.ts`, `src/path-builder.ts`, `src/index.ts`) -- read and analyzed
- JSONata built-in function list -- verified by parsing `$fn(x)` for 59 function names

### Secondary (MEDIUM confidence)
- Higher-order function parameter semantics -- derived from JSONata documentation patterns and AST structure analysis. The exact parameter meanings ($v=element, $i=index, $a=array for $map) are from JSONata language specification.

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all existing
- Architecture: HIGH - AST shapes empirically verified, scoping semantics tested at runtime, patterns are well-established compiler techniques
- Pitfalls: HIGH - each pitfall derives from verified AST behavior or empirically tested scoping semantics

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable domain, no external dependencies changing)
