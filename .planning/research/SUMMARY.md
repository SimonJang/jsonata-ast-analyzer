# Project Research Summary

**Project:** JSONata AST Path Analyzer — v1.1.1 Bug Fixes
**Domain:** Recursive AST walker correctness fixes (static analysis tooling)
**Researched:** 2026-03-05
**Confidence:** HIGH

## Executive Summary

This milestone is a pure bug-fix release targeting 14 documented correctness failures in the JSONata AST path extraction walker (`walker.ts`). The bugs fall into 7 categories spanning scope propagation, path prefixing, step-type handling gaps, and HOF parameter binding — all isolated to a single 626-line source file. The existing stack (TypeScript 5.9, Vitest 4.0, jsonata 2.1, tsup 8.5, pnpm 10.30) is fully adequate; zero new dependencies, config changes, or tooling additions are warranted. All 14 bugs are verified by `it.skip` fixtures with documented expected outputs, and all fixes are confirmed as pure logic changes with no architectural changes required.

The recommended approach is strictly sequential fix ordering, from lowest regression risk to highest. The four isolated single-function fixes (walkPath object/block steps, walkVariable .group + sort, $lookup chaining, inline lambda apply) should be completed first because they are additive and have bounded blast radius. The filter predicate leak and focus variable double-prefix bugs share a root cause in `walkFilterStages` scope-aware prefixing and must be tackled together last, after a stable base of 10 additional passing tests is established. Each fix must be committed separately and followed by a full test suite run before proceeding to the next.

The primary risk in this milestone is the filter predicate scope isolation fix: the fix touches the HOF parameter binding path used by 40+ existing passing tests. A string-heuristic approach to separating "base paths" from "predicate paths" will produce false positives on legitimate nested paths like `orders.items`. The only safe approach is structural — either walking the data argument's base node separately from its filter stages via an `extractBasePaths()` helper, or using a `walkNodeForBinding()` helper that skips predicate side effects. Any modification to `walkHigherOrderCall` or `walkFilterStages` must be immediately followed by the complete 200-test suite run before moving on.

## Key Findings

### Recommended Stack

All bugs are logic errors in `walker.ts`; no additional dependencies are required. The existing `jsonata.ast()` method is the primary debugging tool for verifying parser output for any ambiguous AST shape — critical for bugs where the fix depends on knowing the exact node structure the parser produces (specifically bugs 2, 4, 6, and 7). Vitest's `it.skip` mechanism is the bug-tracking device; unskipping each fixture is the activation step for verifying each fix. Coverage should be run ad-hoc with `vitest run --coverage` after each phase rather than enforcing thresholds that add friction during iterative fixing.

**Core technologies:**
- TypeScript 5.9.3: Type-safe walker/scope implementation — strict mode catches AST node shape errors at compile time
- jsonata 2.1.0: Parser only; `ast()` method used for debugging AST structure — the bugs are in the walker, not the parser
- Vitest 4.0.18: Test runner; `it.skip` tracks the 14 unfixed bugs; `assertFixture()` validates path array correctness with sorted comparison
- @vitest/coverage-v8 4.0.18: Branch coverage verification post-fix — confirms new code paths are exercised; no enforcement thresholds
- tsup 8.5.1: ESM-only bundler — no changes needed for bug fixes
- pnpm 10.30.3: Package manager — lockfile stable, no changes needed

### Expected Features

This milestone adds no new capabilities. Every deliverable is a correction to documented incorrect behavior. The "features" are correctness guarantees that users already expect but do not currently receive.

**Must fix (table stakes — wrong output for valid JSONata expressions):**
- Filter predicate scope isolation — `$map(items[active], fn)` must NOT produce `items.active.name`; 4 bugs; highest user impact because spurious paths corrupt consumer trust in every HOF+filter combination
- Focus variable prefix deduplication — `orders@$o[$o.total > 100]` must NOT produce `orders.orders.total`; 2 bugs; visibly wrong double-prefixed output
- Parent operator walkPath for unary/block steps — object constructor and block steps in path sequences are silently dropped, inner paths lost; 2 bugs
- $lookup HOF chaining with argument preservation — `$lookup(inventory, itemCode).quantity` must extract all three paths; 2 bugs
- walkVariable .group property — variable-resolved group-by drops key/value expression paths; 1 bug
- Array constructor scope propagation — `[$x := data.source, $x.field]` must resolve `$x` in subsequent array elements; 1 bug
- Apply operator inline lambda binding — `data ~> function($d) { $d.count }` must bind `$d` to `["data"]`; 1 bug
- Variable-resolved sort path extraction — `($x := items; $x^(price))` must extract sort key path `items.price`; 1 bug

**Should have (regression test coverage — distinguishes careful fix from fragile patch):**
- Predicate isolation regression suite — 10+ tests: multi-stage filters, nested HOFs, variable-bound intermediates, chained applies
- Focus/context variable regression suite — 10+ tests: nested `@$outer`, focus var shadowing, focus combined with `#$i` positional index
- Parent operator regression suite — 10+ tests: multi-level `%.%.field`, parent in lambda body, parent at different nesting depths
- HOF chaining regression suite — 10+ tests: suffix depth variations, other HOFs as path steps
- Scope propagation regression suite — 10+ tests: multi-bind arrays, group-by multi-key, sort descending, multi-param lambda

**Defer (v2+, explicitly not building):**
- Predicate path type tagging in public `PathResult` API — breaks consumer contracts for an internal concern
- Runtime-aware path resolution — contradicts "static analysis only" design principle; requires input data
- Partial bug fix release — inconsistent behavior for users; shared root causes make full fix cheaper than half fix
- Scope chain refactor to dynamic scoping — would break 40+ correctly-passing tests that rely on lexical scope isolation

### Architecture Approach

All fixes are concentrated in `walker.ts` — no other source files require modification. The architecture is a recursive type-dispatch walker (`walkNode` switches on 17 node types), with scope managed via an immutable linked-list `ScopeTracker`. The bugs represent gaps in the step-iteration loop of `walkPath` (missing step types: function, unary, block), incorrect "all paths are equivalent" assumptions in `walkFilterStages` and `walkHigherOrderCall`, and missing sequential scope accumulation in `walkUnary` for array constructors. The core design (flat `string[]` returns, single dedup at `extractPaths`, immutable scope chain) is correct and must not be changed.

**Major components and their bug-fix changes:**
1. `walkPath()` — Add: function-step handling for $lookup chaining (Bug 2); unary/block step handling for parent operator (Bug 4); sort walking in variable branch (Bug 5a); group-by in variable branch (Bug 6)
2. `walkFilterStages()` — Change: scope-aware prefixing that distinguishes locally-relative paths (need prefix) from scope-resolved paths (already absolute, skip prefix) for Bugs 1 and 3
3. `walkHigherOrderCall()` — Change: bind only base collection paths to lambda parameters, not predicate side-effect paths; use new `extractBasePaths()` helper for the binding step (Bug 1)
4. `walkApply()` — Add: `rhs.type === "lambda"` branch with first-parameter binding to lhs paths, including thunk detection guard (Bug 5b)
5. `walkUnary()` `[` case — Change: sequential scope accumulation for array elements when bind nodes are direct children, mirroring `walkBlock` pattern (Bug 7)
6. New helper `extractBasePaths(node, scope)` — Walk a node returning only base data paths without filter predicate side effects; used by `walkHigherOrderCall` for parameter binding

**Unchanged components:** `scope.ts`, `path-builder.ts`, `types.ts`, `index.ts`, `builtins.ts` — none require modification. Estimated total change: 80-120 lines in `walker.ts`.

### Critical Pitfalls

1. **Filter predicate fix via string matching** — Stripping "predicate-like" paths from HOF data arguments using string heuristics (e.g., "any path that is a suffix of another") will false-positive on legitimate nested paths like `orders.items`. Prevention: structural separation — walk the data arg's base node separately from filter stages using `extractBasePaths()`; never strip by string content matching.

2. **Focus variable prefix fix via blind skip** — "Never prefix variable-resolved paths" will break bare field names in filters that legitimately need prefixing (`items[name = "x"]` → `items.name`). Prevention: in `walkFilterStages`, walk variable-node sub-expressions and emit their resolved paths as-is; walk name/path node sub-expressions and apply `prefixPaths`. Distinguish at the node type level, not by string inspection.

3. **walkUnary scope accumulation applied globally** — Copying `walkBlock`'s sequential scope accumulation into `walkUnary` for ALL array elements will leak variable bindings to sibling elements contrary to JSONata's independent-element array semantics. Prevention: accumulate scope only when a bind node is a DIRECT child of the array constructor (not nested); verify the exact parser AST shape with `jsonata.ast()` before implementing.

4. **walkPath catch-all step handling** — Adding a `default:` case in the step iteration loop that calls `walkNode` on any unrecognized step type can cause infinite recursion via `walkNode` → `walkPath` → `walkNode`. Prevention: add EXPLICIT `case "unary":` and `case "block":` case handlers only; never use a catch-all default for step walking.

5. **Fix ordering causing cascading failures** — Filter predicate leak (4 bugs) and focus variable double-prefix (2 bugs) both modify `walkFilterStages` and `prefixPaths`. Attempting these before independent fixes are stable creates diagnostic noise that obscures which change caused a given regression. Prevention: complete all independent fixes first (Bugs 7, 6, 4, 2, 5a, 5b), then design and implement Bugs 1 and 3 together as the final coupled unit. Commit each individual fix separately with a full test suite run between each.

## Implications for Roadmap

Based on combined research, the 14 bugs decompose cleanly into three phases ordered by independence and regression risk. The architecture research's fix order (safest first) aligns with the features research's priority groups (P3 → P2 → P1). This convergence from two independent analyses makes the phase structure high-confidence.

### Phase 1: Isolated Single-Function Fixes (6 bugs across 4 fix areas)

**Rationale:** These four bug categories are fully independent of each other and of the filter-related bugs. Each is a purely additive change to a different function with no interaction risk. Fixing them first reduces failing tests from 14 to 8 and validates that the walker's core structure is sound before the harder work begins.

**Delivers:** 6 bugs fixed, 40+ regression tests across 4 new test files, full suite green at 8 remaining skipped tests

**Addresses:**
- Bug 7: Array constructor scope — rewrite `walkUnary "[" ` case with sequential scope accumulation mirroring `walkBlock`; detect bind as DIRECT child before activating accumulation; verify AST shape with `jsonata.ast()` first
- Bug 6: walkVariable .group + walkPath variable branch sort — audit all properties VariableNode can carry in a single pass; add group-by and sort-term handling to walkPath variable branch before returning
- Bug 4: Parent operator walkPath — add explicit `case "unary":` and `case "block":` in step loop; compute context prefix from `buildPathString(node.steps.slice(0, i))`; walk inner expressions via `walkNode(step, scope)` and prefix results
- Bug 2: $lookup HOF chaining — add function-step handling in walkPath step loop; walk function step via `walkNode(step, scope)` to extract argument paths; do NOT context-prefix function arguments (they are absolute, not context-relative)

**Avoids:** Pitfall 4 (explicit cases not catch-all), Pitfall 1 (bind-as-direct-child check), Pitfall 8 (audit .group AND sort together in single pass), Pitfall 9 (no context prefix on function step argument paths)

**Research flag:** Standard patterns — all changes are additive case handling with clear models in the existing codebase (`walkBlock` for scope accumulation, `walkGroupBy` for group-by logic, `walkSortTerms` for sort terms).

### Phase 2: Pipeline and Apply Fixes (2 bugs)

**Rationale:** Both pipeline bugs are independent of each other and of the filter-related bugs. The variable-resolved sort fix extends the walkPath variable branch (the same code area modified in Phase 1 for .group). The inline lambda apply fix extends `walkApply`. Grouping them in Phase 2 avoids revisiting Phase 1's walkPath variable branch a second time, and gets all additive fixes complete before the high-risk Phase 3 work begins.

**Delivers:** 8 bugs fixed total, 20+ additional regression tests for pipeline patterns, 6 remaining skipped tests

**Addresses:**
- Bug 5a: Variable-resolved sort — extend walkPath variable branch to also iterate remaining steps for sort nodes and walk their terms with resolved variable paths as the context prefix
- Bug 5b: Inline lambda apply — add `rhs.type === "lambda"` branch in `walkApply`; check `.thunk` flag first (thunks pass through to body); bind lambda's first parameter to `lhsPaths` and walk the body

**Avoids:** Pitfall 10 (thunk lambda confusion — explicit `.thunk` check before treating as user inline lambda), Pitfall 11 (all independent fixes complete before coupled filter fixes begin)

**Research flag:** Standard patterns — walkPath variable branch and walkApply are well-understood after Phase 1; the `walkLambdaWithBindings` pattern is the model for inline lambda parameter binding.

### Phase 3: Filter Predicate Scope-Awareness (6 bugs — coupled fix)

**Rationale:** Bugs 1 and 3 share the same root cause: `walkFilterStages` applies `prefixPaths` blindly to all paths returned by `walkNode` on the filter expression, regardless of whether those paths came from local field access (need prefix) or from variable resolution (already absolute). These must be designed and implemented together because they overlap in `walkFilterStages` and `prefixPaths`, and fixing one partially affects the other. Doing this last maximizes the stable base for regression detection — 8 of 14 bugs are already fixed, so any regression introduced here is unambiguously attributed to this phase's changes.

**Delivers:** All 14 bugs fixed, full regression suite complete (70+ new tests across 7 files), milestone complete

**Addresses:**
- Bug 1: Filter predicate path leak — add `extractBasePaths(node, scope): string[]` helper that walks a node's base path without filter stage side effects; modify `walkHigherOrderCall` to call `extractBasePaths` for lambda parameter binding while keeping `walkNode` for result path accumulation
- Bug 3: Focus variable double-prefix — modify `walkFilterStages` to walk filter expression sub-nodes with scope awareness; emit variable-resolved paths as-is (no prefix); apply `prefixPaths` only to paths from locally-relative name/path nodes

**Avoids:** Pitfall 2 (structural not string-based separation of base/predicate paths), Pitfall 3 (scope-aware filter walking at the node-type level, not by string inspection), Pitfall 6 (new `extractBasePaths` helper instead of modifying `walkHigherOrderCall` directly), Pitfall 13 (verify no fix removes paths that are genuinely reachable)

**Research flag:** Pre-implementation design required. Before writing code, sketch the `extractBasePaths()` function signature and the `walkFilterStages` scope-awareness mechanism in detail. Choose one of the two approaches documented in ARCHITECTURE.md and record the decision. Verify the parser AST shape for `items[active]` and `orders@$o[...]` with `jsonata.ast()`. No external research needed — all implementation context is in the research files.

### Phase Ordering Rationale

- **Independence first:** Bugs 7, 6, 4, 2, 5a, 5b are all additive changes to separate functions with no shared code paths. Completing them first eliminates 10 of 14 failures and leaves a stable, well-tested base for the riskiest work.
- **Coupled last:** Bugs 1 and 3 both modify `walkFilterStages` — designing and implementing them together avoids two passes over high-risk shared code, reduces the chance of conflicting partial fixes, and ensures the test evidence for each is clean.
- **Regression risk ascending per phase:** Phase 1 fixes have LOW regression risk (additive); Phase 2 has LOW risk; Phase 3 has HIGH risk (40+ existing tests touch the modified HOF and filter code paths). The ascending risk structure means each phase's test runs are simpler to reason about.
- **Sequential commits, not sequential phases:** Each individual fix should be a separate git commit with a full `vitest run` in between. Do not batch multiple fixes in a single commit. This enables `git bisect` to pinpoint regressions precisely.

### Research Flags

Phases needing deeper design work before implementation:
- **Phase 3 (pre-implementation):** Design the `extractBasePaths()` helper interface and the `walkFilterStages` scope-awareness mechanism explicitly before any code changes. ARCHITECTURE.md documents two viable options for each — select one, document the rationale, then implement. Run `jsonata.ast()` on the four affected expressions to confirm the AST shapes the fix depends on.

Phases with standard patterns (no additional research needed):
- **Phase 1:** All four fixes have direct models in the existing codebase. `walkBlock` is the model for scope accumulation; `walkGroupBy` is the model for group-by walking; `walkSortTerms` is the model for sort term walking. The change in each case is applying the existing pattern to a new call site.
- **Phase 2:** Both fixes are small additive branches in well-understood functions. The existing `walkLambdaWithBindings` call pattern is the model for inline lambda binding in `walkApply`.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via `pnpm list --depth 0`. Zero new dependencies confirmed by direct source analysis of all 7 bug categories. |
| Features | HIGH | All 14 bugs documented by `it.skip` fixtures with explicit expected outputs; root causes traced to specific lines in walker.ts; fix locations identified precisely. |
| Architecture | HIGH | All analysis based on direct source code examination of walker.ts (626 lines), scope.ts (97 lines), all type definitions, and all 14 bug fixture AST traces. No external references needed. |
| Pitfalls | HIGH | 13 specific pitfalls identified with detection signatures (warning signs) and concrete prevention strategies, all grounded in the actual source code and interaction patterns between walker functions. |

**Overall confidence:** HIGH

### Gaps to Address

- **Parser AST shape for ambiguous nodes:** Three bugs (4, 7, and 10/5b) require knowing the exact AST node structure the jsonata parser generates for specific expressions. ARCHITECTURE.md recommends running `jsonata.ast()` on the affected expressions and inspecting the output before implementing those fixes. This is a pre-implementation step, not a research gap — the tool (`jsonata.ast()`) is already available as a production dependency.

- **`extractBasePaths()` helper design decision:** The filter predicate fix strategy is defined at the conceptual level in ARCHITECTURE.md (walk data arg's base node without filter stages) but the exact function signature and the `walkFilterStages` scope-awareness mechanism need a concrete design choice before Phase 3 coding begins. Two viable options are documented; pick one and record the decision in the phase plan.

- **Regression test exact expressions:** STACK.md recommends 10+ tests per bug category (70+ total new tests). The specific expressions for each regression test are not pre-enumerated — they will be composed during each phase based on the edge case lists in FEATURES.md. This is expected and appropriate; the edge case categories (multi-stage filters, nested HOFs, etc.) provide sufficient guidance for the test author.

## Sources

### Primary (HIGH confidence)
- Direct source code analysis: `src/walker.ts` (626 lines), `src/scope.ts` (97 lines), `src/types.ts` (213 lines), `src/index.ts` (46 lines), `src/path-builder.ts` (33 lines), `src/builtins.ts` (46 lines)
- Bug documentation: 14 `it.skip` fixtures across `test/integration/data-transforms.test.ts`, `test/integration/business-rules.test.ts`, `test/integration/api-reshaping.test.ts`, `test/integration/data-export.test.ts`, `test/integration/edge-cases.test.ts`
- Unit test baseline: 105 passing tests in `test/extract-paths.test.ts`
- Integration test baseline: 186 passing tests across 5 integration test files
- Project context: `.planning/PROJECT.md`, `.planning/MILESTONES.md`, `.planning/STATE.md`
- Package versions: `pnpm list --depth 0` output confirming all installed versions

### Secondary (MEDIUM confidence)
- JSONata parser AST structure: inferred from `src/types.ts` type definitions and `jsonata.ast()` output referenced in bug analysis — parser internals not directly inspected in the parser's own source code

### Tertiary (LOW confidence)
- None — all research findings are grounded in direct codebase analysis of the project's own source files and test fixtures

---
*Research completed: 2026-03-05*
*Ready for roadmap: yes*
