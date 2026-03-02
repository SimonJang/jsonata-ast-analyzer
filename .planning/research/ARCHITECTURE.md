# Architecture Patterns

**Domain:** Static analysis tool for JSONata expression ASTs
**Researched:** 2026-03-02

## Recommended Architecture

The system follows a classic **compiler front-end analysis pipeline**: parse, walk, collect, resolve, output. The JSONata parser is external (the official `jsonata` npm package), so this project starts at the "walk" stage and focuses on semantic analysis of the AST to extract data paths.

```
                    +-------------------+
                    |  JSONata Parser   |  (external: jsonata npm)
                    |  jsonata(expr)    |
                    +--------+----------+
                             |
                             | ExprNode (AST root)
                             v
                    +-------------------+
                    |  AST Walker       |  (recursive dispatch)
                    |  visitNode()      |
                    +--------+----------+
                             |
                      +------+------+
                      |             |
                      v             v
              +-----------+  +-----------+
              |  Scope    |  |   Path    |
              |  Tracker  |  | Collector |
              +-----------+  +-----------+
                      |             |
                      +------+------+
                             |
                             v
                    +-------------------+
                    |  Path Resolver    |
                    |  (post-walk)      |
                    +--------+----------+
                             |
                             v
                    +-------------------+
                    |  Output / API     |
                    +-------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Parser Adapter** | Calls `jsonata(expr).ast()` to get the AST root. Handles parse errors. Thin wrapper. | AST Walker (provides ExprNode) |
| **AST Walker** | Recursive descent through every node. Dispatches to type-specific handlers via `switch(node.type)`. Manages enter/leave lifecycle. | Scope Tracker (push/pop scopes), Path Collector (emit path segments) |
| **Scope Tracker** | Maintains a stack of variable bindings. Maps `$varName` to the AST subtree (and resolved path) it was bound to. Handles block scoping and lambda closures. | AST Walker (receives bind events), Path Resolver (provides variable-to-path mappings) |
| **Path Collector** | Accumulates raw path segments as the walker traverses `path` and `name` nodes. Handles wildcards, descendants, and filter predicates. Produces unresolved path entries. | AST Walker (receives path events), Path Resolver (provides raw paths for resolution) |
| **Path Resolver** | Post-walk pass that resolves variable references in collected paths to their bound data paths. Expands `$var.field` into the actual data path. Marks unresolvable dynamic paths with wildcards. | Scope Tracker (reads bindings), Path Collector (reads raw paths), Output (produces final paths) |
| **Output / API** | Exposes `extractPaths(expression: string): PathResult[]` as the public API. Also powers the CLI. | Parser Adapter (entry point), Path Resolver (final results) |

### Data Flow

**Phase 1: Parse**
```
JSONata expression string
  --> jsonata(expr).ast()
  --> ExprNode tree (the AST)
```
The official JSONata parser is used as-is. The `ast()` method on the expression object returns the root `ExprNode`. The parser is also available as `jsonata.parser` for direct access. **Confidence: HIGH** (verified in jsonata source: `jsonata.parser = parser` and `ast: function() { return ast; }`).

**Phase 2: Walk + Collect**
```
ExprNode (root)
  --> Walker recurses through node.type dispatch
  --> For 'path' nodes: iterate node.steps, accumulate segments
  --> For 'name' nodes within paths: emit path segment
  --> For 'bind' nodes: register $var = <rhs subtree> in Scope Tracker
  --> For 'variable' nodes: look up in Scope Tracker, record reference
  --> For 'filter' nodes (type 'binary' with value '['): recurse into predicate, paths found are also data reads
  --> For 'function' nodes: recurse into arguments (they may contain paths)
  --> For 'lambda' nodes: push new scope frame, recurse body, pop scope
  --> For 'block' nodes: push new scope frame, process expressions sequentially, pop scope
  --> For 'sort' nodes: recurse into sort terms (they reference data paths)
  --> For 'condition' nodes: recurse into condition, then, else branches
  --> For 'wildcard' nodes: emit wildcard segment
  --> For 'descendant' nodes: emit recursive descent marker
  --> For 'parent' nodes: emit parent traversal marker
```

**Phase 3: Resolve**
```
Raw paths + variable bindings
  --> Replace $variable references with their bound paths
  --> Mark dynamic/computed paths with [*] wildcard
  --> Deduplicate and normalize
  --> Return PathResult[]
```

## JSONata AST Node Types Reference

The `ExprNode.type` discriminant has these values (**Confidence: HIGH** -- verified from official `jsonata.d.ts`):

| Type | Key Properties | Path Relevance |
|------|---------------|----------------|
| `path` | `steps: ExprNode[]` | PRIMARY -- represents a data access path like `a.b.c` |
| `name` | `value: string` | A single field name; usually a step within a `path` |
| `string` | `value: string` | Literal value, not a data path |
| `number` | `value: number` | Literal value, not a data path |
| `value` | `value: any` | Boolean/null literal, not a data path |
| `binary` | `value: string (operator), lhs, rhs` | The `.` (map) and `[` (filter) operators create paths; `:=` creates bindings |
| `unary` | `value: string, expression/expressions` | Array `[` and object `{` constructors; recurse into contents |
| `block` | `expressions: ExprNode[]` | Creates a scope boundary; evaluate expressions sequentially |
| `bind` | `lhs, rhs` | Variable binding; lhs is variable name, rhs is bound expression |
| `lambda` | `arguments: ExprNode[], body: ExprNode` | Creates closure scope; parameters shadow outer variables |
| `function` | `procedure: ExprNode, arguments: ExprNode[]` | Function call; recurse into arguments for path extraction |
| `partial` | `procedure, arguments` | Partial application; treat like function |
| `variable` | `value: string` | Variable reference; resolve via Scope Tracker |
| `condition` | `condition, then, else` | Conditional; recurse all three branches |
| `transform` | `pattern, update, delete` | Transform expression; pattern and update contain paths |
| `wildcard` | (none) | Wildcard `*` -- emit wildcard segment |
| `descendant` | (none) | Recursive descent `**` -- emit recursive marker |
| `parent` | `slot: {label, level}` | Parent operator `%` -- emit parent traversal |
| `regexp` | `value` | Regular expression literal, not a data path |
| `operator` | `value` | Operator token, not directly path-relevant |
| `error` | `error` | Parse error node |

**Critical note on `path` nodes:** The JSONata parser pre-composes path expressions. An expression like `account.order.product` becomes a single `path` node with `steps: [{type:'name',value:'account'}, {type:'name',value:'order'}, {type:'name',value:'product'}]`. The walker does NOT need to manually join `.`-separated names -- the parser has already done this. This is a major simplification.

**Critical note on filters:** A filter like `items[price > 10]` produces a `path` node where one of the steps contains filter/predicate information. The predicate expression `price > 10` references the field `price`, which must be collected as a read path under the `items` context.

## Patterns to Follow

### Pattern 1: Exhaustive Switch Dispatch on `node.type`

**What:** Use TypeScript's discriminated union on `ExprNode.type` with a `switch` statement that handles every case. Add a `default: never` check for exhaustiveness.

**Why:** The JSONata AST has exactly 20 node types (verified from `jsonata.d.ts`). A switch is cleaner than a visitor class hierarchy for this size. TypeScript's exhaustiveness checking catches missing handlers at compile time.

**When:** In the core `visitNode()` function of the AST Walker.

**Example:**
```typescript
interface ExprNode {
  type: 'path' | 'name' | 'binary' | 'unary' | 'block' | 'bind' |
        'lambda' | 'function' | 'partial' | 'variable' | 'condition' |
        'transform' | 'wildcard' | 'descendant' | 'parent' |
        'string' | 'number' | 'value' | 'regexp' | 'operator' | 'error';
  // ... other properties
}

function visitNode(node: ExprNode, ctx: WalkContext): void {
  switch (node.type) {
    case 'path':
      return visitPath(node, ctx);
    case 'name':
      return visitName(node, ctx);
    case 'binary':
      return visitBinary(node, ctx);
    case 'bind':
      return visitBind(node, ctx);
    case 'variable':
      return visitVariable(node, ctx);
    case 'block':
      return visitBlock(node, ctx);
    case 'lambda':
      return visitLambda(node, ctx);
    case 'function':
      return visitFunction(node, ctx);
    case 'condition':
      return visitCondition(node, ctx);
    case 'transform':
      return visitTransform(node, ctx);
    case 'unary':
      return visitUnary(node, ctx);
    case 'wildcard':
      return visitWildcard(node, ctx);
    case 'descendant':
      return visitDescendant(node, ctx);
    case 'parent':
      return visitParent(node, ctx);
    case 'partial':
      return visitPartial(node, ctx);
    // Literal/terminal nodes -- no paths to extract
    case 'string':
    case 'number':
    case 'value':
    case 'regexp':
    case 'operator':
    case 'error':
      return; // no-op for path extraction
    default:
      const _exhaustive: never = node.type;
      throw new Error(`Unknown node type: ${_exhaustive}`);
  }
}
```

**Confidence: HIGH** -- discriminated union exhaustive switch is a well-established TypeScript pattern, and the node type list is verified from the official type definitions.

### Pattern 2: Scope Stack with Block Boundaries

**What:** Maintain a stack of `Map<string, PathExpression[]>` objects. Push a new frame when entering a `block` or `lambda` node. Pop when leaving. Variable lookups walk the stack from top to bottom (lexical scoping).

**Why:** JSONata uses block-level lexical scoping. Variables bound with `:=` inside parentheses are scoped to that block and nested blocks. Lambda functions capture their defining environment (closures). This mirrors how JSONata actually evaluates.

**When:** In the Scope Tracker component.

**Example:**
```typescript
class ScopeTracker {
  private stack: Map<string, ResolvedPath[]>[] = [new Map()];

  pushScope(): void {
    this.stack.push(new Map());
  }

  popScope(): void {
    this.stack.pop();
  }

  bind(varName: string, paths: ResolvedPath[]): void {
    this.currentScope().set(varName, paths);
  }

  resolve(varName: string): ResolvedPath[] | undefined {
    // Walk stack top-to-bottom (innermost scope first)
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const binding = this.stack[i].get(varName);
      if (binding !== undefined) return binding;
    }
    return undefined; // unbound variable (likely built-in like $sum)
  }

  private currentScope(): Map<string, ResolvedPath[]> {
    return this.stack[this.stack.length - 1];
  }
}
```

**Confidence: HIGH** -- JSONata scoping rules are documented: "The scope of a variable is limited to the 'block' in which it was bound" and lambdas capture their defining environment via "a snapshot of the environment."

### Pattern 3: Path Context Stack

**What:** Maintain a context stack that tracks the current "prefix" path as the walker descends into nested expressions. When processing `account.order.items[price > 10]`, the predicate `price > 10` is evaluated in the context of each `items` element, so `price` becomes `account.order.items.price`.

**Why:** JSONata's map operator (`.`) changes the context for the right-hand side. Filter predicates evaluate against each element of the filtered array. Without context tracking, you lose the full path prefix.

**When:** When entering `path` node steps and filter predicates.

**Example:**
```typescript
interface WalkContext {
  scopeTracker: ScopeTracker;
  pathCollector: PathCollector;
  contextPath: string[];  // current prefix stack
}

function visitPath(node: ExprNode, ctx: WalkContext): void {
  const savedContext = [...ctx.contextPath];

  for (const step of node.steps ?? []) {
    if (step.type === 'name') {
      ctx.contextPath.push(step.value);
    } else if (step.type === 'wildcard') {
      ctx.contextPath.push('*');
    } else if (step.type === 'descendant') {
      ctx.contextPath.push('**');
    } else {
      // Filter, sort, or other step modifiers
      // Process with current context as prefix
      visitNode(step, ctx);
    }
  }

  // Emit the complete path
  ctx.pathCollector.addPath([...ctx.contextPath]);

  // Restore context
  ctx.contextPath = savedContext;
}
```

### Pattern 4: Two-Pass Architecture (Walk then Resolve)

**What:** Separate AST walking (collecting raw paths and variable bindings) from path resolution (substituting variable references with actual paths). The first pass builds up the raw data; the second pass resolves it.

**Why:** Variable bindings may be forward-referenced within a block (all bindings in a block are visible throughout it in some expression languages), or a variable may be bound in an outer scope and referenced deep in a nested expression. Doing resolution in a separate pass avoids ordering issues and keeps the walker focused on structural traversal.

**When:** After the walker completes, run the resolver.

**Confidence: MEDIUM** -- This is a standard compiler analysis pattern. JSONata's actual scoping is sequential within blocks (later bindings aren't visible to earlier expressions), so a single-pass approach could also work for most cases. However, the two-pass approach is more robust for complex variable chains like `$a := foo; $b := $a.bar; $b.baz`.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Evaluating Expressions to Find Paths

**What:** Running the JSONata expression against sample data and observing which paths are accessed at runtime.
**Why bad:** Misses conditional branches not taken, doesn't work without representative data, gives incomplete results for complex expressions. The whole point of this tool is STATIC analysis -- no runtime evaluation.
**Instead:** Walk the AST and collect all paths from all branches (condition, then, else all contribute paths).

### Anti-Pattern 2: String-Based Path Extraction

**What:** Using regex or string parsing on the JSONata expression text to extract paths.
**Why bad:** JSONata has complex operator precedence, nested expressions, string literals that look like paths, and function calls that contain path arguments. String parsing cannot handle these reliably.
**Instead:** Use the official parser's AST, which has already resolved precedence, nesting, and tokenization.

### Anti-Pattern 3: Monolithic Handler Function

**What:** One giant function with a massive switch statement that handles walking, scope tracking, and path collection all inline.
**Why bad:** Becomes unmanageable as JSONata node type handling grows complex. Impossible to test scope tracking independently from path collection.
**Instead:** Separate into distinct components (Walker, ScopeTracker, PathCollector) that communicate through well-defined interfaces.

### Anti-Pattern 4: Treating the AST Like a Simple Tree

**What:** Assuming a generic tree walker (visit all children) is sufficient.
**Why bad:** JSONata AST nodes have semantically different child relationships. A `binary` node's `lhs` and `rhs` have different meanings depending on the operator (`[` means filter, `.` means map, `:=` means bind). A generic "visit all children" walker would miss the semantic context needed for correct path extraction.
**Instead:** Each node type handler must understand the semantics of its children and process them accordingly.

### Anti-Pattern 5: Ignoring Built-in Function Side Effects on Paths

**What:** Not recursing into function arguments for path extraction.
**Why bad:** Functions like `$sum(orders.total)` access the path `orders.total`. If you skip function arguments, you miss data paths. Even custom functions may receive paths as arguments.
**Instead:** Always recurse into all function arguments. The function name itself is not a data path (it's a variable referencing a function), but its arguments may contain paths.

## Build Order (Dependency Chain)

The components have clear dependencies that dictate build order:

```
1. Parser Adapter     (no internal dependencies)
   |
2. AST Type Defs      (no internal dependencies, can parallel with 1)
   |
3. Scope Tracker      (depends on type defs)
   |
4. Path Collector     (depends on type defs)
   |
5. AST Walker         (depends on Scope Tracker + Path Collector + Type Defs)
   |
6. Path Resolver      (depends on Scope Tracker output + Path Collector output)
   |
7. Public API / CLI   (depends on everything above)
```

**Build phase rationale:**

1. **Parser Adapter + AST Type Defs (Phase 1):** Start here because everything else depends on having proper TypeScript types for the AST nodes and a way to produce them. This also serves as validation that `jsonata(expr).ast()` works as expected and the types match reality.

2. **Scope Tracker + Path Collector (Phase 2):** These are independent of each other and can be built in parallel. Each has a focused responsibility and clear unit-test surface. Build them before the walker so the walker has components to delegate to.

3. **AST Walker -- Basic Paths (Phase 3):** Handle the straightforward node types first: `path`, `name`, `string`, `number`, `value`, `wildcard`, `descendant`. This covers simple expressions like `account.order.product` without variable binding or complex operators.

4. **AST Walker -- Variables and Scoping (Phase 4):** Add handling for `bind`, `variable`, `block`, `lambda`. This requires the Scope Tracker and covers expressions with variable assignments.

5. **AST Walker -- Complex Operators (Phase 5):** Handle `binary` (especially filter `[`, sort `^`, apply `~>`), `function`, `partial`, `condition`, `transform`, `unary`, `parent`. These are the most complex handlers.

6. **Path Resolver (Phase 6):** With all raw paths and bindings collected, build the resolver that produces final output.

7. **Public API + CLI (Phase 7):** Wrap everything in a clean API and add CLI support.

## Scalability Considerations

This is a developer tool / build-time analysis tool, not a production service handling user traffic. "Scale" here means handling large/complex JSONata expressions and large numbers of expressions.

| Concern | Small (1-10 expressions) | Medium (100s of expressions) | Large (1000s of expressions) |
|---------|--------------------------|------------------------------|------------------------------|
| Parse time | Negligible | Negligible (parser is fast) | Batch with async/workers if needed |
| AST walk time | Negligible | Negligible (trees are small) | Still negligible -- ASTs rarely exceed hundreds of nodes |
| Memory | Negligible | Negligible | Stream expressions, don't hold all ASTs in memory |
| Variable resolution | Simple | Could have deep chains | Cycle detection needed for `$a := $b; $b := $a` |
| Output size | Handful of paths | Hundreds of paths | Deduplicate and normalize aggressively |

The primary scalability concern is **expression complexity** (deeply nested, many variables) rather than expression count. A single pathological expression with deeply chained variable bindings could cause quadratic resolution time if not handled carefully. Use memoization in the resolver for repeated variable lookups.

## Sources

- JSONata official documentation: [Path Operators](https://docs.jsonata.org/path-operators), [Programming Constructs](https://docs.jsonata.org/programming), [Processing Model](https://docs.jsonata.org/processing), [Embedding and Extending](https://docs.jsonata.org/embedding-extending), [Other Operators](https://docs.jsonata.org/other-operators) -- HIGH confidence
- JSONata GitHub source (`jsonata.js`, `parser.js`): [jsonata-js/jsonata](https://github.com/jsonata-js/jsonata) -- HIGH confidence (verified parser API and AST node structure from raw source)
- JSONata TypeScript definitions (`jsonata.d.ts`): ExprNode type union verified -- HIGH confidence
- JSONata issue #206 on path extraction: [github.com/jsonata-js/jsonata/issues/206](https://github.com/jsonata-js/jsonata/issues/206) -- confirms no built-in path extraction exists
- AST Walker Scope pattern: [sxzz/ast-walker-scope](https://github.com/sxzz/ast-walker-scope) -- MEDIUM confidence (JavaScript/Babel-specific, adapted for JSONata)
- ESLint architecture (visitor pattern reference): [ESLint Custom Rules](https://eslint.org/docs/latest/extend/custom-rules) -- MEDIUM confidence (pattern reference, not directly applicable)
- Discriminated unions for exhaustive AST handling: [FullStory blog](https://www.fullstory.com/blog/discriminated-unions-and-exhaustiveness-checking-in-typescript/) -- HIGH confidence (standard TypeScript pattern)
- Stedi prettier-plugin-jsonata (prior art for JSONata AST walking): [GitHub](https://github.com/Stedi/prettier-plugin-jsonata) -- MEDIUM confidence (confirms approach but couldn't inspect source directly)
