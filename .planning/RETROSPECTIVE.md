# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-03
**Phases:** 7 | **Plans:** 11 | **Tests:** 105

### What Was Built
- Complete JSONata static path analyzer: parser adapter, recursive walker, scope chain, confidence annotations
- Handles full JSONata language: variables, lambdas, filters, sorts, transforms, parent operators, dynamic paths
- TypeScript library API (`extractPaths`) and CLI tool (`jsonata-paths`)
- 1,964 LOC (1,116 source + 848 test) across 7 phases in 2 days

### What Worked
- TDD throughout every phase — tests caught issues immediately, zero regressions across 11 plans
- Discriminated union AST types with single cast boundary — type safety everywhere after parse()
- Over-approximate design philosophy — users prefer false positives to missed dependencies
- GSD verification loop caught integration gaps early (Phase 6 and 7 were gap-closure phases)
- Small, focused plans (avg 3.5 min each) kept scope tight and progress visible

### What Was Inefficient
- Phase 4-5 ROADMAP.md plan checkboxes left unchecked (cosmetic but created audit noise)
- ADV-03 missing from 04-02-SUMMARY.md frontmatter required extra audit work to verify
- Two gap-closure phases (6, 7) needed after initial 5-phase plan — could have caught walkPath/walkVariable predicate gaps in Phase 3 planning
- CLI error handling edge case (`[object Object]`) only caught by E2E audit flow, not by unit tests

### Patterns Established
- Parser adapter pattern: cast at boundary, type-safe discriminated union everywhere else
- Type-dispatch walker: switch on `node.type` with explicit casts per case
- Prefix-after-walk: walk sub-expression normally, prefix all resulting paths with context path
- walkFilterStages: generic stages handler reusable for NameNode.stages and VariableNode.predicate
- Three-tier error extraction: `instanceof Error` > object with `.message` > `String()` fallback
- Test structure: describe blocks per requirement ID for traceability

### Key Lessons
1. Integration audit after all phases reveals gaps that unit tests miss — the walkVariable predicate gap was invisible to per-phase verification
2. Generic helper signatures (stages[] + context + scope + focus) are more reusable than node-specific signatures (NameNode) — Phase 6 refactor proved this
3. Over-approximation is the right default for static analysis — better to report `item[*]` than silently skip dynamic filters
4. Confidence as post-processing (not walker modification) keeps the walker composable and the annotation logic centralized

### Cost Observations
- Model mix: quality profile (opus for execution, sonnet/haiku for research/verification agents)
- Sessions: ~5 sessions across 2 days
- Notable: 0.53 hours total execution time for 11 plans — avg 3.5 min/plan is very fast for TDD cycles

---

## Milestone: v1.1 — Real-World Integration Tests

**Shipped:** 2026-03-05
**Phases:** 6 | **Plans:** 6 | **Tests:** 200 (186 passing + 14 skipped)

### What Was Built
- Exhaustive integration test suite: 95 tests across 5 scenario categories (data transforms, business rules, API reshaping, data export, edge cases)
- IntegrationFixture discriminated union type with assertFixture one-liner assertion and sortPaths normalization
- NPM script segmentation: test:unit (105 tests), test:integration (95 tests), npm test (200 total)
- 14 documented analyzer bugs as `it.skip` fixtures with `BUG(v1.2)` tracking and correct expected output
- CLI round-trip verification via execFileSync subprocess invocation

### What Worked
- Research-first approach: pre-verifying every expression against the live analyzer before writing fixtures eliminated fixture debugging entirely
- BUG(v1.2) skip convention: documenting correct expected output (not buggy actual) creates ready-made acceptance criteria for the fix phase
- Fixture-driven testing pattern: define fixture array, loop with assertFixture() — DRY, consistent, easy to add new cases
- Parallel phases 9-12: all 4 scenario categories were independent, enabling fast sequential execution without dependency bottlenecks
- Composite fixtures: combining bug-free patterns from multiple requirements validated cross-pattern interaction

### What Was Inefficient
- ROADMAP.md plan checkboxes inconsistency: phases 8-9 show `[ ]` while 10-13 show `[x]` — minor cosmetic issue carried forward from v1.0
- Nyquist validation files created as drafts but never completed — 6 VALIDATION.md files in draft status (wave_0_complete: false)
- Some duplication between BIZR-04 and EDGE-05 for $lookup testing (both skip for same root cause, different expressions)

### Patterns Established
- IntegrationFixture discriminated union: ExactFixture vs SubsetFixture with `never` fields for compile-time mutual exclusivity
- BUG(v1.2) tracking convention: `// BUG(v1.2): description` on line before `it.skip`, fixture shows correct expected output
- assertFixture() one-liner: calls extractPaths(), sorts both sides, asserts with toEqual — zero test boilerplate
- Category-per-file organization: one test file per scenario category, describe-per-requirement-ID for traceability
- Composite fixtures: combine bug-free patterns from multiple requirements to validate cross-feature interaction
- execFileSync for CLI testing: bypasses shell expansion of $ in JSONata expressions

### Key Lessons
1. Pre-verification of every expression against the live analyzer before writing tests eliminates the fixture-debugging cycle entirely — zero test failures during execution
2. Documenting bugs as skipped tests with correct expected output is better than bug tickets — the acceptance criteria is executable and version-tracked
3. A single milestone's test suite can expose ~14 distinct analyzer bugs that unit tests miss — integration tests with real-world patterns are indispensable
4. Filter predicate path leak is the most pervasive analyzer bug (4 instances across 3 phases) — likely a single root cause fix in walkFilterStages

### Cost Observations
- Model mix: quality profile (opus for execution, sonnet for integration checker/verification agents)
- Sessions: ~3 sessions across 1 day
- Notable: 13 min total execution time for 6 plans — avg 2.2 min/plan; even faster than v1.0 due to established patterns

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~5 | 7 | Initial release — established TDD, GSD verification, audit-driven gap closure |
| v1.1 | ~3 | 6 | Integration test suite — established fixture-driven testing, BUG tracking, pre-verification |

### Cumulative Quality

| Milestone | Tests | LOC (src) | LOC (test) | Tech Debt |
|-----------|-------|-----------|------------|-----------|
| v1.0 | 105 | 1,116 | 848 | 4 non-critical items |
| v1.1 | 200 | 1,116 | 2,394 | 14 documented bugs (BUG(v1.2)) |

### Top Lessons (Verified Across Milestones)

1. Integration audit after all phases reveals gaps invisible to per-phase verification
2. Small, focused plans (< 5 min each) with TDD produce zero regressions
3. Pre-verifying expressions before writing test fixtures eliminates the debugging cycle (confirmed v1.1)
4. Documenting bugs as skipped tests with correct expected output creates executable acceptance criteria (established v1.1)
