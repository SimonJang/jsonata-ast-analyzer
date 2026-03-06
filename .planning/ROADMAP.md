# Roadmap: JSONata AST Path Analyzer

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-7 (shipped 2026-03-03)
- ✅ **v1.1 Real-World Integration Tests** -- Phases 8-13 (shipped 2026-03-05)
- ✅ **v1.1.1 Bug Fixes** -- Phases 14-16 (shipped 2026-03-06)
- 🚧 **v1.1.2 CI Fix** -- Phase 17 (in progress)

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

<details>
<summary>v1.1.1 Bug Fixes (Phases 14-16) -- SHIPPED 2026-03-06</summary>

- [x] Phase 14: Isolated Single-Function Fixes (2/2 plans) -- completed 2026-03-06
- [x] Phase 15: Pipeline and Apply Fixes (1/1 plan) -- completed 2026-03-06
- [x] Phase 16: Filter Predicate Scope-Awareness (2/2 plans) -- completed 2026-03-06

Full details: `milestones/v1.1.1-ROADMAP.md`

</details>

### v1.1.2 CI Fix (In Progress)

**Milestone Goal:** Fix CI pipeline so all 294 tests pass by adding a build step before the test run.

- [x] **Phase 17: CI Build Step** - Add `pnpm build` to CI workflow so `dist/cli.js` exists for CLI round-trip tests (completed 2026-03-06)

## Phase Details

### Phase 17: CI Build Step
**Goal**: CI pipeline produces build artifacts before running tests so all 294 tests pass including CLI round-trip tests
**Depends on**: Nothing (standalone CI config change)
**Requirements**: CI-01
**Success Criteria** (what must be TRUE):
  1. CI workflow YAML includes a `pnpm build` step after `pnpm typecheck` and before `pnpm test`
  2. CI pipeline passes all 294 tests on both Node 20 and Node 22 (including 3 CLI round-trip tests that require `dist/cli.js`)
  3. No existing CI steps (checkout, pnpm setup, node setup, install, typecheck, test) are removed or broken
**Plans**: 1 plan

Plans:
- [ ] 17-01: Add build step to CI workflow

## Progress

**Execution Order:**
Phase 17

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
| 15. Pipeline and Apply Fixes | v1.1.1 | 1/1 | Complete | 2026-03-06 |
| 16. Filter Predicate Scope-Awareness | v1.1.1 | 2/2 | Complete | 2026-03-06 |
| 17. CI Build Step | 1/1 | Complete    | 2026-03-06 | - |
