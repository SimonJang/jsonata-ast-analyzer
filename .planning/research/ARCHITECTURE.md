# Architecture Research: README "How It Works" Section

**Domain:** README documentation for AST analysis library
**Researched:** 2026-03-09
**Confidence:** HIGH

## The Question

How should the README's "How it works" section be structured? What level of architectural detail is appropriate for a README versus separate docs? How do similar tools present their internals?

## How Similar Tools Present Architecture

### Pattern 1: README = Pipeline One-Liner, Separate Architecture Doc (ESLint, esbuild, SWC)

**ESLint** keeps its README focused on what-it-does and how-to-use-it. Architecture lives at `eslint.org/docs/latest/contribute/architecture/` as a contributor-facing doc. The README mentions zero architecture.

**esbuild** keeps its README as a marketing/installation page. Architecture lives in `docs/architecture.md` -- a deep-dive contributor doc covering parsing, linking, and code generation phases with performance rationale. The README says nothing about how it works.

**SWC** follows the same pattern: README is installation + benchmark comparisons. Architecture docs are on the website and in DeepWiki.

**Relevance to this project:** LOW. These are large projects with dedicated documentation sites. A small single-purpose library does not need that separation -- its README IS its documentation.

### Pattern 2: README Has a Short "How It Works" Section (jscodeshift, dependency-cruiser, madge)

**jscodeshift** includes a brief conceptual section explaining it has "a runner" (for CLI) and "a wrapper around recast" (for API). No diagram. Just 2-3 paragraphs explaining the two-part architecture.

**dependency-cruiser** has a "How it works" section in its README: a one-paragraph explanation followed by a list of what it analyzes. The npm page IS the documentation.

**madge** keeps it to one sentence: uses `dependency-tree` under the hood to extract dependencies.

**Relevance to this project:** HIGH. This is the correct pattern for a focused library. Users want to understand the mental model in 30 seconds, not read a contributor guide.

### Pattern 3: Pipeline Diagram in README (Babel)

**Babel** presents its core pipeline as a one-liner in documentation:

```
input string -> @babel/parser -> AST -> transformer[s] -> AST -> @babel/generator -> output string
```

This single line communicates the entire architecture. Babel's README itself is minimal (monorepo overview), but the pipeline one-liner appears everywhere in their ecosystem docs.

**Relevance to this project:** HIGH. This project's pipeline is structurally identical: `expression string -> parser -> AST -> walker -> raw paths -> dedup + confidence -> PathResult[]`. A single pipeline diagram communicates the full architecture.

## Recommended Architecture: "How It Works" Section Structure

### What to Include in the README

Based on research, the README "How it works" section should contain exactly three elements:

1. **A pipeline diagram** -- ASCII art, not Mermaid (see Diagram Format below)
2. **One paragraph explaining the pipeline** -- what each stage does, in plain English
3. **A confidence classification table** -- explains the three confidence levels since they are part of the output contract

Total length: 15-25 lines. No more.

### What to Exclude from the README

- Internal function names (`walkNode`, `walkPath`, `walkFilterStages`, etc.)
- Scope chain implementation details (immutable linked list of Maps)
- How variable tracing works
- How higher-order function parameter binding works
- AST node type details
- The discriminated union type system

**Rationale (from matklad's ARCHITECTURE.md guidance):** "Keep it short: every recurring contributor will have to read it." For a README, the bar is even higher -- every potential USER reads it. Internal details belong in JSDoc comments on the source code (which this project already has, extensively).

### Component Responsibilities

| Component | README Visibility | Why |
|-----------|-------------------|-----|
| `extractPaths()` | YES -- it is the public API | Users call this function |
| `parse()` adapter | YES -- as "uses official JSONata parser" | Users need to know it delegates to the real parser |
| AST walker | YES -- as "walks the AST recursively" | Conceptual understanding, not implementation detail |
| `buildPathString()` | NO | Internal implementation detail |
| `deriveConfidence()` | YES -- as the confidence table | Users consume confidence levels |
| `ScopeTracker` | NO | Internal implementation detail |
| `walkFilterStages` etc. | NO | Internal implementation detail |
| `builtins.ts` | NO | Internal implementation detail |
| CLI wrapper | Separate section, not in "How it works" | Already covered by CLI usage section |

## Recommended Pipeline Diagram

### ASCII Art (Recommended)

```
Expression string
       |
       v
  JSONata parser (official)
       |
       v
  Abstract Syntax Tree
       |
       v
  Recursive AST walker
  - Extracts field access paths
  - Traces variable assignments
  - Resolves function arguments
       |
       v
  Deduplication
       |
       v
  Confidence classification
  (static / dynamic / partial)
       |
       v
  PathResult[]
```

**Why ASCII over Mermaid:** npm does NOT render Mermaid diagrams. GitHub does, but npmjs.com shows raw code blocks. Since many developers discover packages via npm, ASCII art is the universally portable choice. ESLint, Babel, and most npm libraries use ASCII or plain text for their README diagrams.

**Confidence:** HIGH -- verified that npmjs.com does not support Mermaid rendering.

### Alternative: Inline Text Pipeline

For an even more compact presentation:

```
Expression  -->  JSONata Parser  -->  AST  -->  Walker  -->  Dedup  -->  Classify  -->  PathResult[]
```

This Babel-style one-liner could precede the expanded diagram or replace it for maximum brevity.

## Recommended Prose Structure

### Section: "How It Works"

**Paragraph 1 -- The pipeline (3-4 sentences):**
Explain that `extractPaths()` parses the expression into an AST using the official JSONata parser, then recursively walks the AST to collect every data path the expression reads from the input object. Variable assignments are traced back to their source paths. Higher-order functions like `$map` and `$filter` are understood -- their lambda parameters are bound to the correct data paths.

**Paragraph 2 -- Confidence levels (2-3 sentences):**
Explain that each path is classified with a confidence level. Static paths are fully resolved at analysis time. Dynamic paths contain `[*]` where a computed property could not be statically determined. Partial paths contain `%` from the parent operator.

**Table -- Confidence levels:**

| Confidence | Meaning | Example |
|-----------|---------|---------|
| `static` | Fully resolved at analysis time | `orders.items.price` |
| `dynamic` | Contains unresolvable computed access | `data[*].value` |
| `partial` | Contains parent operator reference | `items.%.date` |

**Paragraph 3 -- Design philosophy (1-2 sentences):**
Explain the over-approximation principle: the analyzer reports a superset of paths rather than risking missed dependencies. If in doubt, a path is included.

### What NOT to Write

Do not write a "Component Architecture" sub-section with module descriptions. Do not describe the walker's dispatch mechanism. Do not explain the scope chain. These are implementation details that change between versions and have no bearing on how users consume the library.

The JSDoc comments in the source files already serve as the contributor/architecture documentation. The README should not duplicate them.

## Architectural Patterns

### Pattern: Pipeline Explanation at the Right Abstraction Level

**What:** Present the analysis as a pipeline of conceptual stages, not code-level functions.

**Good example:**
> "The expression is parsed into an AST, then walked recursively to extract every data path."

**Bad example:**
> "The `parse()` function calls `jsonata(expression).ast()` to produce an `AstNode`, which is passed to `walkNode()` that dispatches on `node.type` via a switch statement across 17 node types."

The good example communicates the same information without coupling the README to implementation details.

### Pattern: Confidence as Output Contract

**What:** Present confidence levels as part of the API contract, not as an implementation detail. Users need to understand what `static`, `dynamic`, and `partial` mean to consume the output correctly.

**This belongs in the README** because it affects how users write code against the library's output. A user filtering for `confidence === "static"` needs to know what that means.

### Pattern: Design Decision as One-Liner

**What:** State the over-approximation principle concisely. This single sentence explains why users might see paths they did not expect, preempting confusion.

**Good example:**
> "The analyzer over-approximates: it reports a superset of actual paths rather than risk missing any."

This does not need a sub-section, a table of trade-offs, or a philosophical justification. One sentence.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Source Code Map in README

**What people do:** List every source file with its purpose (parser.ts, walker.ts, scope.ts, etc.)
**Why it's wrong for a README:** Users consuming the library via npm never see source files. This is contributor documentation, and it goes stale as files are renamed or refactored. The JSDoc comments in each file already serve this purpose.
**Do this instead:** If contributor docs are needed later, create a separate CONTRIBUTING.md or ARCHITECTURE.md in the repo root.

### Anti-Pattern 2: Mermaid-Only Diagrams

**What people do:** Use Mermaid flowcharts for the pipeline diagram.
**Why it's wrong:** npm does not render Mermaid. The diagram appears as raw code to npm users.
**Do this instead:** Use ASCII art. It renders identically on GitHub, npm, and in terminals.

### Anti-Pattern 3: Exhaustive AST Node Type Documentation

**What people do:** Document every AST node type the walker handles.
**Why it's wrong:** Users pass expression strings and receive `PathResult[]`. They never interact with the AST. Documenting 20+ node types in the README overwhelms readers with irrelevant information.
**Do this instead:** Say "supports the full JSONata language" and link to the JSONata docs for the language reference.

### Anti-Pattern 4: Separate "Architecture" and "How It Works" Sections

**What people do:** Create both a user-facing "How it works" and a developer-facing "Architecture" section in the README.
**Why it's wrong for this project:** With 1,189 lines of source code across 7 files, the architecture IS simple. Two sections about it doubles the maintenance burden and confuses readers about which one to read.
**Do this instead:** One "How it works" section that conveys the mental model. Developers who want more depth can read the well-commented source.

## Integration Points

### New Content vs Modified Content

| Section | Status | Notes |
|---------|--------|-------|
| "How it works" | NEW | Does not exist in current README |
| Pipeline diagram | NEW | ASCII art, goes inside "How it works" |
| Confidence table | NEW | Goes inside "How it works" |
| Current README | REPLACE | Current README is a single placeholder line |

### Relationship to Other README Sections

The "How it works" section should appear AFTER usage examples and BEFORE limitations. The ordering rationale:

1. Users want to know **what it does** (overview) -- first
2. Users want to know **how to use it** (install, API, CLI, examples) -- second
3. Users who are still reading want to understand **how it works** -- third
4. Users evaluating fit want to know **limitations** -- fourth

This follows the progressive disclosure pattern: most users stop after usage examples. Only those evaluating the tool deeply continue to "How it works."

### Section Ordering Evidence

ESLint's README: prerequisites -> installation -> configuration -> usage.
jscodeshift's README: overview -> installation -> usage -> how it works.
dependency-cruiser's README: what -> install -> usage -> how it works -> options.

The consistent pattern across tools: usage before architecture. "How it works" is for readers who already decided to use the tool and want to understand it, or who are evaluating it for trustworthiness.

## Sources

- [ESLint Architecture Documentation](https://eslint.org/docs/latest/contribute/architecture/) -- separate contributor doc, not in README
- [ESLint README](https://github.com/eslint/eslint/blob/main/README.md) -- no architecture section
- [Babel README](https://github.com/babel/babel/blob/main/README.md) -- monorepo overview, pipeline one-liner in docs
- [esbuild architecture.md](https://github.com/evanw/esbuild/blob/main/docs/architecture.md) -- separate deep-dive contributor doc
- [jscodeshift README](https://github.com/facebook/jscodeshift/blob/main/README.md) -- brief "how it works" in README
- [dependency-cruiser README](https://github.com/sverweij/dependency-cruiser) -- "how it works" section in README
- [matklad ARCHITECTURE.md guidance](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html) -- "map of a country, not an atlas"
- [GitHub Mermaid support](https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/) -- GitHub renders Mermaid, npm does not
- [GitHub Creating Diagrams docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) -- official GitHub diagram support reference
- Direct source code analysis of all 7 source files in `src/`
- Confidence: HIGH -- all recommendations based on verified patterns from established tools and confirmed platform rendering capabilities

---
*Architecture research for: README "How It Works" documentation structure*
*Researched: 2026-03-09*
