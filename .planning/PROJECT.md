# JSONata AST Path Analyzer

## What This Is

A TypeScript/Node library and CLI tool that analyzes JSONata expression ASTs to extract all data paths being read from the source JSON object. It uses the official JSONata parser to produce the AST, then walks that tree to produce a flat list of every leaf path the expression touches — enabling safe data refactoring and fetch optimization.

## Core Value

Given any JSONata expression, accurately identify every data path read from the input object — including paths accessed through variable assignments, filter predicates, and function arguments.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Parse JSONata expressions using the official JSONata parser
- [ ] Walk the AST to extract all leaf data paths accessed from the input
- [ ] Trace variable assignments back to their source data paths ($x := account.name → account.name)
- [ ] Handle filter predicates as path reads (items[price > 10] → items.price)
- [ ] Mark dynamically computed paths with wildcards (order[fieldName] → order[*])
- [ ] Support full JSONata language: lambdas, custom functions, chained transforms, conditionals, sorting, grouping
- [ ] Expose as a TypeScript library with a programmatic API
- [ ] Provide a CLI wrapper for command-line usage
- [ ] Handle parent operator (%) and context references
- [ ] Handle recursive descent operator (**)

### Out of Scope

- Building a custom JSONata parser — use the official one
- Evaluating/executing JSONata expressions — this is static analysis only
- Modifying or transforming JSONata expressions
- Runtime type inference on the source data

## Context

JSONata is a powerful query and transformation language for JSON data. Complex systems accumulate large JSON objects and numerous JSONata expressions. Without knowing which paths are actually read, teams can't safely:
1. **Refactor data shapes** — might break unknown expressions
2. **Optimize data fetching** — fetch everything because you don't know what's needed

The official JSONata library includes a parser that produces an AST. This project builds on that AST as a foundation — it's an analyzer, not a parser.

The AST node types from the JSONata parser include: `path`, `name`, `string`, `number`, `value`, `binary`, `unary`, `block`, `bind`, `lambda`, `function`, `variable`, `filter`, `sort`, `transform`, `wildcard`, `descendant`, `parent`, and others.

## Constraints

- **Tech stack**: TypeScript, Node.js, official `jsonata` package as the parser
- **Dependency**: Must use the official JSONata parser's AST output — don't re-implement parsing
- **Analysis type**: Static analysis only — no expression evaluation

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use official JSONata parser | Proven, complete, maintained — no reason to rewrite | — Pending |
| Static analysis only | Don't need runtime data to determine which paths are accessed | — Pending |
| Wildcard for dynamic paths | Can't statically resolve computed property names, wildcard communicates "something here" | — Pending |
| Trace through variable assignments | Variables are just aliases to data paths — tracing gives complete picture | — Pending |

---
*Last updated: 2026-03-02 after initialization*
