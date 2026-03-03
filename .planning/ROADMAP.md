# Roadmap: JSONata AST Path Analyzer

## Overview

This roadmap delivers a static analysis library that extracts every data path a JSONata expression reads from its input. The journey starts with accurate AST types and a basic walker for simple paths, builds scope infrastructure for variable tracing, adds context-relative resolution for filters/sorts/transforms, tackles advanced operators (parent, dynamic paths, confidence), and wraps everything in a clean programmatic API and CLI. Each phase delivers a verifiable, incremental capability -- the walker works on progressively more complex expressions as phases complete.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation and Basic Walker** - Custom AST types, parser adapter, and exhaustive walker handling simple paths, literals, binary/conditional/block expressions
- [x] **Phase 2: Scope Infrastructure and Variable Tracing** - Scope tracker, variable binding resolution, function argument paths, and multi-hop variable chain resolution
- [x] **Phase 3: Context-Relative Operators** - Filter predicates, sort expressions, transform operators, and array index vs. filter distinction with context-relative path resolution
- [x] **Phase 4: Advanced Analysis** - Parent operator resolution, dynamic path wildcarding, and confidence annotations on extracted paths (completed 2026-03-03)
- [x] **Phase 5: Public API and CLI** - TypeScript programmatic API and command-line tool wrapping the analysis pipeline (completed 2026-03-03)
- [x] **Phase 6: ADV-02 Edge Case Fix** - Close the untested ADV-02 gap where walkPath's variable-resolution branch skips filter predicate inspection for resolved VariableNodes (completed 2026-03-03)
- [ ] **Phase 7: Integration Polish** - Close remaining integration gaps: walkVariable standalone predicate inspection and CLI error message formatting

## Phase Details

### Phase 1: Foundation and Basic Walker
**Goal**: Users can extract data paths from JSONata expressions that use simple dot-paths, wildcards, descendants, binary operators, conditionals, and block expressions
**Depends on**: Nothing (first phase)
**Requirements**: PATH-01, PATH-02, PATH-03, PATH-04, PATH-05, EXPR-01, EXPR-02, EXPR-04
**Success Criteria** (what must be TRUE):
  1. Parsing a simple expression like `account.name` returns `["account.name"]` as an extracted path
  2. Wildcard expressions like `order.*` and descendant expressions like `**.price` produce paths with wildcard/descendant segments
  3. Binary expressions like `price * quantity` extract paths from both operands
  4. Conditional expressions extract paths from condition, then-branch, and else-branch
  5. Literal expressions (strings, numbers, booleans, null) produce no paths and never crash the walker
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md -- Project scaffold + custom AST types + parser adapter
- [ ] 01-02-PLAN.md -- Walker, path builder, and extractPaths (TDD)

### Phase 2: Scope Infrastructure and Variable Tracing
**Goal**: Users can extract accurate data paths from expressions that use variable assignments, function arguments, lambdas, context bindings, and positional variables
**Depends on**: Phase 1
**Requirements**: SCOPE-01, SCOPE-02, SCOPE-03, SCOPE-04, SCOPE-05, EXPR-05
**Success Criteria** (what must be TRUE):
  1. Variable assignment `$x := account.name; $x` resolves to `["account.name"]` -- the variable is traced back to its source data path
  2. Multi-hop variable chains like `$a := x.y; $b := $a.z; $b` resolve to `["x.y.z"]`
  3. Function arguments in expressions like `$sum(items.price)` extract `["items.price"]` as a data path
  4. Lambda/higher-order patterns like `$map(items, function($v) { $v.name })` resolve to `["items.name"]`
  5. Positional variables (`#$i`) are recognized as non-data-path references and produce no paths
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md -- Scope infrastructure + basic variable resolution + function argument extraction (TDD)
- [ ] 02-02-PLAN.md -- Lambda resolution + higher-order functions + apply operator + custom function tracing (TDD)

### Phase 3: Context-Relative Operators
**Goal**: Users can extract accurate data paths from filter predicates, sort expressions, transform operators, and array indexing -- all of which resolve sub-expression paths relative to their parent context
**Depends on**: Phase 2
**Requirements**: EXPR-03, EXPR-06, EXPR-07, EXPR-08
**Success Criteria** (what must be TRUE):
  1. Filter predicate `items[price > 10]` extracts `["items.price"]` with `price` resolved relative to `items`
  2. Sort expression `items^(price)` extracts `["items.price"]` with sort key resolved relative to the sorted collection
  3. Transform operator expressions extract paths from pattern, update, and delete clauses
  4. Numeric array index access like `items[0]` is distinguished from filter predicates and does not produce a spurious path for the index
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Advanced Analysis
**Goal**: Users get complete analysis results for expressions using parent operators, dynamically computed paths, and receive confidence annotations indicating whether each extracted path is statically certain or partially resolved
**Depends on**: Phase 3
**Requirements**: ADV-01, ADV-02, ADV-03
**Success Criteria** (what must be TRUE):
  1. Parent operator (`%`) produces a symbolic marker or resolved path indicating the parent context was accessed
  2. Dynamically computed paths like `item[fieldName]` produce `["item[*]"]` with a wildcard marking the unresolvable segment
  3. Each extracted path carries a confidence annotation (e.g., "static" for fully resolved, "dynamic" for wildcard-containing, "partial" for parent-operator paths)
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

### Phase 5: Public API and CLI
**Goal**: Users can consume the path analyzer as a TypeScript/JS library via a clean programmatic API or as a CLI tool from the command line
**Depends on**: Phase 4
**Requirements**: API-01, API-02
**Success Criteria** (what must be TRUE):
  1. Calling `extractPaths(expression)` from TypeScript/JS code returns a typed `PathResult[]` with all extracted paths
  2. Running the CLI with a JSONata expression argument prints extracted paths to stdout
  3. The CLI accepts input via both command-line argument and stdin piping
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

### Phase 6: ADV-02 Edge Case Fix
**Goal:** Close the ADV-02 integration gap identified in the v1.0 milestone audit — when `walkPath` resolves a variable step and returns early, filter predicates on the resolved `VariableNode` are not inspected for unresolvable `$variable` expressions, so `($data := orders; $data[$field].price)` silently fails to emit `orders[*]`
**Depends on:** Phase 4
**Requirements:** ADV-02 (gap closure)
**Gap Closure:** Closes `ADV-02-edge-case` integration gap from v1.0 audit
**Success Criteria** (what must be TRUE):
  1. `($data := orders; $data[$field].price)` emits `{path: "orders[*]", confidence: "dynamic"}`
  2. All existing 101 tests continue to pass
  3. New test is added covering the composed variable-filter scenario
**Plans**: 1 plan

Plans:
- [ ] 06-01-PLAN.md -- Fix walkPath variable-resolution branch + add composed variable-filter test

### Phase 7: Integration Polish
**Goal:** Close remaining v1.0 integration gaps — fix walkVariable standalone predicate inspection for function arguments, and fix CLI error message formatting for jsonata parse errors
**Depends on:** Phase 6
**Requirements:** EXPR-03, ADV-02, API-02 (gap closure)
**Gap Closure:** Closes `walkVariable-predicate-gap` and `CLI-error-message` integration gaps from v1.0 audit
**Success Criteria** (what must be TRUE):
  1. `$map($data[status], fn)` where `$data` resolves to a path — the `[status]` filter predicate is inspected and its paths extracted
  2. All existing tests continue to pass
  3. CLI produces the actual error message (not `[object Object]`) for jsonata parse errors
  4. New tests cover standalone VariableNode predicate and CLI error formatting
**Plans**: TBD

Plans:
- [ ] 07-01-PLAN.md -- TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Basic Walker | 2/2 | Complete | 2026-03-02 |
| 2. Scope Infrastructure and Variable Tracing | 2/2 | Complete | 2026-03-02 |
| 3. Context-Relative Operators | 2/2 | Complete | 2026-03-03 |
| 4. Advanced Analysis | 2/2 | Complete   | 2026-03-03 |
| 5. Public API and CLI | 1/1 | Complete   | 2026-03-03 |
| 6. ADV-02 Edge Case Fix | 1/1 | Complete | 2026-03-03 |
| 7. Integration Polish | 0/1 | Pending | — |
