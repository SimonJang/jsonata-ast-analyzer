# Phase 18: Overview and Installation - Research

**Researched:** 2026-03-09
**Domain:** README documentation (overview, quick example, installation, license)
**Confidence:** HIGH

## Summary

Phase 18 is a documentation-only phase that replaces the current placeholder README with a structured document containing: an H1 title (`# jsonata-ast-analyzer`), a one-liner description, a quick example showing expression-in/paths-out, installation commands for pnpm/npm/yarn with an ESM-only notice, and a license section. It also creates empty headings for Phases 19-22 to fill in later.

The domain is straightforward -- writing Markdown content based on verified project facts. All information needed (package name, API shape, actual output format, license) comes from the project itself. The primary risk is a license mismatch between `package.json` (says ISC) and the actual `LICENSE` file (contains MIT text). This must be resolved before writing the license section.

**Primary recommendation:** Write the README in a single plan with one task per section (title/one-liner, quick example, installation, skeleton headings, license). Use verified `extractPaths()` output from the built dist to ensure the quick example is accurate.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Full skeleton: Phase 18 writes its own sections fully and creates empty headings for future phases (API Reference, CLI Usage, Examples, How It Works, Limitations)
- Empty headings only -- no placeholder text, no HTML comments, no "coming soon" markers
- Later phases (19-22) simply insert content under their respective headings
- Use npm package name as the H1: `# jsonata-ast-analyzer`
- One-liner description follows immediately underneath (not in the heading itself)
- Section ordering: title -> one-liner -> Quick Example -> Installation -> API Reference -> CLI Usage -> Examples -> How It Works -> Limitations -> License
- Quick example appears BEFORE installation (show value first, per OVVW-02)
- No badges, no TOC (per project-level decisions)

### Claude's Discretion
- Opening one-liner wording and tone
- Which JSONata expression to use in the quick example (should demonstrate core value: expression in, paths out)
- Install command formatting (code block style, tab vs separate blocks for pnpm/npm/yarn)
- ESM-only notice prominence and wording
- License section format

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OVVW-01 | README opens with a clear one-line description of what the library does and who it's for | Package metadata (name, description), API surface (1 function, 2 types), verified output format |
| OVVW-02 | README includes a quick example (expression -> output) before installation instructions | Verified extractPaths() output from live execution; section ordering locked (example before install) |
| INST-01 | README shows pnpm/npm/yarn install commands | Package name confirmed: `jsonata-ast-analyzer`; packageManager field: `pnpm@10.30.3` |
| INST-02 | README notes ESM-only requirement (no CommonJS/require) | Verified: `"type": "module"`, exports map has only `import` (no `require`), no CJS fallback |
| LIC-01 | README includes license section | LICENSE file contains MIT text; package.json says ISC -- DISCREPANCY flagged |

</phase_requirements>

## Standard Stack

Not applicable -- this phase writes Markdown documentation only. No libraries are installed or code written.

## Architecture Patterns

### README Structure (Locked by CONTEXT.md)

```
# jsonata-ast-analyzer
{one-liner description}

## Quick Example
{expression in, paths out}

## Installation
{pnpm/npm/yarn commands + ESM notice}

## API Reference
{empty -- Phase 19}

## CLI Usage
{empty -- Phase 20}

## Examples
{empty -- Phase 21}

## How It Works
{empty -- Phase 22}

## Limitations
{empty -- Phase 22}

## License
{license text}
```

### Pattern 1: Quick Example Format

**What:** Show the core value proposition in a single code block -- a JSONata expression goes in, a list of paths comes out.

**Recommended approach:** Use a JavaScript code block showing `extractPaths()` being called with a simple but non-trivial expression, followed by the output. The expression should demonstrate the core insight: the analyzer identifies ALL paths the expression reads, including paths inside filters/projections that are not obvious from skimming the expression.

**Verified example output (from live execution):**

```javascript
import { extractPaths } from "jsonata-ast-analyzer";

const paths = extractPaths('orders[status = "active"].items.price');
// [
//   { path: "orders.items.price",  confidence: "static" },
//   { path: "orders.status",       confidence: "static" }
// ]
```

This is a good quick example because:
- It is short and scannable
- The filter predicate (`status = "active"`) demonstrates that the analyzer finds hidden path reads
- A developer sees: "I give it an expression, it tells me every field it touches"
- Both output paths are `static` confidence -- simple to understand before learning about `dynamic`/`partial`

**Alternative expression considered:** `Account.Order.Product.{"name": Description.Colour, "price": Price}` -- this shows projection but is longer and uses the JSONata object constructor syntax which may confuse developers unfamiliar with JSONata. The filter example is more universally readable.

### Pattern 2: Installation Block Format

**What:** Show install commands for all three major package managers, with pnpm first (since the project uses pnpm as its packageManager).

**Recommended format:** Separate code blocks, one per package manager, with shell language tag:

```sh
pnpm add jsonata-ast-analyzer
```

```sh
npm install jsonata-ast-analyzer
```

```sh
yarn add jsonata-ast-analyzer
```

Reasoning: Separate blocks are simpler to copy than tab-based switchers (which require HTML/special Markdown that may not render consistently). They are also more scannable.

### Pattern 3: ESM-Only Notice

**What:** Prominently inform users this package requires `import` syntax and cannot be `require()`'d.

**Recommended approach:** A blockquote callout immediately after the install commands:

```markdown
> **Note:** This package is ESM-only. Use `import` — `require()` is not supported.
```

This follows the community pattern established by Sindre Sorhus's "Pure ESM package" guidance. A blockquote renders with visual distinction on GitHub, npm, and most Markdown viewers without requiring any HTML.

### Pattern 4: License Section

**What:** A brief section at the bottom stating the license type with a link to the LICENSE file.

**Recommended format:**

```markdown
## License

MIT
```

Simple, standard, no verbosity needed -- the full text is in the LICENSE file.

### Anti-Patterns to Avoid
- **Placeholder text in empty headings:** User explicitly locked "empty headings only -- no placeholder text, no HTML comments, no 'coming soon' markers"
- **Badges row:** User explicitly excluded badges per project-level decisions
- **Table of contents:** User explicitly excluded TOC per project-level decisions
- **Implementation jargon in one-liner:** The description should say what the library does for the user, not how it works internally (no "AST walker", no "recursive descent")

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Quick example output | Don't type the output manually | Run `extractPaths()` against the built dist and copy the actual output | Ensures the README example is accurate and matches real behavior |

## Common Pitfalls

### Pitfall 1: License Mismatch
**What goes wrong:** `package.json` declares `"license": "ISC"` but the `LICENSE` file at the project root contains the full MIT License text ("MIT License / Copyright (c) 2025 Simon Jang").
**Why it happens:** The project was likely initialized with a default ISC license in package.json but the LICENSE file was later created/replaced with MIT text.
**How to avoid:** The README should reference whichever license is actually intended. Since the LICENSE file contains the MIT full text and is the canonical legal document, the README should say "MIT". The `package.json` license field should also be updated to "MIT" for consistency, though that is technically a code change -- flag this for the planner.
**Warning signs:** If the README says one license and package.json says another, npm will show the package.json value on the registry page while the LICENSE file shows something else.

### Pitfall 2: Stale Quick Example
**What goes wrong:** The example output in the README does not match actual library output, eroding trust.
**Why it happens:** Writing example output by hand instead of capturing from actual execution.
**How to avoid:** Run the expression through `extractPaths()` and copy the real output. Verified output for `orders[status = "active"].items.price`:
```json
[
  { "path": "orders.items.price", "confidence": "static" },
  { "path": "orders.status", "confidence": "static" }
]
```

### Pitfall 3: Empty Headings With Content
**What goes wrong:** Adding "Coming soon", "TODO", HTML comments, or any content under the placeholder headings for Phases 19-22.
**Why it happens:** Instinct to fill empty space.
**How to avoid:** The user explicitly locked this: empty headings only. Just `## API Reference` with nothing below it until the next heading.

### Pitfall 4: Overlong One-Liner
**What goes wrong:** The description becomes a paragraph instead of a single scannable line.
**Why it happens:** Trying to explain too much upfront.
**How to avoid:** Keep it to one sentence, ~15-20 words max. Target audience and value prop only. Details go in the Quick Example and later sections.

## Code Examples

### Verified Quick Example (from live execution)

Expression: `orders[status = "active"].items.price`

Output:
```json
[
  { "path": "orders.items.price", "confidence": "static" },
  { "path": "orders.status", "confidence": "static" }
]
```

### Alternative Quick Example (verified)

Expression: `Account.Order.Product.Price`

Output:
```json
[
  { "path": "Account.Order.Product.Price", "confidence": "static" }
]
```

This is simpler but less compelling -- it does not demonstrate that the analyzer finds non-obvious paths.

### Project API Surface (for one-liner crafting)

- **Function:** `extractPaths(expression: string): PathResult[]`
- **Types:** `PathResult { path: string; confidence: Confidence }`, `Confidence = "static" | "dynamic" | "partial"`
- **CLI:** `jsonata-paths <expression>` (binary name from package.json `bin` field)
- **Package name:** `jsonata-ast-analyzer`
- **ESM-only:** `"type": "module"`, exports map has only `import` key
- **License file:** MIT License, Copyright (c) 2025 Simon Jang
- **package.json license field:** ISC (MISMATCH -- should be MIT)

## State of the Art

Not applicable -- this is a documentation phase writing Markdown. No evolving technology landscape to track.

## Open Questions

1. **License field mismatch**
   - What we know: LICENSE file contains MIT text. package.json says ISC.
   - What's unclear: Which was the user's intent? The LICENSE file is more deliberate (full legal text was chosen).
   - Recommendation: Write "MIT" in the README (matching the LICENSE file). Flag to planner that package.json `license` field should be updated from "ISC" to "MIT" as a housekeeping fix in this phase.

## Validation Architecture

> `workflow.nyquist_validation` is not present in config.json -- treating as enabled per instructions.

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
| OVVW-01 | README has one-line description | manual-only | Visual review of README.md | N/A |
| OVVW-02 | Quick example before install section | manual-only | Visual review of README.md section order | N/A |
| INST-01 | pnpm/npm/yarn install commands present | manual-only | Visual review of README.md | N/A |
| INST-02 | ESM-only notice present | manual-only | Visual review of README.md | N/A |
| LIC-01 | License section present | manual-only | Visual review of README.md | N/A |

**Justification for manual-only:** All requirements are about Markdown content in a README file. There is no behavior to test programmatically. The verification step is "read the README and confirm each section exists with correct content." The existing test suite (`pnpm test`) should still pass since no code is changed.

### Sampling Rate
- **Per task commit:** `pnpm test` (ensure no code was accidentally broken)
- **Per wave merge:** `pnpm test` (full suite)
- **Phase gate:** Full suite green + manual README review

### Wave 0 Gaps
None -- this phase writes documentation only. Existing test infrastructure is unaffected and requires no additions.

## Sources

### Primary (HIGH confidence)
- `package.json` -- package name, version, type, exports, bin, license field, packageManager
- `src/index.ts` -- API surface: `extractPaths()` function signature, exported types
- `src/types.ts` -- `PathResult` interface, `Confidence` type definition
- `LICENSE` -- MIT License, Copyright (c) 2025 Simon Jang
- `dist/index.js` -- live execution of `extractPaths()` to verify example outputs
- `.planning/phases/18-overview-and-installation/18-CONTEXT.md` -- locked decisions

### Secondary (MEDIUM confidence)
- [Sindre Sorhus Pure ESM package gist](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c) -- community standard for ESM-only notice wording
- [npm docs: About package README files](https://docs.npmjs.com/about-package-readme-files/) -- README best practices

### Tertiary (LOW confidence)
None -- all findings verified from project source or official references.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no libraries needed, documentation only
- Architecture: HIGH -- README structure locked by CONTEXT.md decisions
- Pitfalls: HIGH -- verified from project source (license mismatch confirmed, example output captured from live execution)

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- Markdown documentation practices do not change rapidly)
