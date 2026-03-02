---
phase: 01-foundation-and-basic-walker
plan: 01
subsystem: infra
tags: [typescript, jsonata, vitest, tsup, esm, ast]

# Dependency graph
requires: []
provides:
  - "Project scaffold: pnpm, TypeScript strict, Vitest, tsup, ESM-only"
  - "Custom discriminated-union AST types (AstNode with 13 node types + GenericNode)"
  - "PathResult interface for stable public API contract"
  - "parse() function bridging jsonata parser to typed AstNode"
affects: [01-02, 02-variable-tracing, 03-filter-sort, 04-confidence, 05-public-api]

# Tech tracking
tech-stack:
  added: [jsonata@2.1.0, typescript@5.9.3, vitest@4.0.18, tsup@8.5.1, "@vitest/coverage-v8@4.0.18"]
  patterns: [discriminated-union-ast, parser-adapter-cast-boundary, esm-only-module]

key-files:
  created: [package.json, tsconfig.json, vitest.config.ts, tsup.config.ts, src/index.ts, src/types.ts, src/parser.ts]
  modified: [.gitignore]

key-decisions:
  - "Package name: jsonata-ast-analyzer (broader than path-extractor for future phases)"
  - "ESM .js extensions in relative imports for Node.js ESM compat"
  - "Single cast boundary in parse() -- all downstream code uses discriminated unions"
  - "GenericNode catch-all with index signature for unhandled AST node types"
  - "passWithNoTests in vitest config so zero-test runs exit cleanly"

patterns-established:
  - "Discriminated union on node.type field for exhaustive switch handling"
  - "Parser adapter pattern: cast at boundary, type-safe everywhere else"
  - "PathResult wrapper from day one for API stability"

requirements-completed: [PATH-05]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 1 Plan 01: Project Scaffold and Type Foundation Summary

**ESM TypeScript project with jsonata@2.1.0, custom discriminated-union AST types (13 node interfaces + GenericNode), and parse() adapter**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T13:50:37Z
- **Completed:** 2026-03-02T13:53:18Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Fully functional TypeScript project scaffold with pnpm, strict mode, Vitest, tsup, ESM-only output
- Custom discriminated-union AST types covering all Phase 1 node types: path, name, wildcard, descendant, binary, condition, block, unary, string, number, value, variable, regex, plus GenericNode catch-all
- PathResult interface with `path: string` field established as the stable public API contract
- parse() adapter bridging jsonata parser to typed AstNode with single cast boundary

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize project scaffold** - `e75eedc` (chore)
2. **Task 2: Define custom AST types and parser adapter** - `ce4a16d` (feat)

## Files Created/Modified
- `package.json` - Project manifest with jsonata, typescript, vitest, tsup dependencies; ESM-only module config
- `pnpm-lock.yaml` - Lockfile for reproducible installs
- `tsconfig.json` - TypeScript strict mode, ES2022 target, bundler moduleResolution
- `vitest.config.ts` - Vitest with globals and passWithNoTests
- `tsup.config.ts` - ESM build with dts and sourcemaps
- `src/index.ts` - Public API entry point placeholder
- `src/types.ts` - Custom AST discriminated union types and PathResult interface
- `src/parser.ts` - Thin wrapper around jsonata() returning typed AstNode

## Decisions Made
- Package name set to `jsonata-ast-analyzer` (broader scope for future phases)
- Used `.js` extensions in TypeScript relative imports for ESM compatibility
- Single type cast at the parser boundary (`as AstNode`) -- all downstream code uses discriminated unions
- GenericNode uses index signature `[key: string]: unknown` for forward compatibility with unhandled node types
- Added `passWithNoTests: true` to vitest config so zero-test state exits cleanly (code 0)
- Approved esbuild build scripts via `pnpm.onlyBuiltDependencies` in package.json

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added passWithNoTests to vitest config**
- **Found during:** Task 1 (Initialize project scaffold)
- **Issue:** Vitest exits with code 1 when no test files exist, failing the "pnpm test passes" verification
- **Fix:** Added `passWithNoTests: true` to vitest.config.ts test options
- **Files modified:** vitest.config.ts
- **Verification:** `pnpm test` exits with code 0
- **Committed in:** e75eedc (Task 1 commit)

**2. [Rule 3 - Blocking] Approved esbuild build scripts**
- **Found during:** Task 1 (Initialize project scaffold)
- **Issue:** pnpm blocked esbuild's postinstall script (required by tsup), showing a build approval warning
- **Fix:** Added `pnpm.onlyBuiltDependencies: ["esbuild"]` to package.json
- **Files modified:** package.json
- **Verification:** `pnpm install` completes without warnings, esbuild binary available
- **Committed in:** e75eedc (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes were necessary for the scaffold to function. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All dependencies installed and verified
- AST types ready for walker implementation in Plan 02
- parse() function tested empirically against jsonata 2.1.0
- TypeScript strict mode + Vitest infrastructure ready for TDD in Plan 02

## Self-Check: PASSED

All 8 files verified present. Both commits (e75eedc, ce4a16d) confirmed in git log. src/types.ts exports 16 items, src/parser.ts exports 1 item. pnpm typecheck and pnpm test both pass.

---
*Phase: 01-foundation-and-basic-walker*
*Completed: 2026-03-02*
