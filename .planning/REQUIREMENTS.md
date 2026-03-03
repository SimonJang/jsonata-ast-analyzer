# Requirements: JSONata AST Path Analyzer — v1.1

**Defined:** 2026-03-03
**Core Value:** Validate that the path analyzer correctly handles real-world, multi-feature JSONata expressions — not just isolated patterns

## v1.1 Requirements

### Test Infrastructure

- [ ] **INFR-01**: Integration test directory (`test/integration/`) with category-per-file organization (5 files)
- [ ] **INFR-02**: Typed `IntegrationFixture` interface with `name`, `expression`, `expectedPaths`, optional `mustContain`/`mustNotContain`
- [ ] **INFR-03**: Shared `sortPaths()` utility that normalizes path order before comparison
- [ ] **INFR-04**: Shared `assertFixture()` utility enforcing `toEqual` on sorted results with confidence included
- [ ] **INFR-05**: NPM scripts for `test:unit`, `test:integration`, and `test:update-snapshots`

### Data Transformations

- [ ] **TRFM-01**: User can verify path extraction from filter → sort → map → reshape pipeline chains
- [ ] **TRFM-02**: User can verify path extraction from chained `~>` apply operator pipelines with lambda threading
- [ ] **TRFM-03**: User can verify path extraction from array dot-notation mapping with context-relative paths
- [ ] **TRFM-04**: User can verify path extraction from string concatenation/formatting with path operands
- [ ] **TRFM-05**: User can verify path extraction from multi-stage transforms with intermediate variable bindings

### Business Rules

- [ ] **BIZR-01**: User can verify path extraction from conditional field selection (ternary, elvis `?:`, coalescing)
- [ ] **BIZR-02**: User can verify path extraction from multi-field compound filter predicates (and/or boolean)
- [ ] **BIZR-03**: User can verify path extraction from aggregation over nested arrays (`$sum`, `$count`, `$average`)
- [ ] **BIZR-04**: User can verify path extraction from lookup and cross-reference patterns
- [ ] **BIZR-05**: User can verify path extraction from variable-driven object construction (bind + multi-reference)

### API Reshaping

- [ ] **APIR-01**: User can verify path extraction from nested API payload extraction + flattening into new objects
- [ ] **APIR-02**: User can verify path extraction from nested object output with mixed sources (multiple root paths)
- [ ] **APIR-03**: User can verify path extraction from deep path traversal with array flattening
- [ ] **APIR-04**: User can verify path extraction from context variable binding with cross-reference (`@$v` pattern)
- [ ] **APIR-05**: User can verify path extraction from parent operator `%` in nested mapped contexts

### Data Export

- [ ] **DEXP-01**: User can verify path extraction from structure-to-structure JSON format conversion
- [ ] **DEXP-02**: User can verify path extraction from multi-field extraction into flat records
- [ ] **DEXP-03**: User can verify path extraction from transform operator with update + delete clauses
- [ ] **DEXP-04**: User can verify path extraction from group-by with aggregation (context-relative key/value)

### Edge Cases & Tech Debt

- [ ] **EDGE-01**: User can verify path extraction from deeply nested variable chains (3-4 hop resolution)
- [ ] **EDGE-02**: User can verify path extraction from recursive/nested higher-order functions (closure across `$map` levels)
- [ ] **EDGE-03**: User can verify path extraction from custom function definition with multi-call interprocedural tracing
- [ ] **EDGE-04**: User can verify path extraction from `$sort` with lambda callback (known tech debt)
- [ ] **EDGE-05**: User can verify path extraction from `$lookup` higher-order semantics (known tech debt)
- [ ] **EDGE-06**: User can verify path extraction from standalone `BindNode` outside block (known tech debt)
- [ ] **EDGE-07**: User can verify complex expression round-trip via CLI (`jsonata-paths`)

## Future Requirements

### Extended Validation

- **EVAL-01**: Snapshot-based regression baselines for all 50+ tests (inline snapshots as secondary)
- **EVAL-02**: Coverage delta reporting (integration tests vs unit tests)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Platform-specific function testing | Extension functions are opaque by design — 1-2 smoke tests sufficient |
| Expression evaluation correctness | Not the analyzer's job — static analysis only |
| Performance benchmarks | Expressions are short strings, not a concern |
| Unicode/i18n field name matrix | 1 smoke test is sufficient |
| Equivalent syntax variations | Pick the natural syntax per scenario |
| Bug fixes for tech debt | v1.1 is testing only — document bugs as v1.2 items, use `it.skip` |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFR-01 | — | Pending |
| INFR-02 | — | Pending |
| INFR-03 | — | Pending |
| INFR-04 | — | Pending |
| INFR-05 | — | Pending |
| TRFM-01 | — | Pending |
| TRFM-02 | — | Pending |
| TRFM-03 | — | Pending |
| TRFM-04 | — | Pending |
| TRFM-05 | — | Pending |
| BIZR-01 | — | Pending |
| BIZR-02 | — | Pending |
| BIZR-03 | — | Pending |
| BIZR-04 | — | Pending |
| BIZR-05 | — | Pending |
| APIR-01 | — | Pending |
| APIR-02 | — | Pending |
| APIR-03 | — | Pending |
| APIR-04 | — | Pending |
| APIR-05 | — | Pending |
| DEXP-01 | — | Pending |
| DEXP-02 | — | Pending |
| DEXP-03 | — | Pending |
| DEXP-04 | — | Pending |
| EDGE-01 | — | Pending |
| EDGE-02 | — | Pending |
| EDGE-03 | — | Pending |
| EDGE-04 | — | Pending |
| EDGE-05 | — | Pending |
| EDGE-06 | — | Pending |
| EDGE-07 | — | Pending |

**Coverage:**
- v1.1 requirements: 31 total
- Mapped to phases: 0
- Unmapped: 31 ⚠️

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-03 after initial definition*
