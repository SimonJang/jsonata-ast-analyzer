# Phase 21: Progressive Examples - Research

**Researched:** 2026-03-10
**Domain:** README documentation (progressive worked examples demonstrating all three confidence levels)
**Confidence:** HIGH

## Summary

Phase 21 adds 3-5 progressive worked examples under the existing `## Examples` heading in README.md. Each example pairs a JSONata expression with the full `extractPaths()` output, showing how the analyzer handles increasingly complex patterns. The examples must collectively cover all three confidence levels (`static`, `dynamic`, `partial`) and must not repeat any expressions already used in the README.

This is a documentation-only phase with no code changes. All research findings are verified by running candidate expressions through the built CLI (`node dist/cli.js`). The primary challenge is selecting expressions that (a) feel real-world, (b) progress from simple to complex, (c) cover all three confidence levels, and (d) do not overlap with expressions already in the README from Phases 18-20.

**Primary recommendation:** Use 4 examples progressing from a simple dot-path (static) through variable tracing (static), compound filter predicates (static), a dynamic computed path (dynamic), and a parent operator path (partial with static mix). Write them under the existing `## Examples` heading with a brief intro sentence and per-example explanatory text matching the minimal prose style of earlier phases.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- user delegated all decisions to Claude.

### Claude's Discretion
- **Example progression** -- Which JSONata patterns to showcase and in what order. Must cover: simple dot-path access (static), variable assignment tracing (static), filter predicates, dynamic/computed paths (dynamic), and parent operator or partial resolution (partial). Must avoid repeating expressions already used in Quick Example (`orders[status = "active"].items.price`), CLI argument mode (`account.name`), or CLI stdin mode (`$sum(orders.total)`).
- **Presentation format** -- How each example is displayed (intro sentences, code block style, headings vs numbered list). Should match the clean, minimal prose style established in Phases 18-20.
- **Expression choices** -- Which specific JSONata expressions to use. Should feel real-world rather than synthetic. Fresh expressions that don't overlap with earlier README sections.
- **Section intro** -- Whether the Examples section needs a brief intro paragraph or jumps straight into examples.
- **Example count** -- 3-5 examples per EXMP-01 requirement, covering all three confidence levels across the set.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXMP-01 | README includes 3-5 progressive examples demonstrating all three confidence levels across real usage patterns | Verified candidate expressions with actual CLI output below; expression avoidance list documented; progression strategy defined |

</phase_requirements>

## Standard Stack

Not applicable -- this phase writes Markdown documentation only. No libraries are installed or code written.

## Architecture Patterns

### README Insertion Point

Content goes under the existing `## Examples` heading (currently empty, line 105 in README.md), between `## CLI Usage` and `## How It Works`. The heading already exists from Phase 18.

### Expressions Already in README (DO NOT REUSE)

| Expression | Location | Confidence Shown |
|------------|----------|-----------------|
| `orders[status = "active"].items.price` | Quick Example | static |
| `account.name` | CLI argument mode + confidence table | static |
| `$sum(orders.total)` | CLI stdin mode | static |
| `item[$field]` | Confidence table | dynamic |
| `orders.items.%.orderRef` | Confidence table | partial |

### Recommended Example Progression (4 examples)

The progression builds complexity and introduces confidence levels one at a time:

**Example 1: Simple dot-path access (static)**
Demonstrates the baseline -- a straightforward nested property access.

Expression: `customer.name`

```
Verified output:
[{"path":"customer.name","confidence":"static"}]
```

Simple, clean, one path, one result. Shows the basic API contract.

**Example 2: Variable assignment with path tracing (static)**
Demonstrates that the analyzer resolves variables back to their data source paths -- a key capability.

Expression: `($addr := customer.address; $addr.city & ", " & $addr.state)`

```
Verified output:
[
  {"path":"customer.address","confidence":"static"},
  {"path":"customer.address.city","confidence":"static"},
  {"path":"customer.address.state","confidence":"static"}
]
```

This is a good progression because:
- It introduces variable binding (`$addr :=`)
- Shows that the analyzer traces through the variable to find the real source paths
- Uses string concatenation (`&`) which is common in real JSONata
- All outputs are still `static` -- no new confidence level yet

**Example 3: Compound filter predicates (static)**
Demonstrates hidden path discovery inside filter conditions.

Expression: `products[price > 50 and inStock].name`

```
Verified output:
[
  {"path":"products.name","confidence":"static"},
  {"path":"products.price","confidence":"static"},
  {"path":"products.inStock","confidence":"static"}
]
```

This shows:
- The analyzer finds `price` and `inStock` inside the filter predicate
- A developer might only think about `products.name` -- the analyzer reveals all three paths
- Compound boolean (`and`) is realistic business logic
- Still all `static` -- builds confidence before introducing dynamic/partial

**Example 4: Dynamic computed path (dynamic + static mix)**
Demonstrates the dynamic confidence level -- when a variable is used in bracket-filter position, the path segment is unresolvable at analysis time.

Expression: `inventory[$category].quantity`

```
Verified output:
[
  {"path":"inventory.quantity","confidence":"static"},
  {"path":"inventory[*]","confidence":"dynamic"}
]
```

This shows:
- `$category` is an unbound variable used as a bracket filter -- the analyzer cannot know which field it refers to
- The `[*]` wildcard marker indicates "some field, but we don't know which"
- The `.quantity` continuation is still `static` -- only the dynamic segment gets the wildcard
- First appearance of `dynamic` confidence in the examples

**Example 5 (optional -- to hit parent/partial): Parent operator (partial + static mix)**
Demonstrates the partial confidence level via the parent operator (`%`).

Expression: `orders.items.{"itemName": name, "orderDate": %.date}`

```
Verified output:
[
  {"path":"orders.items","confidence":"static"},
  {"path":"orders.items.name","confidence":"static"},
  {"path":"orders.items.%.date","confidence":"partial"}
]
```

This shows:
- The `%` operator navigates up to the parent context (from item to its containing order)
- `%.date` means "the date field on the parent" -- the analyzer cannot fully resolve this statically
- Mixed confidence: two `static` paths alongside one `partial` path
- This is the most complex pattern, appropriate for the final example

### Alternative Expression Candidates (verified, available if needed)

| Expression | Output Summary | Confidence | Why Not Primary |
|------------|---------------|------------|-----------------|
| `orders[total > 100].customer` | 2 static paths | static | Less interesting than compound filter |
| `company.departments[active].employees.email` | 2 static paths | static | Good but similar to filter example |
| `($items := order.lineItems; $sum($map($items, function($v) { $v.price * $v.qty })))` | 3 static paths | static | Good HOF example but complex for docs |

### Presentation Format

**Recommended:** Use H3 subheadings within the Examples section, one per example. Each example has:
1. A brief (1 sentence) description of what the expression does
2. A JavaScript code block showing `extractPaths()` call and output as comments (matching Quick Example style)

This matches the pattern established in the Quick Example section and keeps visual consistency.

**Alternative considered:** Numbered list with shell command + JSON output (matching CLI Usage style). Not recommended because the JS import style was established first and is more natural for showing the API.

### Anti-Patterns to Avoid
- **Repeating README expressions:** The avoidance list is explicit -- do not use any of the 5 expressions already in the README
- **Synthetic-feeling expressions:** Use realistic domain terminology (customer, products, orders, inventory) not abstract names (a.b.c, foo.bar)
- **Over-explaining:** Keep prose minimal -- the code block does the heavy lifting
- **Inconsistent format:** All examples should use the same code block format (JS import style with comment output)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Example output | Don't type path results manually | Run `node dist/cli.js '<expr>'` or `extractPaths()` and copy verified output | Ensures accuracy -- a typo in a path or confidence level erodes trust |

## Common Pitfalls

### Pitfall 1: Duplicating Existing README Expressions
**What goes wrong:** An example uses `account.name` or `item[$field]` which already appear in the confidence table or CLI sections.
**Why it happens:** Forgetting what earlier phases already wrote.
**How to avoid:** Check the avoidance list documented above. The 5 expressions to avoid are: `orders[status = "active"].items.price`, `account.name`, `$sum(orders.total)`, `item[$field]`, `orders.items.%.orderRef`.
**Warning signs:** Any expression from the Quick Example, CLI, or Confidence Table sections appearing in the Examples section.

### Pitfall 2: Stale or Incorrect Output
**What goes wrong:** The example shows output that does not match what `extractPaths()` actually returns.
**Why it happens:** Writing output by hand, or using an expression without verifying against the built dist.
**How to avoid:** Every example in this research has been verified by running `node dist/cli.js '<expression>'` against the current build. The planner should ensure the implementation task also verifies output before writing.
**Warning signs:** Path order, confidence level, or path format not matching actual CLI output.

### Pitfall 3: Missing a Confidence Level
**What goes wrong:** The example set only shows 2 of 3 confidence levels.
**Why it happens:** Focusing on the most common (static) patterns and forgetting to include dynamic and partial.
**How to avoid:** The recommended 5-example progression explicitly includes static (examples 1-3), dynamic (example 4), and partial (example 5). The success criteria require all three levels appear across the set.
**Warning signs:** No example output contains `"confidence":"dynamic"` or `"confidence":"partial"`.

### Pitfall 4: Breaking Existing README Structure
**What goes wrong:** Content is inserted at the wrong position, or existing headings are moved/deleted.
**Why it happens:** Editing the README without carefully checking insertion point.
**How to avoid:** Insert content ONLY between the `## Examples` heading (line 105) and the `## How It Works` heading (line 107). Do not modify anything outside this range.
**Warning signs:** Any diff touching lines outside the Examples section.

### Pitfall 5: Inconsistent Code Block Style
**What goes wrong:** Some examples use JS import style, others use shell command style, breaking visual consistency.
**Why it happens:** Mixing the Quick Example pattern (JS) with the CLI Usage pattern (shell).
**How to avoid:** Use JS import style consistently for all examples, matching the Quick Example section format. The examples show the programmatic API, not the CLI.
**Warning signs:** Mixed language tags (`js` vs `sh`) in the examples section.

## Code Examples

### Verified Example 1: Simple Dot-Path (static)

```javascript
extractPaths('customer.name')
// [{ path: "customer.name", confidence: "static" }]
```

CLI verification: `node dist/cli.js 'customer.name'`
Output: `[{"path":"customer.name","confidence":"static"}]`

### Verified Example 2: Variable Tracing (static)

```javascript
extractPaths('($addr := customer.address; $addr.city & ", " & $addr.state)')
// [
//   { path: "customer.address",       confidence: "static" },
//   { path: "customer.address.city",  confidence: "static" },
//   { path: "customer.address.state", confidence: "static" }
// ]
```

CLI verification: `node dist/cli.js '($addr := customer.address; $addr.city & ", " & $addr.state)'`
Output: `[{"path":"customer.address","confidence":"static"},{"path":"customer.address.city","confidence":"static"},{"path":"customer.address.state","confidence":"static"}]`

### Verified Example 3: Compound Filter Predicates (static)

```javascript
extractPaths('products[price > 50 and inStock].name')
// [
//   { path: "products.name",    confidence: "static" },
//   { path: "products.price",   confidence: "static" },
//   { path: "products.inStock", confidence: "static" }
// ]
```

CLI verification: `node dist/cli.js 'products[price > 50 and inStock].name'`
Output: `[{"path":"products.name","confidence":"static"},{"path":"products.price","confidence":"static"},{"path":"products.inStock","confidence":"static"}]`

### Verified Example 4: Dynamic Computed Path (dynamic + static)

```javascript
extractPaths('inventory[$category].quantity')
// [
//   { path: "inventory.quantity", confidence: "static" },
//   { path: "inventory[*]",      confidence: "dynamic" }
// ]
```

CLI verification: `node dist/cli.js 'inventory[$category].quantity'`
Output: `[{"path":"inventory.quantity","confidence":"static"},{"path":"inventory[*]","confidence":"dynamic"}]`

### Verified Example 5: Parent Operator (partial + static)

```javascript
extractPaths('orders.items.{"itemName": name, "orderDate": %.date}')
// [
//   { path: "orders.items",        confidence: "static" },
//   { path: "orders.items.name",   confidence: "static" },
//   { path: "orders.items.%.date", confidence: "partial" }
// ]
```

CLI verification: `node dist/cli.js 'orders.items.{"itemName": name, "orderDate": %.date}'`
Output: `[{"path":"orders.items","confidence":"static"},{"path":"orders.items.name","confidence":"static"},{"path":"orders.items.%.date","confidence":"partial"}]`

## State of the Art

Not applicable -- this is a documentation phase writing Markdown content. No evolving technology landscape to track.

## Open Questions

None -- all candidate expressions have been verified against the current build, the avoidance list is clear, and the progression covers all three confidence levels. The planner has everything needed to create a plan.

## Validation Architecture

> `workflow.nyquist_validation` is not present in config.json -- treating as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | vitest config via package.json scripts |
| Quick run command | `pnpm test:unit` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXMP-01 | README includes 3-5 progressive examples with all 3 confidence levels | manual-only | Visual review of README.md Examples section | N/A |

**Justification for manual-only:** EXMP-01 is about Markdown content in a README file. There is no programmatic behavior to test. Verification is "read the Examples section and confirm: (a) 3-5 examples present, (b) each shows expression + full output, (c) all three confidence levels appear." The existing test suite (`pnpm test`) should still pass since no code is changed.

### Sampling Rate
- **Per task commit:** `pnpm test` (ensure no code was accidentally broken)
- **Per wave merge:** `pnpm test` (full suite)
- **Phase gate:** Full suite green + manual README review confirming all three confidence levels present

### Wave 0 Gaps
None -- this phase writes documentation only. Existing test infrastructure is unaffected and requires no additions.

## Sources

### Primary (HIGH confidence)
- `README.md` -- current content, verified section structure and existing expressions (lines 1-114)
- `src/index.ts` -- `extractPaths()` function signature, confidence derivation logic
- `src/types.ts` -- `PathResult` interface, `Confidence` type (`"static" | "dynamic" | "partial"`)
- `dist/cli.js` -- live CLI execution to verify all 5 candidate expression outputs
- `test/extract-paths.test.ts` -- 294+ test fixtures providing verified expression/output pairs
- `test/integration/*.test.ts` -- integration test fixtures with real-world patterns
- `.planning/phases/21-progressive-examples/21-CONTEXT.md` -- user decisions and constraints
- `.planning/phases/18-overview-and-installation/18-RESEARCH.md` -- established documentation patterns

### Secondary (MEDIUM confidence)
None needed -- all findings verified from project source.

### Tertiary (LOW confidence)
None -- all findings verified from project source and live execution.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no libraries needed, documentation only
- Architecture: HIGH -- insertion point verified in current README; all example outputs verified via CLI
- Pitfalls: HIGH -- avoidance list derived from current README content; all outputs verified against live build

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable -- Markdown documentation practices do not change rapidly)
