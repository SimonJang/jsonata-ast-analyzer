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

## Examples

## How It Works

## Limitations

## License

MIT
