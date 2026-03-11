# Phase 22: Architecture and Limitations - Research

**Researched:** 2026-03-11
**Domain:** README documentation -- architecture explanation and limitations framing
**Confidence:** HIGH

## Summary

Phase 22 adds content to two existing empty headings in the README: `## How It Works` and `## Limitations`. The work is purely prose -- no code changes, no new dependencies, no test changes. The pipeline flow, over-approximation principle, and limitation framing are all derivable directly from reading the source code (which this research has done thoroughly).

The actual pipeline as implemented in `src/index.ts` is: `parse()` (JSONata parser to AST) -> `walkNode()` (recursive traversal with scope chain) -> `Set` dedupe -> `deriveConfidence()` (classify each path) -> `PathResult[]`. The CONTEXT.md specifies the diagram stages as: expression string -> parse -> walk -> dedupe -> classify -> PathResult[]. These match the code.

**Primary recommendation:** Write the content by directly mapping source code structure to the agreed-upon diagram format and prose style. All technical details are fully known from the codebase -- no external research needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Pipeline diagram**: Compact single-line flow style (not box diagram). Stages: expression string -> parse -> walk -> dedupe -> classify -> PathResult[]. Each stage gets a brief label. Top-level stages only -- no scope/variable resolution detail in diagram. Conceptual labels only -- no source file names.
- **Architecture depth**: Pipeline diagram + prose description of stages. Keep heading as "How It Works" (not "Architecture"). Mention the official JSONata parser dependency explicitly. No test suite size or validation metrics.
- **Over-approximation framing**: Presented as a paragraph at the end of How It Works section (not a separate subsection). No concrete example of superset behavior. No analogy to other static analyzers. Include one sentence explaining WHY: false positives (extra paths) are safe; false negatives (missed paths) can break downstream consumers.
- **Limitations**: Three items (not four): static analysis only + no evaluation merged into one, dynamic path wildcards, parent operator approximation. Framed as deliberate design decisions with rationale. Format: bold heading + one sentence of rationale per limitation. No concrete code examples in limitations.

### Claude's Discretion
- Exact prose wording for stage descriptions
- How much internal detail to expose in the walk stage description (scope chains, variable tracing, filter handling)
- Precise wording of over-approximation paragraph
- Exact rationale sentences for each limitation

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ARCH-01 | README includes a "How it works" section with ASCII pipeline diagram showing expression -> parse -> walk -> extract -> classify flow | Pipeline fully mapped from `src/index.ts`: parse() -> walkNode() -> Set dedupe -> deriveConfidence() -> PathResult[]. Diagram format locked in CONTEXT.md as compact single-line flow. |
| ARCH-02 | README explains the over-approximation design principle (superset of actual paths) | Over-approximation is evidenced throughout the codebase: unknown node types return [] (skip silently), unresolvable variables produce wildcards or are skipped, all branches of conditionals are walked. CONTEXT.md locks this as a paragraph at end of How It Works. |
| LMTS-01 | README documents limitations framed as design decisions (static-only, over-approximation, dynamic path wildcards) | Three limitations identified and locked in CONTEXT.md: (1) static-only/no evaluation, (2) dynamic path wildcards via [*], (3) parent operator % approximation. Each framed as deliberate choice with rationale. |
</phase_requirements>

## Standard Stack

Not applicable -- this phase is documentation-only (README prose). No libraries, dependencies, or code changes involved.

## Architecture Patterns

### Existing README Structure (insertion points)

```
README.md (lines 173-176):
## How It Works       <-- line 173, currently empty, insert content after this line
                      <-- line 174, blank
## Limitations        <-- line 175, currently empty, insert content after this line
                      <-- line 176, blank
## License            <-- line 177
```

Content goes between these existing headings. No structural changes to the README.

### Pattern 1: Pipeline Diagram (ASCII single-line flow)

**What:** A compact ASCII diagram showing the 5-stage pipeline
**Locked format:** Single-line flow, not box diagram
**Stages (from CONTEXT.md):**
1. Expression string
2. Parse (JSONata parser -> AST)
3. Walk (recursive traversal -> raw paths)
4. Dedupe (Set-based deduplication)
5. Classify (confidence annotation -> PathResult[])

**Source mapping (from code review):**
| Diagram Stage | Code Location | What It Does |
|---------------|---------------|--------------|
| Parse | `src/parser.ts` - `parse()` | Delegates to official `jsonata` package's parser, returns AST |
| Walk | `src/walker.ts` - `walkNode()` | Recursive switch-based dispatch over AST node types, threads immutable scope chain for variable resolution |
| Dedupe | `src/index.ts` line 44 | `[...new Set(rawPaths)]` -- simple Set-based string dedup |
| Classify | `src/index.ts` - `deriveConfidence()` | Checks path for `%` segment (partial), `[*]` marker (dynamic), else static |

### Pattern 2: Over-Approximation Paragraph

**What:** A paragraph explaining the design principle
**Position:** End of How It Works section, before Limitations heading
**Key points to convey (from code evidence):**
- The analyzer reports a superset of paths that may be accessed (not the exact set)
- All branches of conditionals are walked (both then and else)
- Unresolvable variables produce `[*]` wildcards rather than being omitted
- Unknown node types return empty arrays (skip silently, don't crash)
- WHY: false positives (extra paths reported) are safe for downstream consumers; false negatives (missed paths) could break data dependency tracking

### Pattern 3: Three Limitations as Design Decisions

**What:** Three limitation items, each with bold heading + one sentence rationale
**Items (locked by CONTEXT.md):**

1. **Static analysis only** (merged: no evaluation + static-only)
   - Code evidence: The analyzer never evaluates expressions. `parse()` produces an AST, `walkNode()` traverses structure only. No runtime, no input data, no expression evaluation.
   - Rationale angle: Enables analysis without requiring sample data or a runtime environment.

2. **Dynamic path wildcards**
   - Code evidence: `walkFilterStages()` in walker.ts lines 288-294 -- when a pure `$variable` in bracket position has no resolved data paths, it emits `contextPrefix[*]` and marks as `dynamic` confidence.
   - Rationale angle: Acknowledges that a field is accessed while signaling that the exact field name depends on runtime data.

3. **Parent operator approximation**
   - Code evidence: `walkNode()` case "parent" returns `["%"]` as a literal path segment. `deriveConfidence()` checks for `%` as a whole segment and returns `partial`. The parent operator navigates to enclosing context at runtime, but statically the exact target is indeterminate.
   - Rationale angle: The `%` marker preserves structural information about parent navigation while honestly flagging that resolution requires runtime context.

### Anti-Patterns to Avoid
- **Mentioning source file names in README:** CONTEXT.md explicitly says "conceptual labels only -- no source file names"
- **Adding code examples to limitations:** CONTEXT.md says "no concrete code examples in limitations -- examples section already covers these"
- **Creating subsection for over-approximation:** Must be a paragraph within How It Works, not a separate subsection
- **Using "Architecture" as heading:** Keep existing "How It Works" heading per CONTEXT.md
- **Showing scope chain detail in diagram:** Diagram is top-level stages only
- **Including a fourth limitation:** Three items only -- static analysis + no evaluation are merged into one

## Don't Hand-Roll

Not applicable -- this phase writes prose only. No code solutions needed.

## Common Pitfalls

### Pitfall 1: Getting the pipeline stages wrong
**What goes wrong:** Describing stages that don't match the actual code
**Why it happens:** Guessing from requirements instead of reading source
**How to avoid:** The actual pipeline is in `src/index.ts` lines 41-46:
  1. `parse(expression)` -- parser.ts wraps `jsonata(expression).ast()`
  2. `walkNode(ast, scope)` -- walker.ts recursive dispatch
  3. `[...new Set(rawPaths)]` -- deduplication
  4. `.map(path => ({ path, confidence: deriveConfidence(path) }))` -- classification
**Warning signs:** Mentioning stages like "extract" as separate from "walk" -- they are the same step

### Pitfall 2: Diagram showing "extract" as a separate stage
**What goes wrong:** REQUIREMENTS.md mentions "extract" as a stage, but the actual code has walk + dedupe + classify (no separate "extract" step)
**How to avoid:** CONTEXT.md updated the stages to: parse -> walk -> dedupe -> classify. Follow CONTEXT.md, not REQUIREMENTS.md stage names.

### Pitfall 3: Over-explaining internal details
**What goes wrong:** README becomes a developer guide instead of a "how it works" overview
**Why it happens:** The codebase is rich with interesting implementation details (scope chains, filter handling, HOF semantics, thunk unwrapping)
**How to avoid:** Keep prose at the conceptual level. The walk stage can mention variable tracing and scope handling briefly, but should not explain the linked-list scope chain implementation or filter stage two-pass algorithm.

### Pitfall 4: Breaking the README heading order
**What goes wrong:** Content inserted in wrong location, breaking the established section flow
**How to avoid:** README section order is: ... Examples -> How It Works -> Limitations -> License. Content goes UNDER the existing empty headings (lines 173 and 175), not before or after them.

### Pitfall 5: Framing limitations as apologies
**What goes wrong:** Wording like "unfortunately the analyzer cannot..." or "a known weakness is..."
**Why it happens:** Default tendency to present limitations as deficiencies
**How to avoid:** CONTEXT.md and LMTS-01 explicitly require framing as deliberate design decisions. Use active voice: "The analyzer does X because Y" not "The analyzer cannot do X."

## Code Examples

No code examples needed for this phase -- the deliverable is prose and an ASCII diagram, not code.

### Reference: Actual Pipeline Code (for prose accuracy)

```typescript
// Source: src/index.ts lines 40-46
export function extractPaths(expression: string): PathResult[] {
  const ast = parse(expression);
  const scope = createScope();
  const rawPaths = walkNode(ast, scope);
  const unique = [...new Set(rawPaths)];
  return unique.map((path) => ({ path, confidence: deriveConfidence(path) }));
}
```

### Reference: Confidence Classification (for prose accuracy)

```typescript
// Source: src/index.ts lines 24-31
function deriveConfidence(path: string): Confidence {
  const segments = path.split(".");
  if (segments.includes("%")) return "partial";
  if (path.includes("[*]")) return "dynamic";
  return "static";
}
```

### Reference: Parser Delegation (for prose accuracy)

```typescript
// Source: src/parser.ts lines 11-14
export function parse(expression: string): AstNode {
  const expr = jsonata(expression);
  return expr.ast() as AstNode;
}
```

## State of the Art

Not applicable -- this phase documents the project's own architecture, not external technology.

## Open Questions

1. **How much walker detail in the prose?**
   - What we know: CONTEXT.md gives Claude discretion on "how much internal detail to expose in the walk stage description (scope chains, variable tracing, filter handling)"
   - What's unclear: Exact depth of explanation
   - Recommendation: Mention that the walker handles variable assignments, filter predicates, and function arguments (these are the core value proposition mentioned in the project description), but don't explain HOW (scope chains, two-pass filter algorithm, etc.). One or two sentences per concept.

2. **Exact ASCII diagram style**
   - What we know: "Compact single-line flow style" with brief labels
   - What's unclear: Exact ASCII art format (arrows, spacing)
   - Recommendation: Use a simple arrow chain like:
     ```
     expression string → parse → walk → dedupe → classify → PathResult[]
                          │        │       │         │
                        JSONata   recursive  Set    path string
                        parser   traversal        → confidence
     ```
     Or even simpler -- a single line with labels below. Claude has discretion on exact format.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:unit` |
| Full suite command | `pnpm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-01 | README has "How it works" section with ASCII pipeline diagram | manual-only | N/A -- prose content in README, not testable via automated tests | N/A |
| ARCH-02 | README explains over-approximation design principle | manual-only | N/A -- prose content in README, not testable via automated tests | N/A |
| LMTS-01 | README documents limitations as design decisions | manual-only | N/A -- prose content in README, not testable via automated tests | N/A |

**Justification for manual-only:** All three requirements produce README prose content. There is no programmatic behavior to test. Verification is visual review of the README content against the requirements and CONTEXT.md constraints.

### Sampling Rate
- **Per task commit:** Visual review of README section content
- **Per wave merge:** `pnpm test` (ensure no existing tests broken by file edits)
- **Phase gate:** Visual confirmation that all three sections have correct content; `pnpm test` green

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements (which are documentation-only and require no new test files).

## Sources

### Primary (HIGH confidence)
- `src/index.ts` -- actual pipeline implementation (parse -> walkNode -> Set dedupe -> deriveConfidence -> PathResult[])
- `src/parser.ts` -- parser delegation to `jsonata` package
- `src/walker.ts` -- recursive AST walker with scope-threaded variable resolution
- `src/scope.ts` -- immutable linked-list scope chain implementation
- `src/types.ts` -- PathResult, Confidence, and all AST node type definitions
- `src/path-builder.ts` -- dot-notation path string builder from AST steps
- `src/builtins.ts` -- built-in function registry and higher-order function semantics
- `README.md` -- current state with empty How It Works and Limitations headings
- `22-CONTEXT.md` -- locked decisions from discussion phase

### Secondary (MEDIUM confidence)
None needed -- all information comes from the project's own source code.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no stack needed, documentation-only phase
- Architecture: HIGH -- all pipeline details verified directly from source code
- Pitfalls: HIGH -- derived from CONTEXT.md constraints and code review

**Research date:** 2026-03-11
**Valid until:** Indefinite -- documents the project's own codebase, not external dependencies
