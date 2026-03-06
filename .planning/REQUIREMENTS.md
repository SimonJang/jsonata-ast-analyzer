# Requirements: JSONata AST Path Analyzer

**Defined:** 2026-03-06
**Core Value:** Given any JSONata expression, accurately identify every data path read from the input object — including paths accessed through variable assignments, filter predicates, and function arguments.

## v1.1.2 Requirements

### CI Pipeline

- [ ] **CI-01**: CI workflow builds project before running tests so `dist/cli.js` exists for CLI round-trip tests

## Future Requirements

None.

## Out of Scope

| Feature | Reason |
|---------|--------|
| CI matrix expansion | Current Node 20+22 matrix is sufficient |
| CI caching optimizations | Not needed for this fix |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CI-01 | Phase 17 | Pending |

**Coverage:**
- v1.1.2 requirements: 1 total
- Mapped to phases: 1
- Unmapped: 0

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-06 after initial definition*
