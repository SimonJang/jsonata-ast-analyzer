# Requirements: JSONata AST Path Analyzer -- v1.1

**Defined:** 2026-03-03
**Core Value:** Validate that the path analyzer correctly handles real-world, multi-feature JSONata expressions -- not just isolated patterns

## v1.1 Requirements

### Test Infrastructure

- [x] **INFR-01**: Integration test directory (`test/integration/`) with category-per-file organization (5 files)
- [x] **INFR-02**: Typed `IntegrationFixture` interface with `name`, `expression`, `expectedPaths`, optional `mustContain`/`mustNotContain`
- [x] **INFR-03**: Shared `sortPaths()` utility that normalizes path order before comparison
- [x] **INFR-04**: Shared `assertFixture()` utility enforcing `toEqual` on sorted results with confidence included
- [x] **INFR-05**: NPM scripts for `test:unit`, `test:integration`, and `test:update-snapshots`

### Data Transformations

- [x] **TRFM-01**: User can verify path extraction from filter -> sort -> map -> reshape pipeline chains
- [x] **TRFM-02**: User can verify path extraction from chained `~>` apply operator pipelines with lambda threading
- [x] **TRFM-03**: User can verify path extraction from array dot-notation mapping with context-relative paths
- [x] **TRFM-04**: User can verify path extraction from string concatenation/formatting with path operands
- [x] **TRFM-05**: User can verify path extraction from multi-stage transforms with intermediate variable bindings

### Business Rules

- [x] **BIZR-01**: User can verify path extraction from conditional field selection (ternary, elvis `?:`, coalescing)
- [x] **BIZR-02**: User can verify path extraction from multi-field compound filter predicates (and/or boolean)
- [x] **BIZR-03**: User can verify path extraction from aggregation over nested arrays (`$sum`, `$count`, `$average`)
- [x] **BIZR-04**: User can verify path extraction from lookup and cross-reference patterns
- [x] **BIZR-05**: User can verify path extraction from variable-driven object construction (bind + multi-reference)

### API Reshaping

- [x] **APIR-01**: User can verify path extraction from nested API payload extraction + flattening into new objects
- [x] **APIR-02**: User can verify path extraction from nested object output with mixed sources (multiple root paths)
- [x] **APIR-03**: User can verify path extraction from deep path traversal with array flattening
- [x] **APIR-04**: User can verify path extraction from context variable binding with cross-reference (`@$v` pattern)
- [x] **APIR-05**: User can verify path extraction from parent operator `%` in nested mapped contexts

### Data Export

- [x] **DEXP-01**: User can verify path extraction from structure-to-structure JSON format conversion
- [x] **DEXP-02**: User can verify path extraction from multi-field extraction into flat records
- [x] **DEXP-03**: User can verify path extraction from transform operator with update + delete clauses
- [x] **DEXP-04**: User can verify path extraction from group-by with aggregation (context-relative key/value)

### Edge Cases & Tech Debt

- [x] **EDGE-01**: User can verify path extraction from deeply nested variable chains (3-4 hop resolution)
- [x] **EDGE-02**: User can verify path extraction from recursive/nested higher-order functions (closure across `$map` levels)
- [x] **EDGE-03**: User can verify path extraction from custom function definition with multi-call interprocedural tracing
- [x] **EDGE-04**: User can verify path extraction from `$sort` with lambda callback (known tech debt)
- [x] **EDGE-05**: User can verify path extraction from `$lookup` higher-order semantics (known tech debt)
- [x] **EDGE-06**: User can verify path extraction from standalone `BindNode` outside block (known tech debt)
- [x] **EDGE-07**: User can verify complex expression round-trip via CLI (`jsonata-paths`)

## Future Requirements

### Extended Validation

- **EVAL-01**: Snapshot-based regression baselines for all 50+ tests (inline snapshots as secondary)
- **EVAL-02**: Coverage delta reporting (integration tests vs unit tests)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Platform-specific function testing | Extension functions are opaque by design -- 1-2 smoke tests sufficient |
| Expression evaluation correctness | Not the analyzer's job -- static analysis only |
| Performance benchmarks | Expressions are short strings, not a concern |
| Unicode/i18n field name matrix | 1 smoke test is sufficient |
| Equivalent syntax variations | Pick the natural syntax per scenario |
| Bug fixes for tech debt | v1.1 is testing only -- document bugs as v1.2 items, use `it.skip` |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFR-01 | Phase 8 | Complete |
| INFR-02 | Phase 8 | Complete |
| INFR-03 | Phase 8 | Complete |
| INFR-04 | Phase 8 | Complete |
| INFR-05 | Phase 8 | Complete |
| TRFM-01 | Phase 9 | Complete |
| TRFM-02 | Phase 9 | Complete |
| TRFM-03 | Phase 9 | Complete |
| TRFM-04 | Phase 9 | Complete |
| TRFM-05 | Phase 9 | Complete |
| BIZR-01 | Phase 10 | Complete |
| BIZR-02 | Phase 10 | Complete |
| BIZR-03 | Phase 10 | Complete |
| BIZR-04 | Phase 10 | Complete |
| BIZR-05 | Phase 10 | Complete |
| APIR-01 | Phase 11 | Complete |
| APIR-02 | Phase 11 | Complete |
| APIR-03 | Phase 11 | Complete |
| APIR-04 | Phase 11 | Complete |
| APIR-05 | Phase 11 | Complete |
| DEXP-01 | Phase 12 | Complete |
| DEXP-02 | Phase 12 | Complete |
| DEXP-03 | Phase 12 | Complete |
| DEXP-04 | Phase 12 | Complete |
| EDGE-01 | Phase 13 | Complete |
| EDGE-02 | Phase 13 | Complete |
| EDGE-03 | Phase 13 | Complete |
| EDGE-04 | Phase 13 | Complete |
| EDGE-05 | Phase 13 | Complete |
| EDGE-06 | Phase 13 | Complete |
| EDGE-07 | Phase 13 | Complete |

**Coverage:**
- v1.1 requirements: 31 total
- Mapped to phases: 31/31
- Unmapped: 0

---
*Requirements defined: 2026-03-03*
*Last updated: 2026-03-03 after roadmap phase mapping*
