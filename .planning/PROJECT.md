# JSONata AST Path Analyzer

## What This Is

A TypeScript/Node library and CLI tool that statically analyzes JSONata expression ASTs to extract all data paths being read from the source JSON object. Given any expression — including those with variable assignments, filter predicates, lambda functions, parent operators, and dynamically computed paths — it produces a complete list of every leaf path the expression touches, each annotated with a confidence level. Validated by 200 integration and unit tests across 5 real-world scenario categories.

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

### Active

- [ ] Fix filter predicate path leak into HOF bindings (4 bugs)
- [ ] Fix $lookup HOF chaining losing function arguments (2 bugs)
- [ ] Fix focus variable @$v double-prefix (2 bugs)
- [ ] Fix parent operator walkPath missing object constructor/block steps (2 bugs)
- [ ] Fix pipeline duplicate path extraction (2 bugs)
- [ ] Fix walkVariable missing .group property (1 bug)
- [ ] Fix array constructor scope leak in standalone BindNode (1 bug)
- [ ] Unskip all 14 BUG(v1.2) tests and make them pass
- [ ] Thorough regression test suite (10+ new tests per bug category)

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

Shipped v1.1 with 3,510 LOC TypeScript (1,116 source + 2,394 test).
Tech stack: TypeScript, Node.js, `jsonata` parser, Vitest, tsup (ESM-only).
200 tests (105 unit + 95 integration) with 0 failures and 14 skipped (documented bugs).

Architecture: `parse()` adapter → recursive `walkNode()` dispatcher → `buildPathString()` → `deriveConfidence()` → `PathResult[]`

Known tech debt (14 bugs documented with `BUG(v1.2)` tracking in `it.skip` fixtures):
- Filter predicate path leak into HOF bindings (4 instances)
- $lookup HOF chaining loses function arguments (2 instances)
- Focus variable @$v double-prefix (2 instances)
- Parent operator walkPath misses object constructor/block steps (2 instances)
- Pipeline duplicate path extraction (2 instances)
- walkVariable missing .group property (1 instance)
- Array constructor scope leak in standalone BindNode (1 instance)

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

## Current Milestone: v1.1.1 Bug Fixes

**Goal:** Fix all 14 documented BUG(v1.2) analyzer bugs and build thorough regression test suites around each fix area.

**Target features:**
- Fix all 14 tracked bugs across 7 categories (filter predicate leak, $lookup HOF chaining, focus variable double-prefix, parent operator walkPath, pipeline duplicates, walkVariable .group, array constructor scope)
- Unskip all 14 it.skip test fixtures
- Thorough regression coverage (10+ new tests per bug category)

---
*Last updated: 2026-03-05 after v1.1.1 milestone started*
