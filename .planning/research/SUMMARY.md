# Project Research Summary

**Project:** JSONata AST Path Analyzer
**Domain:** Static analysis / AST path extraction for JSONata expressions
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

The JSONata AST Path Analyzer is a static analysis library that walks the AST produced by the official JSONata parser to extract every data path an expression reads from its input. This is a well-scoped compiler-analysis problem: the parser already exists and is proven, so this project operates exclusively at the semantic analysis layer. The architecture follows a classic compiler front-end pipeline (parse, walk, collect, resolve, output) with five internal components -- Parser Adapter, AST Walker, Scope Tracker, Path Collector, and Path Resolver. The stack is straightforward: TypeScript 5.9, Node 22+, jsonata ^2.1.0, tsup for bundling, vitest for testing, commander for the CLI. Only two runtime dependencies (jsonata, commander), which is correct for a library.

The recommended approach is to build the exhaustive AST walker first, handling all 20+ node types from day one with a discriminated union and TypeScript exhaustive switch checking. The critical architectural decision is that the tool must OVER-APPROXIMATE -- reporting a superset of actual paths is safer than under-reporting, since the primary use case is safe data refactoring. The walker must traverse both `steps` and `stages` on path nodes (the JSONata parser's internal distinction for inline filters, sorts, and grouping operators) and must NOT rely on the official TypeScript `ExprNode` type, which is incomplete. Custom types that accurately model the parser's actual output are essential infrastructure.

The main risks are: (1) incomplete AST node type coverage silently missing paths -- mitigated by exhaustive dispatch and a discovery harness, (2) incorrect variable scope modeling producing wrong path resolutions -- mitigated by a dedicated scope stack with block boundaries and thorough test cases for shadowing, closures, and context bindings, and (3) the steps/stages distinction in the parser's path representation -- a non-obvious internal detail that, if missed, causes filter predicates, sort keys, and grouping expressions to be invisible. All three risks are addressable with known patterns and must be tackled in the first two phases.

## Key Findings

### Recommended Stack

The stack is deliberately minimal: two runtime dependencies, standard TypeScript tooling. The jsonata package (^2.1.0) is the sole essential dependency -- it provides the parser and exposes an `ast()` method on expression objects. This method is typed in the official `jsonata.d.ts` but undocumented in the official docs, making it a stable-but-undocumented API. The `jsonata.parser` static property also exists but is explicitly noted as potentially removable; prefer `expr.ast()`.

**Core technologies:**
- **jsonata ^2.1.0:** AST source -- the official parser with built-in TypeScript types and `ExprNode` discriminated union
- **TypeScript ~5.9:** Language -- strict mode with `noUncheckedIndexedAccess` for safe AST property access
- **tsup ^8.5:** Build -- zero-config bundler producing dual ESM/CJS output with `.d.ts` generation
- **vitest ^4.0:** Testing -- native TypeScript support, 10-20x faster than Jest, zero-config
- **commander ^14.0:** CLI -- lightweight argument parsing for a simple command-line wrapper
- **Node.js >= 22:** Runtime -- Active LTS, supports all ES2022 features natively

**Critical version notes:** Pin jsonata to a specific minor version. The AST is an internal API -- node types, property names, and structure can change between versions without notice. The official `ExprNode` TypeScript type is incomplete (missing `path`, `filter`, `sort`, `bind`, `apply` node types and several properties). Custom types must be built.

### Expected Features

**Must have (table stakes):**
- Simple and nested dot-path extraction (`account.name`, `order.items.price`)
- Wildcard (`*`) and descendant (`**`) operator handling
- Filter predicate path extraction (`items[price > 10]` reports `items.price`)
- Binary/unary/conditional operator operand extraction
- Variable binding tracing (`$x := account.name; $x` resolves to `account.name`)
- Block expression scope handling
- String/number/boolean literal handling (return empty, never crash)
- Programmatic TypeScript API + CLI tool

**Should have (differentiators):**
- Lambda/higher-order function context tracking (`$map` callback resolution)
- Sort expression path extraction (`items^(price)` reports `items.price`)
- Transform operator analysis
- Dynamic path detection with wildcards
- Confidence/completeness annotations on extracted paths

**Defer (v2+):**
- Parent operator (`%`) full resolution -- emit symbolic markers for now
- Custom function interprocedural analysis
- Context variable (`@$v`) and positional variable (`#$i`) binding
- Output format options beyond JSON array
- Multiple expression batch analysis
- Visual explorer / GUI

### Architecture Approach

The system is a five-component pipeline. The Parser Adapter wraps `jsonata(expr).ast()` to obtain the AST root. The AST Walker performs recursive dispatch via an exhaustive switch on `node.type`, delegating to the Scope Tracker (which maintains a stack of variable-to-path mappings with block-level lexical scoping) and the Path Collector (which accumulates raw path segments including wildcards and filter predicates). After the walk completes, the Path Resolver substitutes variable references with their bound data paths, marks dynamic paths with wildcards, deduplicates, and produces the final output. A two-pass architecture (walk then resolve) avoids ordering issues with variable chains.

**Major components:**
1. **Parser Adapter** -- wraps `jsonata(expr).ast()`, handles parse errors, thin layer
2. **AST Walker** -- recursive descent with exhaustive `switch(node.type)` dispatch over 20+ node types
3. **Scope Tracker** -- stack of `Map<string, ResolvedPath[]>` frames for lexical scope modeling
4. **Path Collector** -- accumulates raw path segments, handles steps AND stages on path nodes
5. **Path Resolver** -- post-walk variable substitution, wildcard expansion, deduplication, normalization

### Critical Pitfalls

1. **Incomplete AST node type coverage** -- The `ExprNode` TypeScript type is missing at least 5 node types (`path`, `filter`, `sort`, `bind`, `apply`) and several post-processing types (`stages`, `group`, `index`). Use a custom discriminated union with exhaustive switch dispatch and a `never` default. Build a discovery harness to parse diverse expressions and verify all node types are handled.

2. **Steps/Stages distinction in path nodes** -- Filter predicates (`[expr]`), sort keys (`^(expr)`), and grouping expressions (`{key: agg}`) are stored in a `stages` array on individual step nodes, NOT as children of the path node. A walker that only traverses `steps` will miss all paths inside predicates. Must iterate `path.steps[].stages[]` in addition to `path.steps[]`.

3. **Variable binding scope resolution** -- JSONata has block-level lexical scoping with closures, `@`/`#` context bindings scoped to path expressions, and the reduce operator terminating scope. Incorrect scope modeling produces silent wrong results. Build an explicit scope stack with push/pop on block/lambda boundaries.

4. **Over-approximation strategy not decided** -- Without a consistent strategy, some handlers over-approximate while others under-approximate, making guarantees meaningless. Decision: ALWAYS over-approximate. Report a superset of actual paths. Use wildcards for computed properties, flag `$eval` as opaque.

5. **Undocumented AST properties** -- The parser attaches properties (`predicate`, `group`, `condition`, `then`, `else`, `body`, `update`, `delete`, `pattern`, `focus`, `index`, `tuple`) that are not reflected in the TypeScript types. Missing these means missing paths in conditional branches, transform clauses, and grouping keys.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation -- Types, Parser Adapter, and Basic Walker

**Rationale:** Everything depends on having accurate AST types and a working walker. The official TypeScript types are incomplete, so custom types are the foundation. The basic walker covering simple paths (without variables or complex operators) validates the approach end-to-end and delivers immediate value.
**Delivers:** Custom AST type definitions, parser adapter, core walker handling `path`, `name`, `string`, `number`, `value`, `wildcard`, `descendant`, `binary`, `unary`, `block`, `condition`, literal types. Path Collector component. Over-approximation strategy documented. Steps AND stages traversal implemented.
**Addresses (FEATURES.md):** Simple dot-path extraction, nested paths, wildcard/descendant operators, binary/conditional operand extraction, literal handling, block expression support.
**Avoids (PITFALLS.md):** Incomplete node type coverage (exhaustive switch from day one), steps/stages distinction (built into core traversal), undocumented AST properties (custom types + discovery harness), no approximation strategy (decided and documented upfront).

### Phase 2: Scope Infrastructure and Variable Tracing

**Rationale:** Variable binding tracing is the single most important differentiator AND the highest-complexity table-stakes feature. It requires dedicated infrastructure (Scope Tracker) and careful design. Must come before advanced operators because transforms, lambdas, and higher-order functions all depend on scope resolution.
**Delivers:** Scope Tracker component with push/pop block boundaries, variable binding resolution (`$x := expr` traces to data paths), Path Resolver component (post-walk variable substitution), multi-hop variable chain resolution (`$a := x.y; $b := $a.z; $b` resolves to `x.y.z`).
**Addresses (FEATURES.md):** Variable binding tracing, function argument paths (partial -- arguments extracted, not callback body resolution).
**Avoids (PITFALLS.md):** Variable binding scope resolution errors (explicit scope stack, dedicated test cases for shadowing/closures).

### Phase 3: Filter Predicates and Complex Operators

**Rationale:** Filter predicates are the first "interesting" feature where context changes -- `items[price > 10]` means `price` is relative to `items`. Sort expressions and transform operators follow the same pattern of relative-path resolution. Group these because they share the path-context-stack mechanism.
**Delivers:** Filter predicate path extraction with context-relative resolution, sort expression path extraction, transform operator analysis (pattern/update/delete clauses), array index vs. filter predicate distinction.
**Addresses (FEATURES.md):** Filter predicate path extraction, sort expression paths, transform operator analysis, array index access distinction.
**Avoids (PITFALLS.md):** Path flattening/stages confusion (thoroughly tested here), over-approximation consistency (wildcard for unresolvable predicates).

### Phase 4: Lambda, Higher-Order Functions, and Advanced Features

**Rationale:** Lambda/higher-order function tracking is the hardest problem and depends on both the scope infrastructure (Phase 2) and context tracking (Phase 3). This phase also handles parent operator resolution and context/positional bindings. These are differentiators, not table stakes -- ship the core tool before tackling them.
**Delivers:** Lambda body path extraction, higher-order function context binding (`$map` callback parameter resolution), parent operator (`%`) symbolic resolution, context (`@`) and positional (`#`) variable tracking, `$eval` detection and flagging, confidence annotations on paths.
**Addresses (FEATURES.md):** Lambda/higher-order function context tracking, parent operator resolution, context/positional variable binding, confidence annotations, dynamic path detection.
**Avoids (PITFALLS.md):** Parent operator backward resolution (symbolic markers as fallback), `$eval` silent omission (explicit warning).

### Phase 5: Public API, CLI, and Polish

**Rationale:** The API and CLI are thin wrappers. Deferring them until the core is solid avoids designing the interface before understanding the output structure (especially if confidence annotations are added in Phase 4). This phase also handles output formatting, batch analysis, and documentation.
**Delivers:** Public `extractPaths()` API with TypeScript types, CLI via commander, output format options (JSON, newline-delimited), batch expression analysis, npm package configuration (dual ESM/CJS), comprehensive documentation.
**Addresses (FEATURES.md):** Programmatic TypeScript/JS API, CLI tool, output format options, multiple expression batch analysis.
**Avoids (PITFALLS.md):** UX pitfalls (non-deterministic output order, missing context on paths, silent incomplete results).

### Phase Ordering Rationale

- **Phase 1 before everything:** Custom types and exhaustive walker are the foundation. Every subsequent phase adds handlers to the walker framework established here.
- **Phase 2 before Phase 3:** Filter predicates and transforms can involve variables (`items[$x]`). Scope infrastructure must exist before complex operator handling.
- **Phase 3 before Phase 4:** Lambda context tracking builds on the path-context-stack mechanism introduced for filter predicates.
- **Phase 4 before Phase 5:** API design benefits from knowing the full output structure, including confidence annotations and warnings from advanced analysis.
- **Architecture and Pitfalls converge:** Both recommend building exhaustive types first, scope tracking second, complex operators third. The dependency chain in ARCHITECTURE.md (Parser Adapter -> Type Defs -> Scope Tracker + Path Collector -> Walker -> Resolver -> API) maps directly to this phase structure.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Scope Infrastructure):** JSONata's scoping rules for `@`/`#` bindings, closure capture semantics, and the reduce operator's scope termination need validation against actual parser behavior. Write exploratory tests parsing real expressions.
- **Phase 3 (Filters and Complex Operators):** The `stages` property structure on path steps needs empirical validation -- parse diverse filter/sort/group expressions and inspect the actual AST shape.
- **Phase 4 (Lambdas and Advanced):** Higher-order function binding semantics (`$map`, `$filter`, `$reduce`, `$each`, `$sift`, `$sort`) and parent operator AST output need investigation. The AST may or may not include resolved parent path information.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Exhaustive switch dispatch, discriminated unions, recursive AST walking are all well-documented TypeScript patterns. The node type list is verified.
- **Phase 5 (API and CLI):** Standard library packaging with tsup, commander CLI wrapping, and npm publishing are thoroughly documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified via official sources, npm, and release announcements. Versions confirmed current. Only 2 runtime dependencies. |
| Features | MEDIUM-HIGH | Table stakes features are clear from JSONata language semantics. Differentiators synthesized from analogous tools (GraphQL analyzers, ESLint scope analysis, SQL lineage). No direct competitor exists for validation. |
| Architecture | HIGH | Pipeline pattern is standard for compiler analysis tools. Component boundaries verified against JSONata parser source. AST node types confirmed from official TypeScript definitions and parser source. |
| Pitfalls | HIGH | Pitfalls verified against actual JSONata parser source code, GitHub issues, Go implementation cross-reference, and TypeScript type definitions. The ExprNode incompleteness is empirically confirmed. |

**Overall confidence:** HIGH

### Gaps to Address

- **Exact `stages` property structure:** The steps/stages distinction is documented by the pitfalls research but the exact shape of stage nodes for each operator type (filter, sort, index, join, reduce) needs empirical validation by parsing real expressions. Address in Phase 1 via discovery harness.
- **Parent operator AST output:** Whether the parser's AST includes resolved parent path information or only raw `%` nodes is unknown. Must inspect actual AST output for expressions containing `%`. Address at start of Phase 4.
- **Higher-order function binding semantics:** How `$map`, `$filter`, `$reduce` bind their callback parameters at the AST level is not documented. Need to parse expressions using these functions and inspect parameter binding in the AST. Address in Phase 4.
- **`$eval` prevalence in real-world expressions:** If `$eval` is rare, flagging it as opaque is sufficient. If common, users may need partial analysis. Validate against real expression corpora during Phase 4.
- **Forward reference behavior:** ARCHITECTURE.md notes uncertainty about whether JSONata allows forward references within blocks. The two-pass architecture hedges against this but the actual behavior should be confirmed. Address in Phase 2.
- **No competing tool for feature validation:** No existing JSONata path extraction tool was found. Feature priorities are inferred from analogous domains (GraphQL, SQL lineage, XPath analysis) rather than validated against user expectations. Mitigate by shipping early and iterating.

## Sources

### Primary (HIGH confidence)
- [jsonata npm package](https://www.npmjs.com/package/jsonata) -- v2.1.0, built-in TypeScript types, `ast()` method verified
- [jsonata GitHub repository and source](https://github.com/jsonata-js/jsonata) -- parser source, AST node types, TypeScript definitions
- [JSONata official documentation](https://docs.jsonata.org/) -- path operators, processing model, programming constructs, higher-order functions, other operators
- [Vitest 4.0](https://vitest.dev/) -- test runner, stable release
- [tsup](https://tsup.egoist.dev/) -- bundler, v8.5
- [commander](https://www.npmjs.com/package/commander) -- CLI framework, v14
- [TypeScript 5.9](https://github.com/microsoft/typescript/releases) -- stable release
- [ESLint 10](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/) -- stable release
- [Node.js releases](https://nodejs.org/en/about/previous-releases) -- Node 22 LTS

### Secondary (MEDIUM confidence)
- [Stedi prettier-plugin-jsonata](https://github.com/Stedi/prettier-plugin-jsonata) -- prior art for JSONata AST walking
- [Rust JSONata AstKind enum](https://docs.rs/jsonata/latest/jsonata/ast/enum.AstKind.html) -- cross-reference for node types
- [ESLint scope-manager](https://eslint.org/docs/latest/extend/scope-manager-interface) -- pattern reference for variable scope tracking
- [GraphQL static query analysis](https://www.graphql.de/blog/static-query-analysis/) -- analogous domain for field dependency extraction
- [JSONata GitHub issues (#206, #473, #299, #335)](https://github.com/jsonata-js/jsonata/issues) -- confirms no built-in path extraction, reveals AST quirks

### Tertiary (LOW confidence)
- [Internal structures of JSONata expressions (Medium blog)](https://medium.com/@varshajainm.1121/internal-structures-of-jsonata-expressions-053540af937f) -- helpful AST walkthrough, single source
- [Column-level lineage via SQL parsing (Metaplane)](https://www.metaplane.dev/blog/column-level-lineage-an-adventure-in-sql-parsing) -- validates ~80% coverage achievable with initial AST walking

---
*Research completed: 2026-03-02*
*Ready for roadmap: yes*
