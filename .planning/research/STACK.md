# Stack Research

**Domain:** Bug fixes for JSONata AST path extraction walker (v1.1.1)
**Researched:** 2026-03-05
**Confidence:** HIGH

## Verdict: No Stack Additions Needed

All 14 bugs are logic errors in `walker.ts` and `scope.ts`. They involve incorrect scope propagation, missing AST step handling, and flawed path prefixing. The existing stack (TypeScript 5.9, Vitest 4.0, jsonata 2.1, tsup 8.5) is fully sufficient. No new dependencies, libraries, or tools are warranted.

## Current Stack (Retain As-Is)

### Core Technologies

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| TypeScript | 5.9.3 | Type-safe walker/scope implementation | KEEP -- strict mode catches shape errors in AST handling |
| Node.js | 22+ (ES2022 target) | Runtime | KEEP |
| jsonata | 2.1.0 | Parser for AST generation via `ast()` | KEEP -- parser output is correct; bugs are in our walker |
| Vitest | 4.0.18 | Test runner with `it.skip` for bug tracking | KEEP -- all 14 bugs use `it.skip` fixtures |
| @vitest/coverage-v8 | 4.0.18 | Code coverage via V8 | KEEP -- verify fix completeness |
| tsup | 8.5.1 | ESM-only bundler | KEEP |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| pnpm 10.30.3 | Package manager | Lockfile already stable, no changes needed |
| `vitest run --reporter=verbose` | See individual skip/pass/fail per fixture | Already available, no config change |
| `vitest run --coverage` | Branch coverage for walker/scope changes | Verify all new code paths are exercised after fixes |

## Bug-by-Bug Stack Assessment

All 7 bug categories are **pure logic fixes** in existing source files. Here is why no new tooling is needed for each.

### 1. Filter Predicate Path Leak into HOF Bindings (4 bugs)

**Root cause:** When `items[active]` is the data argument to `$map()`, `walkNode(dataArg)` returns both `items` AND `items.active` (the filter predicate path). These paths are then ALL bound as the element variable (e.g., `$v`), so `$v.name` resolves to both `items.name` AND `items.active.name` (spurious).

**Fix location:** `walkHigherOrderCall()` in `walker.ts` -- the `dataArgPaths` passed to `walkLambdaWithBindings()` must be filtered to only include the base collection path(s), not the filter predicate sub-paths. Alternatively, separate "binding paths" from "reported paths" when walking the data argument.

**Stack needed:** None. This is a path-filtering logic change within existing functions.

### 2. $lookup HOF Chaining (2 bugs)

**Root cause:** `$lookup(inventory, itemCode).quantity` parses as a PathNode with steps `[FunctionNode($lookup), NameNode(quantity)]`. `walkPath()` calls `buildPathString()` which skips the FunctionNode step (it is not name/wildcard/descendant/parent), producing only `quantity`. The function arguments `inventory` and `itemCode` are never walked because `walkPath()` does not handle function-type steps.

**Fix location:** `walkPath()` in `walker.ts` -- add handling for function call steps in the step-iteration loop, walking them to extract their argument paths.

**Stack needed:** None. This is a missing case in the step-iteration loop.

### 3. Focus Variable @$v Double-Prefix (2 bugs)

**Root cause:** `orders@$o[$o.total > 100]` -- the focus variable `$o` is bound to `["orders"]` in `walkFilterStages()`. When `$o.total` is walked inside the filter, it resolves to `["orders.total"]` via the scope chain (already an absolute path). But `walkFilterStages()` then calls `prefixPaths(contextPrefix="orders", filterPaths)`, producing `orders.orders.total` -- double-prefixed.

The related variant: `($cfg := config; items[$cfg.minPrice < price].name)` -- `$cfg.minPrice` resolves to `config.minPrice` (absolute), then gets prefixed with `items` context, producing `items.config.minPrice` (spurious).

**Fix location:** `walkFilterStages()` in `walker.ts` -- paths originating from variable resolution (already absolute/rooted) must NOT be re-prefixed with the filter context. Only locally-relative filter paths (e.g., bare `price` from the filter expression) should be prefixed.

**Stack needed:** None. Logic fix to distinguish between locally-relative and already-resolved paths.

### 4. Parent Operator walkPath Missing Steps (2 bugs)

**Root cause:** `orders.items.{"itemName": name, "orderDate": %.date}` -- the object constructor (`{...}`) appears as a step in `PathNode.steps`. `walkPath()` only handles `name`, `sort`, and `variable` step types in its iteration loop. Steps of type `unary` (object constructor) and `block` are skipped entirely. All inner paths (including parent references) are silently dropped.

**Fix location:** `walkPath()` in `walker.ts` -- add cases for `unary` and `block` step types in the step iteration loop. Walk their inner expressions and prefix results with the context built from preceding steps.

**Stack needed:** None. Missing case handling in the existing step-iteration loop.

### 5. Pipeline Duplicate Paths (2 bugs)

**Root cause (bug a):** `items ~> $filter(...) ~> $map(...)` -- chained applies cause the first apply's paths to be walked multiple times. The filter predicate paths leak through the HOF binding (overlaps with bug #1). The existing `Set`-based dedup in `extractPaths()` handles literal duplicates; the real issue is the spurious predicate-prefixed paths from bug #1.

**Root cause (bug b):** `data ~> function($d) { $d.count }` -- `walkApply()` handles `rhs.type === "function"` but NOT `rhs.type === "lambda"`. When the RHS is a raw lambda (not a function call), it falls through to the `else` branch which walks the lambda via `walkNode()`, hitting `walkLambda()` which returns `[]` for non-thunk lambdas. The lambda's parameter is never bound to the piped data.

**Fix location:** `walkApply()` in `walker.ts` -- add a `rhs.type === "lambda"` case that binds the lambda's first parameter to `lhsPaths` and walks the body. Bug (a) resolves when bug #1 is fixed.

**Stack needed:** None.

### 6. walkVariable Missing .group (1 bug)

**Root cause:** `($r := data.records; $r{category: $sum(amount)})` -- the variable reference `$r` has a `.group` property (the group-by expression attached by the parser), but `walkVariable()` only checks for `.predicate` (filter stages). The group-by key/value expressions are silently dropped.

**Fix location:** `walkVariable()` in `walker.ts` -- after handling predicates, check for `.group` on the VariableNode and walk the group-by expressions. Reuse the existing `walkGroupBy()` pattern, adapting for a VariableNode's resolved paths as the base context.

**Stack needed:** None. Mirror existing `.predicate` handling to also cover `.group`.

### 7. Array Constructor Scope Leak (1 bug)

**Root cause:** `[$x := data.source, $x.field]` -- the array constructor (`[...]`) is handled by `walkUnary()` which uses `flatMap((e) => walkNode(e, scope))`. Each element receives the **same** scope, so `$x := data.source` (a BindNode) walks the RHS but does not propagate the binding to subsequent elements. `$x.field` in the next element fails to resolve `$x`.

**Fix location:** `walkUnary()` in `walker.ts` -- for array constructors (`value === "["`) containing bind expressions, use sequential scope-accumulation (the same pattern as `walkBlock()`). Process elements sequentially, propagating bindings from bind expressions to subsequent elements.

**Stack needed:** None. Reuse the sequential scope-accumulation pattern from `walkBlock()`.

## Debugging Strategy (Existing Tools Only)

### AST Inspection via jsonata.ast()

The `jsonata` package's `ast()` method is the primary debugging tool for understanding what the parser produces. This is already available as a production dependency.

```typescript
import jsonata from "jsonata";
const ast = jsonata('items[active] ~> $map(function($v) { $v.name })').ast();
console.log(JSON.stringify(ast, null, 2));
```

Critical for bugs #2 (seeing FunctionNode in PathNode.steps), #4 (seeing unary/block in steps), #6 (seeing .group on VariableNode), and #7 (seeing BindNode inside unary expressions).

### Vitest Debugging Commands

| Feature | Command | Use Case |
|---------|---------|----------|
| Run single test | `vitest run -t "filter-map pipeline"` | Focus on one bug at a time |
| Unskip and run | Change `it.skip` to `it` | Verify fix for specific bug |
| Verbose output | `vitest run --reporter=verbose` | See all test names in results |
| Coverage report | `vitest run --coverage` | Verify new code paths are exercised |
| Watch mode | `vitest --reporter=verbose` | Rapid iteration during fixes |
| Type checking | `pnpm typecheck` | Catch type errors after walker changes |

### Regression Test Pattern (Using Existing Helpers)

The existing `IntegrationFixture` type with `assertFixture()` helper is the right pattern for regression tests. Use `ExactFixture` mode (not `SubsetFixture`) since the expected output for each regression case should be fully known.

```typescript
const regressionFixtures: IntegrationFixture[] = [
  {
    name: "regression: filter predicate does not leak into $map element binding",
    expression: `$map(items[status = "active"], function($v) { $v.price })`,
    expectedPaths: [
      { path: "items", confidence: "static" },
      { path: "items.price", confidence: "static" },
      { path: "items.status", confidence: "static" },
    ],
  },
];
```

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| AST visualization libraries (`ast-types`, `recast`) | Wrong ecosystem -- those handle JS ASTs, not JSONata ASTs. Our AST is proprietary from the jsonata parser. | `JSON.stringify(ast, null, 2)` for inspection |
| Snapshot testing (`toMatchSnapshot`) | Bug fix tests need exact assertions to document correct behavior. Snapshots hide intent and make it unclear what the correct output should be. Regression tests must state what is expected. | `ExactFixture` with `assertFixture()` |
| Property-based testing (`fast-check`) | JSONata expressions are structured text with specific semantics. Generating valid JSONata ASTs that trigger these specific bug patterns is impractical and would not target the known bugs. | Write targeted regression fixtures for each bug variant |
| Additional assertion libraries (`chai`, `jest-extended`) | Vitest's built-in `expect().toEqual()` is sufficient for path array comparison. The `assertFixture()` helper already handles sorting and diff messages. | Keep using `assertFixture()` |
| Debug logging libraries (`debug`, `pino`, `winston`) | The walker is pure functional (AST in, string[] out). `console.log` with `JSON.stringify` is sufficient for temporary debugging during development. | Temporary `console.log` during fix development, remove before commit |
| Code coverage threshold config | @vitest/coverage-v8 is already installed. Adding coverage thresholds adds friction during iterative bug fixing. Run coverage ad-hoc to verify after fixes are complete. | `vitest run --coverage` on demand |
| Mutation testing (`stryker-mutator`) | Overkill for bug fixes. We already know the bugs exist and have exact expected outputs. Mutation testing is for discovering undertested code, not for fixing known bugs. | Write 10+ targeted regression tests per bug category |
| Test helper libraries (`testing-library`) | No DOM or component testing. Pure function testing of `extractPaths()`. | Existing `assertFixture()` helper |

## Recommended Test Organization for v1.1.1

Keep regression tests alongside the existing integration tests. Add a `regression/` subdirectory for the new 70+ regression tests (10+ per bug category):

```
test/
  extract-paths.test.ts              # 105 unit tests (unchanged)
  integration/
    data-transforms.test.ts           # Unskip 4 BUG(v1.2) tests
    business-rules.test.ts            # Unskip 2 BUG(v1.2) tests
    api-reshaping.test.ts             # Unskip 4 BUG(v1.2) tests
    data-export.test.ts               # Unskip 1 BUG(v1.2) test
    edge-cases.test.ts                # Unskip 2 BUG(v1.2) tests + 1 sort
    helpers.ts                        # Existing assertFixture/sortPaths
    helpers.test.ts                   # Existing helper tests
    regression/                       # NEW: 10+ tests per bug category
      filter-predicate-leak.test.ts   # Variations on filter + HOF binding
      lookup-hof-chaining.test.ts     # $lookup().field patterns
      focus-variable-prefix.test.ts   # @$v double-prefix scenarios
      walkpath-steps.test.ts          # Unary/block steps in paths
      pipeline-duplicates.test.ts     # Chained ~> and lambda piping
      variable-group.test.ts          # Variable-resolved group-by
      array-constructor-scope.test.ts # Bind within array constructor
```

Vitest's default `include` glob already picks up `test/**/*.test.ts`. No config changes needed.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| jsonata@2.1.0 | TypeScript 5.9 | Parser output (AST shape) is stable. Bug fixes are in our walker, not the parser. |
| vitest@4.0.18 | @vitest/coverage-v8@4.0.18 | Already matched versions. `it.skip` to `it` is the unskip mechanism. |
| tsup@8.5.1 | TypeScript 5.9 | ESM-only build. No changes needed for bug fixes. |
| @types/node@25.3.3 | Node.js 22+ | Only needed for CLI (`execFileSync`). No relevance to bug fixes. |

## Installation

```bash
# No new packages to install. Run existing setup:
pnpm install
pnpm build
pnpm test
```

## Summary

**Net new dependencies: 0**
**Config changes: 0**
**Stack changes: 0**
**New files: 7 regression test files in `test/integration/regression/`**

All 14 bugs are logic errors in `walker.ts` (12 bugs across 6 categories) and the interaction between `walkFilterStages()`/`walkVariable()`/`walkHigherOrderCall()` scope handling (bug #1 contributes to 4 bugs and overlaps with bug #5). The fixes involve:

1. Separating "binding paths" from "reported paths" in HOF data argument walking
2. Adding missing step type cases in `walkPath()` (function, unary, block)
3. Preventing re-prefixing of already-resolved variable paths in `walkFilterStages()`
4. Adding `rhs.type === "lambda"` handling in `walkApply()`
5. Adding `.group` handling in `walkVariable()`
6. Adding sequential scope accumulation in `walkUnary()` for array constructors

No external tooling, libraries, or framework changes are needed. The existing test infrastructure (`assertFixture()`, `IntegrationFixture`, Vitest) handles everything.

## Sources

- Codebase analysis: `src/walker.ts` (626 lines), `src/scope.ts` (97 lines), `src/types.ts` (213 lines), `src/builtins.ts` (46 lines), `src/path-builder.ts` (33 lines), `src/index.ts` (46 lines)
- Bug documentation: 14 `it.skip` fixtures across 5 integration test files with `BUG(v1.2)` comments
- Package versions: `pnpm list --depth 0` output confirming all installed versions (HIGH confidence)
- No external research needed: all bugs are internal logic errors in known source files with documented expected outputs

---
*Stack research for: JSONata AST path analyzer v1.1.1 bug fixes*
*Researched: 2026-03-05*
