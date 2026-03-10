# Roadmap: JSONata AST Path Analyzer

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-7 (shipped 2026-03-03)
- ✅ **v1.1 Real-World Integration Tests** -- Phases 8-13 (shipped 2026-03-05)
- ✅ **v1.1.1 Bug Fixes** -- Phases 14-16 (shipped 2026-03-06)
- ✅ **v1.1.2 CI Fix** -- Phase 17 (shipped 2026-03-06)
- **v1.1.3 Documentation** -- Phases 18-22 (in progress)

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

<details>
<summary>v1.1.2 CI Fix (Phase 17) -- SHIPPED 2026-03-06</summary>

- [x] Phase 17: CI Build Step (1/1 plan) -- completed 2026-03-06

Full details: `milestones/v1.1.2-ROADMAP.md`

</details>

### v1.1.3 Documentation (In Progress)

- [x] **Phase 18: Overview and Installation** - README opens with value proposition, quick example, install commands, ESM notice, and license (completed 2026-03-09)
- [x] **Phase 19: API Reference** - README documents extractPaths function, PathResult interface, and Confidence type with examples (completed 2026-03-09)
- [x] **Phase 20: CLI Documentation** - README documents jsonata-paths argument and stdin modes with shell quoting guidance (completed 2026-03-10)
- [ ] **Phase 21: Progressive Examples** - README includes 3-5 worked examples demonstrating all confidence levels
- [ ] **Phase 22: Architecture and Limitations** - README explains how the analyzer works and documents design decisions as limitations

## Phase Details

### Phase 18: Overview and Installation
**Goal**: A developer landing on the README immediately understands what the library does, sees a compelling example, and can install it
**Depends on**: Nothing (first phase of v1.1.3)
**Requirements**: OVVW-01, OVVW-02, INST-01, INST-02, LIC-01
**Success Criteria** (what must be TRUE):
  1. README opens with a clear one-line description that says what the library does and who it is for, without implementation jargon
  2. A quick example (JSONata expression in, path list out) appears before installation instructions so developers see value before committing to install
  3. README shows pnpm, npm, and yarn install commands and prominently notes ESM-only (no CommonJS/require)
  4. README includes a license section at the bottom
**Plans:** 1/1 plans complete

Plans:
- [ ] 18-01-PLAN.md -- Write README with overview, quick example, installation, skeleton headings, and license; fix package.json license field

### Phase 19: API Reference
**Goal**: A developer can understand the complete programmatic API without reading source code
**Depends on**: Phase 18
**Requirements**: API-01, API-02, API-03
**Success Criteria** (what must be TRUE):
  1. README documents `extractPaths(expression)` with its TypeScript signature, parameter description, return type, and error behavior (what happens with invalid expressions)
  2. README shows the `PathResult` interface with both `path` and `confidence` fields as a TypeScript code block
  3. README includes a confidence level table explaining `static`, `dynamic`, and `partial` with meaning, cause, and a concrete example expression for each level
**Plans:** 1/1 plans complete

Plans:
- [ ] 19-01-PLAN.md -- Write API Reference content: extractPaths documentation, PathResult/Confidence types, and confidence level table

### Phase 20: CLI Documentation
**Goal**: A developer can use jsonata-paths from the command line for both one-off queries and piped workflows
**Depends on**: Phase 18
**Requirements**: CLI-01, CLI-02, CLI-03
**Success Criteria** (what must be TRUE):
  1. README shows `jsonata-paths` argument mode with a runnable example command and its output
  2. README shows `jsonata-paths` stdin/pipe mode with a runnable example (e.g., echo piped to jsonata-paths) and its output
  3. README includes a visible shell quoting note explaining that `$` in JSONata expressions requires single quotes to prevent shell variable expansion
**Plans:** 1/1 plans complete

Plans:
- [ ] 20-01-PLAN.md -- Write CLI Usage content: argument mode, stdin mode, shell quoting note, and error behavior

### Phase 21: Progressive Examples
**Goal**: A developer can see how the analyzer handles increasingly complex JSONata patterns across all three confidence levels
**Depends on**: Phase 19
**Requirements**: EXMP-01
**Success Criteria** (what must be TRUE):
  1. README includes 3-5 progressive examples that cover simple dot-path access (static), variable assignment tracing (static), filter predicates, dynamic/computed paths (dynamic), and parent operator or partial resolution (partial)
  2. Each example shows the JSONata expression input and the full extracted output including confidence annotations
  3. All three confidence levels (static, dynamic, partial) appear across the example set
**Plans:** 1 plan

Plans:
- [ ] 21-01-PLAN.md -- Write 5 progressive worked examples under Examples heading with verified CLI output

### Phase 22: Architecture and Limitations
**Goal**: A developer evaluating the tool deeply can understand how it works and what it intentionally does not do
**Depends on**: Phase 19, Phase 21
**Requirements**: ARCH-01, ARCH-02, LMTS-01
**Success Criteria** (what must be TRUE):
  1. README includes a "How it works" section with an ASCII pipeline diagram showing the flow from expression string through parse, walk, extract, classify to PathResult array
  2. README explains the over-approximation design principle: the analyzer reports a superset of actual paths rather than risk missing any
  3. README documents limitations framed as deliberate design decisions (static-only analysis, wildcard injection for dynamic paths, parent operator approximation) rather than deficiencies
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 18 -> 19 -> 20 -> 21 -> 22
(Phases 19 and 20 can execute in parallel since they share only Phase 18 as a dependency.)

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
| 17. CI Build Step | v1.1.2 | 1/1 | Complete | 2026-03-06 |
| 18. Overview and Installation | 1/1 | Complete    | 2026-03-09 | - |
| 19. API Reference | 1/1 | Complete    | 2026-03-09 | - |
| 20. CLI Documentation | 1/1 | Complete    | 2026-03-10 | - |
| 21. Progressive Examples | v1.1.3 | 0/1 | Planned | - |
| 22. Architecture and Limitations | v1.1.3 | 0/0 | Not started | - |
