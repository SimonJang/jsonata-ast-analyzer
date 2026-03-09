# Feature Landscape: README Documentation

**Domain:** Developer documentation for a TypeScript static analysis library
**Researched:** 2026-03-09
**Confidence:** HIGH

## Context

This research covers what documentation sections and content developers expect in a TypeScript library README, specifically for a small, focused static analysis / AST tool like `jsonata-ast-analyzer`. The library is already built (v1.1.2, 294 passing tests, ~1,189 LOC source). The milestone is purely about writing the README.

Evidence was gathered from:
- Direct inspection of READMEs from comparable libraries in the project's own `node_modules`: **acorn** (AST parser), **estree-walker** (AST walker), **magicast** (AST manipulation), **jsonata** (the upstream parser this project depends on)
- Web research on TypeScript library README best practices, npm documentation standards, and README organization patterns
- Azure SDK TypeScript documentation guidelines

## Table Stakes

Features users expect. Missing = README feels incomplete or unprofessional.

| Section | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Project title + one-line description** | First thing every developer reads. Must answer "what is this?" in under 10 words. All surveyed READMEs (acorn, estree-walker, magicast, jsonata) open with this. | Low | Current README just says "Sandbox repository to play around with JSONata" -- must be replaced with the actual purpose. |
| **Installation** | Universal expectation. Every surveyed README includes it. Developers copy-paste install commands. | Low | Single command: `npm install jsonata-ast-analyzer`. Show pnpm/yarn variants since package.json uses pnpm. |
| **Quick start / basic usage example** | The "copy-paste-and-it-works" moment. Acorn shows `acorn.parse("1 + 1", {ecmaVersion: 2020})`. Estree-walker shows a complete walk example. Magicast leads with a full modify-a-file example. Jsonata shows `$sum(example.value)` evaluating to `24`. This is the most important section after the title. | Medium | Must show `extractPaths()` with a real JSONata expression and its output. Should be runnable as-is. |
| **API reference** | TypeScript library users expect to see exported functions and types documented. Azure SDK guidelines mandate TSDoc + TypeDoc. For a library with exactly 1 function and 2 types, inline documentation in the README is sufficient (no need for a separate docs site). | Medium | Document: `extractPaths(expression: string): PathResult[]`, `PathResult` interface shape, `Confidence` type (`"static" | "dynamic" | "partial"`) with explanation of each level. |
| **CLI usage** | The library ships a `bin` entry (`jsonata-paths`). CLI users expect usage examples. Acorn documents its CLI in a dedicated section. | Medium | Document both modes: argument (`jsonata-paths '<expr>'`) and stdin pipe (`echo '<expr>' | jsonata-paths`). Show example output. |
| **TypeScript types** | TypeScript users expect to know what types are exported and how to import them. This is table stakes for any TS-first library. | Low | Show the import statement: `import { extractPaths, type PathResult, type Confidence } from 'jsonata-ast-analyzer'`. Show the `PathResult` interface and `Confidence` type. |
| **License** | Legal requirement. npm docs recommend it. All surveyed READMEs include it. | Low | Already ISC in package.json. Just reference it. |

## Differentiators

Features that set the README apart from minimal docs. Not expected, but signal quality and build trust.

| Section | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Confidence level explanation** | Unique to this library. The `static`/`dynamic`/`partial` confidence system is the library's key differentiator over naive path extraction. A table explaining when each level applies, with examples, helps users understand the output semantics. No comparable library documents confidence/certainty annotations this way. | Medium | Table format works well: confidence level, meaning, example expression, example output. This is the library's intellectual contribution -- document it thoroughly. |
| **Multiple usage examples** | Going beyond a single quick-start example to show common real-world patterns (variable tracing, filter predicates, HOF handling, parent operator). Magicast does this exceptionally well with 5 progressive examples. Acorn is weaker here. | Medium-High | 3-5 examples covering: simple path extraction, variable assignment tracing, dynamic path wildcards, CLI piping. Each should show input expression and full output JSON. |
| **How it works / architecture overview** | Explains the parse-walk-resolve-annotate pipeline. Builds trust that the tool is thoughtfully designed, not a regex hack. Comparable: cppast and magicast both explain their architecture. For a static analysis tool, users want to know the analysis is sound. | Medium | 1-2 paragraphs + a pipeline description. Not a full architecture doc. Mention: uses official jsonata parser, recursive AST walker, variable scope tracing, post-walk confidence derivation. Link the immutable scope chain design and over-approximation principle. |
| **Limitations and design decisions** | Honest documentation of what the tool does NOT do (no runtime evaluation, over-approximation trade-off, dynamic path wildcards). Builds trust. Python's `ast` module documents its limitations explicitly. The jsonata library links to separate docs. For this library, inline limitations are better (small scope). | Medium | Cover: static analysis only (no eval), over-approximation principle, dynamic paths get `[*]` wildcards, parent operator `%` semantics, no caching. Frame as deliberate design choices, not bugs. |
| **Badges** | Visual trust signals at the top. Magicast has npm version, downloads, coverage, license, docs badges. Signal: this project is maintained, tested, and typed. | Low | CI status (GitHub Actions), npm version, license, TypeScript badge. Keep it minimal (4-5 badges max). Not strictly necessary for an unlisted package, but table stakes if publishing to npm. |
| **Table of contents** | Navigation aid for READMEs longer than ~100 lines. Not needed for tiny READMEs (estree-walker skips it at 49 lines) but valuable when multiple sections exist. | Low | Add if the final README exceeds ~80 lines (it will). Use markdown anchor links. |
| **Output format documentation** | Explicitly document the JSON output shape with a concrete example. Developers integrating the output programmatically (e.g., cross-referencing with JSON Schema) need to know the exact shape. | Low | Show a complete JSON output example with multiple paths at different confidence levels. Mention deduplication behavior. |

## Anti-Features

Sections to explicitly NOT include in the README.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Full architecture deep-dive** | README is not the place for a 500-line architecture document. Developers who need internals can read the source (8 files, ~1,189 LOC). Overloading the README makes it unreadable. | Keep architecture to 1-2 paragraphs. If someone wants more, they can read `src/walker.ts` and `src/scope.ts`. |
| **AST node type documentation** | Internal types (`AstNode`, `PathNode`, `WalkScope`, etc.) are implementation details. They are not exported and users never interact with them. | Only document exported types: `PathResult`, `Confidence`. |
| **Changelog / version history** | README should be evergreen. Version-specific changes belong in CHANGELOG.md or GitHub releases. Mixing them creates maintenance burden and clutter. | Reference GitHub releases or a separate CHANGELOG.md if one exists. |
| **Contributing guide** | Premature for a single-maintainer project at v1.x. If needed later, use a separate CONTRIBUTING.md. The jsonata upstream does this correctly. | Omit entirely, or add a single sentence ("Issues and PRs welcome on GitHub"). |
| **Comparison with alternatives** | There are no direct alternatives to compare against (no other "JSONata path extractor" exists). A comparison section would be empty or contrived. | Instead, frame the "How it works" section to implicitly differentiate (static analysis, not runtime tracing). |
| **Browser/CDN usage** | The library uses `node:readline` in CLI, depends on `jsonata` npm package, and is ESM-only. Browser usage is technically possible for the core `extractPaths()` but is not a tested or supported use case. Documenting it creates false expectations. | Omit. If someone asks, the ESM export works in bundlers, but don't promise it. |
| **Badges for unpublished package** | If the package is not published to npm, npm version/download badges would 404 or show nothing. Only add badges for services that are actually active. | Add CI badge (GitHub Actions is active). Skip npm badges until published. Add TypeScript badge (static, always valid). |
| **Roadmap / project status** | The library is feature-complete for its scope. Documenting a roadmap suggests instability or incompleteness. The "Limitations" section covers what it deliberately does not do. | Omit. |
| **Separate docs site** | The API surface is 1 function and 2 types. A docs site (TypeDoc, Docusaurus) would be massive overhead for trivial content. | Keep everything in the README. It will be ~150-250 lines -- well within single-file territory. |

## Feature Dependencies

```
Project title + description → (none, write first)
Installation → (none, independent)
Quick start example → API reference (reader needs to understand output types)
API reference → TypeScript types (types are part of the API)
CLI usage → (none, but logically after API reference)
Confidence level explanation → API reference (explains the Confidence type)
Multiple examples → Quick start (progressive complexity)
How it works → Quick start (reader already saw basic usage)
Limitations → How it works (reader understands what the tool does before learning what it doesn't)
Badges → (none, can be added independently at top)
Table of contents → All sections (generate after all content exists)
Output format → API reference (documents PathResult[] shape in detail)
License → (none, write last)
```

Recommended writing order (respects dependencies, builds progressively):

1. Project title + one-line description
2. Badges (if applicable)
3. Table of contents (placeholder, fill last)
4. Installation
5. Quick start example
6. API reference + TypeScript types + output format
7. Confidence level explanation
8. CLI usage
9. Additional examples
10. How it works
11. Limitations
12. License

## MVP Recommendation

**Minimum viable README** -- the 7 table-stakes sections:

1. **Project title + description** -- replaces the current placeholder
2. **Installation** -- `npm install jsonata-ast-analyzer`
3. **Quick start** -- one `extractPaths()` call with output
4. **API reference** -- `extractPaths()`, `PathResult`, `Confidence`
5. **CLI usage** -- both argument and stdin modes
6. **TypeScript types** -- import statement + type shapes
7. **License** -- ISC reference

**Strongly recommended additions** (high value, moderate effort):

8. **Confidence level explanation** -- this is the library's unique value; without explaining it, users won't understand the output
9. **Multiple examples** -- at least 3 covering simple, variable, and dynamic cases
10. **Limitations** -- sets correct expectations; prevents issue reports for intentional behavior

**Defer:**

- **Badges**: Only add after npm publish (CI badge can be added immediately if GitHub repo is public)
- **Table of contents**: Add only if final README exceeds ~100 lines
- **How it works**: Nice to have but not blocking. Can be a short paragraph initially.
- **Output format section**: Can be folded into API reference rather than standalone

## Section Content Guidance

### Project Title + Description

Pattern from surveyed libraries:
- acorn: "A tiny, fast JavaScript parser written in JavaScript."
- estree-walker: "Simple utility for walking an ESTree-compliant AST"
- magicast: "Programmatically modify JavaScript and TypeScript source codes with a simplified, elegant and familiar syntax."

Recommended for this project:
> Static analysis of JSONata expressions to extract all data paths read from the input object, with confidence annotations.

Key attributes to communicate: **static analysis** (not runtime), **JSONata** (domain), **data paths** (what it extracts), **confidence annotations** (unique value).

### Quick Start Example

Must show the complete flow: expression in, structured output out. Based on magicast and jsonata patterns, show a realistic expression, not a trivial one.

Good example candidate: `Account.Order.Product.Price` is too simple. Better: an expression with variable assignment that shows the tracing capability, e.g., `$x := Account.Order; $x.Product.Price` which produces paths at different points in the expression.

### API Reference

For a 1-function API, inline documentation beats a docs site. Show:
1. Function signature with JSDoc-style description
2. Parameters (just `expression: string`)
3. Return type (`PathResult[]`)
4. The `PathResult` interface shape as a TypeScript code block
5. The `Confidence` type with each variant explained
6. Error behavior (throws on invalid JSONata -- parser error propagates)

### Confidence Level Explanation

This deserves its own subsection because it is the library's distinguishing feature. A table works best:

| Confidence | Meaning | When it occurs | Example |
|------------|---------|----------------|---------|
| `"static"` | Path is fully known at analysis time | Simple field access, wildcards, descendant | `Account.Name` |
| `"dynamic"` | Path contains a computed segment | Filter with unresolvable variable, computed property | `items[*].name` |
| `"partial"` | Path crosses a parent operator boundary | `%` segment in path | `items.%.date` |

### CLI Usage

Two modes, matching the source code:
1. Argument mode: `jsonata-paths 'Account.Order.Product.Price'`
2. Stdin mode: `echo 'Account.Order.Product.Price' | jsonata-paths`

Output is JSON to stdout. Errors go to stderr with exit code 1.

### Limitations

Frame as design decisions, not deficiencies:
1. **Static analysis only** -- does not evaluate expressions or inspect runtime data
2. **Over-approximation** -- reports a superset of actual paths (prefers false positives over missed paths)
3. **Dynamic paths** -- computed property names become `[*]` wildcards (cannot be statically resolved)
4. **Parent operator** -- `%` segments represent cross-scope references (analysis is approximate)
5. **No caching** -- JSONata expressions are typically short; caching would be premature optimization
6. **ESM only** -- no CommonJS export (deliberate: modern Node.js)

## Evidence from Comparable Libraries

### acorn (AST parser, ~3.7M weekly downloads)
- **Structure:** Title, Community, Installation, Importing, Interface (main API), Options (exhaustive list), Command Line, Plugins
- **Strengths:** Exhaustive option documentation, error behavior documented, CLI section
- **Weaknesses:** No quick-start example at the top, no "how it works" section, jumps straight to API reference
- **Takeaway:** API reference thoroughness matters. But lead with an example, unlike acorn.

### estree-walker (AST walker, ~19M weekly downloads)
- **Structure:** Title + one-liner, Installation, Usage (single example), "Why not estraverse?", License
- **Strengths:** Brutally concise. The single usage example tells you everything. "Why not X?" section differentiates.
- **Weaknesses:** No TypeScript types documented, no API reference beyond the example, no error handling docs
- **Takeaway:** For a small library, one great example can carry the README. But TypeScript users need type information.

### magicast (AST manipulation, ~2.3M weekly downloads)
- **Structure:** Title + badges + description, bullet-point features, Install, 5 progressive Examples, Notes/caveats, Browser support, High-level helpers, Development, License
- **Strengths:** Best example progression of all surveyed. Each example builds on the previous. Notes section is honest about limitations. Badge row looks professional.
- **Weaknesses:** No formal API reference (relies entirely on examples). No TypeScript type documentation.
- **Takeaway:** Progressive examples are extremely effective. Lead with simple, escalate to complex.

### jsonata (upstream parser, ~640K weekly downloads)
- **Structure:** Title + description, links (video, docs, playground), Installation, Quick start (Node.js + browser), More information links, Contributing
- **Strengths:** Quick start is excellent -- shows complete input/output. Links to external docs/playground.
- **Weaknesses:** README is thin -- defers most documentation to external site. No API reference in README.
- **Takeaway:** The quick-start pattern (show input data, expression, result) works perfectly for JSONata-related tools. Adapt this for path extraction output.

## Sources

- Acorn README: inspected directly from `node_modules/.pnpm/acorn@8.16.0/` (HIGH confidence)
- estree-walker README: inspected directly from `node_modules/.pnpm/estree-walker@3.0.3/` (HIGH confidence)
- magicast README: inspected directly from `node_modules/.pnpm/magicast@0.5.2/` (HIGH confidence)
- jsonata README: inspected directly from `node_modules/.pnpm/jsonata@2.1.0/` (HIGH confidence)
- [Azure SDK TypeScript Documentation Guidelines](https://azure.github.io/azure-sdk/typescript_documentation.html) (MEDIUM confidence)
- [Gleb Bahmutov: How I Organize README](https://glebbahmutov.com/blog/how-i-organize-readme/) (MEDIUM confidence)
- [Archbee: 15 Elements to Include in Your README](https://www.archbee.com/blog/readme-document-elements) (MEDIUM confidence)
- [Snyk: Best Practices for Modern npm Packages](https://snyk.io/blog/best-practices-create-modern-npm-package/) (MEDIUM confidence)
- [npm Docs: About Package README Files](https://docs.npmjs.com/about-package-readme-files/) (HIGH confidence)
