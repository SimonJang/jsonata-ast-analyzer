# jsonata-ast-analyzer

Static analysis tool that extracts every data path a JSONata expression will read from its input.

## Quick Example

```javascript
import { extractPaths } from "jsonata-ast-analyzer";

const paths = extractPaths('orders[status = "active"].items.price');
// [
//   { path: "orders.items.price",  confidence: "static" },
//   { path: "orders.status",       confidence: "static" }
// ]
```

## Installation

```sh
pnpm add jsonata-ast-analyzer
```

```sh
npm install jsonata-ast-analyzer
```

```sh
yarn add jsonata-ast-analyzer
```

> **Note:** This package is ESM-only. Use `import` -- `require()` is not supported.

## API Reference

### extractPaths(expression: string): PathResult[]

Extracts all data paths that a JSONata expression reads from its input object, including paths hidden inside filters, sorting, and variable assignments.

- **expression** -- a JSONata expression string.
- **Returns** -- a deduplicated array of `PathResult` objects. Each unique path appears once.
- **Throws** -- on invalid JSONata expressions; the parser error propagates unmodified. An empty string throws `"Unexpected end of expression"`.

`extractPaths` always returns an array or throws -- it never returns `null` or `undefined`.

### Types

```typescript
interface PathResult {
  path: string;
  confidence: Confidence;
}

type Confidence = "static" | "dynamic" | "partial";
```

- **path** -- the dot-separated data path. Special markers: `[*]` indicates a dynamic segment, `%` indicates a parent reference.
- **confidence** -- how certain the analysis is about this path. See the table below.

When a path matches multiple confidence levels, the highest priority wins: partial > dynamic > static.

| Level | Meaning | Cause | Example |
|-------|---------|-------|---------|
| `static` | Fully resolved at analysis time | All path segments are known | `account.name` |
| `dynamic` | Contains unresolvable segments | Variable used in bracket filter position | `item[$field]` |
| `partial` | Contains parent operator approximation | Parent operator (`%`) in path | `orders.items.%.orderRef` |

## CLI Usage

### Argument Mode

Pass a JSONata expression as a quoted argument:

```sh
jsonata-paths 'account.name'
```

```json
[{"path":"account.name","confidence":"static"}]
```

### Stdin Mode

Pipe an expression through stdin for use in shell pipelines:

```sh
echo '$sum(orders.total)' | jsonata-paths
```

```json
[{"path":"orders.total","confidence":"static"}]
```

> **Note:** JSONata uses `$` for built-in functions, so always wrap expressions in single quotes to prevent shell variable expansion.
>
> ```sh
> # Correct
> jsonata-paths '$sum(prices)'
>
> # Wrong -- bash expands $sum to an empty string
> jsonata-paths "$sum(prices)"
> ```

Invalid expressions exit with code 1 and print the error to stderr.

## Examples

### Simple property access

A straightforward nested property lookup -- the most common case.

```javascript
import { extractPaths } from "jsonata-ast-analyzer";

const paths = extractPaths('customer.name');
// [{ path: "customer.name", confidence: "static" }]
```

### Variable assignment

The analyzer traces through variable bindings to find the real source paths.

```javascript
const paths = extractPaths(
  '($addr := customer.address; $addr.city & ", " & $addr.state)'
);
// [
//   { path: "customer.address",       confidence: "static" },
//   { path: "customer.address.city",  confidence: "static" },
//   { path: "customer.address.state", confidence: "static" }
// ]
```

### Filter predicates

Paths hidden inside filter conditions are extracted alongside the output path.

```javascript
const paths = extractPaths('products[price > 50 and inStock].name');
// [
//   { path: "products.name",    confidence: "static" },
//   { path: "products.price",   confidence: "static" },
//   { path: "products.inStock", confidence: "static" }
// ]
```

### Dynamic computed path

An unbound variable in bracket position produces a `[*]` wildcard -- the analyzer knows a field is accessed but not which one.

```javascript
const paths = extractPaths('inventory[$category].quantity');
// [
//   { path: "inventory.quantity", confidence: "static" },
//   { path: "inventory[*]",      confidence: "dynamic" }
// ]
```

### Parent operator

The parent operator (`%`) navigates up to the enclosing context, producing `partial` confidence alongside `static` paths.

```javascript
const paths = extractPaths(
  'orders.items.{"itemName": name, "orderDate": %.date}'
);
// [
//   { path: "orders.items",        confidence: "static" },
//   { path: "orders.items.name",   confidence: "static" },
//   { path: "orders.items.%.date", confidence: "partial" }
// ]
```

### Advanced JSONata constructs

The analyzer also tracks reads through common advanced JSONata constructs:

```javascript
extractPaths(
  'library.loans@$l.books@$b[$l.isbn=$b.isbn].{"title":$b.title}'
);
// [
//   { path: "library.loans.books",       confidence: "static" },
//   { path: "library.loans.books.isbn",  confidence: "static" },
//   { path: "library.loans.books.title", confidence: "static" },
//   { path: "library.loans.isbn",        confidence: "static" }
// ]
```

- Joins and context bindings with `@`, while `#` position bindings do not create data paths.
- Grouping with `{}` and ordering with `^()`.
- Higher-order functions, custom lambdas, closure captures, `~>` chains, and partial application placeholders.
- Regex predicates and helper built-ins such as `$contains`, `$match`, and `$replace`.
- Transform expressions, including update reads and dynamic delete expressions.

### Benchmarks and Release Checks

Run the benchmark smoke locally after building:

```sh
pnpm bench
```

Each benchmark reports parse-plus-analyze time plus raw path count before dedupe and unique path count after dedupe.

Run the release gate used by CI:

```sh
pnpm release:check
```

## How It Works

```
expression string → parse → walk → dedupe → classify → PathResult[]
                      │       │       │         │
                   JSONata  recursive  Set    path string
                   parser   traversal  dedup  → confidence
                   → AST    → raw paths
```

**Parse** -- Delegates to the official JSONata parser (the `jsonata` package) to produce an AST. The analyzer does not reimplement parsing; it consumes the same syntax tree that JSONata itself uses for evaluation.

**Walk** -- Recursively traverses the AST, tracking variable assignments across scopes to resolve where data actually comes from. When a variable like `$x` appears in a path, the walker traces it back to the expression that assigned it and reports the underlying data path. This scope-aware traversal also handles filter predicates, sorting expressions, and function arguments -- surfacing paths that a naive tree walk would miss.

**Dedupe** -- Removes duplicate paths using Set-based deduplication. Complex expressions often reference the same data path through multiple code paths; the output contains each unique path exactly once.

**Classify** -- Annotates each unique path with a confidence level: `static` when every segment is fully resolved, `dynamic` when the path contains a `[*]` wildcard from an unresolvable variable in bracket position, or `partial` when the path contains a `%` parent marker whose target depends on runtime context.

The analyzer is designed to over-approximate: it reports a superset of the paths that may be accessed at runtime. Both branches of a conditional are walked, and unresolvable variables produce wildcards rather than being silently omitted. This is a deliberate trade-off -- false positives (extra paths reported) are safe for downstream consumers that use path lists for data dependency tracking, while false negatives (missed paths) could silently break those consumers.

## Limitations

**Static analysis only** -- The analyzer works from the expression text alone, without evaluating it or requiring sample input data. This means it cannot resolve values that depend on runtime state, but it can run anywhere without a live environment.

**Dynamic path wildcards** -- When a variable in bracket position cannot be statically resolved, the analyzer emits a `[*]` wildcard segment and marks the path as `dynamic`. This acknowledges that a field is accessed while signaling that the exact field name depends on runtime data.

**Parent operator approximation** -- The parent operator (`%`) navigates to an enclosing context that is only fully determined at runtime. The analyzer preserves `%` as a literal path segment and marks the result as `partial`, recording the structural relationship without claiming to know the exact target.

**Descendant summaries** -- Descendant paths such as `**.price` are preserved as broad static summaries. The analyzer does not enumerate every possible concrete path under `**`.

**Transform writes** -- Transform locations and update/delete expressions are analyzed for reads, but write targets are not exposed as a separate public API. Literal delete targets such as `["password"]` do not create input reads.

**Internal benchmark helper** -- `__benchmarkExpression()` is exported only so the repository benchmark can measure raw and deduped path counts. Treat it as internal; `extractPaths()` remains the supported API.

## License

MIT
