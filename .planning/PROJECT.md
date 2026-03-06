# JSONata AST Path Analyzer

## What This Is

A TypeScript/Node library and CLI tool that statically analyzes JSONata expression ASTs to extract all data paths being read from the source JSON object. Given any expression — including those with variable assignments, filter predicates, lambda functions, parent operators, higher-order functions, and dynamically computed paths — it produces a complete list of every leaf path the expression touches, each annotated with a confidence level. Validated by 294 tests (unit + integration) across 7 bug fix categories and 5 real-world scenario categories with zero known analyzer bugs.

## Core Value

Given any JSONata expression, accurately identify every data path read from the input object — including paths accessed through variable assignments, filter predicates, and function arguments.

## Requirements

### Validated

- ✓ Parse JSONata expressions using the official JSONata parser — v1.0
- ✓ Walk the AST to extract all leaf data paths accessed from the input — v1.0
- ✓ Trace variable assignments back to their source data paths — v1.0
- ✓ Handle filter predicates as path reads — v1.0
- ✓ Mark dynamically computed paths with wildcards — v1.0
- ✓ Support full JSONata language: lambdas, custom functions, chained transforms, conditionals, sorting, grouping — v1.0
- ✓ Expose as a TypeScript library with a programmatic API — v1.0
- ✓ Provide a CLI wrapper for command-line usage — v1.0
- ✓ Handle parent operator (%) and context references — v1.0
- ✓ Handle recursive descent operator (**) — v1.0
- ✓ Exhaustive real-world integration tests (95 tests) covering multi-line expressions with complex objects — v1.1
- ✓ Data transformation pipeline scenarios (filter, map, reshape, apply, variable transforms) — v1.1
- ✓ Business rule expression scenarios (conditionals, lookups, cross-field calculations) — v1.1
- ✓ API response reshaping scenarios (nested payload extraction/flattening, parent operator) — v1.1
- ✓ Data export/format conversion scenarios (transform operator, group-by) — v1.1
- ✓ Edge case coverage (deep variable chains, nested HOFs, custom functions, CLI round-trip) — v1.1
- ✓ Filter predicate scope isolation in HOF contexts (4 bugs fixed) — v1.1.1
- ✓ Focus variable @$v double-prefix prevention (2 bugs fixed) — v1.1.1
- ✓ Parent operator walkPath through object constructor/block steps (2 bugs fixed) — v1.1.1
- ✓ $lookup HOF chaining with function argument extraction (2 bugs fixed) — v1.1.1
- ✓ Pipeline apply operator lambda binding and sort extraction (2 bugs fixed) — v1.1.1
- ✓ walkVariable .group property handling (1 bug fixed) — v1.1.1
- ✓ Array constructor sequential scope accumulation (1 bug fixed) — v1.1.1
- ✓ All 14 BUG(v1.2) tests unskipped and passing with 80+ regression tests — v1.1.1

### Active

- [ ] CI pipeline builds before testing so CLI round-trip tests pass

### Out of Scope

- Building a custom JSONata parser — use the official one (validated: parser adapter works perfectly)
- Evaluating/executing JSONata expressions — this is static analysis only
- Modifying or transforming JSONata expressions
- Runtime type inference on the source data
- JSON Schema validation — downstream concern; consumers cross-reference paths with schemas
- Visual AST explorer / GUI — separate product (JSONata Studio already has one)
- Language server protocol (LSP) — different product category entirely
- Non-standard JSONata extensions — platform-specific functions treated as opaque
- Performance caching — premature; JSONata expressions are typically short
- Incremental/streaming analysis — batch analysis is sufficient

## Context

Shipped v1.1.1 with 4,547 LOC TypeScript (1,189 source + 3,358 test).
Tech stack: TypeScript, Node.js, `jsonata` parser, Vitest, tsup (ESM-only).
294 tests (all passing, 0 skipped, 0 known bugs).

Architecture: `parse()` adapter -> recursive `walkNode()` dispatcher -> `buildPathString()` -> `deriveConfidence()` -> `PathResult[]`

Key helpers added in v1.1.1:
- `extractBasePaths()` — structural base path extraction for HOF lambda binding
- `filterToBasePaths()` — prefix-based path deduplication
- Three-tier scope-aware `walkFilterStages` — empty scope (bare fields), focus-only scope, full scope

No known tech debt. All previously-documented BUG(v1.2) issues resolved.

## Constraints

- **Tech stack**: TypeScript, Node.js, official `jsonata` package as the parser
- **Dependency**: Must use the official JSONata parser's AST output — don't re-implement parsing
- **Analysis type**: Static analysis only — no expression evaluation
- **Over-approximate**: Report a superset of actual paths rather than risk missing paths

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use official JSONata parser | Proven, complete, maintained — no reason to rewrite | ✓ Good — parser adapter pattern works cleanly |
| Static analysis only | Don't need runtime data to determine which paths are accessed | ✓ Good — confidence annotations communicate uncertainty |
| Wildcard for dynamic paths | Can't statically resolve computed property names, wildcard communicates "something here" | ✓ Good — `[*]` is intuitive and machine-parseable |
| Trace through variable assignments | Variables are just aliases to data paths — tracing gives complete picture | ✓ Good — multi-hop chains resolve correctly |
| Over-approximate by default | Report a superset of actual paths rather than risk missing paths | ✓ Good — users prefer false positives to missed dependencies |
| Custom AST types (discriminated union) | Official ExprNode is incomplete — missing path, filter, sort, bind, apply nodes | ✓ Good — single cast boundary in parse(), type-safe everywhere else |
| Two-pass architecture (walk then resolve) | Avoids variable ordering issues | ✓ Good — sequential block processing with scope accumulation |
| Immutable scope chain | Linked list of Maps with parent pointer, child scope per block | ✓ Good — prevents binding leakage, matches JSONata lexical scoping |
| Post-processing confidence | Derive confidence after dedup, not during walk | ✓ Good — no walker refactor needed, clean separation |
| Parent operator as `%` segment | Over-approximate rather than silent drop | ✓ Good — consumers can detect and handle |
| IntegrationFixture discriminated union | ExactFixture vs SubsetFixture with `never` fields for compile-time enforcement | ✓ Good — zero subset-match usage across 95 integration tests |
| BUG(v1.2) tracking via it.skip | Document correct expected output in skipped tests, not buggy actual output | ✓ Good — grep-able, shows what fix should produce |
| execFileSync for CLI round-trip | Bypasses shell expansion of $ in JSONata expressions | ✓ Good — 3/3 CLI round-trip tests pass cleanly |
| Ascending regression risk ordering | Fix isolated bugs first (Phase 14), pipeline second (Phase 15), coupled filter/focus last (Phase 16) | ✓ Good — each phase built on stable base, zero regressions |
| extractBasePaths for HOF binding | Structural base path extraction avoids filter predicate leak into lambda parameters | ✓ Good — clean separation of collection identity vs filter content |
| Three-tier scope-aware filter | Empty scope (bare fields), focus-only scope, full scope distinguishes path types in walkFilterStages | ✓ Good — eliminates both double-prefix and predicate leak bugs |
| Block-terminal base suppression | Block steps are pure projections; suppress base path to avoid redundant output | ✓ Good — correct semantics for `items.(expr)` patterns |

---
## Current Milestone: v1.1.2 CI Fix

**Goal:** Fix CI pipeline so all 294 tests pass — add build step before test run.

**Target features:**
- Add `pnpm build` step to CI workflow before `pnpm test`

---
*Last updated: 2026-03-06 after v1.1.2 milestone start*
