# Phase 12: Data Export Tests - Research

**Researched:** 2026-03-04
**Domain:** Integration tests for data export pattern path extraction (JSONata AST analyzer)
**Confidence:** HIGH

## Summary

Phase 12 adds integration tests to `test/integration/data-export.test.ts` covering four data export patterns: structure-to-structure format conversion (DEXP-01), multi-field flat record extraction (DEXP-02), transform operator with update/delete clauses (DEXP-03), and group-by with aggregation (DEXP-04). The existing test infrastructure (helpers, assertion utilities, established patterns from Phases 9-11) is fully reusable.

Pre-checking all candidate expressions through `extractPaths()` revealed that the vast majority of patterns produce correct results. One bug was discovered: **group-by on a variable-resolved path** (`$r{category: $sum(amount)}`) drops all group-by key/value paths because `walkVariable` does not check for the `.group` property on `VariableNode`. This requires a `BUG(v1.2)` skip. All other DEXP patterns (direct group-by, transform operator, format conversion, flat extraction) work correctly.

**Primary recommendation:** Follow the exact structural template from Phases 9-11. Use pre-checked expressions with verified expected outputs. Document the variable-group-by bug as a skipped test with `BUG(v1.2):` comment.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Carry forward Phase 9/10/11 mix strategy: focused single-pattern fixture first per requirement, then a realistic composite fixture combining patterns
- Claude decides fixture count per requirement based on complexity
- Each DEXP requirement gets its own nested `describe('DEXP-XX: ...', () => { ... })` block inside the top-level "Data Export" describe
- Pre-check expressions during planning by running them through `extractPaths()` to discover bugs upfront
- Exact match (`expectedPaths`) for ALL fixtures -- no subset matching
- Confidence level always explicit in every PathResult
- Assert what the analyzer actually produces -- run expressions first during planning, observe output, then codify as expected result
- When a test expression reveals wrong/missing paths: use `it.skip('name', () => { ... })` with `BUG(v1.2):` tracking comment
- v1.1 is testing-only -- document bugs for v1.2, don't fix them
- Skipped fixtures show CORRECT expected output (what fix should produce), not buggy actual
- Multi-line template literals for complex expressions; single-line strings for simple ones
- Fixture names combine pattern and behavior: `'nested JSON reshaping: extracts all source leaf paths'`
- Realistic variable names: `$record`, `$export`, `$grouped` (not `$a`, `$b`)
- No inline JSONata comments

### Claude's Discretion
- Exact number of fixtures per DEXP requirement
- Which JSONata expressions best represent each data export pattern
- Format conversion depth for DEXP-01 (flat-to-flat, nested-to-flat, nested-to-nested reshaping)
- What constitutes "flat record extraction" for DEXP-02 (multi-field picks, cherry-picking from nested structures)
- Transform operator complexity for DEXP-03 (simple field updates vs multi-clause update/delete combinations)
- Group-by pattern selection for DEXP-04 (implicit grouping syntax, aggregation function combinations, single vs nested keys)
- Whether composite fixture combines all 4 DEXP patterns or a realistic subset (prefer combining only bug-free patterns)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEXP-01 | User can verify path extraction from structure-to-structure JSON format conversion | All pre-checked: flat-to-flat with concat, nested-to-flat, nested-to-nested, variable-bound reshaping -- all produce correct paths |
| DEXP-02 | User can verify path extraction from multi-field extraction into flat records | All pre-checked: multi-field pick, cherry-pick with index, $map to flat records, aggregation in flat output -- all produce correct paths |
| DEXP-03 | User can verify path extraction from transform operator with update + delete clauses | All pre-checked: literal-only update, source-field update, update+delete, nested pattern, multi-field update -- all produce correct paths. Update paths correctly prefixed with pattern. Delete clause correctly ignored |
| DEXP-04 | User can verify path extraction from group-by with aggregation (context-relative key/value) | Pre-checked: direct group-by works correctly (key + value paths extracted and prefixed). **BUG found**: group-by on variable-resolved path drops all group-by paths (walkVariable missing .group handling). Document as BUG(v1.2) skip |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test framework | Already configured, used by all existing tests |
| assertFixture | n/a | Test assertion helper | Phase 8 infrastructure, one-liner per fixture |
| extractPaths | n/a | Public API under test | The analyzer's entry point |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| IntegrationFixture | n/a | Fixture type (ExactFixture) | Type-safe fixture definitions |
| sortPaths | n/a | Deterministic ordering | Used internally by assertFixture |

No new dependencies needed. All infrastructure exists from Phase 8.

## Architecture Patterns

### Test File Structure
```
test/integration/
  data-export.test.ts     # <-- THIS FILE (skeleton exists)
  helpers.ts              # assertFixture, IntegrationFixture, sortPaths
  data-transforms.test.ts # Phase 9 template
  business-rules.test.ts  # Phase 10 template
  api-reshaping.test.ts   # Phase 11 template
```

### Pattern 1: Requirement-per-describe Block
**What:** Each DEXP-XX requirement gets its own nested `describe` block with typed fixtures array and `for...of` iteration.
**When to use:** Every requirement block.
**Example:**
```typescript
// Source: established pattern from data-transforms.test.ts, business-rules.test.ts, api-reshaping.test.ts
import { describe, it } from "vitest";
import { assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("Data Export", () => {
  describe("DEXP-01: Structure-to-structure JSON format conversion", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "nested-to-flat reshaping: extracts all nested source leaf paths",
        expression: `{"city": order.shipping.address.city, "zip": order.shipping.address.zip, "total": order.summary.total}`,
        expectedPaths: [
          { path: "order.shipping.address.city", confidence: "static" },
          { path: "order.shipping.address.zip", confidence: "static" },
          { path: "order.summary.total", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });
});
```

### Pattern 2: BUG(v1.2) Skipped Tests
**What:** When an expression reveals analyzer bugs, use `it.skip` with `BUG(v1.2):` comment showing correct expected output.
**When to use:** When pre-checked expression produces wrong/missing paths.
**Example:**
```typescript
// BUG(v1.2): walkVariable does not handle .group property -- group-by
// key/value paths dropped when grouping on a variable-resolved path
it.skip("variable-resolved group-by: extracts group key and value paths through variable", () => {
  assertFixture({
    name: "variable-resolved group-by: extracts group key and value paths through variable",
    expression: `($r := data.records; $r{category: $sum(amount)})`,
    expectedPaths: [
      { path: "data.records", confidence: "static" },
      { path: "data.records.amount", confidence: "static" },
      { path: "data.records.category", confidence: "static" },
    ],
  });
});
```

### Pattern 3: Composite Fixture (Bug-Free Patterns Only)
**What:** A final `describe("Composite: ...")` block combining patterns from multiple DEXP requirements.
**When to use:** End of file, after all requirement blocks. Only combines patterns that produce correct results.
**Example:** Combine DEXP-01 format conversion + DEXP-02 flat extraction + DEXP-04 direct group-by (avoid variable-group-by bug).

### Anti-Patterns to Avoid
- **Subset matching:** Always use `expectedPaths` (exact match), never `mustContain`/`mustNotContain`
- **Fixing bugs:** v1.1 is test-only. Document bugs, don't fix the analyzer
- **Buggy expected output:** Skipped tests MUST show correct expected output (what fix should produce)
- **Combining buggy patterns in composite:** Composite fixture should only combine bug-free patterns

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test assertion | Custom expect chains | `assertFixture()` | Handles sorting, error messages, exact/subset modes |
| Path ordering | Manual sort or snapshot | `sortPaths()` | Already built into assertFixture |
| Fixture typing | Ad-hoc object shapes | `IntegrationFixture` type | Compile-time mutual exclusivity between exact/subset |
| Expression validation | Manual AST inspection | `extractPaths()` pre-check | Run expressions before coding tests to discover bugs |

## Common Pitfalls

### Pitfall 1: Transform Update Path Prefixing
**What goes wrong:** Assuming transform update paths are absolute. They're context-prefixed with the pattern path.
**Why it happens:** In JSONata, transform update expressions evaluate in the context of the matched pattern. The walker correctly prefixes update paths with the pattern path.
**How to avoid:** When writing DEXP-03 fixtures, prefix all update expression paths with the transform pattern.
**Example:** `| record | {"total": price * quantity} |` produces `record`, `record.price`, `record.quantity` (not just `price`, `quantity`).

### Pitfall 2: Transform Delete Clause Produces No Paths
**What goes wrong:** Expecting delete field names to appear as paths.
**Why it happens:** Delete clause contains string literals (field names to remove), not path expressions. The walker intentionally does not walk the delete clause.
**How to avoid:** Delete clauses do NOT contribute paths. Only pattern + update produce paths.
**Example:** `| account | {"status": "active"}, ["password"] |` produces only `account` (literal update + string delete = no additional paths).

### Pitfall 3: Group-By on Variable Drops Paths (BUG)
**What goes wrong:** `$r{category: $sum(amount)}` drops all group-by key and value paths.
**Why it happens:** `walkVariable` in walker.ts checks `.predicate` but NOT `.group` on `VariableNode`. The group-by expression is silently ignored.
**How to avoid:** Use direct paths for group-by in passing tests (e.g., `orders{category: ...}`). Use `it.skip` with `BUG(v1.2)` for variable-resolved group-by tests.
**Warning signs:** Group-by results missing key/value paths when the base is a variable.

### Pitfall 4: Group-By Value with Object Constructor
**What goes wrong:** Expecting each field in a group-by value object to produce separate prefixed paths.
**Why it happens:** The `walkGroupBy` function walks the entire value expression via `walkNode`, which handles object constructors correctly.
**How to avoid:** This actually works correctly. `products{brand: {"count": $count(price), "avg": $average(price)}}` produces `products`, `products.brand`, `products.price` (deduplicated from both $count and $average).

### Pitfall 5: Index Access in Flat Records
**What goes wrong:** Expecting numeric index to appear as path segment.
**Why it happens:** The walker's `isNumericIndex` guard skips numeric literals in filter position. `order.items[0].name` produces `order.items.name`, not `order.items[0].name`.
**How to avoid:** Expected paths should NOT include numeric indices. This is correct analyzer behavior (index position is data-dependent).

## Code Examples

Verified patterns from pre-checking through `extractPaths()`:

### DEXP-01: Format Conversion (all passing)
```typescript
// Flat-to-flat with string concatenation
// Expression: '{"name": source.firstName & " " & source.lastName, "email": source.contact.email}'
// Result: source.firstName (static), source.lastName (static), source.contact.email (static)

// Nested-to-flat extraction
// Expression: '{"city": order.shipping.address.city, "zip": order.shipping.address.zip, "total": order.summary.total}'
// Result: order.shipping.address.city (static), order.shipping.address.zip (static), order.summary.total (static)

// Nested-to-nested reshaping
// Expression: '{"billing": {"amount": invoice.lineItems.price, "tax": invoice.tax.amount}, "shipping": {"address": invoice.delivery.address}}'
// Result: invoice.lineItems.price (static), invoice.tax.amount (static), invoice.delivery.address (static)

// Variable-bound reshaping
// Expression: '($src := source.data; {"id": $src.record.id, "label": $src.meta.label, "tags": $src.meta.tags})'
// Result: source.data (static), source.data.record.id (static), source.data.meta.label (static), source.data.meta.tags (static)
```

### DEXP-02: Flat Record Extraction (all passing)
```typescript
// Multi-field pick
// Expression: '{"id": employee.id, "name": employee.name, "dept": employee.department, "salary": employee.compensation.salary}'
// Result: employee.id (static), employee.name (static), employee.department (static), employee.compensation.salary (static)

// Cherry-pick with index (index stripped)
// Expression: '{"orderId": order.id, "customerName": order.customer.name, "firstItem": order.items[0].name, "status": order.status}'
// Result: order.id (static), order.customer.name (static), order.items.name (static), order.status (static)

// Map to flat records
// Expression: '$map(employees, function($e) { {"name": $e.profile.name, "email": $e.contact.email, "dept": $e.department.name} })'
// Result: employees (static), employees.profile.name (static), employees.contact.email (static), employees.department.name (static)

// Multi-field with aggregation
// Expression: '{"customer": order.customer.name, "itemCount": $count(order.items), "total": $sum(order.items.price)}'
// Result: order.customer.name (static), order.items (static), order.items.price (static)
```

### DEXP-03: Transform Operator (all passing)
```typescript
// Literal-only update (no source paths in update)
// Expression: '| account | {"status": "active"} |'
// Result: account (static)

// Update from source fields (prefixed with pattern)
// Expression: '| account | {"displayName": firstName & " " & lastName} |'
// Result: account (static), account.firstName (static), account.lastName (static)

// Update + delete (delete produces no paths)
// Expression: '| account | {"status": "archived"}, ["password", "ssn"] |'
// Result: account (static)

// Nested pattern
// Expression: '| order.customer | {"fullName": firstName & " " & lastName} |'
// Result: order.customer (static), order.customer.firstName (static), order.customer.lastName (static)

// Multi-field update with arithmetic
// Expression: '| record | {"total": price * quantity, "label": category.name} |'
// Result: record (static), record.price (static), record.quantity (static), record.category.name (static)

// Multi-field update + delete
// Expression: '| employee | {"name": firstName & " " & lastName, "active": true}, ["password", "tempToken"] |'
// Result: employee (static), employee.firstName (static), employee.lastName (static)
```

### DEXP-04: Group-By (direct passing, variable-resolved bugged)
```typescript
// Simple group-by (PASSING)
// Expression: 'orders{category: $sum(amount)}'
// Result: orders (static), orders.category (static), orders.amount (static)

// Multi-aggregate group-by (PASSING)
// Expression: 'products{brand: {"count": $count(price), "avg": $average(price)}}'
// Result: products (static), products.brand (static), products.price (static)

// Nested path group-by (PASSING)
// Expression: 'sales.records{region: $sum(amount)}'
// Result: sales.records (static), sales.records.region (static), sales.records.amount (static)

// Nested key group-by (PASSING)
// Expression: 'items{category.name: $count(id)}'
// Result: items (static), items.category.name (static), items.id (static)

// Filtered group-by (PASSING)
// Expression: 'orders[status = "complete"]{category: $sum(amount)}'
// Result: orders (static), orders.status (static), orders.category (static), orders.amount (static)

// Variable-resolved group-by (BUG -- all group-by paths dropped)
// Expression: '($r := data.records; $r{category: $sum(amount)})'
// Actual: data.records (static) -- MISSING category and amount group-by paths
// Expected (correct): data.records (static), data.records.amount (static), data.records.category (static)
```

### Composite Patterns (verified)
```typescript
// DEXP-01+02 composite (PASSING)
// Expression: '{"export": {"name": customer.firstName & " " & customer.lastName, "email": customer.contact.email}, "summary": {"orderCount": $count(orders), "total": $sum(orders.amount)}}'
// Result: customer.firstName (static), customer.lastName (static), customer.contact.email (static), orders (static), orders.amount (static)

// DEXP-03+04 composite (PASSING)
// Expression: '{"updated": | record | {"processed": true} |, "grouped": items{category: $sum(price)}}'
// Result: record (static), items (static), items.category (static), items.price (static)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual AST inspection | Pre-check via extractPaths() | Phase 9 onward | Discover bugs before writing tests |
| Mixed exact/subset assertions | All-exact assertions | Phase 9 decision | More deterministic, clearer failures |
| Fix-as-you-go | BUG(v1.2) skip pattern | Phase 9 decision | v1.1 stays test-only, bugs documented for later |

## Known Bugs Discovered During Pre-Check

### BUG: Variable-Resolved Group-By (DEXP-04)
- **Expression:** `($r := data.records; $r{category: $sum(amount)})`
- **Actual output:** `[{path: "data.records", confidence: "static"}]`
- **Expected output:** `[{path: "data.records", confidence: "static"}, {path: "data.records.amount", confidence: "static"}, {path: "data.records.category", confidence: "static"}]`
- **Root cause:** `walkVariable` in `src/walker.ts` checks `node.predicate` but does NOT check `node.group`. The AST correctly parses `.group` on the `VariableNode`, but the walker ignores it.
- **Impact:** Group-by paths dropped when grouping on a variable reference instead of a direct path.
- **Resolution:** `it.skip` with `BUG(v1.2):` comment. Correct expected output in skip body.

No other bugs discovered across all DEXP patterns. All DEXP-01, DEXP-02, DEXP-03, and direct DEXP-04 expressions produce correct results.

## Open Questions

1. **Composite fixture scope**
   - What we know: DEXP-01, DEXP-02, DEXP-03, and direct DEXP-04 all work. Variable-resolved group-by is bugged.
   - What's unclear: Whether to combine all 4 or a subset.
   - Recommendation: Combine DEXP-01 (format conversion) + DEXP-04 (direct group-by) in a single realistic composite since those are the most interesting combination. Could also include DEXP-03 transform + DEXP-02 extraction.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config implicit (package.json scripts) |
| Quick run command | `npx vitest run test/integration/data-export.test.ts` |
| Full suite command | `npm run test:integration` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEXP-01 | Structure-to-structure format conversion paths | integration | `npx vitest run test/integration/data-export.test.ts` | Skeleton only (empty describe) |
| DEXP-02 | Multi-field flat record extraction paths | integration | `npx vitest run test/integration/data-export.test.ts` | Skeleton only (empty describe) |
| DEXP-03 | Transform operator update/delete paths | integration | `npx vitest run test/integration/data-export.test.ts` | Skeleton only (empty describe) |
| DEXP-04 | Group-by with aggregation key/value paths | integration | `npx vitest run test/integration/data-export.test.ts` | Skeleton only (empty describe) |

### Sampling Rate
- **Per task commit:** `npx vitest run test/integration/data-export.test.ts`
- **Per wave merge:** `npm run test:integration`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. The skeleton file `test/integration/data-export.test.ts` exists with an empty "Data Export" describe block ready to be populated.

## Sources

### Primary (HIGH confidence)
- Source code: `src/walker.ts` -- walkTransform (lines 276-294), walkGroupBy (lines 184-200), walkVariable (lines 379-408)
- Source code: `src/types.ts` -- TransformNode, GroupByNode, VariableNode type definitions
- Pre-check runs: All DEXP expressions verified through `extractPaths()` with actual output captured
- Existing tests: `api-reshaping.test.ts`, `business-rules.test.ts`, `data-transforms.test.ts` -- structural templates

### Secondary (MEDIUM confidence)
- JSONata documentation -- transform operator syntax `| pattern | update, delete |`
- JSONata documentation -- group-by syntax `collection{key: value}`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- identical to Phases 9-11, no new dependencies
- Architecture: HIGH -- exact structural template established and proven across 3 prior phases
- Pitfalls: HIGH -- all expressions pre-checked through actual extractPaths() runs with verified output
- Bug documentation: HIGH -- variable-group-by bug confirmed with AST inspection showing .group on VariableNode

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- testing-only phase, no external dependencies)
