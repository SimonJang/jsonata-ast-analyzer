# Roadmap: JSONata AST Path Analyzer

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-7 (shipped 2026-03-03)
- 🚧 **v1.1 Real-World Integration Tests** -- Phases 8-13 (in progress)

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

### v1.1 Real-World Integration Tests (In Progress)

**Milestone Goal:** Validate the path analyzer against exhaustive real-world JSONata scenarios to build confidence the library handles production-grade expressions correctly. 50+ integration tests across 5 scenario categories plus edge cases targeting known tech debt.

- [ ] **Phase 8: Test Infrastructure** - Shared helpers, fixture types, assertion utilities, NPM scripts
- [ ] **Phase 9: Data Transformation Tests** - Pipeline chains, apply operators, array mapping, string formatting, multi-stage transforms
- [x] **Phase 10: Business Rule Tests** - Conditionals, compound filters, aggregation, lookups, variable-driven construction (completed 2026-03-04)
- [x] **Phase 11: API Reshaping Tests** - Nested extraction, mixed sources, deep traversal, context variables, parent operator (completed 2026-03-04)
- [x] **Phase 12: Data Export Tests** - Format conversion, flat records, transform operator, group-by aggregation (completed 2026-03-04)
- [x] **Phase 13: Edge Cases and Tech Debt** - Deep variable chains, nested HOFs, custom functions, $sort/$lookup/$bind debt, CLI round-trip (completed 2026-03-04)

## Phase Details

### Phase 8: Test Infrastructure
**Goal**: Integration test foundation exists and enforces correct assertion discipline before any scenario tests are written
**Depends on**: Phase 7 (v1.0 complete)
**Requirements**: INFR-01, INFR-02, INFR-03, INFR-04, INFR-05
**Success Criteria** (what must be TRUE):
  1. Running `npm run test:integration` discovers and executes test files from `test/integration/` directory
  2. Running `npm run test:unit` executes only existing unit tests (not integration tests)
  3. A sample fixture using `assertFixture()` fails when expected paths are wrong and passes when correct (the helper enforces exact sorted comparison with confidence)
  4. The `IntegrationFixture` interface provides TypeScript type errors when `name`, `expression`, or `expectedPaths` is missing
**Plans**: 1 plan

Plans:
- [ ] 08-01-PLAN.md -- Integration test helpers, fixture types, category files, and NPM scripts

### Phase 9: Data Transformation Tests
**Goal**: Users can verify the analyzer correctly extracts paths from real-world data transformation patterns -- the most common JSONata production use case
**Depends on**: Phase 8
**Requirements**: TRFM-01, TRFM-02, TRFM-03, TRFM-04, TRFM-05
**Success Criteria** (what must be TRUE):
  1. A filter-sort-map-reshape pipeline expression produces exactly the expected set of paths including all fields referenced across stages
  2. Chained `~>` apply expressions with lambda threading resolve all paths through the pipeline, including lambda parameters
  3. Array dot-notation mapping with context-relative paths (e.g., `orders.items.price`) produces correctly prefixed leaf paths
  4. Multi-stage transforms with intermediate variable bindings resolve all variable hops to their source data paths
  5. All tests use `assertFixture()` with confidence included in every PathResult assertion
**Plans**: 1 plan

Plans:
- [ ] 09-01-PLAN.md -- TRFM-01 through TRFM-05 fixtures: pipeline chains, apply operators, array dot-notation, string formatting, multi-stage variable transforms

### Phase 10: Business Rule Tests
**Goal**: Users can verify the analyzer correctly extracts paths from conditional logic, cross-field calculations, and lookup patterns typical of business rule expressions
**Depends on**: Phase 8
**Requirements**: BIZR-01, BIZR-02, BIZR-03, BIZR-04, BIZR-05
**Success Criteria** (what must be TRUE):
  1. Ternary and coalescing expressions produce paths from all branches (not just the "true" branch)
  2. Compound boolean filter predicates (`and`/`or`) produce paths for every field referenced in the predicate
  3. Aggregation functions over nested arrays (`$sum`, `$count`, `$average`) produce the correct nested path to the aggregated field
  4. Variable-driven object construction (bind to `$var`, reference multiple times) resolves all variable references back to source paths
  5. All tests use `assertFixture()` with confidence included in every PathResult assertion
**Plans**: 1 plan

Plans:
- [ ] 10-01-PLAN.md -- BIZR-01 through BIZR-05 fixtures: conditionals, compound filters, aggregation, lookups, variable-driven object construction

### Phase 11: API Reshaping Tests
**Goal**: Users can verify the analyzer correctly extracts paths from complex API payload extraction and restructuring -- nested objects, multiple root paths, context variables, and parent operators
**Depends on**: Phase 8
**Requirements**: APIR-01, APIR-02, APIR-03, APIR-04, APIR-05
**Success Criteria** (what must be TRUE):
  1. Nested API payload extraction with flattening produces all leaf paths from the source structure, not the output structure
  2. Object constructors pulling from multiple root-level paths (e.g., `{"user": account.name, "order": orders[0].id}`) produce paths under each distinct root
  3. Context variable binding with cross-reference (`@$v` pattern) resolves paths through the binding correctly
  4. Parent operator `%` in nested mapped contexts produces path segments indicating parent scope access
  5. All tests use `assertFixture()` with confidence included in every PathResult assertion
**Plans**: 1 plan

Plans:
- [ ] 11-01-PLAN.md -- APIR-01 through APIR-05 fixtures: nested extraction, mixed sources, deep traversal, context variables, parent operator, plus composite

### Phase 12: Data Export Tests
**Goal**: Users can verify the analyzer correctly extracts paths from structure-to-structure conversions, flat record extraction, and grouped aggregation patterns
**Depends on**: Phase 8
**Requirements**: DEXP-01, DEXP-02, DEXP-03, DEXP-04
**Success Criteria** (what must be TRUE):
  1. Structure-to-structure format conversion (e.g., JSON-to-JSON reshaping) produces all source paths, not destination paths
  2. Multi-field extraction into flat records produces one path per extracted source field
  3. Transform operator with update and delete clauses produces paths from the update expression (not just the match expression)
  4. Group-by with aggregation produces both the grouping key path and the aggregated value path
**Plans**: 1 plan

Plans:
- [ ] 12-01-PLAN.md -- DEXP-01 through DEXP-04 fixtures: format conversion, flat records, transform operator, group-by aggregation, plus composite

### Phase 13: Edge Cases and Tech Debt
**Goal**: Users can verify the analyzer handles the hardest feature interactions and known tech debt items -- deep variable chains, nested closures, interprocedural tracing, and documented untested code paths
**Depends on**: Phase 9, Phase 10, Phase 11, Phase 12 (all scenario categories complete)
**Requirements**: EDGE-01, EDGE-02, EDGE-03, EDGE-04, EDGE-05, EDGE-06, EDGE-07
**Success Criteria** (what must be TRUE):
  1. A 3-4 hop variable chain (e.g., `$c := $b.x; $b := $a.y; $a := root.z`) resolves all the way back to the root data path
  2. Nested higher-order functions with closure capture across two `$map` levels produce paths from both the outer and inner scope
  3. Custom function definitions called from multiple sites produce the union of paths from all call-site arguments
  4. Known tech debt items (`$sort` lambda, `$lookup` HOF semantics, standalone `BindNode`) either pass or are documented as `it.skip` with a tracking comment for v1.2
  5. Complex expressions piped through the CLI (`jsonata-paths`) produce the same path output as the programmatic API
**Plans**: 1 plan

Plans:
- [ ] 13-01-PLAN.md -- EDGE-01 through EDGE-07 fixtures: variable chains, nested HOFs, custom functions, $sort lambda, $lookup/$bind debt, CLI round-trip, plus composite

## Progress

**Execution Order:**
Phases 8 first (infrastructure), then 9-12 in any order (independent test categories), then 13 last (depends on all categories).

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation and Basic Walker | v1.0 | 2/2 | Complete | 2026-03-02 |
| 2. Scope Infrastructure and Variable Tracing | v1.0 | 2/2 | Complete | 2026-03-02 |
| 3. Context-Relative Operators | v1.0 | 2/2 | Complete | 2026-03-03 |
| 4. Advanced Analysis | v1.0 | 2/2 | Complete | 2026-03-03 |
| 5. Public API and CLI | v1.0 | 1/1 | Complete | 2026-03-03 |
| 6. ADV-02 Edge Case Fix | v1.0 | 1/1 | Complete | 2026-03-03 |
| 7. Integration Polish | v1.0 | 1/1 | Complete | 2026-03-03 |
| 8. Test Infrastructure | v1.1 | 0/1 | Not started | - |
| 9. Data Transformation Tests | v1.1 | 0/1 | Not started | - |
| 10. Business Rule Tests | 1/1 | Complete    | 2026-03-04 | - |
| 11. API Reshaping Tests | 1/1 | Complete    | 2026-03-04 | - |
| 12. Data Export Tests | 1/1 | Complete    | 2026-03-04 | - |
| 13. Edge Cases and Tech Debt | 1/1 | Complete    | 2026-03-04 | - |
