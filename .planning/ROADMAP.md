# Roadmap: JSONata AST Path Analyzer

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-7 (shipped 2026-03-03)
- ✅ **v1.1 Real-World Integration Tests** -- Phases 8-13 (shipped 2026-03-05)
- 🚧 **v1.1.1 Bug Fixes** -- Phases 14-16 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-7) -- SHIPPED 2026-03-03</summary>

- [x] Phase 1: Foundation and Basic Walker (2/2 plans) -- completed 2026-03-02
- [x] Phase 2: Scope Infrastructure and Variable Tracing (2/2 plans) -- completed 2026-03-02
- [x] Phase 3: Context-Relative Operators (2/2 plans) -- completed 2026-03-03
- [x] Phase 4: Advanced Analysis (2/2 plans) -- completed 2026-03-03
- [x] Phase 5: Public API and CLI (1/1 plan) -- completed 2026-03-03
- [x] Phase 6: ADV-02 Edge Case Fix (1/1 plan) -- completed 2026-03-03
- [x] Phase 7: Integration Polish (1/1 plan) -- completed 2026-03-03

Full details: `milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>v1.1 Real-World Integration Tests (Phases 8-13) -- SHIPPED 2026-03-05</summary>

- [x] Phase 8: Test Infrastructure (1/1 plan) -- completed 2026-03-04
- [x] Phase 9: Data Transformation Tests (1/1 plan) -- completed 2026-03-04
- [x] Phase 10: Business Rule Tests (1/1 plan) -- completed 2026-03-04
- [x] Phase 11: API Reshaping Tests (1/1 plan) -- completed 2026-03-04
- [x] Phase 12: Data Export Tests (1/1 plan) -- completed 2026-03-04
- [x] Phase 13: Edge Cases and Tech Debt (1/1 plan) -- completed 2026-03-04

Full details: `milestones/v1.1-ROADMAP.md`

</details>

### v1.1.1 Bug Fixes (In Progress)

**Milestone Goal:** Fix all 14 documented BUG(v1.2) analyzer bugs across 7 categories and build thorough regression test suites around each fix area. Ordered by ascending regression risk: isolated additive fixes first, coupled filter/focus fixes last.

- [x] **Phase 14: Isolated Single-Function Fixes** - Fix walkPath steps, walkVariable .group, $lookup chaining, and array constructor scope (8 bugs, 10 requirements) (completed 2026-03-06)
- [ ] **Phase 15: Pipeline and Apply Fixes** - Fix inline lambda apply binding and variable-resolved sort extraction (2 bugs, 3 requirements)
- [ ] **Phase 16: Filter Predicate Scope-Awareness** - Fix filter predicate leak into HOF bindings and focus variable double-prefix (4+2 bugs, 8 requirements)

## Phase Details

### Phase 14: Isolated Single-Function Fixes
**Goal**: All isolated, additive walker bugs are fixed -- parent operator walks through object/block steps, walkVariable handles .group properties, $lookup chaining preserves function arguments, and array constructor scope accumulates correctly
**Depends on**: Phase 13 (stable 200-test baseline from v1.1)
**Requirements**: PRNT-01, PRNT-02, PRNT-03, WVAR-01, WVAR-02, LOOK-01, LOOK-02, LOOK-03, ARRS-01, ARRS-02
**Success Criteria** (what must be TRUE):
  1. Expression `orders.items.{"itemName": name, "orderDate": %.date}` extracts inner object constructor paths including the parent-referenced `date` field
  2. Expression `$r{category: $sum(amount)}` extracts both the group key path (`category`) and the aggregation value path (`amount`) from the variable-resolved group-by
  3. Expression `$lookup(inventory, itemCode).quantity` extracts all three paths: the lookup table, the key argument, and the chained property after the result
  4. Expression `[$x := data.source, $x.field]` resolves the variable reference in the second array element to `data.source.field` via sequential scope accumulation
  5. All 6 previously-skipped BUG(v1.2) tests for these categories are unskipped and passing, plus 40+ new regression tests across 4 test files
**Plans**: 2 plans

Plans:
- [x] 14-01-PLAN.md -- Fix walkPath step handling (PRNT) and walkVariable group-by (WVAR) with 20+ regression tests
- [x] 14-02-PLAN.md -- Fix $lookup chaining (LOOK) and array constructor scope (ARRS) with 20+ regression tests

### Phase 15: Pipeline and Apply Fixes
**Goal**: Apply operator correctly binds inline lambda parameters and variable-resolved sort expressions extract sort key paths relative to the resolved variable
**Depends on**: Phase 14
**Requirements**: PIPE-01, PIPE-02, PIPE-03
**Success Criteria** (what must be TRUE):
  1. Expression `data ~> function($d) { $d.count }` binds `$d` to `data` and extracts `data.count` -- not a duplicate unresolved `$d.count`
  2. Expression `$x := items; $x^(price)` extracts the sort key path `items.price` relative to the resolved variable, not bare `price`
  3. Both previously-skipped BUG(v1.2) pipeline tests are unskipped and passing, plus 10+ new regression tests covering apply and sort patterns
**Plans**: 1 plan

Plans:
- [ ] 15-01-PLAN.md -- Fix walkApply inline lambda binding and walkPath variable-resolved sort extraction with 12+ regression tests

### Phase 16: Filter Predicate Scope-Awareness
**Goal**: Filter predicates in HOF contexts produce correct scope-aware paths without leaking into lambda parameter bindings, and focus variable bindings do not cause double-prefixed paths
**Depends on**: Phase 15 (10 of 14 bugs fixed, stable base for highest-risk changes)
**Requirements**: FILT-01, FILT-02, FILT-03, FILT-04, FILT-05, FOCV-01, FOCV-02, FOCV-03
**Success Criteria** (what must be TRUE):
  1. Expression `$map(orders[status="active"], function($o) { $o.total })` does NOT bind `status` to the lambda parameter -- filter predicate paths stay separate from HOF parameter binding
  2. Expression `orders@$o[$o.total > 100]` produces `orders.total`, NOT the double-prefixed `orders.orders.total`
  3. Nested HOF with filtered input `$map($filter(items[active], fn1), fn2)` produces correct paths at each nesting level without predicate leak or prefix duplication
  4. Expression `library.loans@$l.books@$b[$l.isbn=$b.isbn]` with cross-referenced focus variables resolves both variables correctly without prefix errors
  5. All 6 previously-skipped BUG(v1.2) filter/focus tests are unskipped and passing, plus 20+ new regression tests covering predicate isolation and focus variable prefix handling
**Plans**: TBD

Plans:
- [ ] 16-01: TBD
- [ ] 16-02: TBD

## Progress

**Execution Order:** 14 -> 15 -> 16

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation and Basic Walker | v1.0 | 2/2 | Complete | 2026-03-02 |
| 2. Scope Infrastructure and Variable Tracing | v1.0 | 2/2 | Complete | 2026-03-02 |
| 3. Context-Relative Operators | v1.0 | 2/2 | Complete | 2026-03-03 |
| 4. Advanced Analysis | v1.0 | 2/2 | Complete | 2026-03-03 |
| 5. Public API and CLI | v1.0 | 1/1 | Complete | 2026-03-03 |
| 6. ADV-02 Edge Case Fix | v1.0 | 1/1 | Complete | 2026-03-03 |
| 7. Integration Polish | v1.0 | 1/1 | Complete | 2026-03-03 |
| 8. Test Infrastructure | v1.1 | 1/1 | Complete | 2026-03-04 |
| 9. Data Transformation Tests | v1.1 | 1/1 | Complete | 2026-03-04 |
| 10. Business Rule Tests | v1.1 | 1/1 | Complete | 2026-03-04 |
| 11. API Reshaping Tests | v1.1 | 1/1 | Complete | 2026-03-04 |
| 12. Data Export Tests | v1.1 | 1/1 | Complete | 2026-03-04 |
| 13. Edge Cases and Tech Debt | v1.1 | 1/1 | Complete | 2026-03-04 |
| 14. Isolated Single-Function Fixes | v1.1.1 | 2/2 | Complete | 2026-03-06 |
| 15. Pipeline and Apply Fixes | v1.1.1 | 0/1 | Not started | - |
| 16. Filter Predicate Scope-Awareness | v1.1.1 | 0/? | Not started | - |
