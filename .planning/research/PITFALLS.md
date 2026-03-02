# Pitfalls Research

**Domain:** Static path extraction from JSONata expression ASTs
**Researched:** 2026-03-02
**Confidence:** HIGH (based on official JSONata docs, parser source code analysis, GitHub issues, and AST type definitions)

## Critical Pitfalls

### Pitfall 1: Incomplete AST Node Type Coverage

**What goes wrong:**
The walker handles the "obvious" node types (path, name, binary, variable) but silently ignores node types it does not recognize. Paths accessed through unhandled node types (transform, sort, condition, partial, apply, parent, descendant) are never reported. The tool claims "these are all the paths" but the list is incomplete -- an under-approximation that causes exactly the data refactoring breakage this tool exists to prevent.

**Why it happens:**
The JSONata parser produces at least 20+ distinct node types: `binary`, `unary`, `function`, `partial`, `lambda`, `condition`, `transform`, `block`, `name`, `parent`, `string`, `number`, `value`, `wildcard`, `descendant`, `variable`, `regexp`, `operator`, `error`, `path`, `filter`, `sort`, `bind`, `apply`. But the official TypeScript `ExprNode` type union is incomplete -- it lists only: `"binary" | "unary" | "function" | "partial" | "lambda" | "condition" | "transform" | "block" | "name" | "parent" | "string" | "number" | "value" | "wildcard" | "descendant" | "variable" | "regexp" | "operator" | "error"`. Missing from the union: `path`, `filter`, `sort`, `bind`, `apply`. Developers who code against the TypeScript types will miss these node types entirely. Additionally, the parser produces post-processing node types like `stages`, `group`, and `index` that are not in the type union at all.

**How to avoid:**
- Do NOT rely on the `ExprNode` type union as a source of truth. Instead, analyze the actual parser source (`src/parser.js`) to enumerate all node types.
- Build a comprehensive test suite that parses real JSONata expressions and asserts every node type in the resulting AST is handled.
- Implement an "unknown node type" handler that throws/warns loudly rather than silently skipping. Every node type must either be explicitly handled or explicitly marked as "no paths to extract here."
- Use a discriminated union with exhaustive checking in TypeScript (a `never` default case in a switch on node type).

**Warning signs:**
- Simple expressions work but complex ones miss paths.
- No test cases for transform (`|...|...|`), sort (`^(...)`), conditional (`? :`), or parent (`%`) operators.
- The switch/if-else chain for node types does not have a default/else case that errors.

**Phase to address:**
Phase 1 (Core AST Walker). The walker must be designed from day one with exhaustive node type handling. Retrofitting this later means rewriting the core dispatch logic.

---

### Pitfall 2: Undocumented AST Properties and Hidden Path-Bearing Fields

**What goes wrong:**
AST nodes carry paths in properties that are not obvious from the `ExprNode` TypeScript interface. The interface exposes `lhs`, `rhs`, `steps`, `expressions`, `stages`, `arguments`, `procedure`, `name`, and `value` -- all optional. But the actual parser output includes additional properties like `predicate`, `group`, `condition`, `then`, `else`, `body`, `update`, `delete`, `pattern`, `focus`, `index`, `tuple`, and boolean flags like `keepArray`/`keepSingletonArray`/`sequence`. Failing to traverse these properties means missing paths hidden inside filter predicates, sort expressions, grouping keys, conditional branches, and transform update/delete clauses.

**Why it happens:**
The JSONata AST is an internal implementation detail of the parser, not a documented public API. The TypeScript definitions are a convenience layer that does not exhaustively describe every property the parser attaches to nodes. The Go implementation of JSONata reveals additional fields including `Stages`, `Terms`, `Group`, `Predicate`, `Focus`, `Index`, `Pattern`, `Update`, `Delete`, `Condition`, `Then`, `Else`, `Body` -- many of which are path-bearing.

**How to avoid:**
- In Phase 1, write a "discovery harness" that parses a large corpus of JSONata expressions and logs every property found on every node, compared against what is expected. This empirically discovers the real AST shape.
- For each node type, document which properties can contain child nodes (and thus paths). Build a property-to-child-nodes map.
- Write tests that specifically assert paths are extracted from: filter predicates, sort expressions, grouping keys, conditional then/else branches, transform update/delete clauses, lambda bodies, and block expressions.
- Extend or replace the `ExprNode` type with a comprehensive discriminated union that accurately models the parser output.

**Warning signs:**
- Paths inside `[predicate]` expressions are not extracted.
- Paths in `^(sort_expr)` sort clauses are not found.
- Paths in `{group_key: aggregate}` reduce expressions are not found.
- Conditional branches (`condition ? then_path : else_path`) only extract paths from one branch.

**Phase to address:**
Phase 1 (Core AST Walker). Must be addressed before any node-type-specific handling is built, because the traversal infrastructure needs to know which properties to recurse into.

---

### Pitfall 3: Variable Binding Scope Resolution Errors

**What goes wrong:**
JSONata variables (`$var := expr`) are aliases to data paths. The expression `($x := account.name; $x)` accesses `account.name`, but a naive walker that does not trace variable bindings will report `$x` as the path instead of `account.name`. Worse, JSONata has lexical scoping with closures: variables bound inside blocks go out of scope at the end of the block, lambda definitions capture their enclosing scope, and the `@` and `#` operators bind context/position variables that go out of scope at the end of the path expression. Getting scope wrong means either missing paths (variable resolves to nothing) or reporting phantom paths (variable resolves to the wrong binding).

**Why it happens:**
JSONata's scoping rules are non-trivial:
- Block expressions `(...)` create scope frames.
- Variable bindings (`:=`) are scoped to their containing block and nested blocks.
- Lambda definitions capture a snapshot of the environment (closures).
- `@` (context binding) and `#` (positional binding) create variables scoped to the remainder of the current path expression only.
- The reduce operator `{...}` terminates the current path expression, making prior `@`/`#` bindings inaccessible.

Static analysis must model these scope rules without executing the expression. Incorrect scope modeling is the single most likely source of subtle, hard-to-detect bugs.

**How to avoid:**
- Build an explicit scope model: a stack of scope frames, each containing variable-to-path mappings. Push frames on block/lambda entry, pop on exit.
- For `@` and `#` bindings, track that their scope is the remainder of the path expression, not the containing block.
- For lambda closures, capture the scope at definition time, not invocation time.
- For `:=` bindings, resolve the RHS path in the current scope before adding the variable to the scope.
- Write dedicated test cases for: nested blocks with shadowed variables, lambdas that close over outer variables, `@`/`#` bindings used in subsequent filter predicates, and the reduce operator terminating scope.

**Warning signs:**
- Variables resolve to `undefined` instead of their bound path.
- Inner block variable shadows are not detected (inner `$x` masks outer `$x`).
- Lambda bodies report paths relative to their call site rather than their definition site.
- `@`/`#` variables are accessible after the path expression ends.

**Phase to address:**
Phase 2 (Variable Tracing). This is the second-hardest problem after getting the basic walker right. Must be a dedicated phase because scope modeling requires careful design.

---

### Pitfall 4: Over-Approximation vs. Under-Approximation Strategy Not Decided Up Front

**What goes wrong:**
When static analysis cannot determine the exact set of paths (e.g., computed property names, `$eval`, higher-order functions), the tool must choose: report more paths than are actually accessed (over-approximation/safe for refactoring) or fewer paths (under-approximation/precise but risky). Without a deliberate, consistent strategy, some code paths over-approximate while others under-approximate, making the tool's guarantees meaningless. Users cannot trust it for safe refactoring (needs over-approximation) or for fetch optimization (benefits from precision).

**Why it happens:**
Different language features push toward different strategies:
- Computed property names (`obj[variable]`) -- cannot statically resolve, must approximate.
- `$eval(string_expr)` -- dynamically evaluates an expression, completely opaque to static analysis.
- Higher-order functions (`$map`, `$filter`, `$reduce`, `$each`) -- callback functions access data, but the specific paths depend on what collection is passed.
- `**` (recursive descent) -- matches all descendants, inherently imprecise about which specific paths.
- Custom registered functions -- opaque to static analysis; may access any path.

**How to avoid:**
- Decide the strategy in Phase 1 and document it: this tool should OVER-APPROXIMATE (report a superset of actual paths). This is the correct choice for the stated use cases (safe refactoring, fetch optimization). Missing a path is worse than reporting an extra one.
- For computed property names: use wildcard (`obj[*]`) as the project already plans.
- For `$eval`: report the entire input as potentially accessed (or flag as "cannot analyze").
- For `**`: report a wildcard descendant marker rather than trying to enumerate specific paths.
- For higher-order functions: trace the callback body and combine with the collection's known paths.
- For custom functions: flag as "opaque -- all paths potentially accessed" or allow user annotation.
- Document the approximation strategy in the API so users understand the guarantees.

**Warning signs:**
- No test cases for computed properties, `$eval`, `**`, or higher-order functions.
- Some code paths return empty arrays (under-approximation) while others return wildcards (over-approximation).
- No documentation about what guarantees the tool provides.

**Phase to address:**
Phase 1 (Architecture Decision). Must be decided before writing any extraction logic, because the strategy affects every handler.

---

### Pitfall 5: Path Flattening and the Stages/Steps Distinction

**What goes wrong:**
The JSONata parser post-processes the AST to "flatten" paths. Chained `.` operators are collapsed into a single `path` node with a `steps` array. But filter predicates, sort expressions, and reduce operations are NOT part of the steps array -- they are stored as `stages` on individual step nodes. A walker that only traverses `steps` on path nodes will miss all paths inside filter predicates, sort keys, and grouping expressions.

**Why it happens:**
The parser's post-processing phase transforms the raw AST:
1. Sequences of `.` (map) operations become a `path` node with `steps: [step1, step2, ...]`.
2. Filter predicates `[expr]` become entries in a `stages` array on the preceding step node, not as children of the path node.
3. Sort `^(expr)`, index `#$var`, join `@$var`, and reduce `{...}` are also stored as stages.
4. The `tuple` flag on a node indicates it supports focus/index binding.

This two-level structure (path.steps[].stages[]) is not obvious from the TypeScript types, where `stages` is just listed as an optional `ExprNode[]`.

**How to avoid:**
- When processing a `path` node, iterate over `steps` AND for each step, also iterate over its `stages` array.
- Each stage itself is an AST node that may contain paths (e.g., a filter stage contains a predicate expression with paths to extract).
- Write explicit test cases: `items[price > 10]` should extract `items.price`; `items^(price)` should extract `items.price`; `items{category: $sum(price)}` should extract `items.category` and `items.price`.

**Warning signs:**
- `account.orders[status = "active"]` only reports `account.orders` but not `account.orders.status`.
- Sort expressions like `account.orders^(date)` do not report `account.orders.date`.
- Grouping like `account.orders{category: $sum(total)}` misses `account.orders.category` and `account.orders.total`.

**Phase to address:**
Phase 1 (Core AST Walker). The steps/stages traversal is fundamental to the walker's correctness and must be built into the core traversal logic.

---

### Pitfall 6: The Parent Operator (%) Requires Backward Path Resolution

**What goes wrong:**
The parent operator `%` navigates "upward" in the input data structure. For example, in `Account.Order.Product.(Price * %.Quantity)`, the `%` refers to the `Order` object (the parent of `Product`), so `%.Quantity` means `Account.Order.Quantity`. Static analysis must resolve `%` by tracking the navigation context -- knowing which object is the "current" object at any point in a path expression and computing what its parent would be. Getting this wrong means either missing the path entirely or reporting the wrong path.

**Why it happens:**
The parent operator is the only JSONata feature that navigates "backwards" in the input structure. JSONata itself implements `%` via static analysis at compile time, and the documentation notes that if the parent location cannot be determined, a static error (S0217) is thrown. This means the JSONata parser/compiler already does the hard work of resolving parent references, but the resolved information may or may not be exposed in the AST. If the AST only contains the raw `%` node without the resolved parent path, the analyzer must replicate JSONata's own static analysis logic.

**How to avoid:**
- First, investigate whether the JSONata parser's AST output for `%` includes any resolved path information or only the raw `parent` node type. Parse a test expression with `%` and inspect the AST.
- If the AST contains resolved information: extract it directly.
- If it does not: implement a context-tracking mechanism that, while walking a path expression, maintains a stack of "current objects" so that `%` can be resolved to the parent path segment.
- Support chained `%.%` for grandparent access.
- Test edge cases: `%` at the top level (should be an error), `%.%.field` for deep parent navigation, `%` inside filter predicates.

**Warning signs:**
- Test expressions with `%` produce empty path results.
- `%.field` resolves to just `field` without the parent path prefix.
- No test cases use the parent operator at all.

**Phase to address:**
Phase 3 (Advanced Operators). This is one of the most complex features and should be deferred until the basic walker and variable tracing are solid.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using `any` types for AST nodes instead of discriminated unions | Faster initial development, avoids fighting incomplete TypeScript types | Every handler needs runtime type checking; refactoring is error-prone; no compile-time exhaustiveness checking | Never -- invest in proper types from the start, as the custom types are the tool's foundation |
| Hardcoding built-in function behavior instead of a function registry | Handles common functions quickly | Adding new function awareness requires code changes; custom registered functions are unhandled | Phase 1 MVP only -- replace with registry in Phase 2 |
| Testing only with simple expressions (e.g., `a.b.c`) | Quick to write, builds false confidence | Complex expressions with filters, sorts, conditionals, transforms are where bugs live | Never -- always include complex expressions from the first test suite |
| Ignoring `$eval()` as an edge case | Avoids the hardest static analysis problem | Users who use `$eval` get incorrect results with no warning | Acceptable if `$eval` is explicitly flagged as "cannot analyze" with a warning |
| String-based path comparison instead of structured path representation | Simple to implement and display | Cannot distinguish `a.b` (path) from `a[*].b` (path through wildcard) or `a.b` (two steps) from `a.b` (one step with dot in name) | Never -- use structured path arrays from the start |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| JSONata parser (`jsonata` npm package) | Calling `jsonata(expr).evaluate()` when you only need the AST | Call `jsonata(expr).ast()` -- never evaluate. The parser and evaluator are bundled together but only the parser is needed. Evaluation would require input data and is out of scope. |
| JSONata parser version | Assuming AST structure is stable across versions | Pin the JSONata version. The AST is an internal API -- node types, property names, and structure can change between versions without notice. Test against the pinned version's actual output. |
| JSONata parser error handling | Assuming all expressions parse successfully | JSONata throws on syntax errors with error codes (S01xx series). Wrap `jsonata(expr)` in try/catch and return meaningful error messages including the position of the syntax error. |
| TypeScript types from `jsonata` | Trusting `ExprNode` as a complete type | The `ExprNode` interface is missing node types (`path`, `filter`, `sort`, `bind`, `apply`) and properties (`predicate`, `group`, `condition`, `then`, `else`, `body`, `update`, `delete`, `pattern`, `focus`, `index`, `tuple`). Create your own comprehensive types. |
| Singleton array behavior | Assuming path results are always arrays | JSONata has "sequence flattening" where single values are unwrapped and nested sequences are flattened. AST nodes may have `keepArray`, `keepSingletonArray`, and `sequence` flags that affect this. These flags don't affect path extraction directly but can cause confusion when comparing tool output to JSONata evaluation output. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Recursive AST traversal without cycle detection | Stack overflow on deeply nested expressions | JSONata expressions can be deeply nested (especially with chained transforms or complex conditionals). Use iterative traversal or set a maximum recursion depth. In practice, JSONata expressions rarely exceed 50-100 levels of nesting. | Expressions with 1000+ nesting levels (unlikely in practice but possible with generated expressions) |
| Re-resolving variable bindings on every reference | O(n*m) where n=variable references, m=scope depth | Cache resolved bindings in the scope frame. Once `$x` is resolved to `account.name`, store it. | Expressions with 100+ variable references in deeply nested scopes |
| Parsing the same expression multiple times | Unnecessary CPU cost if the tool is used in a batch pipeline analyzing many expressions | Cache parsed ASTs. `jsonata(expr).ast()` is deterministic for the same input. | Batch analysis of 10,000+ expressions |
| Building path strings by concatenation | Creates many intermediate strings; makes path comparison expensive | Use arrays of path segments internally. Only join to a string for display. | Not a scale issue per se, but a correctness and performance hygiene issue |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Not handling `$eval()` in analyzed expressions | The tool reports paths for the outer expression but misses all paths accessed by the dynamically evaluated inner expression, giving a false sense of completeness | Flag `$eval()` occurrences as "dynamic evaluation detected -- path analysis is incomplete for this expression." Do NOT silently ignore it. |
| Treating user-provided JSONata expressions as safe to parse | The JSONata parser itself could theoretically have bugs that cause issues with maliciously crafted input | Run the parser in a try/catch, set a timeout for parsing (JSONata parsing is normally fast but pathological inputs are possible), and limit input expression length if exposed as a web service. |
| Exposing the tool as an API without input validation | ReDoS-style attacks on the JSONata parser, resource exhaustion | Validate expression length, set parsing timeouts, rate-limit API endpoints. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Reporting paths as flat strings without context | User sees `price` but does not know if it comes from `items[].price` or `order.price` or a filter predicate | Report full paths with their origin context: `items[].price` (from filter predicate), `order.price` (from direct access) |
| Not distinguishing "definitely accessed" from "possibly accessed" | User cannot tell if a path is always read or only read in one conditional branch | Tag paths with certainty: `definite` (always accessed) vs `conditional` (inside if/else) vs `approximate` (inside wildcard/computed access) |
| Silently returning empty results for expressions with `$eval` or custom functions | User trusts the empty result as "no paths accessed" | Return a warning/flag when analysis is incomplete due to dynamic features |
| Not showing which part of the expression accesses each path | User cannot trace back from a reported path to the expression fragment that uses it | Include source position references (the AST has `position` on each node) so paths can be traced back to expression locations |
| Outputting paths in a non-deterministic order | Diff-based workflows break, test assertions become fragile | Sort output paths alphabetically or by source position -- pick one and be consistent |

## "Looks Done But Isn't" Checklist

- [ ] **Basic path extraction:** Often missing paths inside filter predicates -- verify `items[price > 10]` extracts `items.price`
- [ ] **Variable tracing:** Often missing multi-hop chains -- verify `($a := x.y; $b := $a.z; $b)` extracts `x.y.z`
- [ ] **Conditional branches:** Often only traverses the `then` branch -- verify both branches of `condition ? path_a : path_b` are extracted
- [ ] **Lambda bodies:** Often skipped entirely -- verify `$map(items, function($v) { $v.name })` extracts `items.name` (or at minimum `items` + notes lambda body access)
- [ ] **Transform operator:** Often ignored -- verify `$ ~> |account.order|{"total": price * qty}|` extracts `account.order.price` and `account.order.qty`
- [ ] **Sort expressions:** Often missed -- verify `items^(price)` extracts `items.price`
- [ ] **Grouping/reduce expressions:** Often missed -- verify `items{category: $sum(price)}` extracts `items.category` and `items.price`
- [ ] **Recursive descent:** Often returns nothing useful -- verify `**.price` reports a descendant wildcard path marker
- [ ] **Parent operator:** Often crashes or returns empty -- verify `Product.(Price * %.Quantity)` extracts both `Product.Price` and the parent-relative `Quantity` path
- [ ] **Negative test cases:** Verify that string literals, number literals, and boolean constants are NOT reported as paths
- [ ] **Context binding operators:** Often ignored -- verify `items@$item.name` properly traces the `@` binding and extracts `items.name`
- [ ] **Chained function application:** Often only traces one step -- verify `data ~> $map(fn) ~> $filter(fn2)` traces through the entire chain

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Incomplete node type coverage | MEDIUM | Add missing handlers one by one. Each handler is relatively independent. The hard part is finding which types are missing -- use the discovery harness. |
| Missing hidden AST properties | MEDIUM | Parse a comprehensive expression corpus and diff actual vs expected properties. Add traversal for each missing property. |
| Wrong variable scoping | HIGH | Scope model is deeply embedded in the walker. May require redesigning the scope representation and re-testing all variable-related test cases. |
| No over/under-approximation strategy | HIGH | Requires auditing every handler to ensure consistent behavior. Retrofitting a consistent strategy means changing return values throughout. |
| Missed stages on path steps | LOW | Localized fix -- add stages iteration in the path handler. But must then add tests for all stage types (filter, sort, index, join, reduce). |
| Parent operator not handled | LOW | Self-contained feature. Can be added as a new handler without changing existing logic. Needs context tracking addition. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Incomplete node type coverage | Phase 1: Core AST Walker | Exhaustive switch with `never` default compiles; all known node types have a handler; discovery harness finds no unhandled types |
| Undocumented AST properties | Phase 1: Core AST Walker | Discovery harness parsing 50+ diverse expressions finds no un-traversed properties that contain ExprNode children |
| Variable binding scope errors | Phase 2: Variable Tracing | Test suite with nested scopes, shadowing, closures, `@`/`#` bindings all pass; scope frames push/pop correctly |
| Over/under-approximation strategy | Phase 1: Architecture Decision | Strategy documented; every handler reviewed for consistency; computed properties use wildcards; `$eval` flagged |
| Path flattening / stages | Phase 1: Core AST Walker | Test cases for filter, sort, index, join, reduce stages all extract paths from predicate/key expressions |
| Parent operator resolution | Phase 3: Advanced Operators | Test cases with `%`, `%.%`, `%` in predicates all resolve to correct parent-relative paths |
| Higher-order function tracing | Phase 2: Variable Tracing / Phase 3: Advanced | `$map`, `$filter`, `$reduce`, `$each`, `$sift` all trace callback body paths combined with collection paths |
| `$eval` and dynamic analysis boundaries | Phase 3: Advanced Operators | `$eval` occurrences produce explicit warnings; tool output includes "analysis incomplete" flag |
| Custom registered functions | Phase 3: Advanced Operators | Opaque function calls produce "cannot analyze" annotations; optional user-provided function signatures supported |
| Incomplete TypeScript types | Phase 1: Core AST Walker | Custom discriminated union type replaces `ExprNode`; all properties documented; type-safe handlers for each node type |

## Sources

- [JSONata Official Documentation - Path Operators](https://docs.jsonata.org/path-operators) -- HIGH confidence
- [JSONata Official Documentation - Processing Model](https://docs.jsonata.org/processing) -- HIGH confidence
- [JSONata Official Documentation - Programming Constructs](https://docs.jsonata.org/programming) -- HIGH confidence
- [JSONata Official Documentation - Object Functions](https://docs.jsonata.org/object-functions) -- HIGH confidence
- [JSONata Official Documentation - Higher Order Functions](https://docs.jsonata.org/higher-order-functions) -- HIGH confidence
- [JSONata Official Documentation - Other Operators](https://docs.jsonata.org/other-operators) -- HIGH confidence
- [JSONata Official Documentation - Embedding and Extending](https://docs.jsonata.org/embedding-extending) -- HIGH confidence
- [JSONata GitHub Repository](https://github.com/jsonata-js/jsonata) -- HIGH confidence
- [JSONata Parser Source (parser.js AST node types)](https://github.com/jsonata-js/jsonata/blob/master/src/parser.js) -- HIGH confidence (WebFetch verified)
- [JSONata TypeScript Definitions (jsonata.d.ts)](https://github.com/jsonata-js/jsonata/blob/master/jsonata.d.ts) -- HIGH confidence (WebFetch verified)
- [Internal Structures of JSONata Expressions (Medium)](https://medium.com/@varshajainm.1121/internal-structures-of-jsonata-expressions-053540af937f) -- MEDIUM confidence
- [JSONata Go Implementation ASTNode Structure](https://pkg.go.dev/github.com/jsonata-go/jsonata/v206) -- MEDIUM confidence (different implementation but reveals hidden properties)
- [JSONata GitHub Issue #473 - Unexpected Array Properties](https://github.com/jsonata-js/jsonata/issues/473) -- HIGH confidence
- [JSONata GitHub Issue #335 - Parallel Evaluation Bug](https://github.com/jsonata-js/jsonata/issues/335) -- MEDIUM confidence
- [JSONata GitHub Issue #299 - Parent Operator Proposal](https://github.com/jsonata-js/jsonata/issues/299) -- MEDIUM confidence
- [JSONata GitHub PR #371 - Data Joins and Positional Variables](https://github.com/jsonata-js/jsonata/pull/371/files) -- MEDIUM confidence
- [Stedi Prettier Plugin for JSONata](https://github.com/Stedi/prettier-plugin-jsonata) -- MEDIUM confidence (prior art for AST walking)
- [AST Visitor Pattern Pitfalls (Pat Shaughnessy)](https://patshaughnessy.net/2022/1/22/visiting-an-abstract-syntax-tree) -- MEDIUM confidence
- [Static Analysis Limitations for Dynamic Languages (Raven)](https://raven.io/blog/why-static-analysis-falls-short-in-dynamic-programming-languages) -- LOW confidence (general, not JSONata-specific)
- [Data Flow Analysis (Wikipedia)](https://en.wikipedia.org/wiki/Data-flow_analysis) -- MEDIUM confidence (over/under-approximation theory)

---
*Pitfalls research for: JSONata AST static path extraction*
*Researched: 2026-03-02*
