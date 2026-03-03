# JSONata AST Path Analyzer

## What This Is

A TypeScript/Node library and CLI tool that statically analyzes JSONata expression ASTs to extract all data paths being read from the source JSON object. Given any expression — including those with variable assignments, filter predicates, lambda functions, parent operators, and dynamically computed paths — it produces a complete list of every leaf path the expression touches, each annotated with a confidence level.

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

### Active

(None — next milestone requirements TBD via `/gsd:new-milestone`)

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

Shipped v1.0 with 1,964 LOC TypeScript (1,116 source + 848 test).
Tech stack: TypeScript, Node.js, `jsonata` parser, Vitest, tsup (ESM-only).
105 tests covering all 23 requirements with 0 failures.

Architecture: `parse()` adapter → recursive `walkNode()` dispatcher → `buildPathString()` → `deriveConfidence()` → `PathResult[]`

Known tech debt (non-critical):
- `$sort` higher-order semantics defined but untested (handled by walkSortTerms, not via HIGHER_ORDER_SEMANTICS)
- `$lookup` not in HIGHER_ORDER_SEMANTICS; standalone BindNode outside block untested

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

---
*Last updated: 2026-03-03 after v1.0 milestone*
