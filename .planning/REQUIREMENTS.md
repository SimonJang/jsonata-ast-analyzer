# Requirements: JSONata AST Path Analyzer

**Defined:** 2026-03-02
**Core Value:** Given any JSONata expression, accurately identify every data path read from the input object — including paths accessed through variable assignments, filter predicates, and function arguments.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Core Path Extraction

- [ ] **PATH-01**: Extract simple dot-path references (`account.name` → `["account.name"]`)
- [ ] **PATH-02**: Extract nested multi-step paths (`order.items.price`)
- [ ] **PATH-03**: Handle wildcard operator (`*`) emitting `order.*` segments
- [ ] **PATH-04**: Handle descendant operator (`**`) emitting `**.price` segments
- [ ] **PATH-05**: Handle string, number, boolean, and null literals without producing paths

### Expression Analysis

- [ ] **EXPR-01**: Extract paths from both operands of binary operators (`price * quantity` → both)
- [ ] **EXPR-02**: Extract paths from all branches of conditional expressions (condition, then, else)
- [ ] **EXPR-03**: Extract paths from filter predicates (`items[price > 10]` → `items.price`)
- [ ] **EXPR-04**: Extract paths from all sub-expressions in blocks
- [ ] **EXPR-05**: Extract paths from function arguments (`$sum(items.price)` → `items.price`)
- [ ] **EXPR-06**: Distinguish array index access from filter predicates
- [ ] **EXPR-07**: Extract paths from sort expressions (`items^(price)` → `items.price`)
- [ ] **EXPR-08**: Extract paths from transform operator patterns and update expressions

### Variable & Scope Analysis

- [ ] **SCOPE-01**: Trace variable assignments back to source data paths (`$x := account.name` → `account.name`)
- [ ] **SCOPE-02**: Track context variable binding (`@$v`) and resolve paths through them
- [ ] **SCOPE-03**: Recognize positional variables (`#$i`) as non-data-path references
- [ ] **SCOPE-04**: Track lambda/higher-order function context (`$map(items, function($v) { $v.name })` → `items.name`)
- [ ] **SCOPE-05**: Handle custom function calls by tracing arguments into function body definitions

### Advanced Operators

- [ ] **ADV-01**: Resolve parent operator (`%`) with symbolic markers or path backtracking
- [ ] **ADV-02**: Mark dynamically computed paths with wildcards (`item[fieldName]` → `item[*]`)
- [ ] **ADV-03**: Annotate extracted paths with confidence level (static vs dynamic/partial)

### Delivery

- [ ] **API-01**: Expose TypeScript/JS programmatic API (`extractPaths(expression): PathResult[]`)
- [ ] **API-02**: Provide CLI tool for command-line usage with stdin and argument input

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Core Path Extraction

- **PATH-06**: Recursive descent path representation with depth indicators

### Delivery

- **API-03**: Multiple expression batch analysis with deduplication
- **API-04**: Output format options (JSON, tree structure, newline-delimited, bracket-notation)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Custom JSONata parser | Official parser is battle-tested and maintained — no reason to rewrite |
| Expression evaluation/execution | Static analysis only — evaluation is a different problem requiring runtime data |
| Expression modification/rewriting | Code modification is an order of magnitude harder than analysis |
| Runtime type inference | Static analysis operates without sample data or schemas |
| JSON Schema validation | Downstream concern — consumers can cross-reference paths with schemas |
| Visual AST explorer / GUI | Separate product — JSONata Studio already has one |
| Language server protocol (LSP) | Massive undertaking, different product category |
| Non-standard JSONata extensions | Platform-specific functions (Node-RED, AWS) treated as opaque |
| Performance caching | Premature — JSONata expressions are typically short |
| Incremental/streaming analysis | LSP territory — batch analysis is sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PATH-01 | — | Pending |
| PATH-02 | — | Pending |
| PATH-03 | — | Pending |
| PATH-04 | — | Pending |
| PATH-05 | — | Pending |
| EXPR-01 | — | Pending |
| EXPR-02 | — | Pending |
| EXPR-03 | — | Pending |
| EXPR-04 | — | Pending |
| EXPR-05 | — | Pending |
| EXPR-06 | — | Pending |
| EXPR-07 | — | Pending |
| EXPR-08 | — | Pending |
| SCOPE-01 | — | Pending |
| SCOPE-02 | — | Pending |
| SCOPE-03 | — | Pending |
| SCOPE-04 | — | Pending |
| SCOPE-05 | — | Pending |
| ADV-01 | — | Pending |
| ADV-02 | — | Pending |
| ADV-03 | — | Pending |
| API-01 | — | Pending |
| API-02 | — | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 0
- Unmapped: 23 ⚠️

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after initial definition*
