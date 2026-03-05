# Feature Research

**Domain:** Bug fixes in JSONata AST path extraction walker
**Researched:** 2026-03-05
**Confidence:** HIGH

## Feature Landscape

This milestone is a bug-fix-only release. All 14 "features" are corrections to existing walker behavior, verified against documented expected outputs in `it.skip` fixtures. No new capabilities are being added -- only existing ones are being made correct.

### Table Stakes (Must Fix -- Correctness Bugs)

These bugs produce wrong output for valid JSONata expressions. A static analysis tool that reports wrong paths is worse than one that reports nothing, because consumers trust the output.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Filter predicate scope isolation | `$map(items[active], fn($v){$v.name})` must NOT produce `items.active.name` -- predicate paths are metadata about the collection, not element-level bindings | MEDIUM | 4 bugs. Root cause: `walkNode` on `items[active]` returns `["items", "items.active"]`; both get bound as element paths to `$v`. Fix: distinguish base-collection paths from predicate-derived paths before HOF binding. Needs `walkNode` to return structured results or a post-walk filter on predicate paths. Depends on: existing `walkFilterStages`, `walkHigherOrderCall`, `walkLambdaWithBindings`. |
| Focus variable prefix deduplication | `orders@$o[$o.total > 100]` must produce `orders.total`, not `orders.orders.total` | MEDIUM | 2 bugs. Root cause: focus var `$o` bound to `["orders"]` (the context prefix), then `$o.total` resolves to `orders.total`, then `prefixPaths` re-applies `orders.` prefix. Fix: resolved-variable paths that already incorporate the context prefix must not be re-prefixed, OR bind focus variable to empty so resolution produces relative paths that correctly receive the single prefix. Depends on: `walkFilterStages`, `prefixPaths`. |
| Parent operator walkPath for nested constructs | `orders.items.{"itemName": name, "orderDate": %.date}` must extract inner paths from object constructor and block steps within path sequences | MEDIUM | 2 bugs. Root cause: `walkPath` iterates steps looking for `name` and `sort` types only. Unary (`{...}`) and block (`(...)`) steps in a PathNode's step array are silently skipped by both `buildPathString` and `walkPath`. Fix: walk unary/block steps with context prefix from preceding path segments. Depends on: `walkPath`, `buildPathString`. |
| $lookup HOF chaining with argument preservation | `$lookup(inventory, itemCode).quantity` must produce `inventory`, `itemCode`, AND `inventory.quantity` | MEDIUM | 2 bugs. Root cause: parser wraps `$lookup(...)` call inside a PathNode with `.quantity` as suffix step. But walkPath's step loop only handles `name` and `sort` step types -- the function-call step is silently skipped, so its arguments never get walked. Fix: walkPath must detect function-call steps and walk them, passing their result paths forward for suffix concatenation. Depends on: `walkPath`, `walkFunction`. |
| walkVariable group-by property handling | `($r := data.records; $r{category: $sum(amount)})` must extract group key/value paths through variable resolution | LOW | 1 bug. Root cause: `walkVariable` checks `node.predicate` but never checks `node.group`. Only `walkPath` has `walkGroupBy` logic. Fix: add group-by handling to `walkVariable` mirroring `walkPath`'s approach, using resolved variable paths as the group base path. Depends on: `walkVariable`, `walkGroupBy`. |
| Array constructor scope propagation | `[$x := data.source, $x.field]` must resolve `$x` in subsequent array elements | LOW | 1 bug. Root cause: `walkUnary` for `[` uses `flatMap(e => walkNode(e, scope))` -- every expression gets the same scope. Bind nodes inside the array create bindings that never propagate to subsequent expressions. Fix: walk array constructor elements sequentially with scope accumulation (like `walkBlock`), not independently via `flatMap`. Depends on: `walkUnary`, `walkBind`. |
| Apply operator inline lambda binding | `data ~> function($d) { $d.count }` must bind `$d` to `["data"]` and produce `data.count` | LOW | 1 bug (counted in pipeline duplicates category). Root cause: `walkApply` checks `node.rhs.type === "function"` but inline lambdas have `type: "lambda"`. The lambda falls through to `walkNode(node.rhs)` which returns `[]` (real lambdas are definitions, not executions). Fix: handle `rhs.type === "lambda"` in `walkApply` by binding the lambda's first parameter to lhs paths and walking the body. Depends on: `walkApply`, `walkLambdaWithBindings` or similar. |
| Variable-resolved sort path extraction | `($x := items; $x^(price))` must extract `items.price` as a sort-key path | LOW | 1 bug (counted in pipeline duplicates category). Root cause: walkPath's variable-step branch resolves `$x` to `["items"]` and builds suffix from remaining steps. But the sort node `^(price)` is not a path segment -- it is skipped by `buildPathString`. The variable branch never walks sort/filter stages on remaining steps after the variable. Fix: after resolving variable steps, iterate remaining steps for sort nodes and walk their terms with resolved base paths as context prefix. Depends on: `walkPath` variable branch, `walkSortTerms`. |

### Differentiators (Regression Test Coverage)

These are not bug fixes themselves, but the regression suites ensure the fixes stay correct. Building thorough regression coverage distinguishes a careful fix from a fragile patch.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Predicate isolation regression suite | 10+ tests covering filter predicates with HOFs, chained applies, variable-bound intermediates, nested filters, multi-predicate paths | MEDIUM | Edge cases needed: `items[a][b]` multi-stage, nested `$map($filter(...))`, cross-variable predicate references, predicate with function call (`items[$contains(name, "x")]`), predicate on variable-resolved path |
| Focus/context variable regression suite | 10+ tests covering `@$v` focus vars, `#$i` index vars, nested focus scopes, focus with variable cross-references | MEDIUM | Edge cases needed: nested `@$outer[@$inner[...]]`, focus var shadowing, focus on variable-resolved paths, focus combined with positional `#$i`, focus in apply chains |
| Parent operator regression suite | 10+ tests covering `%` in object constructors, blocks, nested maps, multi-level `%.%.field`, combined with variables | MEDIUM | Edge cases needed: parent inside filter predicate, parent inside lambda body, parent with variable resolution, parent in transform update, parent at different nesting depths |
| HOF chaining regression suite | 10+ tests covering `$lookup().field`, `$lookup().nested.field`, chained HOF results in expressions, function call as path step with various suffix depths | LOW | Narrower scope since `$lookup` is the primary case. Also test other HOFs as path steps (e.g., `$filter(...).name` if parser generates similar AST) |
| Scope propagation regression suite | 10+ tests covering array constructor binds, variable-resolved group-by, variable-resolved sort, inline lambda apply | LOW | Covers the 4 smaller bug categories with targeted edge cases: multi-bind in array, group-by with multi-key, sort with descending, apply with multi-param lambda |

### Anti-Features (Explicitly NOT Building)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Predicate path type tagging in PathResult | Tagging paths as "predicate-derived" vs "base-path" in public output | Breaks the public API contract. Consumers would need to update integration code. Adds complexity to the PathResult type for an internal concern. | Keep PathResult unchanged (`{path, confidence}`). Handle predicate/base distinction internally during HOF binding only. |
| Runtime-aware path resolution | Evaluating expressions to determine exact paths at runtime, avoiding over-approximation | Contradicts the core "static analysis only" constraint. Unbounded complexity. Would require input data, making the tool unusable for schema-level analysis. | Continue to over-approximate with confidence annotations. This is a design decision, not a bug. |
| Partial bug fix release | Fixing only the "easy" bugs and deferring the 4 filter-predicate bugs to a later milestone | Creates inconsistent behavior. Users cannot predict which patterns work. All 14 bugs are documented and publicly tracked. Several share root causes, so fixing one often requires the same code change as the others. | Fix all 14 in this milestone. The shared root causes mean the total effort is less than 14 independent fixes. |
| Scope chain refactor to dynamic scoping | Switching from lexical (immutable chain) to dynamic scoping to "simplify" HOF binding | JSONata uses lexical scoping. Dynamic scoping would break 40+ correctly-working tests that rely on proper scope isolation. | Keep immutable scope chain. Fix specific binding points (HOF element binding, array constructor, walkApply). |
| Walker return type refactor | Changing `walkNode` to return structured objects instead of `string[]` to carry predicate metadata | Massive refactor touching every walker function (20+ functions). High risk of introducing regressions. | Find a minimal way to distinguish predicate paths from base paths, either through a naming convention, a separate return channel, or a post-processing step at the HOF binding boundary. |

## Feature Dependencies

```
Filter predicate scope isolation (4 bugs)
    |-- (shared root cause) --> Chained apply predicate leak (data-transforms TRFM-02 bug)
    |-- (shared root cause) --> Variable-bound filter then map (data-transforms TRFM-05 bug)
    |-- (related prefixing) --> Variable-in-filter cross-reference (business-rules BIZR-04 bug)
    |
    +-- related to --> Focus variable prefix deduplication (2 bugs)
                          (both touch walkFilterStages + prefixPaths)

Parent operator walkPath (2 bugs)
    |-- (same fix area) --> Object constructor step walking
    |-- (same fix area) --> Block expression step walking
    (independent of all other categories)

$lookup HOF chaining (2 bugs)
    (independent -- standalone fix in walkPath function-call step handling)

Variable-resolved sort (1 bug)
    |-- (partially related) --> walkPath variable branch
    (independent of predicate/prefix bugs)

walkVariable .group (1 bug)
    (independent -- standalone addition to walkVariable)

Array constructor scope (1 bug)
    (independent -- standalone change to walkUnary "[" handler)

Apply operator inline lambda (1 bug)
    (independent -- standalone addition to walkApply)
```

### Dependency Notes

- **Filter predicate scope isolation is the highest-risk fix.** It touches the core data flow between `walkNode` result and HOF binding. Changes here could regress 40+ existing passing tests if the predicate/base distinction is implemented incorrectly.
- **Filter predicate and focus variable fixes interact.** Both involve `walkFilterStages` and `prefixPaths`. The filter predicate fix may partially resolve the focus variable issue, depending on whether the approach changes how `prefixPaths` handles already-prefixed paths. These should be fixed and tested together.
- **Parent operator walkPath is fully independent.** Its fix adds new step-type handling to `walkPath` without changing any existing code paths. Zero risk to existing tests.
- **The 4 small fixes (sort, group, array scope, apply lambda) are fully independent** of each other and all other fixes. They can be done in any order with zero interaction risk.

## Bug Fix Prioritization

| Bug Category | Bug Count | User Impact | Fix Complexity | Risk to Existing Tests | Priority |
|--------------|-----------|-------------|----------------|----------------------|----------|
| Filter predicate scope isolation | 4 | HIGH -- spurious paths in every HOF+filter combo | MEDIUM -- needs predicate/base path distinction | HIGH -- touches HOF binding used by 40+ tests | P1 |
| Focus variable prefix dedup | 2 | HIGH -- double-prefixed paths are visibly wrong | MEDIUM -- tricky prefix-awareness in walkFilterStages | MEDIUM -- changes to shared walkFilterStages | P1 |
| Parent operator walkPath | 2 | MEDIUM -- parent operator is advanced usage | MEDIUM -- add step-type handlers to walkPath loop | LOW -- purely additive, new code paths | P2 |
| $lookup HOF chaining | 2 | MEDIUM -- $lookup chaining is common pattern | MEDIUM -- walkPath needs function-step awareness | LOW -- new code path in walkPath | P2 |
| Variable-resolved sort | 1 | LOW -- sort on variable-resolved path is niche | LOW -- extend walkPath variable branch | LOW -- additive change to existing branch | P3 |
| walkVariable .group | 1 | LOW -- group-by on variable is niche | LOW -- mirror walkPath's walkGroupBy | LOW -- purely additive function | P3 |
| Array constructor scope | 1 | LOW -- bind-inside-array-constructor is edge case | LOW -- change flatMap to sequential walk | LOW -- isolated to walkUnary "[" case | P3 |
| Apply operator inline lambda | 1 | LOW -- inline lambda with ~> is uncommon syntax | LOW -- add lambda case to walkApply | LOW -- purely additive branch | P3 |

**Priority key:**
- P1: Fix first -- highest impact, shared root causes; getting these right de-risks the rest
- P2: Fix second -- moderate impact, independent fixes that expand walkPath capabilities
- P3: Fix last -- low impact, simple isolated fixes, minimal risk

## Recommended Phase Structure

### Phase 1: Scope and Prefix Fixes (P1 -- 6 bugs)

Fix the filter predicate scope isolation and focus variable prefix deduplication together. These share `walkFilterStages` and `prefixPaths` as common touch points. Fixing them together avoids rework and conflicting changes.

- [ ] Filter predicate scope isolation (4 bugs)
- [ ] Focus variable prefix deduplication (2 bugs)
- [ ] Regression test suite: 20+ tests for predicate isolation + focus variable

### Phase 2: Path Walking Gaps (P2 -- 4 bugs)

Fix the parent operator and $lookup chaining. Both require `walkPath` to handle additional step types it currently ignores. These are independent of each other but grouped because they both extend the same function.

- [ ] Parent operator walkPath for unary/block steps (2 bugs)
- [ ] $lookup HOF chaining with argument preservation (2 bugs)
- [ ] Regression test suite: 20+ tests for parent operator + HOF chaining

### Phase 3: Small Independent Fixes (P3 -- 4 bugs)

Fix the remaining independent single-bug categories. Each is isolated and low-risk.

- [ ] Variable-resolved sort path extraction (1 bug)
- [ ] walkVariable .group property (1 bug)
- [ ] Array constructor scope propagation (1 bug)
- [ ] Apply operator inline lambda binding (1 bug)
- [ ] Regression test suite: 30+ tests covering all 4 categories

## Detailed Expected Behavior

### 1. Filter Predicate Scope Isolation

**Expression:** `$map(items[active], function($v) { $v.name })`

**Current (buggy):** `items`, `items.active`, `items.name`, `items.active.name`

**Expected (correct):** `items`, `items.active`, `items.name`

**Root cause:** `walkNode` called on `items[active]` (a PathNode with a filter stage) returns `["items", "items.active"]`. Both paths get bound as element paths to `$v` via `walkLambdaWithBindings`. When `$v.name` resolves, it appends `.name` to every bound path, producing both `items.name` (correct) and `items.active.name` (spurious).

**Correct behavior in AST walkers:** Filter predicates are metadata reads about the collection -- they describe which elements to select but do not change the element type. When binding a HOF element parameter, only the base collection path should be bound. Predicate-derived paths should be emitted to the output (they are data reads) but NOT threaded into lambda parameter bindings.

**Affected tests:**
- `data-transforms.test.ts:53` -- `$map(items[active], function($v) { $v.name })`
- `data-transforms.test.ts:121` -- `items ~> $filter(fn) ~> $map(fn)` (chained apply)
- `data-transforms.test.ts:279` -- `($data := items[active]; $map($data, fn))` (variable-bound)
- `business-rules.test.ts:174` -- `($min := minPrice; products[price >= $min].name)` (variable cross-ref in filter)

### 2. Focus Variable Prefix Deduplication

**Expression:** `orders@$o[$o.total > 100].id`

**Current (buggy):** `orders.id`, `orders.orders.total`

**Expected (correct):** `orders.id`, `orders.total`

**Root cause:** In `walkFilterStages`, the focus variable `$o` is bound to `[contextPrefix]` which is `["orders"]`. Inside the filter, `$o.total` resolves via `walkNode` -> `walkPath` -> variable resolution to `orders.total`. Then `walkFilterStages` calls `prefixPaths("orders", ["orders.total"])`, producing `orders.orders.total`.

**Correct behavior:** Focus variables represent "the current element in context." When `$o.total` resolves to `orders.total`, that path already includes the context prefix. Re-prefixing is incorrect. The fix should either: (a) bind focus to `[]` (empty) so `$o.total` resolves to just `total`, which then correctly receives the single prefix, or (b) detect and skip re-prefixing for paths that already start with the context prefix.

**Affected tests:**
- `api-reshaping.test.ts:150` -- `orders@$o[$o.total > 100].id`
- `api-reshaping.test.ts:162` -- `($cfg := config; items[$cfg.minPrice < price].name)` (variable cross-ref variant)

### 3. Parent Operator walkPath for Nested Constructs

**Expression:** `orders.items.{"itemName": name, "orderDate": %.date}`

**Current (buggy):** `orders.items` (inner paths silently dropped)

**Expected (correct):** `orders.items`, `orders.items.name`, `orders.items.%.date`

**Root cause:** In `walkPath`, the step iteration loop (lines 138-151) only handles `step.type === "name"` (for filter stages) and `step.type === "sort"`. A unary node (`{...}`) appearing as a path step has `type: "unary"` -- it hits no case and is silently skipped. Its inner expressions (`name`, `%.date`) are never walked. Same issue for block steps (`(expr)` appearing as a path step).

**Correct behavior:** When a path contains a "computational" step (unary object constructor, block expression), the step should be walked with the context prefix from preceding path segments. The step itself does not add to the path string (correct -- `buildPathString` skips it), but its inner expressions are data reads relative to the current context.

**Affected tests:**
- `api-reshaping.test.ts:201` -- `orders.items.{"itemName": name, "orderDate": %.date}` (unary step)
- `api-reshaping.test.ts:215` -- `orders.items.(%.orderRef & ": " & name)` (block step)

### 4. $lookup HOF Chaining

**Expression:** `$lookup(inventory, itemCode).quantity`

**Current (buggy):** `quantity` (function arguments dropped)

**Expected (correct):** `inventory`, `itemCode`, `inventory.quantity`

**Root cause:** The JSONata parser wraps `$lookup(inventory, itemCode).quantity` as a PathNode with steps: `[FunctionNode($lookup(inventory, itemCode)), NameNode(quantity)]`. In `walkPath`, the step iteration loop only handles `name` and `sort` types. The function-call step (`type: "function"`) is skipped. `buildPathString` also skips it (default case returns nothing). The function's arguments (`inventory`, `itemCode`) are never walked.

**Correct behavior:** When a function call appears as a step in a path, its arguments must be walked (they are data reads). The function call step itself doesn't contribute a path segment, but subsequent steps (like `.quantity`) should be suffixed onto the function's data argument paths (for over-approximation). In this case, `$lookup` takes `inventory` as its first arg, so `.quantity` gets suffixed to produce `inventory.quantity`.

**Affected tests:**
- `edge-cases.test.ts:123` -- `$lookup(inventory, itemCode).quantity`
- `business-rules.test.ts:161` -- `$lookup(products, sku).price`

### 5. walkVariable .group Property

**Expression:** `($r := data.records; $r{category: $sum(amount)})`

**Current (buggy):** `data.records` (group-by key/value paths dropped)

**Expected (correct):** `data.records`, `data.records.amount`, `data.records.category`

**Root cause:** `walkVariable` resolves `$r` to `["data.records"]` and handles `node.predicate`, but the parser places the `{category: $sum(amount)}` group-by in `node.group`. Only `walkPath` checks for `.group` via `walkGroupBy`. `walkVariable` never inspects it.

**Correct behavior:** When a variable node has a `.group` property, `walkVariable` should walk the group-by key and value expressions, prefixed with the resolved variable paths, exactly as `walkPath`/`walkGroupBy` does for PathNodes.

**Affected tests:**
- `data-export.test.ts:224` -- `($r := data.records; $r{category: $sum(amount)})`

### 6. Array Constructor Scope Propagation

**Expression:** `[$x := data.source, $x.field]`

**Current (buggy):** `data.source` (`$x.field` unresolved, silently dropped)

**Expected (correct):** `data.source`, `data.source.field`

**Root cause:** `walkUnary` for `[` (array constructor) uses `(node.expressions ?? []).flatMap((e) => walkNode(e, scope))`. Every expression receives the same `scope`. The bind `$x := data.source` is walked (producing `data.source`) but the binding is never added to the scope for subsequent expressions. The second expression `$x.field` cannot resolve `$x` and is silently dropped.

**Correct behavior:** Array constructor expressions should be walked sequentially with scope accumulation, the same way `walkBlock` handles sequential block expressions. When a bind expression appears in an array constructor, subsequent expressions should see the binding.

**Affected tests:**
- `edge-cases.test.ts:155` -- `[$x := data.source, $x.field]`

### 7. Apply Operator Inline Lambda

**Expression:** `data ~> function($d) { $d.count }`

**Current (buggy):** `data` (`$d.count` never resolved)

**Expected (correct):** `data`, `data.count`

**Root cause:** `walkApply` checks `node.rhs.type === "function"` to detect function calls on the RHS. An inline lambda has `type: "lambda"`, so it falls to the `else` branch: `walkNode(node.rhs, scope)`. `walkNode` dispatches to `walkLambda`, which returns `[]` because real lambdas (non-thunks) are definitions, not executions.

**Correct behavior:** When `~>` pipes data into an inline lambda, the lambda's first parameter should be bound to the lhs paths and the body should be walked. This is effectively `walkCustomFunctionCall` with a single argument being the lhs.

**Affected tests:**
- `data-transforms.test.ts:134` -- `data ~> function($d) { $d.count }`

### 8. Variable-Resolved Sort Path Extraction

**Expression:** `($x := items; $x^(price))`

**Current (buggy):** `items` (sort key `price` not extracted)

**Expected (correct):** `items`, `items.price`

**Root cause:** In `walkPath`'s variable-step branch (lines 100-128), the variable `$x` is resolved to `["items"]`. The remaining steps (suffix) are built by `buildPathString(node.steps.slice(varStepIndex + 1))`. But `buildPathString` skips the sort node (default case). The branch never walks sort terms on remaining steps after variable resolution.

**Correct behavior:** After resolving variable steps, the variable branch should also iterate remaining steps looking for sort nodes and walk their term expressions with the resolved paths as context prefix, the same way the non-variable path handling iterates for sort/filter stages.

**Affected tests:**
- `data-transforms.test.ts:66` -- `($x := items; $x^(price))`

## Sources

- Source code analysis: `src/walker.ts` (626 lines), `src/scope.ts` (97 lines), `src/types.ts` (212 lines), `src/index.ts` (46 lines), `src/path-builder.ts` (33 lines), `src/builtins.ts` (46 lines)
- Bug documentation: 14 `it.skip` fixtures across `test/integration/data-transforms.test.ts`, `test/integration/business-rules.test.ts`, `test/integration/api-reshaping.test.ts`, `test/integration/data-export.test.ts`, `test/integration/edge-cases.test.ts`
- Project context: `.planning/PROJECT.md`, `.planning/MILESTONES.md`, `.planning/STATE.md`
- Confidence: HIGH -- all findings derived from direct source code tracing and documented test fixture analysis. No external sources needed; these are implementation bugs in a known codebase.

---
*Feature research for: JSONata AST walker bug fixes (v1.1.1)*
*Researched: 2026-03-05*
