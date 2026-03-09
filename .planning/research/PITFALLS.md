# Pitfalls Research

**Domain:** README documentation for an existing TypeScript/Node static analysis library
**Researched:** 2026-03-09
**Confidence:** HIGH (based on direct codebase analysis, established documentation best practices, and domain-specific knowledge of TypeScript library publishing)

## Critical Pitfalls

### Pitfall 1: Documenting What It Is Instead of What It Does For You

**What goes wrong:**
The README opens with implementation details -- "parses JSONata ASTs using a recursive walker with scope tracking" -- instead of answering the user's actual question: "What problem does this solve and should I use it?" Developers scanning npm or GitHub decide within 10 seconds whether to keep reading. An implementation-focused opening loses them immediately because they do not yet care HOW it works; they care IF it helps.

**Why it happens:**
Library authors are deep in the code. They think about the project in terms of its architecture (walker, scope chain, AST nodes). They write the README from their own perspective, not from the perspective of someone encountering the library for the first time. The curse of knowledge makes "recursive AST walker" feel like a clear description when it is actually jargon.

**How to avoid:**
Open with a one-sentence value proposition: "Given a JSONata expression, extract every data path it reads from the input object." Follow with a concrete before/after example showing input expression and output paths. Save architecture discussion for a "How It Works" section much further down. The first code example should be copy-pasteable and produce visible output within 30 seconds.

**Warning signs:**
- The first paragraph mentions AST, walker, scope, or parser.
- No code example appears above the fold (within the first screenful).
- The README reads like a design document rather than a user guide.

**Phase to address:** Phase 1 (Overview section). The opening paragraph and first example must be written from the user's perspective.

---

### Pitfall 2: Code Examples That Cannot Be Copy-Pasted

**What goes wrong:**
Code examples use incomplete snippets, omit import statements, reference variables defined elsewhere, or produce output the reader cannot verify. The developer copies the example, pastes it into a file, runs it, and gets an error. Trust is destroyed. They close the tab.

For this specific library, the risk is high because:
1. It is ESM-only (`"type": "module"` in package.json). A developer using CommonJS will get `ERR_REQUIRE_ESM` if the example uses `require()`, or if the example uses `import` but does not mention the ESM requirement.
2. The main API is a single function (`extractPaths`), so the example is short -- but if the import path is wrong or the expression string is malformed, it fails silently or throws a parser error with no guidance.
3. The CLI uses `$` characters in JSONata expressions, which shells interpret as variable expansion. `jsonata-paths 'Account.$sum(Order.Product.Price)'` will silently mangle the expression in bash unless the user knows to use single quotes.

**Why it happens:**
Examples are written in the README editor (or directly in markdown) without being executed. The author knows the import path, the module format, and the shell quoting rules, so they do not notice the gaps. Examples that worked during development may drift from the actual published API if the entry point changes.

**How to avoid:**
- Every code example must include the full import statement: `import { extractPaths } from "jsonata-ast-analyzer";`
- Every code example must show the expected output as a comment or `console.log` result.
- The CLI section must explicitly show single-quoted expressions and explain why (shell `$` expansion).
- Mark the ESM-only requirement prominently, before the first code example. State: "This package is ESM-only. Use `import`, not `require()`."
- Verify every code example actually runs by testing them against the built package. Ideally, add a `test:examples` script that executes the README examples.

**Warning signs:**
- Code blocks lack import statements.
- Examples show `const { extractPaths } = require(...)`.
- CLI examples use double quotes around expressions containing `$`.
- No expected output is shown alongside examples.

**Phase to address:** Phase 2 (API Examples) and Phase 3 (CLI Usage). Every example must be verified runnable.

---

### Pitfall 3: Undocumented Confidence Semantics Cause Misinterpretation

**What goes wrong:**
The library returns `PathResult` objects with a `confidence` field: `"static"`, `"dynamic"`, or `"partial"`. If the README does not explain what these mean and when each occurs, users will misinterpret them. Common misinterpretations:

- **"static" means guaranteed correct** -- No. "Static" means the path was fully resolvable at analysis time. The path may still be wrong if the JSONata expression has a logic error.
- **"dynamic" means unreliable** -- No. "Dynamic" means a bracket-wildcard `[*]` was injected because a computed property could not be statically resolved. The path structure is correct; only the specific array index or property name is unknown.
- **"partial" means broken** -- No. "Partial" means a parent operator `%` appears as a segment. The path is structurally valid but requires the consumer to resolve the parent context.

Without clear documentation, users will filter out "dynamic" and "partial" paths, losing coverage. Or they will treat all paths equally, failing to handle wildcards in downstream schema validation.

**Why it happens:**
The confidence system is a design decision specific to this library. There is no industry standard for "confidence levels in static path analysis." Users cannot guess the semantics from the names alone. The type definition (`type Confidence = "static" | "dynamic" | "partial"`) tells them the possible values but not what each means or what to do with each.

**How to avoid:**
Create a dedicated "Confidence Levels" section with:
1. A table mapping each level to its meaning, cause, and recommended handling.
2. A concrete example for each level showing the JSONata expression, the resulting path, and its confidence.
3. An explicit statement of the over-approximation principle: "The analyzer reports a superset of actual paths. It prefers false positives over missed paths."

**Warning signs:**
- The `PathResult` type is shown but `Confidence` values are not individually explained.
- Examples only show `"static"` confidence outputs.
- The over-approximation design philosophy is not mentioned.

**Phase to address:** Phase 2 (API Reference). Confidence semantics must be a first-class section, not a footnote.

---

### Pitfall 4: Missing Limitations Section Causes False Expectations

**What goes wrong:**
Without explicit documentation of what the analyzer CANNOT do, users assume it handles everything. They feed in an expression that uses computed property names (`obj[someVar]`) and expect a concrete path. They get a wildcard path and file a bug. Or they expect the analyzer to tell them which paths are actually taken at runtime and are confused when both branches of a conditional appear.

This library has specific, well-understood limitations:
- Static analysis only -- no runtime evaluation.
- Computed property names become `[*]` wildcards.
- Parent operator `%` paths are structural, not resolved.
- Over-approximation means both branches of conditionals are reported.
- Platform-specific functions (non-standard JSONata extensions) are treated as opaque.

**Why it happens:**
Authors fear that documenting limitations will scare users away. In reality, the opposite is true: users trust libraries that are honest about boundaries. Undocumented limitations become bug reports; documented limitations become accepted tradeoffs.

**How to avoid:**
Include a "Limitations" or "Design Decisions" section that explicitly states:
1. What the analyzer intentionally does NOT do (and why).
2. What produces wildcard or partial confidence results.
3. The over-approximation guarantee (superset, not exact set).
4. What is out of scope (expression evaluation, schema validation, runtime type inference).

Reference the "Out of Scope" list from PROJECT.md -- it is already well-defined.

**Warning signs:**
- No "Limitations" section exists.
- Bug reports ask "Why does it report path X when the condition is never true?"
- Users try to use it as an expression evaluator.

**Phase to address:** Phase 4 (Limitations section). Should come after examples so users understand what it DOES before learning what it does NOT.

---

### Pitfall 5: API Reference Without Type Context

**What goes wrong:**
The README shows `extractPaths(expression)` but does not show the full TypeScript signatures, the `PathResult` interface shape, or the `Confidence` union type. Users working in TypeScript get the types from their editor, but users working in JavaScript -- or evaluating the library before installing -- have no way to understand the API shape from the README alone.

Worse, if the README shows a partial type (e.g., `{ path: string, confidence: string }`) instead of the actual type (`{ path: string, confidence: "static" | "dynamic" | "partial" }`), JavaScript users lose the constraint information entirely.

**Why it happens:**
TypeScript library authors assume all consumers use TypeScript and will get type information from the IDE. But the README serves multiple audiences: TypeScript users, JavaScript users, evaluators who have not installed the package, and AI agents parsing documentation. The README must be self-contained for the API surface.

**How to avoid:**
Include the full public type definitions in the API Reference section:
```typescript
function extractPaths(expression: string): PathResult[]

interface PathResult {
  path: string;
  confidence: Confidence;
}

type Confidence = "static" | "dynamic" | "partial";
```
Show these types explicitly. They are small (the entire public API is one function and two types), so there is no excuse for omitting them.

**Warning signs:**
- `extractPaths` is shown without its return type.
- `PathResult` is mentioned but not defined.
- Type definitions are only shown as links to source files.

**Phase to address:** Phase 2 (API Reference). Types must appear inline in the README, not just in source files.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoding version numbers in examples | Looks current today | Stale after next release, misleads users | Never -- use `npm install jsonata-ast-analyzer` without version pins |
| Omitting the ESM-only notice | Shorter README, less "noise" | ERR_REQUIRE_ESM bug reports, confused CommonJS users | Never -- must be stated prominently |
| Documenting internal functions (walkNode, buildPathString) | Feels thorough | Creates implicit API contract for internals, users couple to implementation | Never in README -- save for CONTRIBUTING.md if needed |
| Using generated output as examples without verification | Fast to write | Output format changes silently break trust | Only for initial draft; must verify before publishing |
| Skipping the "How It Works" section | Faster to ship | Users cannot debug unexpected results, cannot contribute fixes | Acceptable for v1 if time-constrained, but should be added promptly |
| Screenshots instead of text for code examples | Visually appealing | Not searchable, not copy-pasteable, not accessible, cannot be tested | Never for code examples |

## Integration Gotchas

Common mistakes when users integrate this library into their projects.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| CommonJS projects | `require("jsonata-ast-analyzer")` fails with ERR_REQUIRE_ESM | Use dynamic `import()` or migrate to ESM. Document this explicitly. |
| Shell usage (CLI) | Double-quoting expressions: `jsonata-paths "$sum(prices)"` -- shell expands `$sum` | Always single-quote: `jsonata-paths '$sum(prices)'`. Document the quoting rule. |
| CI pipelines | Piping multi-line expressions without handling newlines | Show the stdin pipe pattern: `echo 'expression' \| jsonata-paths`. Document both CLI modes. |
| Schema validation downstream | Treating all paths as equal regardless of confidence | Document that `dynamic` paths contain `[*]` wildcards that need glob-matching against schema paths |
| Bundlers (webpack, esbuild) | Tree-shaking removes the CLI entry point | The `bin` field points to `dist/cli.js`; this is a runtime concern, not a bundle concern. Clarify that CLI is for direct Node.js usage. |

## UX Pitfalls

Common user experience mistakes in developer documentation.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Wall of text before first example | Users leave without understanding what it does | Show input/output example within the first 10 lines of the README |
| Table of contents that is longer than the content | Adds scroll depth, feels bureaucratic | Keep TOC to top-level sections only (6-8 items max) |
| Architecture section before usage section | Users who just want to use it must scroll past internals | Order: Install > Quick Start > API > CLI > How It Works > Limitations |
| Badges overload (20+ badges at top) | Visual noise, none are actionable for the reader | Use 3-5 badges max: npm version, license, CI status, Node version |
| Changelog in the README | Grows unboundedly, pushes useful content down | Link to CHANGELOG.md or GitHub releases instead |
| "See tests for more examples" | Makes tests the documentation, shifts burden to the user | Extract the best test cases AS documentation examples. Tests are verification, not documentation. |
| Unexplained jargon (AST, HOF, scope chain) | Non-specialist users cannot follow | Define terms on first use or avoid them in user-facing sections |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Install section:** Often missing Node.js version requirement -- verify `node >= 20` is stated (per CI matrix)
- [ ] **Install section:** Often missing package manager note -- verify `pnpm` is mentioned as the project's package manager, but `npm`/`yarn` work for consumers
- [ ] **ESM notice:** Often buried in a footnote -- verify it appears BEFORE the first code example
- [ ] **CLI section:** Often missing the shell quoting warning -- verify single-quote examples for `$` expressions
- [ ] **CLI section:** Often missing stdin mode documentation -- verify both `jsonata-paths 'expr'` and `echo 'expr' | jsonata-paths` are shown
- [ ] **API examples:** Often show only simple paths -- verify at least one example with variables, one with filters, one with HOF
- [ ] **Confidence table:** Often lists values without explaining what to DO with each -- verify actionable guidance per level
- [ ] **Error handling:** Often undocumented -- verify what happens when an invalid expression is passed (parser error propagates)
- [ ] **Limitations:** Often omitted entirely -- verify the section exists and covers static-only analysis, wildcard behavior, over-approximation
- [ ] **License:** Often missing from README body -- verify ISC license is stated or linked
- [ ] **TypeScript types:** Often described but not shown -- verify `PathResult` and `Confidence` types appear as code blocks

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Examples that do not run | LOW | Run each example against the built package, fix import paths and output |
| Missing ESM notice causes bug reports | LOW | Add the notice, respond to issues with a link to the section |
| Confidence levels misunderstood | LOW | Add the confidence explanation table, update examples to show all three levels |
| Limitations not documented (bug reports for expected behavior) | MEDIUM | Write the limitations section, close issues as "by design" with link |
| Internal API documented as public | MEDIUM | Remove internal docs, add note that only `extractPaths` is the public API, consider semver implications if users coupled to internals |
| README examples drift from actual API after refactor | MEDIUM | Add a `test:readme` script that extracts and runs code blocks; prevents future drift |
| Jargon-heavy README deters non-specialist users | LOW | Rewrite opening sections for a general audience, move specialist content to architecture section |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Implementation-focused opening (Pitfall 1) | Overview / first section | First paragraph answers "what does this solve?" not "how is it built?" |
| Non-runnable examples (Pitfall 2) | API + CLI examples | Every code block tested against built package |
| Undocumented confidence semantics (Pitfall 3) | API Reference section | Table with all three confidence levels, example for each |
| Missing limitations (Pitfall 4) | Limitations section | Section exists, covers 5+ explicit limitations |
| API types not shown (Pitfall 5) | API Reference section | `extractPaths` signature, `PathResult`, `Confidence` all shown as code blocks |
| ESM-only not stated | Install section | Notice appears before first code example |
| Shell quoting not warned | CLI section | Examples use single quotes, explanation of why |
| Examples only show happy path | API examples | At least one variable, one filter, one HOF, one error case |
| "See tests for examples" | API examples | README is self-contained; tests are not referenced as primary docs |
| No architecture overview | How It Works section | Brief description of parse-walk-resolve pipeline for users debugging unexpected output |

## Sources

- [npm docs: About package README files](https://docs.npmjs.com/about-package-readme-files/) -- Official npm guidance on README content
- [The importance of the README: What I look for in a library](https://blog.sethcorker.com/importance-of-the-readme/) -- Developer perspective on README evaluation
- [10 Common Developer Documentation Mistakes to Avoid](https://document360.com/blog/developer-documentation-mistakes/) -- Documentation anti-patterns
- [Essential Sections for Better Documentation of a README Project](https://www.welcometothejungle.com/en/articles/btc-readme-documentation-best-practices) -- Section ordering and content guidelines
- [Google READMEs Style Guide](https://google.github.io/styleguide/docguide/READMEs.html) -- Code example standards, up-to-date maintenance
- [sindresorhus/pure-esm-package](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c) -- ESM-only package documentation patterns
- [Documentation 101: creating a good README](https://dev.to/erikaheidi/documentation-101-creating-a-good-readme-for-your-software-project-cf8) -- README structure and audience awareness
- [Azure SDK TypeScript Documentation Guidelines](https://azure.github.io/azure-sdk/typescript_documentation.html) -- TypeScript library documentation standards
- [Tutorial: publishing ESM-based npm packages with TypeScript](https://2ality.com/2025/02/typescript-esm-packages.html) -- ESM package documentation requirements
- Direct codebase analysis: `src/index.ts`, `src/types.ts`, `src/cli.ts`, `package.json`, `tsconfig.json` -- HIGH confidence

---
*Pitfalls research for: v1.1.3 README Documentation milestone*
*Researched: 2026-03-09*
