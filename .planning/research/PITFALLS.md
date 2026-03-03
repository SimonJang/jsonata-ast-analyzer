# Domain Pitfalls: Integration Testing a Static Analysis Tool

**Domain:** Adding integration tests to an existing JSONata AST path analyzer
**Researched:** 2026-03-03
**Confidence:** HIGH (based on codebase analysis, testing anti-pattern literature, and domain-specific reasoning about this exact tool's architecture)

---

## Critical Pitfalls

Mistakes that produce false confidence, miss real bugs, or result in a test suite that costs time without catching anything.

### Pitfall 1: Tautological Assertions That Never Fail

**What goes wrong:**
Integration tests use `toContainEqual` or `expect.arrayContaining` to assert that expected paths are present in the output -- but never assert that UNEXPECTED paths are absent. A test like `expect(result).toContainEqual({ path: "orders.total", confidence: "static" })` will pass even if the tool also returns 50 spurious garbage paths. This is the single most likely failure mode for this project because the existing test suite already uses both `toContainEqual` (subset match) and `toEqual` (exact match) inconsistently -- 24 tests use exact `toEqual`, but 19 use `toContainEqual` without length checks. The new integration tests, which are more complex and harder to enumerate exhaustively, will be tempted to lean heavily on subset assertions.

**Why it happens:**
Complex JSONata expressions produce many paths. Enumerating every expected path is tedious. The natural shortcut is "assert the important ones are there" and skip checking that nothing extra came through. This makes the test pass today but provides zero protection against the tool spuriously adding paths after a refactor. An over-approximation bug (reporting `order.customer.address.zip` when only `order.customer.name` is accessed) would sail through every subset assertion test.

**Consequences:**
- The test suite reports 100% pass rate but catches zero over-approximation regressions.
- False confidence: "we have 50+ integration tests and they all pass" when the tests are structurally incapable of detecting the most common static analysis bug (reporting too many paths).
- A future refactor that breaks the deduplication logic or adds erroneous path prefixing goes undetected.

**Prevention:**
- Mandate a "closed-world assertion" discipline: every integration test must use `toEqual` (exact match) as its primary assertion, not `toContainEqual` or `arrayContaining`.
- When exact match is impractical (very complex expressions with 15+ paths), use `toEqual` with `expect.arrayContaining` PLUS an explicit `toHaveLength(N)` check -- this is what the existing test already does in 5 cases (e.g., EXPR-03 filter tests).
- Never use `toContainEqual` without a corresponding `toHaveLength` guard.
- Add a lint rule or review checklist: "Does this test fail if the tool returns extra paths?"

**Detection (warning signs):**
- A test uses `toContainEqual` without `toHaveLength`.
- A test uses `expect.arrayContaining` without `toHaveLength`.
- A test passes when you manually insert a bogus path into the result (mutation test it mentally).
- The test file has no tests that assert the absence of specific paths.

**Phase to address:** Phase 1 -- must be established as a convention before any tests are written.

---

### Pitfall 2: Testing the Expression, Not the Tool

**What goes wrong:**
Integration tests validate that a JSONata expression is syntactically valid (it parses without error) and produces some output -- but the expected paths are derived by running the test author's mental model of "what paths should be here" without verifying against the JSONata specification or actual runtime behavior. The test author writes the expression, guesses what paths it accesses, writes assertions for those guesses, and the test passes because the tool happens to match their mental model. But the mental model is wrong -- the expression actually accesses different paths at runtime -- so the test is asserting the wrong answer and will pass forever.

**Why it happens:**
JSONata has many subtle semantics:
- `items[0].name` accesses `items` and `items.name` but NOT `items.0` -- the `[0]` is an array index, not a filter predicate. A test author might expect `items.0.name` and write a test asserting that.
- `$sum(items.price)` accesses `items.price` as a path. A test author unfamiliar with JSONata might think `$sum` is opaque and only `items` is a data path.
- `Account.Order.Product.(Price * %.Quantity)` -- the `%` refers to the parent `Order` object. A test author might think `%` means something else and write wrong expected paths.
- In `$map(data, function($v, $i, $a) { $v.x + $a })`, `$a` is bound to the full array `data` (not an element), while `$v` is bound to elements. The test author might assume both are elements.

**Consequences:**
- Tests lock in wrong behavior as "correct." Future developers who fix a genuine bug will see these tests fail and assume the fix is wrong.
- The test suite becomes an obstacle to correctness improvement rather than a safety net.

**Prevention:**
- For each integration test scenario, manually trace through what the JSONata expression does with a concrete sample input. Write down: "Given input X, this expression evaluates by reading paths A, B, C." Use the [JSONata Exerciser](https://try.jsonata.org) to verify the expression's behavior.
- Cross-reference expected paths against the existing v1.0 unit tests for the constituent features (filters, variables, higher-order functions) that the integration test combines.
- Include a comment in each test explaining WHY each path is expected, referencing specific JSONata semantics (e.g., "// $v is bound to elements of items, so $v.name resolves to items.name").
- For contentious cases, add a companion comment: "// Verified via JSONata Exerciser with input { items: [{ name: 'x' }] }".

**Detection (warning signs):**
- Test has no comment explaining why specific paths are expected.
- Test author cannot explain the distinction between `items[0]` (index) and `items[active]` (filter) in terms of path extraction behavior.
- Expected paths include things like `items.0` (index-as-path) or `$sum` (function name as path).
- Tests never have a "this path should NOT appear" negative assertion.

**Phase to address:** Phase 1 -- test design principles must be established before writing tests.

---

### Pitfall 3: Integration Tests That Are Just Longer Unit Tests

**What goes wrong:**
The "integration" tests are actually just unit tests with longer expressions. Instead of testing the interaction between features (variable tracing + filter predicates + lambda bindings in a single expression), they test one feature at a time with a slightly more complex expression. The 50+ integration tests end up being 50 variations of the 105 existing unit tests, adding coverage volume but not coverage depth. They pass for the same reason the unit tests pass and would fail for the same reason the unit tests fail. They catch zero new bugs.

**Why it happens:**
Writing genuinely integrated expressions is hard. It requires understanding how JSONata features compose. The temptation is to start with a simple expression and add "one more thing" -- but the "one more thing" doesn't actually interact with the first feature. For example:

- **Not integration:** `($x := account.name; $x)` (just variable tracing -- already covered by SCOPE-01 unit tests)
- **Not integration:** `items[price > 10]` (just filter predicates -- already covered by EXPR-03 unit tests)
- **Integration:** `($threshold := config.minPrice; items[price > $threshold].name)` (variable tracing AND filter predicates AND path continuation interact -- the filter uses a variable, and the result path continues past the filter)

**Consequences:**
- 50+ tests that add maintenance burden but catch no bugs the 105 unit tests wouldn't catch.
- False confidence that "integration testing is complete" when the interactions between features are untested.
- The scenarios the tool is most likely to get wrong (feature interactions) remain untested.

**Prevention:**
- Define "integration test" operationally: an integration test MUST combine at least 2 of the following features in a way where they interact (one feature's output feeds another's input):
  - Variable tracing (`:=` / `$var`)
  - Filter predicates (`[...]`)
  - Higher-order functions (`$map`, `$filter`, `$reduce`)
  - Lambda closures (capturing outer scope variables)
  - Sort/group-by operators (`^(...)` / `{key: value}`)
  - Transform operator (`|...|...|`)
  - Parent operator (`%`)
  - Dynamic bracket wildcard (`[$var]`)
  - Object constructors with path-derived values (`{"key": expr}`)
  - Apply/chaining operator (`~>`)
- Each test must document which features are interacting and how.
- Organize tests by interaction pattern, not by primary feature.

**Detection (warning signs):**
- A test expression uses only one JSONata feature.
- A test can be reduced to an existing unit test by removing surrounding context.
- The test would be caught by running the existing 105 unit tests (it exercises no new interaction).
- Tests are organized by feature ("filter tests", "variable tests") rather than by scenario ("data pipeline with filtering and reshaping").

**Phase to address:** Phase 1 -- test categorization and scenario design before writing any tests.

---

### Pitfall 4: Snapshot Tests Without Intent Documentation

**What goes wrong:**
To avoid the tedium of enumerating all expected paths for complex expressions, the test suite adopts snapshot testing (`toMatchInlineSnapshot`). The initial run generates snapshots. Future runs compare against those snapshots. This creates two failure modes:

1. **Snapshot blindly accepted:** The first run's output becomes the "expected" value without anyone verifying it is correct. If the tool has a bug in path extraction for complex expressions, the snapshot locks in the wrong answer.
2. **Snapshot blindly updated:** When the tool's behavior changes (bug fix or regression), developers run `vitest -u` to update all snapshots without reviewing whether each change is an improvement or a regression. Research consistently shows this happens in practice -- teams become conditioned to update snapshots reflexively.

**Consequences:**
- Snapshots lock in bugs as "correct behavior."
- Behavior regressions are auto-accepted by `vitest -u`.
- No one can tell from a snapshot diff whether a change is correct without understanding the JSONata expression AND the tool's intended behavior -- which no reviewer will do for 50+ tests.
- The test suite becomes a change detector (alerts on any change) rather than a correctness validator (alerts on incorrect changes).

**Prevention:**
- Use snapshots only as a SECONDARY validation, never as the primary assertion. The primary assertion must be explicit: `toEqual([...expected paths...])`.
- If snapshots are used, every snapshot test must have a companion comment explaining what the correct output should be and why. The comment is the source of truth; the snapshot is the automated check.
- Better alternative: use "golden file" testing where expected outputs are in a separate, reviewed file with comments. Changes to golden files require review.
- Best alternative for this project: use exact `toEqual` assertions for all integration tests. The tool's output is a small array of `{ path, confidence }` objects -- manageable even for complex expressions (typically 5-15 paths). Snapshots are unnecessary.

**Detection (warning signs):**
- `toMatchInlineSnapshot` or `toMatchSnapshot` appears in integration tests.
- A PR updates snapshots without per-snapshot review comments.
- No one can explain why a specific snapshot value is correct.
- Tests have snapshots but no explicit assertions.

**Phase to address:** Phase 1 -- assertion strategy must ban snapshots as primary assertions.

---

### Pitfall 5: Missing the "Silence is Wrong" Scenarios

**What goes wrong:**
The tool returns an empty array `[]` for expressions it cannot analyze. Tests that expect non-empty results will catch bugs where the tool misses paths. But tests never cover the scenario where the tool should return something but returns nothing -- because the test author doesn't know the expression should produce paths. This is especially dangerous for:

- Variable chains that fail to resolve (resolve returns `null`, paths silently dropped).
- Lambda parameters that aren't bound by higher-order function semantics (parameter reference produces empty array).
- `walkNode` hitting the `default` branch for an unrecognized node type (returns `[]`).
- Filter predicates where `isNumericIndex` incorrectly classifies a predicate as a numeric index (skipped silently).

In all these cases, the tool returns `[]` or a partial result, the test asserts that specific paths are present using `toContainEqual`, and the missing paths go unnoticed because no one asserts they should be there.

**Why it happens:**
The library's design philosophy is "over-approximate: report a superset of actual paths rather than risk missing paths." But the implementation has many code paths that silently return `[]` (under-approximate). The gap between design intent and implementation creates exactly the class of bug that integration tests should catch -- but only if the tests know which paths to expect.

Specific silent-drop code paths in `walker.ts`:
- Line 127: "Unresolvable variable in path: drop the entire path (silent skip)" -- returns `[]`.
- Line 79: "Unknown node type -- skip silently" -- returns `[]`.
- Line 407: "Unresolvable variable: silent skip" -- returns `[]`.
- Line 70: literals return `[]` (correct, but interacts with variable resolution -- a variable bound to a literal resolves to `[]`).

**Consequences:**
- The most insidious class of bugs -- silent data loss -- goes undetected.
- A refactor that breaks variable resolution will cause many paths to silently disappear. If tests only check for presence of some paths, the missing paths go unnoticed.
- The test suite provides no protection against the tool's most dangerous failure mode.

**Prevention:**
- Every integration test MUST use `toEqual` (exact match) so that missing paths cause test failure. This is the same solution as Pitfall 1 but applied from a different angle -- Pitfall 1 catches extra paths, this catches missing paths.
- Write specific "resolution chain" tests where a variable is bound through 3+ levels and the final path is asserted. If any link in the chain breaks, the path disappears entirely.
- Write tests for expressions where the tool's known "silent skip" code paths could be triggered incorrectly:
  - A variable that SHOULD resolve but might not due to scope ordering.
  - A filter predicate that contains a variable reference (not numeric, but could be misclassified).
  - A node type that the walker handles but whose child traversal is incomplete.
- Track the number of paths returned as a canary metric: if a complex 20-path expression suddenly returns 15 paths, something silently dropped.

**Detection (warning signs):**
- Integration test expects `[]` without explaining why zero paths is the correct answer.
- Tests only assert positive cases (these paths should be present), never negative cases (these paths should not be absent).
- No tests exercise the 3+ hop variable chain resolution.
- No tests verify that the tool's output count matches expectation.

**Phase to address:** Phase 1 and ongoing -- every test must be checked against this criterion.

---

## Moderate Pitfalls

### Pitfall 6: Not Testing Feature Interactions at the Boundary

**What goes wrong:**
Unit tests verify each feature in isolation. Integration tests combine features -- but only in the "happy path" middle. The bugs live at feature boundaries:

- What happens when a filter predicate inside a `$map` callback references a variable from the outer scope? (Filter + Lambda + Variable interaction)
- What happens when a sort expression sorts by a computed key that involves a variable? (Sort + Variable interaction)
- What happens when the parent operator `%` is used inside a filter predicate inside a `$map` callback? (Parent + Filter + Lambda interaction)
- What happens when `~>` pipes into a custom function whose body uses a filter? (Apply + Custom function + Filter interaction)
- What happens when an object constructor has a key derived from a filter result? (Object constructor + Filter interaction)

**Prevention:**
- Create a "feature interaction matrix" -- a grid of all 10 features vs. all 10 features. Each cell that represents a meaningful interaction should have at least one test.
- Focus tests on 3-way interactions (feature A inside feature B inside feature C) since those are where scope and context bugs manifest.
- Example critical 3-way interactions for this codebase:
  - Variable + Filter + Lambda: `($threshold := 10; $map(items, function($v) { $v[price > $threshold] }))`
  - Variable + Custom function + Apply: `($fn := function($x) { $x.name }; data ~> $fn())`
  - Filter + Sort + Path continuation: `items[active]^(price).name`
  - Lambda + Parent + Filter: `$map(items, function($v) { $v[%.category = "A"] })`
  - Transform + Variable + Object constructor: `($prefix := "new"; | data | {$prefix & "Name": firstName} |)`

**Detection (warning signs):**
- No test has 3+ features interacting.
- Tests are organized by primary feature, not by interaction pattern.
- The feature interaction matrix has empty cells for combinations involving filter + variable + lambda.

**Phase to address:** Phase 2 -- after basic integration test infrastructure is established.

---

### Pitfall 7: Confidence Level Assertions Are Missing or Incorrect

**What goes wrong:**
The tool annotates each path with a confidence level (`static`, `dynamic`, or `partial`). Integration tests assert the `path` field but ignore or incorrectly assert the `confidence` field. This is especially dangerous because:

- A path through a parent operator (`%`) should be `partial`, not `static`.
- A path through a dynamic bracket (`[$var]`) should be `dynamic`, not `static`.
- A path resolved through a 3-hop variable chain should still be `static` (fully resolvable).
- All other paths should be `static`.

If confidence is wrong, downstream consumers (e.g., a schema validator that only validates `static` paths) will silently skip paths that should be validated, or attempt to validate paths that cannot be resolved.

**Prevention:**
- Every integration test assertion must include the `confidence` field, not just `path`.
- Group tests by expected confidence outcome: "these expressions should produce only static paths," "these should produce at least one dynamic path," "these should produce at least one partial path."
- Write specific tests for confidence transitions:
  - Variable bound to a `%`-containing path: the resolved reference should inherit `partial` confidence.
  - Variable bound to a `[*]`-containing path: the resolved reference should inherit `dynamic` confidence.
  - Filter predicate on a statically resolvable path: should remain `static`.

**Detection (warning signs):**
- Tests assert `{ path: "foo.bar" }` using `toMatchObject` or `objectContaining` without `confidence`.
- No test specifically validates that `partial` or `dynamic` confidence is assigned correctly in integration scenarios.
- The `deriveConfidence` function is tested indirectly only through `extractPaths` -- but integration tests don't verify its output.

**Phase to address:** Phase 1 -- include confidence in all assertions from the start.

---

### Pitfall 8: Expressions Not Representative of Production JSONata

**What goes wrong:**
Integration test expressions are invented by the test author as "this seems complex enough" rather than derived from actual production JSONata usage. The result is expressions that exercise the tool's features but not in the patterns that real users write. Real-world JSONata has characteristic patterns that synthetic tests rarely capture:

- **Multi-line with whitespace:** Real expressions are 10-30 lines with indentation. The parser handles whitespace correctly, but tests that use single-line expressions never verify this.
- **Chained transforms:** `data ~> $map(...) ~> $filter(...) ~> $reduce(...)` is common in data pipelines but rarely appears in test suites.
- **Nested object construction with mixed sources:** `{ "id": order.id, "total": $sum(order.items.price), "active": order.status = "active" }` mixes paths, aggregations, and comparisons in a single object constructor.
- **Variable-heavy business rules:** 5+ variables assigned at the top of a block, used in complex conditionals with nested ternaries.
- **Lookup patterns:** `Account.Order.Product.$lookup(catalog, SKU)` -- using `$lookup` with cross-collection references.
- **Guard clauses:** `$exists(field) ? field.subfield : "default"` as a common defensive pattern.

**Prevention:**
- Source test expressions from:
  1. JSONata documentation examples (https://docs.jsonata.org).
  2. AWS Step Functions JSONata examples (real production patterns).
  3. JSONata GitHub issues and discussions (user-reported expressions).
  4. The JSONata Exerciser example library.
- Categorize tests by real-world use case pattern, not by language feature:
  - Data transformation pipelines (ETL reshape)
  - Business rule evaluation
  - API response reshaping
  - Configuration/template expansion
  - Data export/format conversion

**Detection (warning signs):**
- All test expressions fit on one line.
- No test uses multi-line string templates for expressions.
- Test expressions use generic names (`a`, `b`, `x`, `y`) instead of domain-realistic names (`order.items.price`, `customer.address.city`).
- No test expression uses more than 3 features together.

**Phase to address:** Phase 1 -- scenario design must be grounded in real-world patterns.

---

### Pitfall 9: Test Ordering and Deduplication Sensitivity

**What goes wrong:**
The tool deduplicates paths using `Set` (insertion order preserved) and returns them in discovery order. Integration test assertions using `toEqual` require exact ordering. When the walker's traversal order changes (e.g., a refactor processes binary operator LHS before RHS instead of RHS before LHS), all integration tests break even though the output is semantically identical. This makes tests brittle -- they fail on correct behavior changes.

**Why it happens:**
The current implementation in `index.ts` line 44: `const unique = [...new Set(rawPaths)]` preserves insertion order. The walker processes nodes in a specific order (e.g., `walkBinary` processes `lhs` then `rhs`). If that order changes, the output order changes, and `toEqual` fails.

**Consequences:**
- A correct refactor that changes traversal order breaks all integration tests.
- Developers waste time debugging "failures" that are actually just order changes.
- Developers may be tempted to switch to `arrayContaining` (losing the benefits of exact matching) to avoid order sensitivity.

**Prevention:**
- Sort results before assertion: `expect(result.sort((a, b) => a.path.localeCompare(b.path))).toEqual(expected.sort(...))`.
- Better: create a test utility function `expectPaths(expression, expectedPaths)` that sorts both arrays before comparing. Use this consistently across all tests.
- Alternative: sort the output of `extractPaths` itself (in the implementation). This makes the API deterministic and order-insensitive. The existing test suite would need updating but the API becomes more predictable.
- If sort-in-implementation is too invasive for v1.1, sort in the test helper only.

**Detection (warning signs):**
- A test fails after a correct refactor due to path ordering changes.
- Different tests use different assertion strategies (some `toEqual`, some `arrayContaining`), making the suite inconsistent.
- No shared test utility for path assertion.

**Phase to address:** Phase 1 -- create the test utility before writing integration tests.

---

## Minor Pitfalls

### Pitfall 10: Test File Organization Becomes Unmanageable

**What goes wrong:**
Adding 50+ integration tests to the existing `test/extract-paths.test.ts` (already 848 lines, 105 tests) creates a 1500+ line test file that is hard to navigate, review, and maintain. Test failures become hard to locate. New tests get appended at the bottom without organization.

**Prevention:**
- Create a separate test file: `test/integration/` directory with one file per scenario category:
  - `test/integration/data-pipelines.test.ts`
  - `test/integration/business-rules.test.ts`
  - `test/integration/api-reshaping.test.ts`
  - `test/integration/data-export.test.ts`
  - `test/integration/edge-cases.test.ts`
- Keep the existing `extract-paths.test.ts` as the unit test file.
- Each integration test file should import and use the same `expectPaths` utility.

**Detection (warning signs):**
- The test file exceeds 1500 lines.
- Tests are hard to find by scenario.
- PR reviews of test changes require scrolling past hundreds of unrelated tests.

**Phase to address:** Phase 1 -- file structure before writing tests.

---

### Pitfall 11: Ignoring the Known Tech Debt in Test Design

**What goes wrong:**
The PROJECT.md documents two pieces of known tech debt:
1. `$sort` higher-order semantics defined but untested (handled by `walkSortTerms`, not via `HIGHER_ORDER_SEMANTICS`).
2. `$lookup` not in `HIGHER_ORDER_SEMANTICS`; standalone `BindNode` outside block untested.

Integration tests that use `$sort` with a lambda callback or `$lookup` may reveal that these features don't work correctly -- but only if the test exercises them. If integration tests avoid these features (because the test author sticks to "safe" territory), the tech debt persists and grows.

**Prevention:**
- Include at least one integration test that exercises each known tech debt item:
  - `$sort(items, function($a, $b) { $a.price - $b.price })` -- tests the higher-order semantics of `$sort`.
  - `$lookup(table, key)` -- tests the non-higher-order handling of `$lookup`.
  - Standalone `$x := value` outside a block -- tests the `walkBind` path.
- If these tests reveal bugs, document them as v1.2 fixes, but at least the tests exist as failing/skipped tests that track the debt.

**Detection (warning signs):**
- No integration test uses `$sort` with a lambda callback.
- No integration test uses `$lookup`.
- Known tech debt from PROJECT.md is not represented in any test.

**Phase to address:** Phase 3 -- after the core integration tests are established, add edge-case tests targeting known debt.

---

### Pitfall 12: Not Testing the CLI Interface in Integration

**What goes wrong:**
The library has a CLI tool (`jsonata-paths`). Integration tests test the library API (`extractPaths`) but not the CLI. The CLI could have bugs in:
- Argument parsing (expression escaping in shell).
- Stdin reading (piped input).
- Output formatting (JSON vs. text).
- Error message formatting (already had a bug where error objects showed as `[object Object]`, fixed in v1.0 Phase 7).

**Prevention:**
- Include a small number of CLI integration tests (3-5) that:
  - Pass a complex expression as a CLI argument and verify JSON output.
  - Pipe a multi-line expression via stdin and verify output.
  - Pass an invalid expression and verify error formatting.
- Use `execFileSync` as the existing Phase 7 test does.

**Detection (warning signs):**
- No test invokes the CLI binary.
- The CLI is tested only by the single error-formatting test from Phase 7.

**Phase to address:** Phase 3 -- after core integration tests are established.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Test infrastructure setup | Pitfall 9 (ordering sensitivity) + Pitfall 10 (file organization) | Create shared `expectPaths` utility and directory structure before writing any tests |
| Data transformation pipeline tests | Pitfall 3 (just longer unit tests) + Pitfall 8 (unrealistic expressions) | Design scenarios around real ETL patterns with 3+ feature interactions |
| Business rule expression tests | Pitfall 2 (testing the expression not the tool) + Pitfall 5 (missing silence-is-wrong) | Verify expected paths against JSONata Exerciser; assert exact result counts |
| API response reshaping tests | Pitfall 1 (tautological assertions) + Pitfall 7 (confidence level) | Use exact `toEqual` assertions including confidence field |
| Edge case and tech debt tests | Pitfall 11 (ignoring known tech debt) + Pitfall 6 (boundary interactions) | Explicitly target `$sort` lambda, `$lookup`, standalone bind, and 3-way feature interactions |
| CLI integration tests | Pitfall 12 (not testing CLI) | Verify complex expression round-trip through CLI with JSON output parsing |

## Pitfall Severity Summary

| # | Pitfall | Severity | Effort to Prevent | Effort to Fix Later |
|---|---------|----------|-------------------|-------------------|
| 1 | Tautological assertions | CRITICAL | LOW (convention) | HIGH (rewrite all assertions) |
| 2 | Testing the expression not the tool | CRITICAL | MEDIUM (requires JSONata knowledge) | HIGH (research every test's expected values) |
| 3 | Integration tests = longer unit tests | CRITICAL | MEDIUM (scenario design discipline) | HIGH (rewrite all test scenarios) |
| 4 | Snapshot tests without intent | CRITICAL | LOW (ban snapshots as primary) | MEDIUM (replace snapshots with explicit) |
| 5 | Missing silence-is-wrong tests | CRITICAL | LOW (use exact assertions) | MEDIUM (add length checks) |
| 6 | Not testing feature boundary interactions | MODERATE | MEDIUM (interaction matrix) | MEDIUM (add targeted tests) |
| 7 | Confidence level assertions missing | MODERATE | LOW (include in all assertions) | LOW (add confidence to existing) |
| 8 | Expressions not representative | MODERATE | MEDIUM (research real patterns) | LOW (swap expressions) |
| 9 | Order sensitivity | MODERATE | LOW (sort utility) | LOW (add sorting) |
| 10 | File organization | MINOR | LOW (directory structure) | MEDIUM (split files later) |
| 11 | Ignoring known tech debt | MINOR | LOW (add specific tests) | LOW (add tests later) |
| 12 | Not testing CLI | MINOR | LOW (few tests needed) | LOW (add tests later) |

## Sources

- [Software Testing Anti-patterns (Codepipes)](https://blog.codepipes.com/testing/software-testing-antipatterns.html) -- MEDIUM confidence (general testing literature)
- [Tautological Test Driven Development Anti-Pattern (Fabio Pereira)](http://fabiopereira.me/blog/2010/05/27/ttdd-tautological-test-driven-development-anti-pattern/) -- MEDIUM confidence (general but directly applicable)
- [Effective Snapshot Testing (Kent C. Dodds)](https://kentcdodds.com/blog/effective-snapshot-testing) -- MEDIUM confidence (snapshot-specific guidance)
- [Its 2025, Stop Using Snapshot Testing (Stackademic)](https://blog.stackademic.com/its-2025-stop-using-snapshot-testing-1afa6612259e) -- LOW confidence (opinion piece but reflects community sentiment)
- [Unit Testing Anti-Patterns (Enterprise Craftsmanship)](https://enterprisecraftsmanship.com/posts/structural-inspection) -- MEDIUM confidence (structural inspection anti-pattern)
- [Vitest Snapshot Guide](https://vitest.dev/guide/snapshot) -- HIGH confidence (official Vitest documentation)
- [JSONata Official Documentation](https://docs.jsonata.org) -- HIGH confidence (JSONata semantics reference)
- [AWS Step Functions JSONata](https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html) -- HIGH confidence (real-world JSONata usage patterns)
- [The Challenge of Testing Data Pipelines (Slalom Build)](https://medium.com/slalom-build/the-challenge-of-testing-data-pipelines-4450744a84f1) -- MEDIUM confidence (test oracle problem)
- Codebase analysis: `walker.ts`, `index.ts`, `types.ts`, `scope.ts`, `extract-paths.test.ts` -- HIGH confidence (direct source code reading)
- Existing v1.0 PITFALLS.md research -- HIGH confidence (prior research on this codebase)

---
*Pitfalls research for: v1.1 Real-World Integration Tests milestone*
*Researched: 2026-03-03*
