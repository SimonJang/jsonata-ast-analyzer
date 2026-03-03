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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~5 | 7 | Initial release — established TDD, GSD verification, audit-driven gap closure |

### Cumulative Quality

| Milestone | Tests | LOC (src) | LOC (test) | Tech Debt |
|-----------|-------|-----------|------------|-----------|
| v1.0 | 105 | 1,116 | 848 | 4 non-critical items |

### Top Lessons (Verified Across Milestones)

1. Integration audit after all phases reveals gaps invisible to per-phase verification
2. Small, focused plans (< 5 min each) with TDD produce zero regressions
