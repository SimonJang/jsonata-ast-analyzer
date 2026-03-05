# Requirements: JSONata AST Path Analyzer

**Defined:** 2026-03-05
**Core Value:** Given any JSONata expression, accurately identify every data path read from the input object — including paths accessed through variable assignments, filter predicates, and function arguments.

## v1.1.1 Requirements

Requirements for bug fix release. Each maps to roadmap phases.

### Filter Predicate Scope

- [ ] **FILT-01**: Filter predicate paths inside HOF callbacks do not leak into the lambda parameter binding (e.g., `$map(orders[status="active"], fn)` does not bind `status` to the lambda parameter)
- [ ] **FILT-02**: Filter predicates on HOF input arrays produce correct context-relative paths (e.g., `orders.status` not `orders.orders.status`)
- [ ] **FILT-03**: Compound filter predicates with multiple fields all resolve correctly without prefix duplication
- [ ] **FILT-04**: Nested HOF with filtered input (e.g., `$map($filter(items[active], fn1), fn2)`) produces correct paths at each level
- [ ] **FILT-05**: Thorough regression suite (10+ tests) covering filter predicate scope isolation in HOF contexts

### Focus Variable

- [ ] **FOCV-01**: Focus variable binding (`@$v`) does not cause double-prefixing of paths (e.g., `orders@$o[$o.total > 100]` produces `orders.total` not `orders.orders.total`)
- [ ] **FOCV-02**: Cross-referencing focus variables in nested contexts resolves correctly (e.g., `library.loans@$l.books@$b[$l.isbn=$b.isbn]`)
- [ ] **FOCV-03**: Thorough regression suite (10+ tests) covering focus variable prefix handling

### Parent Operator

- [ ] **PRNT-01**: Parent operator walkPath handles object constructor steps (e.g., `orders.items.{"itemName": name, "orderDate": %.date}` extracts inner paths)
- [ ] **PRNT-02**: Parent operator walkPath handles block expression steps (e.g., `data.(expr1; expr2)` walks inner expressions)
- [ ] **PRNT-03**: Thorough regression suite (10+ tests) covering parent operator through nested constructs

### Lookup HOF Chaining

- [ ] **LOOK-01**: `$lookup(table, key)` function arguments are extracted as data paths
- [ ] **LOOK-02**: Path continuation after `$lookup` result (e.g., `$lookup(inventory, itemCode).quantity`) extracts both arguments and the chained property
- [ ] **LOOK-03**: Thorough regression suite (10+ tests) covering $lookup patterns and HOF chaining

### Pipeline Deduplication

- [ ] **PIPE-01**: Apply operator with inline lambda (e.g., `data ~> function($d) { $d.count }`) correctly binds lambda parameter and extracts body paths
- [ ] **PIPE-02**: Variable-resolved sort (e.g., `$x := items; $x^(price)`) extracts sort key paths relative to the resolved variable
- [ ] **PIPE-03**: Thorough regression suite (10+ tests) covering pipeline and apply operator path extraction

### Walk Variable Property

- [ ] **WVAR-01**: walkVariable handles `.group` property on variable nodes (e.g., `$r{category: $sum(amount)}` extracts both group key and value paths)
- [ ] **WVAR-02**: Thorough regression suite (10+ tests) covering walkVariable property traversal including group-by

### Array Constructor Scope

- [ ] **ARRS-01**: Variable bindings inside array constructors accumulate scope sequentially (e.g., `[$x := data.source, $x.field]` resolves `$x.field` to `data.source.field`)
- [ ] **ARRS-02**: Thorough regression suite (10+ tests) covering array constructor scope isolation and variable resolution

## Future Requirements

None — this is a focused bug fix release.

## Out of Scope

| Feature | Reason |
|---------|--------|
| New language feature support | Bug fix release only — no new AST node types |
| Performance optimization | Not relevant to correctness fixes |
| API changes | Bug fixes should not change the public API surface |
| New CLI features | Bug fix release only |
| Refactoring walker architecture | Fix bugs minimally; refactor separately if needed later |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILT-01 | — | Pending |
| FILT-02 | — | Pending |
| FILT-03 | — | Pending |
| FILT-04 | — | Pending |
| FILT-05 | — | Pending |
| FOCV-01 | — | Pending |
| FOCV-02 | — | Pending |
| FOCV-03 | — | Pending |
| PRNT-01 | — | Pending |
| PRNT-02 | — | Pending |
| PRNT-03 | — | Pending |
| LOOK-01 | — | Pending |
| LOOK-02 | — | Pending |
| LOOK-03 | — | Pending |
| PIPE-01 | — | Pending |
| PIPE-02 | — | Pending |
| PIPE-03 | — | Pending |
| WVAR-01 | — | Pending |
| WVAR-02 | — | Pending |
| ARRS-01 | — | Pending |
| ARRS-02 | — | Pending |

**Coverage:**
- v1.1.1 requirements: 21 total
- Mapped to phases: 0
- Unmapped: 21

---
*Requirements defined: 2026-03-05*
*Last updated: 2026-03-05 after initial definition*
