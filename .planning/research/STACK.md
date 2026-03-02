# Technology Stack

**Project:** JSONata AST Path Analyzer
**Researched:** 2026-03-02

## Recommended Stack

### Runtime & Language

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | >= 22.x (LTS) | Runtime | Node 22 is Active LTS (supported until April 2027). Node 24 entered LTS October 2025 and is also viable. Target >= 22 for maximum compatibility while staying on maintained versions. | HIGH |
| TypeScript | ~5.9 | Language | Latest stable release. TypeScript 6.0 is in beta but is feature-frozen (last JS-based release). 5.9 is the safe, proven choice. No reason to jump to 6.0 beta for a new library. | HIGH |

### Core Dependency

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| jsonata | ^2.1.0 | JSONata parser (AST source) | The official JSONata library. v2.1.0 (July 2024) is the latest release. It exposes an `ast()` method on parsed expressions that returns the full AST tree. It also exposes `jsonata.parser` as a public property for direct parser access. Ships with built-in TypeScript types (`jsonata.d.ts`) -- no `@types/jsonata` needed. The `ExprNode` type provides a discriminated union over ~20 node types. This is the only dependency that matters; everything else is dev tooling. | HIGH |

**Critical detail about jsonata's API:**

```typescript
import jsonata from 'jsonata';

// Parse expression -- this invokes the parser internally
const expr = jsonata("account.name");

// Access the AST -- this is the method we depend on
const ast = expr.ast();
// Returns: { type: 'path', steps: [{ type: 'name', value: 'account' }, { type: 'name', value: 'name' }] }

// AST node types include: 'binary', 'unary', 'name', 'string', 'number', 'value',
// 'path', 'function', 'lambda', 'condition', 'transform', 'block', 'bind',
// 'variable', 'wildcard', 'descendant', 'parent', 'filter', 'sort', 'regex'

// jsonata.parser is also exposed publicly (may be removed in future versions)
```

**Note:** The `ast()` method is defined in the TypeScript types (`Expression` interface) and exists in the source code, but is NOT documented in the official JSONata docs. It is an undocumented-but-typed public API. The `jsonata.parser` static property is also public but explicitly noted as potentially removable. Prefer `expr.ast()` over direct parser access for stability.

### Build Tooling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| tsup | ^8.5 | Bundle library for distribution | Zero-config TypeScript bundler powered by esbuild. Outputs both ESM and CJS with a single command. Generates `.d.ts` declaration files via `--dts`. tsup is battle-tested with 2,274 dependents on npm. While tsdown (Rolldown-based) is the emerging successor, it is still in beta (0.21.0-beta.2) and not production-ready. Use tsup now; migrate to tsdown later if needed. | HIGH |
| tsx | ^4.21 | Dev-time TypeScript execution | Run `.ts` files directly during development without a compile step. Powered by esbuild, near-instant startup. Used for the CLI entry point during development and for running scripts. Node.js 22+ has built-in type stripping, but tsx handles tsconfig paths, decorators, and edge cases more reliably. | HIGH |

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| vitest | ^4.0 | Test runner | Vitest 4.0 is the current standard for TypeScript testing. Native ESM support, native TypeScript support (no ts-jest needed), 10-20x faster than Jest in watch mode, Jest-compatible API for easy adoption. New in v4: stable browser mode, filesystem-based caching, schema matching. For a pure Node library like this, Vitest's speed and zero-config TypeScript support make it the clear winner. | HIGH |

### CLI Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| commander | ^14.0 | CLI argument parsing | The standard for Node.js CLIs with 116,000+ dependents. Built-in TypeScript types. Clean, declarative API. v14 requires Node >= 20 (aligns with our Node 22+ target). Security updates guaranteed through May 2027. For a simple CLI wrapper around a library, commander is the right weight -- not too heavy (like oclif), not too light (like minimist). | HIGH |

### Code Quality

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| eslint | ^10.0 | Linting | ESLint 10 released February 2026. Flat config is now the only format. Per-file config resolution (useful for monorepos). Requires Node >= 20.19. | HIGH |
| typescript-eslint | ^8.56 | TypeScript-specific lint rules | Actively maintained (weekly releases). v8 supports ESLint flat config natively. "Project Service" feature simplifies typed linting setup. | HIGH |
| prettier | ^3.x | Code formatting | Standard formatter. Separates formatting concerns from linting. Use with eslint-config-prettier to avoid conflicts. | HIGH |

### Package Management & Publishing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| npm | (bundled) | Package manager | Ships with Node.js. For a single-package library, npm is simpler than pnpm or yarn. No workspace complexity needed. | HIGH |
| @changesets/cli | ^2.29 | Version management & changelog | Automates semver bumps and changelog generation. Overkill for initial development but valuable once publishing to npm. Add when ready to publish, not at project start. | MEDIUM |

## Project Configuration

### tsconfig.json

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Key decisions:**
- `target: ES2022` -- Node 22+ supports all ES2022 features natively
- `module: ES2022` -- enables top-level await, native ESM
- `moduleResolution: bundler` -- correct for tsup-bundled libraries
- `noUncheckedIndexedAccess` -- critical for safe AST walking where node properties may be undefined
- `strict: true` -- non-negotiable for a library that analyzes code

### tsup.config.ts

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
});
```

**Key decisions:**
- Dual ESM/CJS output for maximum consumer compatibility
- Two entry points: `index` for library API, `cli` for command-line usage
- `splitting: false` -- small library, no need for code splitting
- `.d.ts` generation built into the build step

### package.json (exports)

```jsonc
{
  "name": "jsonata-ast-analyzer",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "bin": {
    "jsonata-paths": "./dist/cli.mjs"
  },
  "files": ["dist"],
  "engines": {
    "node": ">=22"
  }
}
```

### eslint.config.mjs

```javascript
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
);
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Bundler | tsup 8.x | tsdown (Rolldown) | tsdown is still beta (0.21.0-beta.2). Faster, but not stable enough for production libraries yet. Migrate when it hits 1.0. |
| Bundler | tsup 8.x | tsc + manual config | tsc alone doesn't bundle, doesn't produce CJS+ESM dual output easily, and requires more configuration. tsup wraps esbuild for speed and simplicity. |
| Bundler | tsup 8.x | Rollup | Rollup is powerful but requires significant configuration for TypeScript. tsup provides the same output with zero config. |
| Test runner | Vitest 4.x | Jest 30 | Jest now supports ESM but still requires ts-jest or babel for TypeScript. Vitest handles TypeScript natively with zero config and runs 10-20x faster. Jest only makes sense for React Native or legacy codebases. |
| CLI | commander 14 | yargs | yargs is more verbose and heavier. For a simple CLI with 1-2 commands and a few flags, commander is cleaner. |
| CLI | commander 14 | oclif | oclif is a full CLI framework with plugins, hooks, and generators. Massive overkill for a single-purpose tool. |
| CLI | commander 14 | citty / cleye | Newer, lighter alternatives but with smaller ecosystems. commander's maturity and documentation win for a library that needs reliability. |
| Linter | ESLint 10 | Biome | Biome is faster but has fewer TypeScript-specific rules than typescript-eslint. For a library doing AST analysis, strong type-aware linting is more valuable than speed. |
| TS runner | tsx | Node.js native type stripping | Node 22+ can run `.ts` files natively via `--experimental-strip-types`, but it doesn't support tsconfig paths, doesn't handle all TypeScript syntax, and is still experimental. tsx is more reliable for development. |
| TS version | 5.9 | 6.0 beta | 6.0 is feature-frozen (same features as 5.9 essentially) but is beta. No benefit, some risk. |

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| `@types/jsonata` | Outdated (6+ years old). jsonata ships its own types since v2.x. Installing @types/jsonata will cause type conflicts. |
| `ts-node` | Slow, complex configuration, poor ESM support. tsx is faster and simpler in every way. |
| `jest` | Requires ts-jest for TypeScript, slow compared to vitest, worse ESM support. No advantage for a new project. |
| `webpack` | Application bundler, not a library bundler. Massive configuration overhead for no benefit. |
| `babel` | Unnecessary when using tsup (esbuild) for building and vitest for testing. Adds complexity with no value. |
| Custom JSONata parser | Explicitly out of scope. The official parser is proven, complete, and maintained. Re-implementing it would be a massive waste of effort and a source of bugs. |
| `jsonata-go` or other ports | This project is TypeScript/Node. Use the canonical JavaScript implementation. |
| `esbuild` directly | tsup wraps esbuild with library-appropriate defaults (dual output, dts, clean). Using esbuild directly requires manual configuration for all of this. |

## Installation

```bash
# Core runtime dependency
npm install jsonata

# Build tooling
npm install -D typescript tsup tsx

# Testing
npm install -D vitest

# CLI (runtime dependency)
npm install commander

# Code quality
npm install -D eslint @eslint/js typescript-eslint eslint-config-prettier prettier
```

## Dependency Inventory

| Package | Runtime/Dev | Justification |
|---------|-------------|---------------|
| jsonata | Runtime | Core dependency -- provides the parser and AST we analyze |
| commander | Runtime | CLI argument parsing for the `jsonata-paths` command |
| typescript | Dev | Type checking (tsup uses esbuild for actual compilation) |
| tsup | Dev | Bundling library for distribution |
| tsx | Dev | Running TypeScript during development |
| vitest | Dev | Test runner |
| eslint | Dev | Linting |
| @eslint/js | Dev | ESLint base config |
| typescript-eslint | Dev | TypeScript lint rules |
| eslint-config-prettier | Dev | Prevent eslint/prettier conflicts |
| prettier | Dev | Code formatting |

**Total runtime dependencies: 2** (jsonata, commander). This is deliberately minimal. A library should have few runtime dependencies.

## Sources

- [jsonata npm package](https://www.npmjs.com/package/jsonata) -- version 2.1.0, built-in TypeScript types (HIGH confidence)
- [jsonata GitHub releases](https://github.com/jsonata-js/jsonata/releases) -- v2.1.0 latest, July 2024 (HIGH confidence)
- [jsonata source code (jsonata.js)](https://github.com/jsonata-js/jsonata/blob/master/src/jsonata.js) -- confirms `ast()` method on expression objects (HIGH confidence)
- [jsonata TypeScript definitions](https://github.com/jsonata-js/jsonata/blob/master/jsonata.d.ts) -- ExprNode type, Expression interface with ast() (HIGH confidence)
- [JSONata official docs](https://docs.jsonata.org/) -- ast() not documented but exists in code and types (MEDIUM confidence for long-term stability)
- [tsup npm](https://www.npmjs.com/package/tsup) -- v8.5.1 (HIGH confidence)
- [tsup documentation](https://tsup.egoist.dev/) (HIGH confidence)
- [tsdown npm](https://www.npmjs.com/package/tsdown) -- v0.21.0-beta.2, still beta (HIGH confidence)
- [Vitest 4.0 announcement](https://vitest.dev/blog/vitest-4) -- stable release (HIGH confidence)
- [Vitest npm](https://www.npmjs.com/package/vitest) -- v4.0.18 (HIGH confidence)
- [commander npm](https://www.npmjs.com/package/commander) -- v14.0.3 (HIGH confidence)
- [TypeScript releases](https://github.com/microsoft/typescript/releases) -- 5.9 stable, 6.0 beta (HIGH confidence)
- [ESLint 10 release](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/) -- v10.0.2 (HIGH confidence)
- [typescript-eslint](https://typescript-eslint.io/) -- v8.56.1 (HIGH confidence)
- [Node.js releases](https://nodejs.org/en/about/previous-releases) -- Node 22 LTS, Node 24 LTS (HIGH confidence)
- [tsx npm](https://www.npmjs.com/package/tsx) -- v4.21.0 (HIGH confidence)
