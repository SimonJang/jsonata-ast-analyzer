# Project Research Summary

**Project:** JSONata AST Path Analyzer — v1.1 Real-World Integration Testing
**Domain:** Static analysis tool integration testing
**Researched:** 2026-03-03
**Confidence:** HIGH

## Executive Summary

This milestone adds exhaustive real-world integration tests to a mature v1.0 JSONata AST path analyzer. The tool takes JSONata expressions as input and returns an array of `PathResult` objects (`{ path, confidence }`) representing every data field the expression reads. Integration testing for a static analysis tool differs critically from standard integration testing: the tool's output is a small, deterministic array (typically 5-15 paths) that must exactly match what the analyzed expression reads, and the most dangerous failure modes are silent — the tool returns fewer paths than it should, not more.

The recommended approach is to write 50+ hand-crafted test scenarios organized into five category files under `test/integration/`, using Vitest's `it.for()` with typed fixture objects and exact `toEqual` assertions as the primary validation mechanism. No new dependencies are required — the existing stack (TypeScript 5.9, jsonata 2.1.0, Vitest 4.0.18, @vitest/coverage-v8) already provides all capabilities needed, including parameterized test tables (`it.for()`), inline snapshots (`toMatchInlineSnapshot()`), and parallel file execution. The v1.1 work is entirely in writing tests, not in adding infrastructure.

The dominant risks are not technical but disciplinary: the test suite can be written in ways that provide zero protection against the tool's most common failure modes. Specifically, using subset assertions (`toContainEqual`) without length guards allows the tool to spuriously over-report paths without detection, while using exact assertions without sorted comparison makes the suite brittle to correct refactors. Both problems are solved by a shared `helpers.ts` assertion utility that sorts both arrays before comparison and uses `toEqual` as the standard. Every test must include the `confidence` field in assertions, not just `path`, because confidence misclassification (`static` vs `dynamic` vs `partial`) is a silent functional regression.

## Key Findings

### Recommended Stack

The v1.0 stack requires zero changes for v1.1. Vitest 4.0.18 (the current stable release as of February 2026) provides everything needed: `it.for()` for typed parameterized test tables with superior TypeScript inference over `it.each()`, `toMatchInlineSnapshot()` for baseline captures, `@vitest/coverage-v8` for coverage reporting, and parallel file execution for fast feedback. The existing `vitest.config.ts` already picks up files in `test/integration/*.test.ts` via its default glob — no configuration changes are needed.

**Core technologies:**
- **Vitest 4.0.18**: Test runner, parameterized tables, snapshots — already installed; use `it.for()` for all new tests
- **@vitest/coverage-v8 4.0.18**: Coverage verification — confirms integration tests exercise new code paths beyond unit tests
- **TypeScript 5.9**: Typed fixture interfaces enforce completeness and catch typos at compile time
- **jsonata 2.1.0**: The library under test — integration tests go through the public `extractPaths()` API only

**What NOT to add:** fast-check (cannot generate meaningful JSONata expressions), faker, mocking libraries (pure function, no mocking needed), external fixture files (expressions are short strings, keep them inline).

### Expected Features

The research identified test coverage across 10 table-stakes scenario categories and 14 differentiating complex patterns, with 6 explicit anti-features to avoid.

**Must have (table stakes — 20-25 tests):**
- API response reshaping (nested extraction + flattening) — the single most common JSONata use case in production
- Data transformation pipelines (filter → sort → map → reshape) — core production pattern at Stedi, AWS, Node-RED
- Conditional field selection (ternary, elvis `?:`, coalescing) — all branches must produce paths
- String concatenation and formatting (`&` operator with path operands on both sides)
- Aggregation over nested arrays (`$sum`, `$count`, `$average` with nested path arguments)
- Variable-driven object construction (bind sub-tree to `$var`, reference multiple times in constructor)
- Array mapping via dot operator (context-relative path resolution per element)
- Multi-field filter predicates (compound `and`/`or` boolean filters)
- Lookup and cross-reference patterns (`$lookup`, filter by value from another context)
- Nested object output with mixed sources (object constructors pulling from multiple root paths)

**Should have (differentiators — 15-20 tests):**
- Chained apply operator pipelines (`~>` multi-stage processing with lambda threading)
- Context variable binding with cross-reference (`@$l.books@$b[$l.isbn=$b.isbn]` pattern from official docs)
- Parent operator in nested context (multi-level `%` chaining in mapped object constructors)
- Recursive/nested higher-order functions (closure capture across two `$map` levels)
- Deeply nested variable chains (3-4 hop resolution: `$prices := $items.price; $items := $orders.items; ...`)
- Custom function definition and multi-call (interprocedural path tracing)
- Transform operator with update + delete clause (paths from update expression, not delete clause)
- Group-by with aggregation (context-relative key and value extraction)

**Defer (out of scope for v1.1):**
- Platform-specific extension functions (`$lookupTable`, `$globalContext`, `$states.input`) — cover with 1-2 "unknown function passthrough" tests
- Expression evaluation correctness — not the analyzer's job
- Performance benchmark tests — expressions are short strings, not a concern
- Unicode/i18n field name matrix — 1 smoke test is sufficient
- Equivalent expression variation coverage — pick the natural syntax per scenario

### Architecture Approach

The integration test suite follows a **category-per-file, fixture-driven, dual-validation** architecture. Five test files under `test/integration/` each cover one scenario category. Test cases are defined as typed `IntegrationFixture` objects in arrays at the top of each file and iterated with `it.for()`. Primary validation uses exact `toEqual` assertions on sorted results; secondary validation uses `toMatchInlineSnapshot()` as a regression baseline. A shared `helpers.ts` module provides the typed fixture interface, `sortPaths()`, and `assertFixture()`.

**Major components:**
1. **`test/integration/helpers.ts`** — `IntegrationFixture` interface, `sortPaths()`, `assertFixture()`; imported by all category files
2. **5 category test files** — `data-transforms`, `business-rules`, `api-reshaping`, `data-export`, `edge-cases`; 8-15 typed fixtures each
3. **Fixture arrays** — Typed `IntegrationFixture[]` with expression string, `expectedPaths: PathResult[]`, optional `mustContain`/`mustNotContain`
4. **Inline snapshots** — Secondary baselines per complex test, populated by `vitest -u`, reviewed before commit

**Build order within the suite:** data-transforms → business-rules → api-reshaping → data-export → edge-cases. Each category builds on confidence from the previous and escalates complexity. The file structure requires no config changes — Vitest's default glob picks up `test/**/*.test.ts` automatically.

### Critical Pitfalls

1. **Tautological assertions (`toContainEqual` without length guard)** — Subset assertions allow over-reporting bugs to go undetected entirely. Mandate `toEqual` (exact match after sorting) as the primary assertion on every test. When subset assertions are necessary for very complex outputs, always pair with `toHaveLength(N)`. Enforce via the shared `assertFixture()` utility.

2. **Testing the expression, not the tool** — Expected paths must reflect JSONata specification semantics, not the test author's mental model. Subtle semantics (array index vs. filter predicate, `$v` vs. `$a` in `$map` callbacks, `%` parent scope) are easy to get wrong. Verify each fixture's expected output using the JSONata Exerciser with concrete sample data. Document WHY each path appears in fixture comments.

3. **Integration tests that are just longer unit tests** — Every integration test must combine at least 2 interacting features (e.g., variable tracing inside a filter predicate inside a lambda). Tests organized by feature are unit tests; tests organized by real-world scenario are integration tests. Each test's scenario name and comments must explain which features are interacting.

4. **Snapshot tests without intent documentation** — `toMatchInlineSnapshot()` is a secondary baseline only, never the primary assertion. Snapshots can be blindly updated with `vitest -u`. The primary assertion is always an explicit `toEqual`. Never commit snapshot content without reviewing that the values are semantically correct.

5. **Missing "silence is wrong" coverage** — The walker has documented silent-drop code paths: unresolvable variables return `[]`, unknown node types return `[]`. These produce fewer paths without any error. Only exact `toEqual` assertions catch this; subset assertions do not. Deep variable chain tests (3+ hops) are specifically designed to surface silent resolution failures.

## Implications for Roadmap

Based on combined research, the recommended phase structure prioritizes: (1) infrastructure that prevents poorly-structured tests from being written, (2) core production patterns that exercise the most walker code paths, and (3) advanced patterns that stress feature interactions and known technical debt.

### Phase 1: Test Infrastructure and Assertion Foundation

**Rationale:** Without the shared `helpers.ts` utility and assertion discipline established before any tests are written, pitfalls 1, 4, 5, and 9 will manifest across the entire suite and be expensive to retroactively fix. This is the foundational constraint identified across all four research files — PITFALLS.md explicitly calls it out as "Phase 1 before writing any tests."

**Delivers:** `test/integration/` directory, `helpers.ts` with `IntegrationFixture` type + `sortPaths()` + `assertFixture()`, NPM scripts (`test:unit`, `test:integration`, `test:update-snapshots`), and 2-3 smoke fixtures in `data-transforms.integration.test.ts` to validate the infrastructure end-to-end.

**Addresses:** File organization (Pitfall 10), assertion strategy convention (Pitfall 1), ordering sensitivity (Pitfall 9), snapshot discipline (Pitfall 4)
**Avoids:** All critical assertion pitfalls before they can be written into tests

### Phase 2: Core Production Patterns (20-25 tests)

**Rationale:** API reshaping, data pipelines, conditional selection, aggregation, and variable-driven construction appear in every production JSONata environment. These also exercise the widest cross-section of the walker's code paths. If the walker has fundamental bugs in variable resolution or filter predicate context, they surface here. FEATURES.md designates these as the 10 table-stakes categories sourced from Stedi, AWS Step Functions, and Node-RED production usage.

**Delivers:** `data-transforms.integration.test.ts`, `business-rules.integration.test.ts`, `api-reshaping.integration.test.ts` fully populated with 20-25 tests sourced from real production patterns. Expressions are multi-line template literals with descriptive comments. All tests use `assertFixture()` with `confidence` included in every `PathResult` assertion.

**Uses:** `it.for()` parameterized tables, typed `IntegrationFixture[]` arrays, `assertFixture()` helper from Phase 1
**Implements:** Category-per-file architecture from ARCHITECTURE.md; complexity-ladder ordering within each file
**Avoids:** Pitfall 2 (verify via JSONata Exerciser), Pitfall 3 (each test combines 2+ interacting features), Pitfall 7 (confidence field in all assertions), Pitfall 8 (expressions sourced from real production patterns)

### Phase 3: Advanced Patterns, Edge Cases, and Tech Debt (25-30 tests)

**Rationale:** Chained `~>` pipelines, context variable binding (`@$v`), parent operator chains, nested lambda closures, and deeply nested variable chains represent the complex end of production JSONata. They also target the features most likely to have subtle scope-chain bugs. The known technical debt from PROJECT.md (`$sort` lambda semantics, `$lookup`, standalone `BindNode`) must be explicitly covered — PITFALLS.md identifies skipping known debt as Pitfall 11 and flags it as a Phase 3 concern.

**Delivers:** `data-export.integration.test.ts`, `edge-cases.integration.test.ts`, targeted fixtures for each known tech debt item (`$sort` with lambda callback, `$lookup`, standalone `$x := expr` bind outside a block), plus 3-5 CLI integration tests using `execFileSync` (complex expression round-trip, stdin piping, error formatting verification).

**Avoids:** Pitfall 5 (3+ hop variable chain tests detect silent drops), Pitfall 6 (3-way feature interaction matrix cells covered), Pitfall 11 (tech debt items explicitly targeted), Pitfall 12 (CLI tests added)

### Phase Ordering Rationale

- Infrastructure before tests: PITFALLS.md shows that bad assertion conventions are hard to retroactively fix across 50+ tests; `helpers.ts` must exist before the first test is written.
- Core patterns before edge cases: ARCHITECTURE.md's build-order analysis shows each category builds on confidence from the previous; edge cases require the fixture infrastructure to be battle-tested.
- Feature interaction depth: PITFALLS.md's feature interaction matrix analysis shows 3-way interactions (variable + filter + lambda) as the highest-risk untested area; these are addressed in Phase 3 after Phase 2 establishes that 2-way interactions work correctly.
- Tech debt explicitly phased: Phase 3 targets known tech debt items from PROJECT.md explicitly rather than relying on incidental coverage.

### Research Flags

Phases needing closer attention during implementation:
- **Phase 3 edge cases:** Context variable binding (`@$v` with cross-reference across two arrays), parent operator in mapped contexts, and deeply nested variable chains are the hardest to reason about. Expected paths for these scenarios should be verified against the JSONata Exerciser with concrete sample data before writing assertions, per Pitfall 2 guidance.
- **Phase 3 tech debt targets:** `$sort` higher-order semantics and standalone `BindNode` behavior are documented as untested in PROJECT.md. Tests for these may reveal actual bugs. If they do, document as v1.2 items and mark tests as `it.skip` with a tracking comment — do not fix the bugs in scope of v1.1.

Phases with standard, lower-risk patterns:
- **Phase 1 infrastructure:** Vitest APIs are well-documented; the `IntegrationFixture` interface and `sortPaths()` utility are straightforward TypeScript.
- **Phase 2 core patterns:** Production JSONata patterns are extensively documented across four independent sources; expected outputs for basic pipelines, conditionals, and aggregations are mechanically derivable from JSONata semantics.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies; all capabilities verified in Vitest 4.0 official docs; npm version confirmed |
| Features | HIGH | Test categories sourced from official JSONata docs + Stedi + AWS Step Functions + Node-RED — four independent production sources; cross-referenced against existing 105-test unit suite |
| Architecture | HIGH | Category-per-file fixture pattern validated against Vitest community discussions; component boundaries are clean and consistent with existing project structure |
| Pitfalls | HIGH | Grounded in direct codebase analysis of `walker.ts`, `index.ts`, `scope.ts` combined with testing anti-pattern literature; silent-drop code paths identified by line number |

**Overall confidence:** HIGH

### Gaps to Address

- **Snapshot usage policy:** ARCHITECTURE.md recommends inline snapshots as secondary validation on every test; PITFALLS.md recommends against relying on them. These are consistent but the implementation team should decide upfront: secondary snapshot on every test, or only on complex expressions with 10+ paths. Either is defensible — consistency across the suite is what matters.
- **`$sort` lambda semantics:** PROJECT.md documents that `$sort` higher-order semantics are defined but untested. An integration test may reveal a bug. The gap is known and scoped to Phase 3 — if a test fails, it becomes a tracked v1.2 item. Do not let uncertainty about this prevent starting Phase 2.
- **Exact path enumeration for complex expressions:** For expressions producing 15+ paths (deeply nested variable chains, transform operator with update + delete), manually enumerating expected paths is tedious and error-prone. Mitigation: verify against the JSONata Exerciser with concrete input data and document the reasoning in fixture comments. This is a process discipline gap, not a technical one.

## Sources

### Primary (HIGH confidence)
- [Vitest Test API Reference](https://vitest.dev/api/) — `it.for()`, `it.each()`, `describe.each()` documentation
- [Vitest Snapshot Guide](https://vitest.dev/guide/snapshot) — `toMatchInlineSnapshot()`, custom serializers, best practices
- [Vitest 4.0 Announcement](https://vitest.dev/blog/vitest-4) — confirms v4.0.18 as current stable
- [JSONata Official Docs](https://docs.jsonata.org/) — path operators, programming constructs, expressions, construction patterns
- [AWS Step Functions JSONata](https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html) — production JSONata usage patterns in cloud workflows
- [Stedi Common Mapping Expressions](https://www.stedi.com/docs/edi-platform/mappings/jsonata/common-mapping-expressions) — production EDI/API data transformation patterns
- Codebase analysis: `walker.ts`, `index.ts`, `types.ts`, `scope.ts`, `extract-paths.test.ts` — direct source code reading; silent-drop code paths identified by line number

### Secondary (MEDIUM confidence)
- [Vitest GitHub Discussion #4675](https://github.com/vitest-dev/vitest/discussions/4675) — unit vs. integration test separation via directory
- [Node-RED JSONata Recipes](https://github.com/node-red/cookbook.nodered.org/wiki/JSONata-Recipes) — community production patterns
- [SSENSE Step Functions JSONata 2025](https://medium.com/ssense-tech/step-functions-in-2025-simplify-your-development-with-jsonata-1590b6c439d3) — real-world complexity examples
- [Effective Snapshot Testing (Kent C. Dodds)](https://kentcdodds.com/blog/effective-snapshot-testing) — snapshot discipline guidance
- [Software Testing Anti-patterns (Codepipes)](https://blog.codepipes.com/testing/software-testing-antipatterns.html) — tautological test anti-pattern
- [Stedi JSONata Cheatsheet](https://www.stedi.com/docs/edi-platform/mappings/jsonata/jsonata-cheatsheet) — common real-world expression patterns

### Tertiary (LOW confidence)
- [Its 2025, Stop Using Snapshot Testing (Stackademic)](https://blog.stackademic.com/its-2025-stop-using-snapshot-testing-1afa6612259e) — opinion piece, informs snapshot policy discussion
- [JSONata Kestra Article](https://medium.com/@fhussonnois/jsonata-the-swiss-army-knife-of-kestra-for-json-transformation-07c27d27988d) — data integration pipeline patterns
- [Tautological Test Driven Development Anti-Pattern (Fabio Pereira)](http://fabiopereira.me/blog/2010/05/27/ttdd-tautological-test-driven-development-anti-pattern/) — general testing literature

---
*Research completed: 2026-03-03*
*Ready for roadmap: yes*
