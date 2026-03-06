# Milestones

## v1.1.1 Bug Fixes (Shipped: 2026-03-06)

**Phases:** 3 | **Plans:** 5 | **Tasks:** 13 | **Tests:** 294 (all passing, 0 skipped)
**Source:** 4,547 LOC TypeScript (1,189 source + 3,358 test)
**Timeline:** 2 days (2026-03-05 planning, 2026-03-06 execution)
**Git range:** `test(14-01)` -> `docs(phase-16)` (36 commits)

**Delivered:** Fixed all 14 documented BUG(v1.2) analyzer bugs across 7 categories (filter predicate leak, $lookup chaining, focus variable double-prefix, parent operator walkPath, pipeline duplicates, walkVariable .group, array constructor scope) with 80+ new regression tests and zero regressions across the full 294-test suite.

**Key accomplishments:**
1. Fixed walkPath to handle object constructor, block expression, and function steps for parent operator and $lookup chaining (PRNT + LOOK)
2. Fixed walkVariable group-by and array constructor sequential scope accumulation (WVAR + ARRS)
3. Fixed walkApply inline lambda parameter binding and variable-resolved sort extraction (PIPE)
4. Created extractBasePaths/filterToBasePaths helpers for structural HOF base path extraction
5. Fixed filter predicate scope isolation with three-tier scope-aware walkFilterStages (FILT + FOCV)
6. All 14 BUG(v1.2) tests unskipped and passing, 80+ new regression tests, zero regressions

**Tech debt resolved:** All 14 `it.skip` BUG(v1.2) fixtures from v1.1 are now unskipped and passing. Zero known analyzer bugs remain.

**Archives:** `milestones/v1.1.1-ROADMAP.md`, `milestones/v1.1.1-REQUIREMENTS.md`

---

## v1.1 Real-World Integration Tests (Shipped: 2026-03-05)

**Phases:** 6 | **Plans:** 6 | **Tests:** 200 (186 passing + 14 skipped)
**Source:** 3,510 LOC TypeScript (1,116 source + 2,394 test)
**Timeline:** 1 day (2026-03-04)
**Git range:** `test(08-01)` → `docs(13-01)` (17 commits)

**Delivered:** Exhaustive real-world integration test suite validating path extraction across 5 scenario categories (data transforms, business rules, API reshaping, data export, edge cases) with 14 known analyzer bugs documented as `it.skip` with `BUG(v1.2)` tracking for the next milestone.

**Key accomplishments:**
1. IntegrationFixture discriminated union type with sortPaths/assertFixture one-liner assertion and NPM script segmentation (test:unit, test:integration)
2. 21 data transformation fixtures covering pipeline chains, apply operators, array dot-notation, string formatting, and multi-stage variable transforms
3. 18 business rule fixtures covering conditionals, compound filters, aggregation, lookups, and variable-driven object construction
4. 14 API reshaping fixtures covering nested extraction, mixed sources, deep traversal, context variables, and parent operator
5. 21 data export fixtures covering format conversion, flat records, transform operator, and group-by aggregation
6. 12 edge case fixtures covering deep variable chains, nested HOFs, custom functions, $sort lambda, $lookup/$bind tech debt, and CLI round-trip

**Tech debt documented:** 14 `it.skip` fixtures across 5 phases with `BUG(v1.2)` tracking comments — filter predicate path leak (4), $lookup HOF chaining (2), focus variable double-prefix (2), parent operator walkPath (2), pipeline duplicate paths (2), walkVariable property gap (1), array constructor scope (1)

**Archives:** `milestones/v1.1-ROADMAP.md`, `milestones/v1.1-REQUIREMENTS.md`, `milestones/v1.1-MILESTONE-AUDIT.md`

---

## v1.0 MVP (Shipped: 2026-03-03)

**Phases:** 7 | **Plans:** 11 | **Tests:** 105
**Source:** 1,116 LOC TypeScript + 848 LOC tests
**Timeline:** 2 days (2026-03-02 → 2026-03-03)
**Git range:** `feat(01-01)` → `feat(07-01)` (86 commits)

**Delivered:** A static analysis library that extracts every data path a JSONata expression reads from its input — including paths through variables, filters, lambdas, parent operators, and dynamic computations — as both a TypeScript API and CLI tool.

**Key accomplishments:**
1. Custom AST type system (13 discriminated union types) with parser adapter wrapping official JSONata parser
2. Recursive type-dispatch walker extracting all leaf data paths from expressions
3. Immutable scope chain with variable resolution, lambda tracing, and higher-order function binding ($map, $filter, $reduce, $each, $sift, $sort)
4. Context-relative operators: filter predicates, sort expressions, group-by, and transform with correct path prefixing
5. Parent operator resolution, dynamic path wildcarding, and confidence annotations (static/dynamic/partial)
6. Public API (`extractPaths`) and CLI tool (`jsonata-paths`) with stdin/argument input

**Archives:** `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`

---

