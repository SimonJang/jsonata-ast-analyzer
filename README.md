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

## CLI Usage

## Examples

## How It Works

## Limitations

## License

MIT
