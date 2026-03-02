# Feature Landscape

**Domain:** Static analysis / AST path extraction for JSONata expressions
**Researched:** 2026-03-02
**Confidence:** MEDIUM-HIGH (JSONata AST structure verified via official parser source and Rust implementation; feature landscape synthesized from GraphQL analyzers, ESLint scope analysis, XPath static analysis, and field-level lineage tooling)

## Table Stakes

Features users expect. Missing = product feels incomplete or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Simple dot-path extraction | This is the core promise. `account.name` must produce `["account.name"]`. If this fails, nothing else matters. | Low | The happy path -- `path` nodes containing `name` children. Straightforward recursive walk. |
| Nested path extraction | Users will immediately try `order.items.price`. Multi-step paths are the bread and butter of JSONata. | Low | `path` node with multiple `name` steps. Concatenate step names with dots. |
| Wildcard operator (`*`) | JSONata's `*` selects all properties of an object. Path result should include a wildcard segment like `order.*` or `order[*]`. | Low | `wildcard` AST node type. Emit a `*` segment in the extracted path. |
| Descendant operator (`**`) | `**` recursively descends the hierarchy. Users writing `**.price` expect to see it reflected in extracted paths. | Low | `descendant` AST node type. Emit a `**` segment. Cannot resolve to concrete paths statically. |
| Filter predicate path extraction | `items[price > 10]` reads `items` AND `items.price`. The predicate accesses data that must be reported. | Medium | `filter` nodes contain an expression that references paths. Must walk into the filter's condition expression and resolve paths relative to the filter's context. |
| Array index access | `items[0]` is a positional access, not a field read. Must distinguish from filter predicates that read data. | Low-Med | Numeric literal inside `filter` vs boolean expression. Positional access means the parent array path (`items`) is needed but not a sub-field. |
| Variable binding tracing (`$x := expr`) | `$x := account.name; $x` -- variable `$x` is an alias. Must trace back to `account.name`. Without this, analysis is incomplete for any non-trivial expression. | High | `bind` nodes associate a `variable` with an expression. Requires building a scope/environment that maps variable names to their source paths. Must handle shadowing and nested scopes. |
| Binary operator operand extraction | `price * quantity` reads both `price` and `quantity`. All binary operations (`+`, `-`, `*`, `/`, `&`, comparisons, `in`, `and`, `or`) have LHS and RHS that may reference data. | Low | `binary` node with `lhs` and `rhs` children. Recursively extract from both sides. |
| Conditional expression paths | `condition ? trueExpr : falseExpr` -- all three branches may read data. Must extract paths from all branches. | Low-Med | `condition` node with `condition`, `then`, `else` children. Extract from all three. Cannot know statically which branch executes, so report all paths. |
| Function argument paths | `$sum(items.price)` reads `items.price`. Built-in function arguments reference data that must be extracted. | Medium | `function` nodes contain `arguments` array. Walk each argument. Challenge: some functions transform context (like `$map`, `$filter`, `$reduce`) and their lambda arguments operate on different contexts. |
| Block expression support | Parenthesized expressions `(expr1; expr2; expr3)` create blocks. Must extract paths from all sub-expressions. | Low | `block` node with `expressions` array. Walk each expression. Blocks also create variable scope boundaries. |
| String/number/boolean literal handling | Literals produce no paths. Must not crash or produce spurious results on `"hello"`, `42`, `true`, `null`. | Low | `string`, `number`, `value` node types. Return empty path set. |
| Programmatic TypeScript/JS API | Users consume this as a library. Must export a function like `extractPaths(expression: string): string[]` or similar. | Low | Standard npm package with TypeScript types. This is the primary interface. |
| CLI tool | Command-line usage for scripting, CI pipelines, and quick exploration. `jsonata-paths "Account.Order.Product"` should just work. | Low | Thin wrapper over the library API. Read from stdin or argument. Output as JSON or newline-delimited. |

## Differentiators

Features that set product apart. Not expected (no competing tool exists in this space), but valued by power users.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Lambda/higher-order function context tracking | `$map(items, function($v) { $v.name })` -- the lambda's `$v` is bound to elements of `items`. Resolving `$v.name` to `items.name` requires understanding higher-order function semantics. This is where most naive AST walkers give up. | High | Must recognize built-in higher-order functions (`$map`, `$filter`, `$reduce`, `$each`, `$sift`, `$sort`) and understand how they bind their callback parameters. Map `$v` to `items[*]` contextually. |
| Sort expression path extraction | `items^(price)` sorts by `price`, which means `items.price` is read. The sort key is a data dependency. | Medium | `sort` nodes contain sort terms that reference fields. Must resolve sort expressions relative to the array being sorted. |
| Transform operator analysis | `\| items \| {"discounted": price * 0.9} \|` reads `items` and `items.price`. The transform pattern and update expressions reference data. | Medium | `transform` node with pattern, update, and optionally delete expressions. Walk all three and resolve relative paths. |
| Parent operator (`%`) resolution | `items.%.orderId` navigates to the parent object. Must produce something meaningful -- either a wildcard parent path or flag as "accesses parent context". | Medium-High | `parent` AST node. Statically resolving what `%` points to requires knowing the data shape, which we don't have. Best approach: emit a symbolic marker like `<parent>` or track relative to the current path and go one level up. |
| Context variable binding (`@$v`) tracking | `items@$item.subItems{ "parent": $item.name }` binds the current context to `$item`. Must trace these bindings like regular variable assignments. | Medium | `@` binding creates a variable in scope for the remainder of the path. Similar to `bind` but scoped to the path expression. |
| Positional variable (`#$i`) recognition | `items#$i` binds position index. This variable is numeric, not a data reference. Should NOT produce a path but must not confuse the variable tracker. | Low-Med | `#` binding creates a numeric variable. Must recognize it produces no data path while still tracking it in the scope to avoid false positives when `$i` appears later. |
| Dynamic path detection with wildcards | `item[fieldName]` where `fieldName` is a variable that can't be statically resolved. Must flag this as `item[*]` rather than silently dropping it. | Medium | When a filter/index expression is a variable reference that doesn't trace back to a string literal, emit a wildcard. Communicates "something is accessed here, but we can't determine what." |
| Recursive descent path representation | For `**.price`, represent this as a path that says "price at any depth". Useful for understanding which fields are accessed regardless of nesting. | Low | Already handled by descendant node type, but the representation in output matters. Consider outputting `**.price` rather than trying to enumerate. |
| Confidence/completeness annotation | Mark each extracted path with whether it was fully statically resolved (HIGH confidence) or involved dynamic/unknown components (LOW confidence). | Medium | Return structured results instead of just strings: `{ path: "items.price", confidence: "static" }` vs `{ path: "items[*]", confidence: "dynamic" }`. Helps consumers prioritize. |
| Regex literal handling | `$match(name, /pattern/)` -- regex is not a data path. Must not produce spurious paths from regex nodes. | Low | `regex` AST node. Return empty. But note the first argument to `$match` IS a data path. |
| Custom function call handling | User-defined functions via `$myFunc := function($x) { ... }`. When `$myFunc(data.field)` is called, must trace argument into the function body. | High | Requires resolving `function` nodes where the procedure is a variable reference, looking up the lambda in scope, and binding arguments to parameters. Full interprocedural analysis. |
| Multiple expression batch analysis | Analyze many expressions at once against the same data contract. Return union of all accessed paths. | Low | Wrapper that calls the core extractor in a loop and deduplicates. But valuable for the "which fields can I safely remove?" use case. |
| Output format options | JSON, newline-delimited, tree structure, dot-notation, bracket-notation. Different consumers want different formats. | Low-Med | Formatting layer on top of core extraction. Tree output (showing hierarchy) is more complex but valuable for visualization. |

## Anti-Features

Features to explicitly NOT build. These are tempting but wrong for this project.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Custom JSONata parser | The official `jsonata` package has a battle-tested parser. Writing a custom parser is months of work, will have bugs, and will drift from the language spec. | Use `jsonata(expr).ast()` from the official package. This is explicitly stated in PROJECT.md constraints. |
| Expression evaluation/execution | This is a static analysis tool. Evaluating expressions requires input data and a runtime -- totally different problem with different complexity. | Return the AST paths, let consumers evaluate separately with the official `jsonata` package. |
| Expression modification/rewriting | Tempting to offer "rename field X to Y in all expressions", but code modification is an order of magnitude harder than analysis. Different error modes, different testing needs. | Report what paths are accessed. Let a separate tool (or future project) handle rewriting. |
| Runtime type inference | Knowing the actual types of data at each path requires sample data or a schema. Static analysis operates without data. | Report paths as strings. If consumers have a JSON Schema, they can cross-reference externally. |
| JSON Schema validation | Checking if extracted paths match a known schema is a downstream concern, not a core analysis feature. | Output paths in a format that's easy to compare against schema tools. |
| Visual AST explorer / GUI | A web-based AST visualization tool is a separate product. JSONata Studio already has an AST explorer. | Focus on the programmatic API and CLI. Let users pipe output to existing visualization tools. |
| Language server protocol (LSP) | An LSP for JSONata (autocomplete, hover info, go-to-definition) is a massive undertaking and a different product category. | The path extraction API could feed INTO an LSP, but building the LSP is out of scope. |
| Supporting non-standard JSONata extensions | Some platforms (Node-RED, AWS Step Functions) add custom functions. Trying to support all extensions leads to an ever-growing surface area. | Handle unknown functions gracefully: extract paths from arguments, flag the function call as opaque. Don't try to model what custom functions do to data. |
| Performance optimization via caching | Premature. JSONata expressions are typically short. The parser and walker will be fast enough without caching layers. | Profile first. If analysis of a single expression ever takes >10ms, then investigate. |
| Incremental/streaming analysis | Analyzing expressions one node at a time as they're typed. This is LSP territory. | Batch analysis: give it a complete expression, get back complete results. |

## Feature Dependencies

```
Simple dot-path extraction (foundation)
  --> Nested path extraction (extends foundation with multi-step)
  --> Wildcard operator (new node type in path)
  --> Descendant operator (new node type in path)
  --> Binary operator operand extraction (recursive walk pattern)
    --> Conditional expression paths (same recursive pattern)
    --> Filter predicate path extraction (recursive + context scoping)
  --> Block expression support (walk children pattern)
  --> String/number/boolean literal handling (base case for recursion)

Variable binding tracing (scope infrastructure)
  --> Context variable binding tracking (extends scope to @ operator)
  --> Positional variable recognition (extends scope to # operator)
  --> Lambda/higher-order function context tracking (scope + function semantics)
    --> Custom function call handling (extends lambda tracking to user functions)

Filter predicate path extraction
  --> Sort expression path extraction (similar relative-path resolution)
  --> Transform operator analysis (similar pattern + update/delete expressions)

Dynamic path detection with wildcards
  --> Confidence/completeness annotation (extends dynamic detection to structured output)

Programmatic TypeScript/JS API (core interface)
  --> CLI tool (wraps API)
  --> Multiple expression batch analysis (wraps API in loop)
  --> Output format options (formatting layer on API results)
```

## MVP Recommendation

Prioritize:
1. **Simple and nested dot-path extraction** -- the core value proposition. If this doesn't work perfectly, nothing else matters.
2. **All literal/operator node handling** (binary, unary, conditional, block, string, number, boolean) -- completes the basic AST walk so no expression crashes the tool.
3. **Filter predicate path extraction** -- this is where JSONata paths get interesting. `items[price > 10]` reading `items.price` is a key insight users need.
4. **Wildcard and descendant operators** -- straightforward to implement, rounds out path support.
5. **Variable binding tracing** -- the single most important differentiator. Without it, analysis of real-world expressions is incomplete. This is also the highest-complexity table-stakes feature.
6. **Programmatic API + CLI** -- the two delivery mechanisms.

Defer:
- **Lambda/higher-order function context tracking**: High complexity, requires understanding built-in function semantics. Ship a version that extracts the lambda body paths but doesn't resolve parameter bindings. Flag as "partial analysis" and improve later.
- **Custom function call handling**: Requires interprocedural analysis. Handle gracefully by extracting argument paths but treating the function body as opaque if the definition isn't in the same expression.
- **Parent operator resolution**: Hard to resolve without data shape knowledge. Emit a marker and document the limitation.
- **Transform operator analysis**: Medium complexity but less commonly used in practice. Add after core path extraction is solid.
- **Output format options**: Start with JSON array output. Add tree/hierarchical output later based on user feedback.
- **Confidence annotations**: Valuable but adds API complexity. Start with simple path strings, evolve to structured results.
- **Multiple expression batch analysis**: Trivial to implement but design the API first based on single-expression usage patterns.

## Sources

- [JSONata official documentation - Path Operators](https://docs.jsonata.org/path-operators) - HIGH confidence, authoritative source for JSONata path operator semantics
- [JSONata GitHub repository](https://github.com/jsonata-js/jsonata) - HIGH confidence, reference implementation
- [JSONata parser source (AST node types)](https://raw.githubusercontent.com/jsonata-js/jsonata/master/src/parser.js) - HIGH confidence, 22 distinct node types verified via raw source
- [Rust JSONata AstKind enum](https://docs.rs/jsonata/latest/jsonata/ast/enum.AstKind.html) - MEDIUM confidence (v0.0.0 incomplete impl), but confirms 23 node type variants matching JS parser
- [Stedi prettier-plugin-jsonata](https://github.com/Stedi/prettier-plugin-jsonata) - MEDIUM confidence, confirms all node types must be handled for complete AST traversal; provides `serializeJsonata()` for AST-to-string
- [Internal structures of JSONata expressions (Varsha Jain)](https://medium.com/@varshajainm.1121/internal-structures-of-jsonata-expressions-053540af937f) - LOW confidence (single blog source), but helpful walkthrough of AST structure
- [ESLint scope-manager](https://eslint.org/docs/latest/extend/scope-manager-interface) - HIGH confidence, established pattern for variable/scope tracking in AST analysis
- [eslint-scope on npm](https://www.npmjs.com/package/eslint-scope) - HIGH confidence, reference implementation of scope analysis as a separate concern
- [GraphQL static query analysis](https://www.graphql.de/blog/static-query-analysis/) - MEDIUM confidence, analogous domain: extracting field dependencies from query ASTs
- [Orbeon XForms expression analysis](https://doc.orbeon.com/xforms/xpath/expression-analysis) - MEDIUM confidence, closest precedent: static XPath dependency extraction for optimization
- [Field-level lineage at InfoQ](https://www.infoq.com/articles/field-level-lineage-modern-data-systems/) - MEDIUM confidence, demonstrates the broader pattern of AST-walking for data dependency extraction
- [Column-level lineage via SQL parsing (Metaplane)](https://www.metaplane.dev/blog/column-level-lineage-an-adventure-in-sql-parsing) - LOW confidence (single source), but validates that ~80% coverage is achievable with initial AST walking and edge cases require iteration
- [JSONata npm trends](https://npmtrends.com/jsonata) - MEDIUM confidence, ~635K weekly downloads confirms active ecosystem
- [AWS Step Functions JSONata integration](https://aws.amazon.com/blogs/compute/simplifying-developer-experience-with-variables-and-jsonata-in-aws-step-functions/) - HIGH confidence (official AWS blog), confirms JSONata adoption in major cloud platforms
- [JSONata in Node-RED](https://flows.nodered.org/flow/29fd01f8a62fec86d875ecbd68001cb0) - MEDIUM confidence, confirms JSONata as built-in Node-RED feature
- [JSONata processing model](https://docs.jsonata.org/processing) - HIGH confidence, official docs on how JSONata evaluates expressions
- [JSONata programming constructs](https://docs.jsonata.org/programming) - HIGH confidence, official docs on variables, lambdas, blocks
