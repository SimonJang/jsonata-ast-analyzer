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

## How It Works

## Limitations

## License

MIT
