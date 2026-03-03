# Feature Landscape: v1.1 Real-World Integration Test Categories

**Domain:** Integration test coverage for a JSONata AST path analyzer
**Researched:** 2026-03-03
**Confidence:** HIGH (patterns sourced from official JSONata docs, Stedi production mappings, AWS Step Functions usage, Node-RED cookbook, and GitHub issue patterns; cross-referenced with analyzer's existing 105-test unit suite)

## Table Stakes

Test categories that any production JSONata use involves. Gaps here mean the analyzer is untested against the most common real-world patterns.

| Test Category | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **API response reshaping** (nested extraction + flattening) | The single most common JSONata use case: take an API response, extract nested fields, flatten into a new shape. Every Stedi mapping, every Node-RED flow, every Step Functions transform does this. | Medium | Multi-step paths into nested objects, object constructors with mixed literal keys and data-path values, array mapping via dot operator. Tests should use 3-5 levels of nesting. |
| **Data transformation pipelines** (filter -> sort -> map -> reshape) | Production JSONata chains operations: filter an array, sort results, map to new objects. Stedi docs, Node-RED recipes, and AWS examples all demonstrate this. | Medium-High | Combines filter predicates, sort expressions, object constructors, and variable bindings in a single multi-line expression. The analyzer must track context through each stage. |
| **Conditional field selection** (ternary + default operators) | `condition ? fieldA : fieldB` and `field ?: default` are ubiquitous in production. Stedi's common expressions page lists conditional omission as a primary pattern. Zendesk AI agent examples use conditionals heavily. | Medium | All branches of conditionals reference different paths. The analyzer must report paths from ALL branches (over-approximate). Also tests the `?:` (elvis) and `??` (coalescing) operators which the parser models as condition nodes. |
| **String concatenation and formatting** | `FirstName & " " & LastName` and `Address.(Street & ", " & City)` are in virtually every data mapping scenario. Stedi, Node-RED, and the official docs all show this. | Low-Med | Binary `&` operator with path operands on both sides. Tests that string literals do not produce spurious paths while field references do. |
| **Aggregation over nested arrays** | `$sum(orders.items.price)`, `$count(products)`, `$average(scores)` -- standard analytics patterns. Every IoT, e-commerce, and reporting use case. | Low-Med | Built-in function calls with nested path arguments. The analyzer already handles this in unit tests, but integration tests should combine aggregation with filtering and variable binding. |
| **Lookup and cross-reference patterns** | `$lookup($$, key)`, `products[id = orderId]`, referencing one array filtered by a value from another context. Stedi uses `$lookupTable`. Node-RED uses `$lookup($$, ...)` for message introspection. | Medium-High | Combines filter predicates with variable references, the `$$` root context, and potentially the `in` operator. Tests the analyzer's ability to handle cross-referencing between different data structures in one expression. |
| **Variable-driven object construction** | `($items := data.products; {"count": $count($items), "total": $sum($items.price)})` -- bind a sub-tree to a variable, then reference it multiple times in an object constructor. This is the standard pattern for reusable sub-expressions. | Medium | Variable binding + object constructor + function calls using the same bound variable. Tests deduplication (same underlying path referenced multiple times) and variable-to-path resolution in constructor values. |
| **Array mapping via dot operator** | `Account.Order.Product.(Price * Quantity)` -- JSONata's dot operator IS the map operation. This is not a higher-order function; it is the core language mechanic for iterating arrays. Official docs emphasize this distinction. | Medium | PathNode with an embedded binary expression evaluated per-element. The analyzer must recognize that `Price` and `Quantity` are relative to `Account.Order.Product`, not root-level fields. |
| **Multi-field filter predicates** | `orders[status = "active" and total > threshold]` -- filter with compound boolean logic referencing multiple fields. Common in every data filtering scenario. | Medium | Filter expression with `and`/`or` binary operators. Each operand references a different field. The analyzer must extract all referenced fields from within the predicate and prefix them with the filter context. |
| **Nested object output with mixed sources** | `{"customer": customer.name, "items": orders.items.({"sku": sku, "qty": quantity, "total": price * quantity}), "orderDate": metadata.created}` -- constructing output objects that pull from multiple root-level paths. This is the canonical "reshape" pattern. | Medium-High | Object constructor at the top level with values sourced from different root paths. Nested object constructor inside array mapping. Tests that the analyzer correctly identifies root-level vs context-relative paths. |

## Differentiators

Complex patterns that prove the analyzer handles edge cases. Not every JSONata expression uses these, but they appear in production and failure to handle them would undermine trust.

| Test Category | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Chained apply operator pipelines** | `data ~> $filter(fn) ~> $map(fn) ~> $reduce(fn)` -- the `~>` operator chains multiple transforms. Used in Node-RED, Stedi, and AWS Step Functions for readable multi-stage processing. | High | Each `~>` stage implicitly threads the LHS as the first argument. The analyzer must resolve lambda parameter bindings at each stage and carry context forward. |
| **Context variable binding (`@$v`) with cross-reference** | `library.loans@$l.books@$b[$l.isbn=$b.isbn].{"title": $b.title, "customer": $l.customer}` -- the official docs' canonical example of context binding. Binds iteration context to named variables for cross-referencing across nested arrays. | High | Two simultaneous context bindings (`@$l` and `@$b`) with a filter predicate that cross-references them. The analyzer must maintain separate context scopes and resolve `$l.isbn` against the `loans` context and `$b.isbn` against the `books` context. |
| **Parent operator in nested context** | `Account.Order.Product.{"Product": $.ProductName, "Order": %.OrderID, "Account": %.%.'Account Name'}` -- navigating to parent and grandparent objects from within a mapped context. From official JSONata path operators docs. | High | Multiple levels of `%` chaining. The analyzer already emits `%` as a path segment with `partial` confidence. Integration tests should verify multi-level `%` chains in realistic object constructor contexts. |
| **Positional variable with conditional** | `items#$i.($i = 0 ? "first" : $i = $count(items)-1 ? "last" : "middle")` -- using positional index in complex conditional logic. Node-RED documentation shows this pattern. | Medium | Positional `#$i` binding plus conditional expressions that reference `$i`. The analyzer must recognize `$i` as non-data-path (bound to empty) and not produce spurious paths, while still extracting `items` as a data path. |
| **Recursive/nested higher-order functions** | `$map(departments, function($dept) { $map($dept.employees, function($emp) { $emp.name & " (" & $dept.name & ")" }) })` -- nested `$map` with inner lambda capturing outer lambda's parameter. | High | Two-level lambda nesting with closure capture. The inner lambda's `$dept.name` must resolve through the outer lambda's binding back to `departments.name`. The existing unit test covers nested `$map`, but integration tests should add closure capture across levels. |
| **Custom function definition and multi-call** | `($format := function($item) { $item.name & ": $" & $string($item.price) }; orders.items.($format($)))` -- define a function, then call it from within a mapped context. | High | Custom function binding + invocation from within a dot-mapped context where `$` is the current item. Tests the analyzer's interprocedural analysis when the call site's context differs from the definition site. |
| **Transform operator with variable and delete** | `$ ~> \|Account.Order.Product\|{"Total": Price * Quantity, "Discounted": Price * 0.9}, ["UnitPrice"]\|` -- the full transform syntax with computed update fields and a delete clause. From official docs. | Medium-High | Transform pattern, update with multiple computed fields (accessing data paths relative to pattern), and delete clause (string literals, not paths). Tests that the analyzer correctly extracts paths from the update expression but not from the delete clause. |
| **Group-by with aggregation** | `Account.Order.Product{`Supplier`.$sum(Price * Quantity)}` -- group by supplier, aggregate each group. The official JSONata reduce operator documentation shows this. | Medium | Group-by key and value expressions are both context-relative to the grouped array. Tests that the analyzer correctly prefixes both key and value paths. |
| **Range operator and sequence expressions** | `[1..10].$string()` or `$map([0..$count(items)-1], function($i) { items[$i] })` -- sequence generation with range operator, often used in index-driven patterns. | Medium | The `..` range operator produces a binary node. When used with data paths (e.g., `[0..$count(items)]`), the `$count(items)` argument references data. Tests that the analyzer extracts paths from range bounds. |
| **Regex match with path arguments** | `$match(product.description, /sale|discount/i).match` -- regex matching where the first argument is a data path and the result is navigated. | Low-Med | `$match` is a standard function; first arg is a path, second is a regex literal (no path). Integration test should verify regex literal produces no path while the data argument does. |
| **Deeply nested variable chains (3+ levels)** | `($root := data; $orders := $root.orders; $items := $orders[status="active"].items; $prices := $items.price; $sum($prices))` -- 4-hop variable chain where each step adds more specificity. | High | Each variable references the previous one. The analyzer must resolve the full chain: `$prices` -> `$items.price` -> `$orders[status="active"].items.price` -> `$root.orders[status="active"].items.price` -> `data.orders.items.price` (plus `data.orders.status` from the filter). |
| **Mixed static/dynamic paths in one expression** | `(data[knownField > 10][$dynamicVar].nested.path)` -- one filter uses a static field reference, the next uses an unresolvable variable producing `[*]`. | Medium | The same expression produces both `static` and `dynamic` confidence paths. Tests that the analyzer correctly annotates each path segment independently. |
| **Function composition via `~>`** | `($uppertrim := $trim ~> $uppercase; $uppertrim(name))` -- composing two functions into a new one. From official docs. | Medium | `~>` used for function composition (not data piping). The analyzer should handle the case where `~>` connects two function references rather than a data expression and a function call. |
| **Singleton array operator `[]`** | `Phone.number[]` -- forces result to always be an array. Common in production for defensive programming against single-element arrays. | Low | The `[]` operator adds `keepArray` flag to the AST node. Should not affect path extraction -- same paths should be produced with or without `[]`. Validates that the analyzer ignores this flag. |
| **Computed object keys** | `data.{name: value}` vs `data.{"literal-key": value}` -- when object keys are data references vs string literals. | Medium | When the key expression in an object constructor is a path (not a string literal), it reads data. The standard `{key: value}` pair syntax treats the key as a path expression. Tests that the analyzer extracts paths from both key and value positions appropriately. |
| **Spread and merge operations** | `$merge([$spread(base), {"override": newValue}])` -- spreading an object and merging with overrides. Node-RED cookbook shows `$spread($)` as a common pattern. | Medium | `$spread` and `$merge` are built-in functions. Arguments are data paths. Tests that the analyzer extracts from function arguments even for less common built-in functions. |

## Anti-Features

Test patterns NOT worth investing in, and why.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Platform-specific function testing** (Node-RED `$globalContext`, `$flowContext`; AWS Step Functions `$states.input`; Stedi `$lookupTable`, `$omitField`) | These are runtime extensions, not part of the JSONata language. The analyzer correctly treats unknown functions as opaque (extract argument paths, skip function body). Testing each platform's extensions would be an unbounded surface area. | Write 1-2 tests confirming "unknown function passthrough" behavior. That covers all platform extensions by design. |
| **Expression evaluation correctness** | Testing whether `$sum(items.price)` produces the correct numeric result is evaluator testing, not path analyzer testing. The analyzer only cares about which paths are read, not what values they produce. | Keep tests focused on extracted paths and confidence annotations. Never assert on computed values. |
| **Parser error handling exhaustive coverage** | Testing every possible malformed JSONata expression to ensure graceful error messages. The parser (official `jsonata` package) handles this. The analyzer just propagates parser errors. | Keep the existing single CLI error formatting test. Add at most 2-3 more for common typos (missing closing bracket, unmatched quotes). |
| **Performance benchmark tests** | Testing that analysis completes in under N milliseconds. JSONata expressions are typically short (under 500 chars). Performance is not a concern at this scale. | If a specific expression is suspiciously slow, investigate ad hoc. Do not maintain a benchmark suite. |
| **Unicode/i18n field name testing** | Testing expressions with Unicode field names like `donnees.nom` or emoji field names. The JSONata parser handles this; the analyzer just concatenates string segments. | Add 1 smoke test with a non-ASCII field name. Do not build a matrix of Unicode edge cases. |
| **Equivalent expression variations** | Testing that `$filter(items, function($v) { $v.active })` and `items[active]` produce the same paths. The analyzer already has unit tests for both patterns individually. Integration tests should focus on novel combinations, not proving equivalence between syntax alternatives. | Use whichever syntax variant is most natural for the scenario being tested. Do not duplicate tests to cover both. |
| **Whitespace/formatting variations** | Testing that reformatted expressions (different indentation, line breaks, semicolons vs newlines) produce identical results. The parser normalizes whitespace. | Use readable multi-line formatting in integration tests for clarity. Do not test formatting variations. |

## Feature Dependencies

```
API Response Reshaping (foundation scenarios)
  --> Data Transformation Pipelines (builds on reshaping + adds filter/sort/map chains)
  --> Conditional Field Selection (adds branching to reshaping patterns)
  --> Nested Object Output with Mixed Sources (complex reshaping)

Variable-Driven Object Construction (scope + constructor interaction)
  --> Deeply Nested Variable Chains (extends to 3-4 hop resolution)
  --> Custom Function Definition and Multi-Call (extends to interprocedural tracing)

Array Mapping via Dot Operator (context-relative path resolution)
  --> Group-By with Aggregation (same context-relative pattern)
  --> Chained Apply Operator Pipelines (extends to multi-stage context threading)

Filter Predicates (already unit-tested in isolation)
  --> Multi-Field Filter Predicates (compound boolean filters)
  --> Lookup and Cross-Reference Patterns (filters with cross-context references)
  --> Mixed Static/Dynamic Paths (filters producing different confidence levels)

Higher-Order Functions (already unit-tested in isolation)
  --> Recursive/Nested Higher-Order Functions (multi-level lambda nesting)
  --> Context Variable Binding with Cross-Reference (@ binding + filter cross-ref)
  --> Parent Operator in Nested Context (% in mapped object constructors)
```

## Integration Test Suite Structure Recommendation

Prioritize by production frequency and analyzer risk:

### Phase 1: Core Production Patterns (20-25 tests)
1. **API response reshaping** -- 5-6 tests with varying nesting depth and mixed extraction patterns
2. **Data transformation pipelines** -- 4-5 tests with filter/sort/map chains of increasing complexity
3. **Conditional field selection** -- 3-4 tests covering ternary, elvis, coalescing with nested paths
4. **String concatenation and formatting** -- 2-3 tests with multi-path concatenation in mapped contexts
5. **Aggregation over nested arrays** -- 2-3 tests combining aggregation with filtering and variables
6. **Variable-driven object construction** -- 3-4 tests with reused variables in constructors

### Phase 2: Advanced Production Patterns (15-20 tests)
1. **Chained apply operator pipelines** -- 3-4 tests with 2-4 stage pipelines
2. **Lookup and cross-reference patterns** -- 2-3 tests with cross-array filtering
3. **Nested higher-order functions** -- 2-3 tests with closure capture across levels
4. **Custom function definition** -- 2-3 tests with multi-call and mapped context invocation
5. **Deeply nested variable chains** -- 2-3 tests with 3-4 hop chains
6. **Array mapping via dot operator** -- 2-3 tests with complex per-element expressions

### Phase 3: Edge Case Patterns (10-15 tests)
1. **Context variable binding** -- 2-3 tests with `@$v` cross-referencing
2. **Parent operator chains** -- 2-3 tests with multi-level `%` in constructors
3. **Transform operator** -- 2-3 tests with update + delete
4. **Mixed static/dynamic paths** -- 2 tests confirming mixed confidence output
5. **Group-by with aggregation** -- 2 tests with key + value extraction
6. **Remaining differentiators** -- 1-2 tests each for range, regex, singleton array, computed keys, spread/merge

## Sources

- [JSONata Official Docs - Path Operators](https://docs.jsonata.org/path-operators) - HIGH confidence, canonical source for filter, sort, group-by, wildcard, descendant, parent, context binding, positional binding syntax
- [JSONata Official Docs - Building Result Structures](https://docs.jsonata.org/construction) - HIGH confidence, object and array constructor patterns
- [JSONata Official Docs - Programming Constructs](https://docs.jsonata.org/programming) - HIGH confidence, variable binding, lambdas, closures, recursion, higher-order functions, partial application
- [JSONata Official Docs - Expressions](https://docs.jsonata.org/expressions) - HIGH confidence, string/numeric/comparison/boolean operators
- [JSONata Official Docs - Other Operators](https://docs.jsonata.org/other-operators) - HIGH confidence, transform operator, apply/chaining, conditional, concatenation, variable binding
- [Stedi Common Mapping Expressions](https://www.stedi.com/docs/edi-platform/mappings/jsonata/common-mapping-expressions) - HIGH confidence, production JSONata patterns for EDI/API data transformation
- [Stedi JSONata Cheatsheet](https://www.stedi.com/docs/edi-platform/mappings/jsonata/jsonata-cheatsheet) - MEDIUM confidence, summarizes common real-world patterns
- [AWS Step Functions JSONata](https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html) - HIGH confidence, production JSONata usage in cloud workflows
- [SSENSE Step Functions JSONata 2025](https://medium.com/ssense-tech/step-functions-in-2025-simplify-your-development-with-jsonata-1590b6c439d3) - MEDIUM confidence, real-world production patterns and complexity examples
- [Node-RED JSONata Recipes](https://github.com/node-red/cookbook.nodered.org/wiki/JSONata-Recipes) - MEDIUM confidence, community-sourced production patterns with message transformation, context access, array processing
- [Node-RED Home Assistant JSONata](https://zachowj.github.io/node-red-contrib-home-assistant-websocket/guide/jsonata/) - MEDIUM confidence, IoT-specific JSONata usage patterns
- [JSONata Kestra Article](https://medium.com/@fhussonnois/jsonata-the-swiss-army-knife-of-kestra-for-json-transformation-07c27d27988d) - MEDIUM confidence, data integration pipeline patterns
- [Blues Wireless JSONata Examples](https://blues.com/blog/10-jsonata-examples/) - MEDIUM confidence, IoT device data transformation patterns
- [JSONata GitHub Issues #170](https://github.com/jsonata-js/jsonata/issues/170) - MEDIUM confidence, documents path processing edge cases
- [JSONata GitHub Issues #496](https://github.com/jsonata-js/jsonata/issues/496) - LOW confidence, documents variable binding in transform edge case
