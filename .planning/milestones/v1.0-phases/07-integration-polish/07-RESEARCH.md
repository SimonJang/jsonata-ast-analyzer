# Phase 7: Integration Polish - Research

**Researched:** 2026-03-03
**Domain:** AST walker bug fix + CLI error handling
**Confidence:** HIGH

## Summary

Phase 7 addresses two specific, well-characterized integration gaps identified in the v1.0 milestone audit. Both are narrow, surgical fixes to existing code with clear reproduction cases and established patterns to follow.

**Gap 1 (walkVariable predicate):** When a `VariableNode` with predicates appears as a standalone function argument (e.g., `$map($data[status], fn)`), the `walkVariable` function resolves the variable but never inspects `node.predicate`. The fix mirrors the pattern already implemented in `walkPath`'s variable-resolution branch (walker.ts lines 110-116) -- resolve the variable, then call `walkFilterStages` on the predicate array using the resolved paths as context prefix. The existing `walkFilterStages` function (walker.ts:208-252) already handles all predicate complexity including focus variable binding, numeric index guards, and ADV-02 dynamic wildcard emission.

**Gap 2 (CLI error message):** The jsonata library throws plain objects (not `Error` instances) on parse errors. The CLI's catch block uses `err instanceof Error` which returns `false`, falling through to `String(err)` which produces `[object Object]`. The fix accesses `err.message` directly, with appropriate fallback handling for unexpected error shapes.

**Primary recommendation:** Implement both fixes in a single plan. The walkVariable fix adds ~10 lines mirroring walkPath's pattern. The CLI fix changes one line in the error handler. Both have clear test cases defined by the success criteria.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Single exit code (1) for all errors -- no distinction between parse errors and internal errors
- Errors written to stderr (keep current behavior)
- No expression echo in error output -- just the error information
- Exit code behavior unchanged from current implementation
- Strictly the 2 integration gaps from milestone audit: `walkVariable-predicate-gap` and `CLI-error-message`
- Carried-forward tech debt ($sort untested, standalone BindNode, $lookup semantics) stays in the audit -- not in scope
- Drive-by cosmetic fixes included: remove unused `ParentNode` import in walker.ts, update ROADMAP.md Phase 6 checkbox and progress table

### Claude's Discretion
- CLI error detail level -- how much of jsonata's error object to expose (message, position, token are available)
- walkVariable predicate fix implementation approach -- should mirror walkPath's pattern but Claude determines exact mechanics

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope. Carried tech debt items remain documented in v1.0-MILESTONE-AUDIT.md.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXPR-03 | Extract paths from filter predicates (`items[price > 10]` -> `items.price`) | walkVariable predicate fix ensures predicates on standalone VariableNodes are walked, extending EXPR-03 coverage to the `$map($data[status], fn)` case |
| ADV-02 | Mark dynamically computed paths with wildcards (`item[fieldName]` -> `item[*]`) | walkVariable predicate fix ensures `walkFilterStages` is called for standalone VariableNode predicates, enabling ADV-02 dynamic wildcard emission for `$data[$field]` as function arg |
| API-02 | Provide CLI tool for command-line usage with stdin and argument input | CLI error message fix ensures parse errors display the actual message, not `[object Object]` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test framework | Already used for all 102 existing tests |
| typescript | ~5.9.3 | Type checking | Project uses strict TypeScript throughout |
| tsup | ^8.5.1 | Build tool | Already configured for library + CLI dual output |

### Supporting
No new libraries needed. Both fixes are purely internal code changes.

### Alternatives Considered
None -- no new dependencies required for this phase.

**Installation:**
No new packages to install.

## Architecture Patterns

### Recommended Project Structure
No structural changes. All modifications are to existing files:
```
src/
├── walker.ts        # walkVariable fix (~10 lines added)
├── cli.ts           # Error handler fix (~3 lines changed)
test/
└── extract-paths.test.ts  # New test cases added
.planning/
├── ROADMAP.md       # Phase 6 checkbox + progress table update
```

### Pattern 1: Predicate Inspection on Variable Resolution
**What:** After resolving a variable's paths from scope, check `node.predicate` and call `walkFilterStages` to extract filter paths
**When to use:** When a VariableNode has a `predicate` array (filter stages applied directly to the variable)
**Example:**
```typescript
// Source: walker.ts walkPath variable branch (lines 110-116) -- the pattern to mirror
const predicates = varStep.predicate;
if (predicates && predicates.length > 0) {
  for (const resolvedPath of resolved) {
    paths.push(...walkFilterStages(predicates, resolvedPath, scope, varStep.focus));
  }
}
```

The same pattern applies to `walkVariable` -- after resolving the variable, inspect `node.predicate` and call `walkFilterStages` with each resolved path as context prefix.

### Pattern 2: Error Object Message Extraction
**What:** Handle jsonata's non-Error thrown objects by checking for `.message` property
**When to use:** In catch blocks where jsonata errors may be caught
**Example:**
```typescript
// Current (broken):
const message = err instanceof Error ? err.message : String(err);
// Produces: "Error: [object Object]" for jsonata errors

// Fixed -- check for message property on any object:
const message = err instanceof Error
  ? err.message
  : typeof err === "object" && err !== null && "message" in err
    ? (err as { message: string }).message
    : String(err);
```

### Anti-Patterns to Avoid
- **Duplicating walkFilterStages logic in walkVariable:** The existing `walkFilterStages` function handles all predicate complexity (focus binding, numeric index guard, ADV-02 dynamic wildcard). Call it, do not inline a partial reimplementation.
- **Wrapping jsonata errors in new Error():** The parser.ts comment explicitly states "jsonata errors are NOT Error instances; they are plain objects" -- do not try to normalize them upstream, handle them at the consumption point (CLI).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filter predicate walking | Custom predicate iteration in walkVariable | `walkFilterStages()` | Already handles focus binding, numeric index guard, ADV-02 dynamic wildcard -- 7 edge cases in one function |
| Error message extraction | Regex parsing of `String(err)` | Property access on `err.message` | jsonata errors always have a `.message` string property (verified: "Syntax error: ...", "Unexpected end of expression", etc.) |

**Key insight:** Both fixes reuse existing infrastructure. The predicate fix calls an existing function. The CLI fix uses an existing property.

## Common Pitfalls

### Pitfall 1: Forgetting to Handle Focus Variable in walkVariable
**What goes wrong:** The `VariableNode.focus` property (from `@$v` syntax like `$data@$v[type]`) must be passed to `walkFilterStages` to correctly bind the focus variable in the filter scope.
**Why it happens:** Focus is easy to overlook because it's a secondary property on VariableNode, but `walkFilterStages` uses it for scope binding.
**How to avoid:** Pass `node.focus` as the fourth argument to `walkFilterStages`, mirroring the walkPath pattern exactly.
**Warning signs:** Tests with `@$v` syntax on standalone variables would fail or produce incorrect scope bindings.

### Pitfall 2: Losing the Resolved Paths Return in walkVariable
**What goes wrong:** After adding predicate inspection, the function might return only the predicate paths and forget to also return the resolved variable paths themselves.
**Why it happens:** The current `walkVariable` returns `[...resolved]`. Adding predicate paths must augment this, not replace it.
**How to avoid:** Accumulate both the predicate paths AND the resolved paths, then return them together.
**Warning signs:** Existing tests for simple variable resolution (like `($x := account; $x.name)`) would break.

### Pitfall 3: Assuming err.message Always Exists
**What goes wrong:** If a non-jsonata error (e.g., a raw string throw, or an unexpected error type) reaches the CLI catch block, accessing `.message` on it could produce `undefined`.
**Why it happens:** While jsonata errors always have `.message`, defensive programming requires handling edge cases.
**How to avoid:** Use the three-tier check: `instanceof Error` first, then `typeof err === "object" && "message" in err`, then fall back to `String(err)`.
**Warning signs:** CLI would show "Error: undefined" for unexpected error types.

### Pitfall 4: Breaking the walkPath Variable Branch
**What goes wrong:** Accidentally modifying the walkPath variable-resolution branch while adding the walkVariable fix.
**Why it happens:** The two branches handle similar but distinct cases -- walkPath handles VariableNode as a step in a PathNode, walkVariable handles standalone VariableNode.
**How to avoid:** Only modify `walkVariable` (lines 380-399). Do not touch `walkPath`'s variable branch.
**Warning signs:** Existing Phase 6 composed variable-filter tests would fail.

## Code Examples

### walkVariable With Predicate Inspection
```typescript
// Source: pattern derived from walkPath (walker.ts:110-116) applied to walkVariable
function walkVariable(node: VariableNode, scope: ScopeTracker): string[] {
  if (node.value === "") {
    return [];
  }

  const resolved = resolveVariable(scope, node.value);
  if (resolved) {
    const paths = [...resolved];

    // Inspect predicates on standalone VariableNode (mirrors walkPath pattern)
    if (node.predicate && node.predicate.length > 0) {
      for (const resolvedPath of resolved) {
        paths.push(...walkFilterStages(node.predicate, resolvedPath, scope, node.focus));
      }
    }

    return paths;
  }

  if (BUILTIN_FUNCTIONS.has(node.value)) {
    return [];
  }

  return [];
}
```

### CLI Error Handler Fix
```typescript
// Source: cli.ts catch block (lines 31-34) -- fixed version
catch (err) {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? (err as { message: string }).message
        : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}
```

### Verified: jsonata Error Object Structure
```
// Source: empirical testing against jsonata 2.1.0
// jsonata throws plain objects (NOT Error instances):
{
  code: "S0201",           // error code string
  position: 18,            // character position in expression
  token: "expression",     // the problematic token
  stack: "Error\n...",     // stack trace string
  message: "Syntax error: \"expression\""  // human-readable message
}

// typeof: "object"
// instanceof Error: false
// String(err): "[object Object]"
// err.message: "Syntax error: \"expression\""
```

## State of the Art

No changes from current approach. This phase applies surgical fixes to existing code without architectural changes.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `err instanceof Error` check only | Three-tier error message extraction | This phase | CLI correctly displays jsonata parse error messages |
| `walkVariable` ignores `predicate` | `walkVariable` calls `walkFilterStages` on predicates | This phase | Standalone VariableNode predicates correctly walked |

## Open Questions

1. **CLI error detail level (Claude's Discretion)**
   - What we know: jsonata errors expose `message`, `position`, `token`, and `code` properties. The user decision says "just the error information" with no expression echo.
   - What's unclear: Should the CLI show just `message`, or also include `position`/`code` for debuggability?
   - Recommendation: Show just `err.message` -- it already includes the relevant context (e.g., `Syntax error: "expression"`). Position and code are useful for programmatic consumers but verbose for CLI output. Keep it simple; the message property is sufficient for human consumption. If richer output is desired later, it can be added to the v2 scope.

## Sources

### Primary (HIGH confidence)
- `/home/simon-mainframe/Desktop/projects/jsonata-ast-poc/src/walker.ts` - walkVariable implementation (lines 380-399), walkPath variable branch (lines 100-129), walkFilterStages (lines 208-252)
- `/home/simon-mainframe/Desktop/projects/jsonata-ast-poc/src/cli.ts` - CLI error handler (lines 31-34)
- `/home/simon-mainframe/Desktop/projects/jsonata-ast-poc/src/types.ts` - VariableNode type definition with `predicate` and `focus` properties (lines 93-99)
- `/home/simon-mainframe/Desktop/projects/jsonata-ast-poc/src/parser.ts` - Parser comment documenting jsonata error object shape
- Empirical testing: jsonata 2.1.0 error object structure verified via Node.js REPL (typeof, instanceof, Object.keys, .message)
- Empirical testing: `$map($data[status], fn)` confirmed to miss predicate paths in current implementation
- Empirical testing: CLI confirmed to produce `Error: [object Object]` for parse errors
- `/home/simon-mainframe/Desktop/projects/jsonata-ast-poc/.planning/v1.0-MILESTONE-AUDIT.md` - Gap descriptions and severity assessments

### Secondary (MEDIUM confidence)
None needed -- all findings verified against actual source code and runtime behavior.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all existing infrastructure
- Architecture: HIGH - both fixes mirror existing patterns with verified reproduction cases
- Pitfalls: HIGH - all pitfalls derived from reading the actual code and understanding the existing pattern

**Research date:** 2026-03-03
**Valid until:** Indefinite (fixes are to specific code locations in the current codebase)
