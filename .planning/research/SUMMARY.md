# Project Research Summary

**Project:** jsonata-ast-analyzer v1.1.3 README Documentation
**Domain:** Developer documentation for a TypeScript static analysis library
**Researched:** 2026-03-09
**Confidence:** HIGH

## Executive Summary

This milestone is a documentation task, not a code task. The library (jsonata-ast-analyzer) is already built: v1.1.2, 294 passing tests, ~1,189 LOC, with a single exported function (`extractPaths`), two types (`PathResult`, `Confidence`), and a CLI binary (`jsonata-paths`). The current README is a placeholder ("Sandbox repository to play around with JSONata") that must be replaced with a professional, adoption-oriented README. Research across comparable TypeScript libraries (acorn, estree-walker, magicast, ky, p-queue, taze) shows a clear consensus: the README should lead with a value proposition and a copy-pasteable example, not implementation details. The API surface is small enough that everything belongs in a single README file -- no docs site, no TypeDoc, no generated documentation.

The recommended approach is hand-written GitHub Flavored Markdown following the proven section order: title, badges, quick example, TOC, installation, API reference, CLI usage, deeper examples, how it works, limitations, license. The critical insight from research is that the quick example must appear before installation -- developers evaluate whether a library is worth installing before they look at install commands. The "How it works" section should use a Babel-style ASCII pipeline diagram (not Mermaid, which npm cannot render) and stay under 25 lines. The confidence level system (`static`/`dynamic`/`partial`) is the library's unique differentiator and must be thoroughly documented with a dedicated table and per-level examples.

The primary risks are: (1) writing an implementation-focused README that leads with jargon instead of user value, (2) code examples that cannot be copy-pasted due to missing imports, ESM-only issues, or shell quoting problems with `$` in JSONata expressions, and (3) leaving the confidence semantics undocumented, which will cause users to misinterpret output. All three are preventable with disciplined writing order and example verification.

## Key Findings

### Recommended Stack

No runtime dependencies are needed for this milestone. The "stack" is the tooling and conventions for producing the README itself.

**Core technologies:**
- **Hand-written Markdown (GFM):** The API surface is 1 function and 2 types -- generated documentation (TypeDoc, ts-readme) adds complexity without value
- **Shields.io badges:** De facto standard for open-source trust signals; use for CI status, TypeScript, Node.js version, ESM-only, and license
- **GitHub Actions native badge:** First-party CI status badge, more reliable than Shields.io for workflow status
- **ASCII diagrams over Mermaid:** npm does not render Mermaid; ASCII is universally portable across GitHub, npm, and terminals

**Do not use:** TypeDoc, documentation site generators (Docusaurus/VitePress), npm version/download badges (package is not published yet), Mermaid diagrams.

### Expected Features

**Must have (table stakes):**
- Project title + one-line description (replaces current placeholder)
- Installation with ESM-only notice prominently placed
- Quick start example showing `extractPaths()` with input and output
- API reference with full TypeScript signatures (`extractPaths`, `PathResult`, `Confidence`)
- CLI usage documenting both argument mode and stdin pipe mode
- License reference (ISC)

**Should have (differentiators):**
- Confidence level explanation table -- this is the library's unique intellectual contribution; without it, users cannot correctly interpret output
- Multiple progressive examples (3-5: simple path, variable tracing, dynamic wildcards, CLI piping)
- "How it works" section with ASCII pipeline diagram (under 25 lines)
- Limitations section framing design decisions, not deficiencies
- Badges (CI, TypeScript, Node.js, ESM-only, license)
- Table of contents (final README will be 150-250 lines)

**Defer (v2+):**
- npm version/download badges (add after npm publish)
- Separate documentation site
- Contributing guide
- Changelog in README
- Output format as standalone section (fold into API reference)

### Architecture Approach

The README's "How it works" section should follow the Pattern 2 model from research (jscodeshift, dependency-cruiser): a short section with a pipeline diagram and 2-3 paragraphs, positioned after usage examples and before limitations. The pipeline is: `expression string -> JSONata parser -> AST -> recursive walker -> deduplication -> confidence classification -> PathResult[]`. Present this as a Babel-style ASCII diagram. Exclude all internal details (walker dispatch, scope chain implementation, AST node types). The confidence levels are part of the output contract and belong in the README; the scope chain is an implementation detail and does not.

**Content components:**
1. **Pipeline diagram** (ASCII art) -- the core mental model
2. **Pipeline explanation** (1 paragraph) -- what each stage does in plain English
3. **Confidence classification table** -- maps each level to meaning, cause, and example
4. **Over-approximation one-liner** -- "reports a superset of paths rather than risk missing any"

### Critical Pitfalls

1. **Implementation-focused opening** -- Leading with "recursive AST walker with scope tracking" instead of "extract every data path from a JSONata expression." Prevent by writing the first paragraph from the user's perspective, showing a code example within the first 10 lines.

2. **Non-runnable code examples** -- Missing imports, ESM-only issues (`ERR_REQUIRE_ESM`), shell `$` expansion mangling CLI expressions. Prevent by including full import statements in every example, placing the ESM notice before the first code block, and using single-quoted strings in all CLI examples.

3. **Undocumented confidence semantics** -- Users will misinterpret `static`/`dynamic`/`partial` without explanation. Prevent with a dedicated confidence table showing meaning, cause, example expression, and recommended handling for each level.

4. **Missing limitations section** -- Users assume the tool handles everything, then file bugs for intentional design decisions (over-approximation, wildcard injection, parent operator approximation). Prevent by explicitly listing what the analyzer does NOT do and framing each as a deliberate choice.

5. **API types not shown inline** -- TypeScript signatures omitted from README, forcing users to install before understanding the API shape. Prevent by including `extractPaths` signature, `PathResult` interface, and `Confidence` type as code blocks in the API reference.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Overview and Installation

**Rationale:** The title, description, badges, and installation section have zero dependencies on other sections. They frame the entire README and set the tone. Research unanimously shows the opening must answer "what does this solve?" -- not "how is it built?" -- within 10 seconds of reading.
**Delivers:** Project title, one-line description, badge row, ESM-only notice, install commands, and the table of contents placeholder.
**Addresses:** Table stakes (title, installation, license), badges differentiator.
**Avoids:** Pitfall 1 (implementation-focused opening), Pitfall 2 (ESM notice must precede examples).

### Phase 2: Quick Start and API Reference

**Rationale:** The quick-start example is the single most important section for adoption. It must come before installation per research (show value before asking to install). The API reference documents the full type surface and is a dependency for the confidence explanation and deeper examples.
**Delivers:** Quick-start code example (copy-pasteable, with output), `extractPaths` signature, `PathResult` interface, `Confidence` type with dedicated explanation table, error behavior.
**Addresses:** Table stakes (quick start, API reference, TypeScript types), confidence level differentiator.
**Avoids:** Pitfall 2 (non-runnable examples), Pitfall 3 (undocumented confidence), Pitfall 5 (types not shown).

### Phase 3: CLI Documentation

**Rationale:** The CLI is a separate entry point with its own usage patterns and gotchas (shell quoting). It logically follows the API reference since users understand the output format by now.
**Delivers:** CLI argument mode examples, stdin pipe mode examples, shell quoting warning for `$` expressions, error output behavior.
**Addresses:** Table stakes (CLI usage).
**Avoids:** Pitfall 2 (shell quoting causing silent expression mangling).

### Phase 4: Progressive Examples

**Rationale:** Deeper examples build on the quick start and require the reader to already understand the API and confidence levels. Research from magicast shows progressive examples are the most effective documentation pattern for small libraries.
**Delivers:** 3-5 examples covering simple paths, variable assignment tracing, filter predicates, dynamic/wildcard paths, and parent operator. Each shows expression input and full JSON output with confidence levels.
**Addresses:** Multiple examples differentiator, output format documentation.
**Avoids:** Pitfall 2 (all examples must be verified runnable), Pitfall 3 (examples should demonstrate all three confidence levels).

### Phase 5: How It Works and Limitations

**Rationale:** These sections serve readers who are evaluating the tool deeply or debugging unexpected output. Research consistently places them after all usage content (progressive disclosure). They are the final sections before license.
**Delivers:** ASCII pipeline diagram, pipeline explanation paragraph, over-approximation principle statement, limitations list (static-only, wildcards, parent operator, no caching, ESM-only).
**Addresses:** How it works differentiator, limitations differentiator.
**Avoids:** Pitfall 1 (architecture after usage, not before), Pitfall 4 (missing limitations).

### Phase 6: Final Assembly and Verification

**Rationale:** The TOC can only be written after all sections exist. Badge URLs need verification. Every code example must be tested against the built package.
**Delivers:** Completed TOC with anchor links, verified badge URLs, all examples tested, final review pass.
**Addresses:** Table of contents, example verification.
**Avoids:** Pitfall 2 (example drift from actual API).

### Phase Ordering Rationale

- Phases 1-2 establish the README's identity and core value proposition. Everything else depends on these being right.
- Phase 3 is independent of Phase 4 but shares the same output format context, so it logically follows Phase 2.
- Phase 4 before Phase 5 because users must see what the tool DOES before learning what it does NOT.
- Phase 6 is inherently last because TOC and verification require all other content to exist.
- This ordering mirrors the feature dependency graph from FEATURES.md and the progressive disclosure pattern from ARCHITECTURE.md.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** The confidence level table content needs careful drafting. The exact examples for each confidence level should be pulled from actual test cases to ensure accuracy. Consider running `extractPaths` against candidate expressions to capture real output.
- **Phase 4:** Progressive example selection requires reviewing the test suite to find the most illustrative cases. Verify which JSONata expressions produce which confidence levels.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Badges and installation are completely covered by STACK.md with copy-paste-ready URLs. No additional research needed.
- **Phase 3:** CLI documentation patterns are straightforward. Shell quoting rules are well-documented in PITFALLS.md.
- **Phase 5:** The ASCII pipeline diagram is already drafted in ARCHITECTURE.md. The limitations list is already enumerated in FEATURES.md and PITFALLS.md.
- **Phase 6:** Assembly and verification is mechanical.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations backed by direct analysis of comparable libraries (acorn, estree-walker, magicast, ky, p-queue). No runtime dependencies needed -- this is purely a Markdown authoring task. |
| Features | HIGH | Feature landscape derived from direct inspection of node_modules READMEs and cross-referenced with npm documentation standards and Azure SDK guidelines. |
| Architecture | HIGH | "How it works" section structure validated against established tools (ESLint, Babel, jscodeshift, dependency-cruiser). Mermaid vs ASCII rendering verified against npm platform capabilities. |
| Pitfalls | HIGH | All five critical pitfalls are grounded in specific, verifiable properties of this codebase (ESM-only, shell quoting, confidence type semantics). Not generic advice. |

**Overall confidence:** HIGH

All four research files independently converge on the same conclusions: hand-written GFM, user-first opening, copy-pasteable examples, confidence levels as first-class documentation, ASCII over Mermaid, limitations as trust-building. There are no conflicting recommendations across the research files.

### Gaps to Address

- **Example verification:** No automated mechanism exists to test README code examples against the built package. Consider adding a `test:readme` script during Phase 6 or as a follow-up task. For now, manual verification is acceptable.
- **npm publication status:** Badge recommendations assume the package is not yet published to npm. If publication happens before or during this milestone, add npm version and download badges.
- **Exact confidence examples:** The research provides the framework for the confidence table but the specific JSONata expressions and their outputs should be verified by running `extractPaths` during Phase 2 planning to ensure the examples produce the documented confidence levels.

## Sources

### Primary (HIGH confidence)
- Acorn README (node_modules/.pnpm/acorn@8.16.0/) -- AST parser documentation patterns
- estree-walker README (node_modules/.pnpm/estree-walker@3.0.3/) -- minimal AST library README model
- magicast README (node_modules/.pnpm/magicast@0.5.2/) -- progressive example patterns
- jsonata README (node_modules/.pnpm/jsonata@2.1.0/) -- upstream library documentation
- [Shields.io documentation](https://shields.io/) -- badge URL formats
- [GitHub Actions badge docs](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/adding-a-workflow-status-badge) -- native CI badge
- [npm README docs](https://docs.npmjs.com/about-package-readme-files/) -- npm rendering requirements
- [sindresorhus/pure-esm-package](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c) -- ESM-only documentation patterns
- Direct codebase analysis: src/index.ts, src/types.ts, src/cli.ts, package.json

### Secondary (MEDIUM confidence)
- [ky README](https://github.com/sindresorhus/ky) -- small TypeScript library documentation model
- [p-queue README](https://github.com/sindresorhus/p-queue) -- API reference formatting
- [taze README](https://github.com/antfu-collective/taze) -- CLI tool documentation
- [Azure SDK TypeScript Documentation Guidelines](https://azure.github.io/azure-sdk/typescript_documentation.html) -- TypeScript library standards
- [matklad ARCHITECTURE.md guidance](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html) -- documentation scope principles
- [Google READMEs Style Guide](https://google.github.io/styleguide/docguide/READMEs.html) -- code example standards

### Tertiary (LOW confidence)
- General README best-practice blog posts (dev.to, archbee.com, document360.com) -- used for pattern confirmation only, not as primary evidence

---
*Research completed: 2026-03-09*
*Ready for roadmap: yes*
