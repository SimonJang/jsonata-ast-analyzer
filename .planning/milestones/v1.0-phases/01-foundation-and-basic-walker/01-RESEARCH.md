# Phase 1: Foundation and Basic Walker - Research

**Researched:** 2026-03-02
**Domain:** JSONata AST parsing, TypeScript walker architecture, path extraction
**Confidence:** HIGH

## Summary

Phase 1 is a greenfield TypeScript library that parses JSONata expressions via the official `jsonata` npm package (v2.1.0), walks the resulting AST, and extracts data paths as dot-notation strings. The JSONata parser is synchronous and produces a well-structured AST with known node types (`path`, `name`, `wildcard`, `descendant`, `binary`, `condition`, `block`, `unary`, `string`, `number`, `value`). The official TypeScript type definitions (`ExprNode`) are incomplete -- they are missing the `path`, `bind`, `apply`, `filter`, `sort`, and `regex` type discriminants, along with properties like `condition`, `then`, `else`, `expression`, `body`, and `group`. Custom AST types must be built from empirical observation of the parser output.

The walker itself is straightforward recursive dispatch on `node.type`. Each handler extracts paths from its children and returns them upward. Path nodes concatenate their `steps` into dot-notation strings; binary nodes collect paths from both `lhs` and `rhs`; condition nodes collect from `condition`, `then`, and `else`; block nodes collect from all `expressions`. Literal types (`string`, `number`, `value`) produce no paths. The result is deduplicated and wrapped in `PathResult` objects.

**Primary recommendation:** Build custom discriminated-union AST types from empirical parser output, implement a recursive type-dispatch walker, use Vitest for testing, tsup for building, pnpm for package management, ESM-only output.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Path output format: Dot-notation strings matching JSONata syntax (e.g., `"account.orders.price"`)
- Return `PathResult` objects from day one (not plain strings) to avoid breaking changes when Phase 4 adds confidence annotations
- Deduplicate paths in output -- callers care about "what data is accessed", not frequency
- Function name: `extractPaths(expression: string): PathResult[]`
- Wildcard & special segment representation:
  - Literal `*` in path strings for wildcards: `"order.*"`
  - Literal `**` for descendant operator: `"**.price"`
  - Full path context preserved: `"account.**.price"` (not just `"**.price"`)
  - Bracket wildcard `[*]` for dynamically computed paths (Phase 4): `"item[*]"`
  - Parent operator `%` representation deferred to Phase 4 discussion
- Error & edge case behavior:
  - Throw on invalid JSONata input -- let the jsonata parser's error propagate to the caller
  - String-only input -- `extractPaths` accepts expression strings, not pre-parsed ASTs
  - Pre-parsed AST support can be considered for Phase 5 public API if needed
- Project setup:
  - Package manager: pnpm
  - Test framework: Vitest
  - Module format: ESM only (`"type": "module"`)
  - TypeScript with strict mode

### Claude's Discretion
- Unknown/unexpected AST node handling strategy (skip, warn, or throw)
- Empty expression and whitespace-only input behavior
- Package name (jsonata-ast-analyzer, jsonata-path-extractor, or similar)
- Build tooling (tsup, tsc, unbuild, etc.)
- Source directory structure and file organization
- TypeScript strictness level details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PATH-01 | Extract simple dot-path references (`account.name` -> `["account.name"]`) | `path` node with `steps` array of `name` nodes; concatenate step values with `.` separator. Empirically verified. |
| PATH-02 | Extract nested multi-step paths (`order.items.price`) | Same `path` + `steps` structure, just more steps. Verified with 3-step paths. |
| PATH-03 | Handle wildcard operator (`*`) emitting `order.*` segments | Wildcard appears as `{ type: "wildcard", value: "*" }` step inside `path.steps`. Concatenate as literal `*`. |
| PATH-04 | Handle descendant operator (`**`) emitting `**.price` segments | Descendant appears as `{ type: "descendant", value: "**" }` step inside `path.steps`. Concatenate as literal `**`. Prefix context preserved (e.g., `account.**.price`). |
| PATH-05 | Handle string, number, boolean, and null literals without producing paths | `string` type has `value` string; `number` type has numeric `value`; booleans/null are `value` type with `value: true/false/null`. None contain child nodes. Return empty array. |
| EXPR-01 | Extract paths from both operands of binary operators | `binary` node has `lhs` and `rhs` children, both full AST subtrees. Walk both, union results. Verified with `*`, `+`, `>`, `and`, `&`, `=`, `in`, `..` operators. |
| EXPR-02 | Extract paths from all branches of conditional expressions | `condition` node has `condition`, `then`, and optional `else` properties. Walk all present branches, union results. Verified with/without else. |
| EXPR-04 | Extract paths from all sub-expressions in blocks | `block` node has `expressions` array. Walk each, union results. Verified with multi-expression blocks `(a; b; c)`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| jsonata | 2.1.0 | JSONata parser -- produces AST from expression strings | Official reference implementation, MIT licensed, includes TypeScript declarations |
| typescript | 5.9.x | Type system, compiler | Industry standard, required for strict mode and discriminated unions |
| vitest | 4.x | Test framework | User decision; native ESM/TS support, fast, compatible with Vite ecosystem |
| tsup | 8.x | Build/bundle tool | Zero-config TypeScript bundler powered by esbuild; generates ESM + .d.ts in one command |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @vitest/coverage-v8 | 4.x | Code coverage | Run with `vitest --coverage` for coverage reports |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsup | tsc (raw) | tsc doesn't bundle, doesn't rewrite extensions for ESM, requires more config; tsup is simpler for library output |
| tsup | tsdown | Newer (Rolldown-based), ESM-first, but less battle-tested; tsup is safer for now |
| tsup | unbuild | Rollup-based, more config; tsup is simpler for single-format ESM output |

**Installation:**
```bash
pnpm init
pnpm add jsonata@2.1.0
pnpm add -D typescript@~5.9 vitest@^4 tsup@^8 @vitest/coverage-v8@^4
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── index.ts              # Public API: extractPaths()
├── parser.ts             # Thin wrapper around jsonata() to get AST
├── walker.ts             # Recursive AST walker (core logic)
├── types.ts              # Custom AST types + PathResult
└── path-builder.ts       # Builds dot-notation path strings from steps
test/
├── extract-paths.test.ts # Integration tests for extractPaths()
├── walker.test.ts        # Unit tests for individual node handlers
├── path-builder.test.ts  # Unit tests for path string construction
└── fixtures/             # Optional: complex expression test fixtures
```

### Pattern 1: Discriminated Union AST Types
**What:** Define custom TypeScript types for each AST node using a discriminated union on the `type` field. This replaces the incomplete official `ExprNode`.
**When to use:** Always -- the official `ExprNode` is missing critical types and properties.
**Why:** The official `ExprNode` type definition (from `jsonata.d.ts`) has these gaps:
- Missing type discriminants: `path`, `bind`, `apply`, `filter`, `sort`, `regex`
- Missing properties: `condition`, `then`, `else` (on condition nodes), `expression` (on unary nodes), `body` (on lambda nodes), `group` (on path nodes), `terms` (on sort nodes), `expr` (on filter nodes)
- `lhs` typed as `ExprNode | ExprNode[]` but never narrowed by `type`

**Example:**
```typescript
// Custom discriminated union for Phase 1 node types
interface PathNode {
  type: "path";
  steps: AstNode[];
  keepSingletonArray?: boolean;
  keepArray?: boolean;
  group?: GroupExpression;
}

interface NameNode {
  type: "name";
  value: string;
  position: number;
  stages?: StageNode[];    // filter/sort/index stages
  keepArray?: boolean;
  ancestor?: AncestorSlot; // parent operator tracking
  tuple?: boolean;
}

interface WildcardNode {
  type: "wildcard";
  value: "*";
  position: number;
}

interface DescendantNode {
  type: "descendant";
  value: "**";
  position: number;
}

interface BinaryNode {
  type: "binary";
  value: string;  // "+", "-", "*", "/", ">", "<", "=", "!=", "and", "or", "&", "in", ".."
  position: number;
  lhs: AstNode;
  rhs: AstNode;
}

interface ConditionNode {
  type: "condition";
  position: number;
  condition: AstNode;
  then: AstNode;
  else?: AstNode;       // optional -- ternary without else is valid
}

interface BlockNode {
  type: "block";
  position: number;
  expressions: AstNode[];
}

interface UnaryNode {
  type: "unary";
  value: string;  // "-" for negation, "[" for array constructor, "{" for object constructor
  position: number;
  expression?: AstNode;    // for negation: -price
  expressions?: AstNode[]; // for array constructor: [a, b, c]
  lhs?: [AstNode, AstNode][]; // for object constructor: {"key": value}
}

interface StringNode {
  type: "string";
  value: string;
  position: number;
}

interface NumberNode {
  type: "number";
  value: number;
  position: number;
}

interface ValueNode {
  type: "value";
  value: boolean | null;  // true, false, null
  position: number;
}

interface VariableNode {
  type: "variable";
  value: string;  // variable name WITHOUT $ prefix
  position: number;
}

interface RegexNode {
  type: "regex";
  value: RegExp;
  position: number;
}

// Phase 1 only needs to handle these types.
// Phase 2+ types (bind, lambda, function, apply, filter, sort, transform, parent)
// should be handled gracefully by a fallback case.

type AstNode =
  | PathNode | NameNode | WildcardNode | DescendantNode
  | BinaryNode | ConditionNode | BlockNode | UnaryNode
  | StringNode | NumberNode | ValueNode
  | VariableNode | RegexNode
  | GenericNode;  // catch-all for unknown types

interface GenericNode {
  type: string;
  [key: string]: unknown;
}
```

### Pattern 2: Recursive Type-Dispatch Walker
**What:** A single `walkNode(node)` function that dispatches on `node.type` using a switch statement, calling type-specific handlers that return `string[]` (raw paths before wrapping in PathResult).
**When to use:** This is the core pattern for the entire walker.
**Why:** Simple, exhaustive (TypeScript enforces all union members handled), easy to extend in later phases.

**Example:**
```typescript
function walkNode(node: AstNode): string[] {
  switch (node.type) {
    case "path":
      return walkPath(node);
    case "binary":
      return [...walkNode(node.lhs), ...walkNode(node.rhs)];
    case "condition":
      return [
        ...walkNode(node.condition),
        ...walkNode(node.then),
        ...(node.else ? walkNode(node.else) : []),
      ];
    case "block":
      return node.expressions.flatMap(expr => walkNode(expr));
    case "unary":
      return walkUnary(node);
    case "name":
      return [node.value];  // standalone name is a single-step path
    case "wildcard":
      return ["*"];
    case "descendant":
      return ["**"];
    case "string":
    case "number":
    case "value":
    case "regex":
      return [];  // literals produce no paths
    case "variable":
      return [];  // Phase 1: variables are opaque (Phase 2 traces them)
    default:
      // Unknown node type -- skip silently (over-approximate principle: don't crash)
      return [];
  }
}

function walkPath(node: PathNode): string[] {
  // Concatenate steps into dot-notation string
  const segments = node.steps.map(step => {
    switch (step.type) {
      case "name": return step.value;
      case "wildcard": return "*";
      case "descendant": return "**";
      default: return null; // skip unknown step types
    }
  }).filter(Boolean);

  if (segments.length === 0) return [];
  return [segments.join(".")];
}
```

### Pattern 3: Path String Builder
**What:** Separate path assembly logic from walker logic. The walker identifies which AST subtrees represent data access; the path builder converts step sequences to dot-notation strings.
**When to use:** Keeps path formatting concerns isolated for easier changes in later phases.

**Example:**
```typescript
function buildPathString(steps: AstNode[]): string | null {
  const segments: string[] = [];
  for (const step of steps) {
    switch (step.type) {
      case "name":
        segments.push(step.value);
        break;
      case "wildcard":
        segments.push("*");
        break;
      case "descendant":
        segments.push("**");
        break;
      default:
        // Non-path step (e.g., sort, filter in later phases)
        // For Phase 1, skip these
        break;
    }
  }
  return segments.length > 0 ? segments.join(".") : null;
}
```

### Pattern 4: PathResult Wrapper
**What:** Return `PathResult` objects (not plain strings) from day one to stabilize the API contract.
**When to use:** Always -- this is a locked user decision.

**Example:**
```typescript
interface PathResult {
  path: string;  // dot-notation path string
}

function extractPaths(expression: string): PathResult[] {
  const ast = jsonata(expression).ast();
  const rawPaths = walkNode(ast);
  const unique = [...new Set(rawPaths)];
  return unique.map(path => ({ path }));
}
```

### Anti-Patterns to Avoid
- **Modifying the official ExprNode type:** Don't try to augment `jsonata.ExprNode` -- build your own types from scratch based on empirical observation. The official type is a single flat interface, not a discriminated union.
- **Casting everything to `any`:** Use proper discriminated unions so TypeScript catches missing handlers.
- **Deep-cloning the AST:** The AST is read-only for our purposes. Walk it in-place.
- **Evaluating expressions:** This is static analysis only. Never call `expression.evaluate()`.
- **String manipulation on expressions:** Don't try to extract paths by parsing the expression string. Always use the AST.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONata parsing | Custom parser | `jsonata` npm package | Battle-tested, 100% branch coverage in official tests, handles all edge cases |
| AST production | Manual tokenizer/parser | `jsonata(expr).ast()` | Parser is synchronous, returns complete AST, handles operator precedence and error recovery |
| TypeScript bundling | Manual tsc + postprocessing | `tsup` | Handles ESM output, declaration files, sourcemaps in one command |
| Test framework | Custom test runner | `vitest` | Native ESM/TS, fast, good assertion library, coverage built-in |

**Key insight:** The JSONata parser does all the hard work. Our job is purely to walk the already-parsed tree. Do not attempt to parse JSONata expressions ourselves.

## Common Pitfalls

### Pitfall 1: The Official ExprNode Type is Incomplete
**What goes wrong:** Using `jsonata.ExprNode` directly and hitting type errors or missing type narrowing because the type union doesn't include `path`, `bind`, `apply`, `filter`, or `sort`.
**Why it happens:** The `jsonata.d.ts` was written for jsonata 1.7 and hasn't been fully updated. It treats all nodes as the same flat interface with optional properties.
**How to avoid:** Build custom discriminated union types from empirical parser output (documented above). Cast the parser output to your custom `AstNode` type at the boundary.
**Warning signs:** `Property 'condition' does not exist on type 'ExprNode'`, or needing `(node as any).condition`.

### Pitfall 2: `path` Nodes Wrapping Single Names
**What goes wrong:** Expecting a bare `name` node for `account` but getting `{ type: "path", steps: [{ type: "name", value: "account" }] }`.
**Why it happens:** The JSONata parser always wraps standalone names in a `path` node. Even a single field reference like `name` becomes a `path` with one step.
**How to avoid:** Always handle `path` as the top-level container for field references. The walker's `walkPath` function naturally handles 1-step and N-step paths identically.
**Warning signs:** Missing paths in output for simple single-field expressions.

### Pitfall 3: Unary Nodes Have Different Shapes
**What goes wrong:** Assuming all `unary` nodes have the same structure.
**Why it happens:** The parser reuses `type: "unary"` for three different constructs:
1. Negation (`-price`): has `expression` property (single child)
2. Array constructor (`[a, b]`): has `expressions` property (array of children)
3. Object constructor (`{"k": v}`): has `lhs` property (array of key-value pairs)
**How to avoid:** Dispatch on `node.value` (`"-"`, `"["`, `"{"`) to determine which properties to read.
**Warning signs:** `Cannot read property 'type' of undefined` when walking unary nodes.

### Pitfall 4: Stages on Name Nodes (Filters/Sorts)
**What goes wrong:** Missing paths inside filter predicates or sort expressions because they're nested in `stages` on name nodes, not as separate top-level nodes.
**Why it happens:** The parser attaches predicates (`items[price > 10]`) as `stages` on the preceding name step, not as separate children. The `stages` property contains `filter` or `sort` nodes.
**How to avoid:** Phase 1 doesn't need to walk `stages` (filters are Phase 3), but the walker should not crash if `stages` is present. When Phase 3 arrives, add stage walking to the name/step handler.
**Warning signs:** Silently missing paths from filter predicates. For Phase 1, this is expected/acceptable.

### Pitfall 5: The jsonata Error is Not an Error Instance
**What goes wrong:** `catch (e) { if (e instanceof Error) ... }` misses jsonata parse errors.
**Why it happens:** The jsonata parser throws plain objects, not `Error` instances. They have `code`, `position`, `token`, `message`, and `stack` properties but `instanceof Error` returns `false`.
**How to avoid:** Check for the error properties directly (`if (e && typeof e === 'object' && 'code' in e)`) or simply let the error propagate unmodified (which is the user's locked decision).
**Warning signs:** Swallowed parse errors, tests that expect `Error` instances failing.

### Pitfall 6: jsonata Package is UMD, Not ESM
**What goes wrong:** Import issues when using the jsonata package in an ESM TypeScript project.
**Why it happens:** The published `jsonata.js` is a UMD (browserify) bundle. It has `"module": "jsonata.js"` and `"main": "jsonata.js"` but no `"type": "module"` or `"exports"` field.
**How to avoid:** Use `import jsonata from "jsonata"` (default import). This works correctly in ESM contexts because Node.js handles UMD modules as CJS with a default export. Verified empirically.
**Warning signs:** `SyntaxError: Named export 'xxx' not found` or `ERR_REQUIRE_ESM`.

### Pitfall 7: Variable Node Values Don't Include the $ Prefix
**What goes wrong:** Looking for `$x` in the AST but finding `{ type: "variable", value: "x" }`.
**Why it happens:** The parser strips the `$` prefix from variable names. The `value` property contains only the bare name.
**How to avoid:** If referencing variables, remember they don't have the `$` prefix in the AST. Phase 1 treats variables as opaque (returning no paths), so this mainly matters for Phase 2.
**Warning signs:** Variable resolution failing to match names.

## Code Examples

Verified patterns from empirical parser output (tested against jsonata 2.1.0):

### Parsing an Expression
```typescript
// Source: Empirical testing against jsonata 2.1.0
import jsonata from "jsonata";

// Parsing is synchronous -- jsonata() parses immediately, .ast() returns the tree
const expression = jsonata("account.name");
const ast = expression.ast();
// ast = { type: "path", steps: [{ type: "name", value: "account", position: 7 }, { type: "name", value: "name", position: 12 }] }
```

### Complete AST Shapes for Phase 1 Node Types

```typescript
// Source: Empirical testing against jsonata 2.1.0

// PATH: "account.name"
{ type: "path", steps: [{ value: "account", type: "name", position: 7 }, { value: "name", type: "name", position: 12 }] }

// PATH with WILDCARD: "order.*"
{ type: "path", steps: [{ value: "order", type: "name", position: 5 }, { value: "*", type: "wildcard", position: 7 }] }

// PATH with DESCENDANT: "**.price"
{ type: "path", steps: [{ value: "**", type: "descendant", position: 2 }, { value: "price", type: "name", position: 8 }] }

// PATH with prefix + DESCENDANT: "account.**.price"
{ type: "path", steps: [
  { value: "account", type: "name", position: 7 },
  { value: "**", type: "descendant", position: 10 },
  { value: "price", type: "name", position: 16 }
] }

// SINGLE NAME: "name" -- still wrapped in path!
{ type: "path", steps: [{ value: "name", type: "name", position: 4 }] }

// BINARY: "price * quantity"
{ type: "binary", value: "*", position: 7,
  lhs: { type: "path", steps: [{ value: "price", type: "name", position: 5 }] },
  rhs: { type: "path", steps: [{ value: "quantity", type: "name", position: 16 }] }
}

// BINARY nested: "a > 1 and b < 2"
{ type: "binary", value: "and", position: 9,
  lhs: { type: "binary", value: ">", lhs: {path:"a"}, rhs: {number:1} },
  rhs: { type: "binary", value: "<", lhs: {path:"b"}, rhs: {number:2} }
}

// CONDITION with else: "a ? b : c"
{ type: "condition", position: 3,
  condition: { type: "path", steps: [{ value: "a", type: "name" }] },
  then: { type: "path", steps: [{ value: "b", type: "name" }] },
  else: { type: "path", steps: [{ value: "c", type: "name" }] }
}

// CONDITION without else: "condition ? thenBranch"
{ type: "condition", position: 11,
  condition: { type: "path", steps: [{ value: "condition", type: "name" }] },
  then: { type: "path", steps: [{ value: "thenBranch", type: "name" }] }
  // no "else" property
}

// BLOCK: "(a; b; c)"
{ type: "block", position: 1,
  expressions: [
    { type: "path", steps: [{ value: "a", type: "name" }] },
    { type: "path", steps: [{ value: "b", type: "name" }] },
    { type: "path", steps: [{ value: "c", type: "name" }] }
  ]
}

// EMPTY BLOCK: "()" -- valid, zero expressions
{ type: "block", position: 1, expressions: [] }

// STRING: "hello"
{ value: "hello", type: "string", position: 7 }

// NUMBER: 42
{ value: 42, type: "number", position: 2 }

// BOOLEAN TRUE: true
{ value: true, type: "value", position: 4 }

// BOOLEAN FALSE: false
{ value: false, type: "value", position: 5 }

// NULL: null
{ value: null, type: "value", position: 4 }

// UNARY NEGATE: "-price"
{ type: "unary", value: "-", position: 1,
  expression: { type: "path", steps: [{ value: "price", type: "name" }] }
}

// UNARY ARRAY: "[a, b, c]"
{ type: "unary", value: "[", position: 1,
  expressions: [
    { type: "path", steps: [{ value: "a", type: "name" }] },
    { type: "path", steps: [{ value: "b", type: "name" }] },
    { type: "path", steps: [{ value: "c", type: "name" }] }
  ]
}

// UNARY OBJECT: {"name": account.name, "total": price * qty}
{ type: "unary", value: "{", position: 1,
  lhs: [
    [{ value: "name", type: "string" }, { type: "path", steps: [...] }],
    [{ value: "total", type: "string" }, { type: "binary", ... }]
  ]
}

// VARIABLE: "$x" -- note: no $ prefix in value
{ value: "x", type: "variable", position: 2 }

// REGEX: /test/i
{ value: {}, type: "regex", position: 7 }
```

### Error Handling Patterns
```typescript
// Source: Empirical testing against jsonata 2.1.0

// jsonata throws on invalid input -- errors are NOT Error instances
try {
  jsonata("");  // empty string
} catch (e: unknown) {
  // e = { code: "S0207", position: 0, message: "Unexpected end of expression", token: ..., stack: ... }
  // e instanceof Error === false !!
}

// Common error codes:
// S0207 - Unexpected end of expression (empty, whitespace, incomplete)
// S0203 - Expected token before end of expression (unclosed parens/brackets)
// S0211 - Symbol cannot be used as unary operator
```

### Complete extractPaths Implementation Sketch
```typescript
import jsonata from "jsonata";

interface PathResult {
  path: string;
}

export function extractPaths(expression: string): PathResult[] {
  // Step 1: Parse -- let jsonata throw on invalid input
  const ast = jsonata(expression).ast();

  // Step 2: Walk -- recursive dispatch on node.type
  const rawPaths = walkNode(ast as AstNode);

  // Step 3: Deduplicate
  const unique = [...new Set(rawPaths)];

  // Step 4: Wrap in PathResult
  return unique.map(path => ({ path }));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@types/jsonata` separate package | Types bundled in `jsonata` package | jsonata 1.8+ | No need for `@types/jsonata` |
| jsonata CJS-only | jsonata UMD bundle (works in ESM via default import) | jsonata 2.x | Use `import jsonata from "jsonata"` |
| Jest for testing | Vitest for ESM-native testing | 2023+ | No ESM workarounds needed, faster execution |
| tsc for library builds | tsup (esbuild-powered) | 2022+ | One command for ESM + .d.ts output |

**Deprecated/outdated:**
- `@types/jsonata`: Not needed -- types ship with the package (though they are incomplete)
- Jest with ESM transforms: Vitest handles ESM natively, no experimental flags needed

## Open Questions

1. **Unknown node type handling strategy (Claude's Discretion)**
   - What we know: The walker will encounter node types not handled in Phase 1 (e.g., `bind`, `lambda`, `function`, `apply`, `transform`, `filter`, `sort`, `parent`, `partial`). The project philosophy is "over-approximate" (report superset of paths).
   - Recommendation: **Skip unknown types silently** (return empty array). This aligns with over-approximation -- we won't crash and won't produce false paths. Log a debug warning if a `console.warn` flag is enabled. Do NOT throw, as that violates the "don't crash on valid expressions" principle.

2. **Empty expression and whitespace-only input behavior (Claude's Discretion)**
   - What we know: The jsonata parser throws `S0207 "Unexpected end of expression"` for both `""` and `"   "`.
   - Recommendation: **Let the error propagate** -- this is consistent with the locked decision "throw on invalid JSONata input". Empty/whitespace IS invalid JSONata. The caller can catch the error. No special-casing needed.

3. **Package name (Claude's Discretion)**
   - Recommendation: **`jsonata-ast-analyzer`** -- broader than "path extractor" since the project aims to do more than just paths (confidence annotations, scope analysis in later phases). Alternatively, `jsonata-path-extractor` is more specific to v1 scope.

4. **Build tooling (Claude's Discretion)**
   - Recommendation: **tsup** -- researched above. Zero-config, ESM + .d.ts in one command, esbuild-powered, well-maintained. Configuration is minimal for ESM-only output.

5. **Source directory structure (Claude's Discretion)**
   - Recommendation: Flat `src/` with 4-5 files (index, parser, walker, types, path-builder). No nested directories needed at this scale. Test directory mirrors source structure.

6. **All AST node types in jsonata 2.1.0**
   - What we know: Empirically confirmed ALL type strings found in the jsonata source: `apply`, `binary`, `bind`, `block`, `condition`, `descendant`, `error`, `filter`, `function`, `lambda`, `name`, `number`, `parent`, `partial`, `path`, `regex`, `sort`, `string`, `transform`, `unary`, `value`, `variable`, `wildcard`
   - What's unclear: Whether future jsonata versions will add more types.
   - Recommendation: Use a `default` case in the switch that logs and returns empty paths, so new types don't cause crashes.

## Sources

### Primary (HIGH confidence)
- `jsonata` npm package v2.1.0 -- empirical testing of parser output for all Phase 1 expression types
- `jsonata.d.ts` from the package -- TypeScript type definitions examined for completeness
- `jsonata.js` source code -- extracted all `type` string values via automated search
- Vitest official docs (https://vitest.dev/) -- configuration and setup patterns
- tsup official docs (https://tsup.egoist.dev/) -- ESM library build configuration

### Secondary (MEDIUM confidence)
- npm registry version queries -- confirmed latest versions: jsonata 2.1.0, vitest 4.0.18, tsup 8.5.1, typescript 5.9.3
- Community articles on TypeScript ESM project setup with Vitest and pnpm
- Community articles comparing tsup vs tsc vs unbuild for TypeScript libraries

### Tertiary (LOW confidence)
- None -- all findings verified empirically or via official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- versions verified via npm, imports tested empirically
- Architecture: HIGH -- AST shapes fully documented from empirical testing against jsonata 2.1.0, all Phase 1 node types verified
- Pitfalls: HIGH -- all pitfalls discovered through empirical testing (error types, ExprNode gaps, UMD import, variable naming)

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable domain -- jsonata, Vitest, and tsup are mature)
