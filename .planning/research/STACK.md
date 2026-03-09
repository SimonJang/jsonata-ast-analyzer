# Stack Research

**Domain:** README documentation for TypeScript/Node.js library (jsonata-ast-analyzer)
**Researched:** 2026-03-09
**Confidence:** HIGH

## Recommended Stack

This is a documentation milestone -- the "stack" here is not runtime dependencies but rather the tools, services, conventions, and structural patterns needed to produce a high-quality README that drives developer adoption.

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Shields.io badges | N/A (hosted service) | Visual at-a-glance project status indicators | De facto standard for open-source badges; recognized instantly by developers scanning npm/GitHub. Used by nearly every well-regarded TypeScript library (Zod, ky, Vitest, tsup). |
| GitHub-native workflow badge | N/A (built-in) | CI status indicator | GitHub provides a first-party badge URL for Actions workflows, no third-party dependency. More reliable than Shields.io CI badges since it queries GitHub directly. |
| Hand-written Markdown | N/A | README content format | For a focused library with a single exported function, hand-written documentation is superior to generated docs. TypeDoc is overkill here -- the API surface is tiny (1 function, 2 types). |
| GitHub Flavored Markdown (GFM) | N/A | Rendering target | GitHub and npm both render GFM. Use fenced code blocks with `typescript` language tag, pipe tables, and anchor links for TOC. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| markdown-toc | ^1.2.0 | Auto-generate table of contents from Markdown headings | Only if the README grows beyond ~8 sections. For v1.1.3, manual TOC is sufficient and avoids a dev dependency. Used by NASA/OpenMCT, Prisma, Prettier, Mocha, and thousands of others. |
| doctoc | ^2.2.0 | Alternative TOC generator, auto-updates in-place | If you want CI-enforced TOC freshness (doctoc can be run as a pre-commit hook). Heavier than markdown-toc. |
| TypeDoc | ^0.27+ | API reference generation from TSDoc comments | Do NOT use for this milestone. The API surface is 1 function and 2 types. TypeDoc shines for libraries with 20+ exports. Adds complexity without proportional value here. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Shields.io URL builder | Badge URL construction | Use `https://img.shields.io/badge/LABEL-MESSAGE-COLOR` for static badges. Dynamic badges use endpoint-specific URLs (e.g., `/npm/v/PACKAGE`). |
| GitHub Actions badge URL | CI status badge | Format: `https://github.com/OWNER/REPO/actions/workflows/FILENAME/badge.svg`. For this repo: `https://github.com/SimonJang/jsonata-ast-analyzer/actions/workflows/ci.yml/badge.svg` |
| Code fence syntax highlighting | Example formatting | Use ` ```typescript ` for import/usage examples and ` ```bash ` for CLI commands. GitHub and npm renderers both support this. |

## Badge Recommendations

### Badges to Include (in this order, left to right)

These are the badges that provide genuine signal for a TypeScript/Node library:

| Badge | URL Pattern | Why |
|-------|-------------|-----|
| CI Status | `[![CI](https://github.com/SimonJang/jsonata-ast-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/SimonJang/jsonata-ast-analyzer/actions/workflows/ci.yml)` | Most important badge. Developers check this first. Links to workflow runs. |
| TypeScript | `![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)` | Signals first-class TypeScript support with bundled types. Critical for TS developers evaluating the library. |
| Node.js | `![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green?logo=node.js&logoColor=white)` | Communicates minimum supported version. This project tests on Node 20 and 22. |
| ESM Only | `![ESM Only](https://img.shields.io/badge/module-ESM%20only-yellow)` | Important caveat -- saves CJS users from a bad experience. Yellow color signals "pay attention." |
| License | `![License: MIT](https://img.shields.io/badge/License-MIT-green)` | Standard trust signal. MIT is maximally permissive. |

### Badges to NOT Include

| Badge | Why Not |
|-------|---------|
| npm version | Package is not published to npm yet. Add this badge when/if published. |
| npm downloads | Same -- not published. |
| Code coverage percentage | Not currently exported from CI. Only add when you have real coverage reporting. Fake coverage badges erode trust. |
| Bundle size (bundlephobia) | Only relevant for browser-targeted libraries. This is a Node.js analysis tool. |
| "PRs Welcome" | Unnecessary for a small focused library. |
| Dependency count | Misleading -- the single `jsonata` dependency is intentional and correct. |

## README Section Structure

### Recommended Order (evidence-based)

Based on analysis of well-regarded TypeScript libraries (Zod, ky, p-queue, changesets, taze), the optimal README section order for this project is:

| Order | Section | Purpose | Rationale |
|-------|---------|---------|-----------|
| 1 | Title + one-line description | What is this? | First thing developers see on GitHub and npm. |
| 2 | Badges | Trust signals at a glance | CI passing, TypeScript, Node version, license. |
| 3 | Quick example | "Show, don't tell" | A single copy-paste code block that demonstrates the core value proposition in under 10 lines. This is the most important section for adoption -- developers who see a relevant example keep reading. |
| 4 | Table of Contents | Navigation aid | Manual anchor links to each section. Required once you have 6+ sections. |
| 5 | Installation | How to get it | `pnpm add` / `npm install` commands. Note ESM-only requirement. |
| 6 | API Reference | What does it export? | `extractPaths()` signature, `PathResult` interface, `Confidence` type. Keep it tight -- this is 1 function and 2 types. |
| 7 | CLI Usage | Command-line interface | `jsonata-paths` binary with both argument and stdin modes. Include real examples with output. |
| 8 | Examples | Deeper usage patterns | Progressive complexity: simple path, nested path, variable assignment, filter predicate, wildcard/dynamic, parent operator. Each example shows expression -> output mapping. |
| 9 | How It Works | Architecture overview | Brief description of the analysis pipeline: parse -> walk -> resolve -> deduplicate -> annotate. For developers who want to understand or contribute. |
| 10 | Limitations | Honest about boundaries | Static analysis only, over-approximation, dynamic paths, parent operator. Builds trust by setting correct expectations. |
| 11 | License | Legal | One-liner with link to LICENSE file. |

### Critical Ordering Insight

The quick example MUST come before installation. Rationale from ky, p-queue, and Zod patterns: developers evaluate whether a library is worth installing BEFORE they look at install commands. Leading with a compelling example reduces bounce rate. The pattern is: "Here's what it does" -> "Want it? Here's how to install."

## Content Conventions

### Code Examples Format

Every code example should follow this pattern used by top TypeScript libraries:

```
1. Show the import statement (so developers know what to import)
2. Show the function call with a realistic input
3. Show the output (as a comment or separate block)
```

For this project specifically:
- Use `typescript` code fence for library usage
- Use `bash` code fence for CLI usage
- Show the JSONata expression as a string literal (developers need to see the expression)
- Show the output as an inline comment `// =>` or as a JSON block

### API Reference Format

For a library this small, use inline TypeScript signatures with descriptions rather than a table:

```markdown
### `extractPaths(expression: string): PathResult[]`

Description of what it does.

### `PathResult`

\`\`\`typescript
interface PathResult {
  path: string;
  confidence: Confidence;
}
\`\`\`

### `Confidence`

\`\`\`typescript
type Confidence = "static" | "dynamic" | "partial";
\`\`\`

With a table explaining what each confidence level means.
```

This format is used by p-queue, ky, and similar focused libraries. It keeps types visible and copy-pasteable.

### What Belongs in README vs. Separate Docs

| In README | NOT in README (separate file or docs site) |
|-----------|-------------------------------------------|
| Quick start and core usage | Full AST node type documentation |
| API reference for public exports | Internal architecture deep-dive |
| CLI usage with examples | Contributing guidelines (CONTRIBUTING.md) |
| 5-8 progressive examples | Changelog (CHANGELOG.md) |
| Brief "how it works" paragraph | Test fixture documentation |
| Limitations section | Development setup instructions |
| License one-liner | Design decision history |

For this project: everything fits in the README. The API surface is tiny (1 function, 2 types, 1 CLI command), and the library is focused enough that a single well-structured README is the right choice. Splitting into a docs site or wiki would fragment the developer experience for no benefit.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hand-written Markdown README | TypeDoc-generated API docs | When you have 20+ exported functions/types. TypeDoc excels at large API surfaces. For 1 function and 2 types, it adds complexity without value. |
| Manual TOC with anchor links | markdown-toc / doctoc auto-generation | When README exceeds ~15 sections or changes frequently. For a stable README with 10 sections, manual TOC is simpler and has no tooling dependency. |
| Shields.io static badges | badgen.net | When you need faster badge response times. Badgen is slightly faster but less recognized. Shields.io is the community standard. |
| GitHub Actions native badge | Shields.io GitHub Actions badge | When you need custom styling on the CI badge. Native badge is more reliable but less customizable. |
| Inline code examples in README | Separate /examples directory with runnable scripts | When examples need to be tested/validated automatically. For a README with 5-8 short examples, inline is cleaner and keeps everything in one place. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| TypeDoc for this project | API surface is 1 function + 2 types. TypeDoc generates multi-page HTML sites. The setup cost (tsconfig integration, output directory, hosting) far exceeds the documentation value for this surface area. | Hand-written Markdown API reference directly in README. |
| ts-readme (auto-generation from JSDoc) | Generates Markdown from source code comments, but output formatting is mechanical and lacks the narrative flow that drives adoption. Good for reference, bad for storytelling. | Write the README by hand with curated examples. |
| README-only documentation site (Docusaurus, VitePress) | These are documentation site generators. This library does not need a documentation site. The entire API fits in a single README page. Using a site generator would signal the project is more complex than it is. | Single README.md file. |
| Badgen.net badges | Less widely recognized than Shields.io. Developers have trained visual recognition for Shields.io badge shapes. | Shields.io badges. |
| npm badge / download badge | Package is not published to npm. Displaying these badges would show errors or zeros, which harms credibility. | Add these badges only after npm publication. |

## Exemplary READMEs to Reference

These TypeScript/Node libraries have READMEs that match the profile of jsonata-ast-analyzer (focused library, small API, CLI tool):

| Library | Why It Is a Good Model | Key Pattern to Adopt |
|---------|----------------------|---------------------|
| [ky](https://github.com/sindresorhus/ky) | Small API, clear badges, benefits list, progressive examples, comprehensive API reference | Comparative code example early ("here's what it replaces"), then detailed API |
| [p-queue](https://github.com/sindresorhus/p-queue) | Single-purpose library, TypeScript-first, excellent progressive complexity in examples | Each API method documented with signature + description + example |
| [taze](https://github.com/antfu-collective/taze) | CLI tool with library API, clean zero-friction "just run it" examples | CLI-first presentation, configuration section for power users |
| [changesets](https://github.com/changesets/changesets) | Badges as trust signals, tiered entry points for different audiences | "Getting Started" section with links to deeper docs |
| [picocolors](https://github.com/alexeyraspopov/picocolors) | Tiny focused library, comparison-driven README | Benchmark table demonstrating value proposition |

## Project-Specific Badge URLs

Pre-built badge Markdown for this project (copy-paste ready):

```markdown
[![CI](https://github.com/SimonJang/jsonata-ast-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/SimonJang/jsonata-ast-analyzer/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green?logo=node.js&logoColor=white)
![ESM Only](https://img.shields.io/badge/module-ESM%20only-yellow)
![License: MIT](https://img.shields.io/badge/License-MIT-green)
```

## Installation

```bash
# No new packages to install for the documentation milestone.
# The README is hand-written Markdown -- no build tools, generators, or plugins needed.
```

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Shields.io badges | Any Markdown renderer | Static SVGs served via img.shields.io. Work on GitHub, npm, and any GFM renderer. |
| GitHub Actions badge | GitHub-rendered Markdown | Uses GitHub's internal badge.svg endpoint. Only works when repo is public or viewer has access. |
| GFM code fences | GitHub + npm + most renderers | `typescript` and `bash` language tags are universally supported. |

## Sources

- [Shields.io official documentation](https://shields.io/) -- badge URL formats, customization options (HIGH confidence)
- [GitHub Actions badge docs](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/adding-a-workflow-status-badge) -- native workflow status badge format (HIGH confidence)
- [npm README documentation](https://docs.npmjs.com/about-package-readme-files/) -- npm README rendering requirements (HIGH confidence)
- [ky README](https://github.com/sindresorhus/ky) -- structural patterns for small TypeScript library (HIGH confidence, direct analysis)
- [p-queue README](https://github.com/sindresorhus/p-queue) -- API reference formatting patterns (HIGH confidence, direct analysis)
- [Zod README](https://github.com/colinhacks/zod) -- progressive example patterns (HIGH confidence, direct analysis)
- [taze README](https://github.com/antfu-collective/taze) -- CLI documentation patterns (HIGH confidence, direct analysis)
- [changesets README](https://github.com/changesets/changesets) -- badge and tiered documentation patterns (HIGH confidence, direct analysis)
- [markdown-toc](https://github.com/jonschlinkert/markdown-toc) -- TOC generation tool (MEDIUM confidence, WebSearch)
- [How to Write an Awesome README](https://dev.to/documatic/how-to-write-an-awesome-readme-cfl) -- general README best practices (MEDIUM confidence, WebSearch)
- [Writing the Perfect README for Your Node Library](https://blog.bitsrc.io/writing-the-perfect-reademe-for-your-node-library-2d5f24dc1c06) -- Node-specific README guidance (MEDIUM confidence, WebSearch)
- [README documentation splitting guidance](https://colinhacks.com/essays/docs-the-smart-way) -- when to split README vs docs site (MEDIUM confidence, WebSearch)

---
*Stack research for: README documentation for jsonata-ast-analyzer TypeScript library*
*Researched: 2026-03-09*
