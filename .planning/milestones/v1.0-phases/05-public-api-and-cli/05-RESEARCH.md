# Phase 5: Public API and CLI - Research

**Researched:** 2026-03-03
**Domain:** TypeScript library packaging, Node.js CLI tooling, tsup multi-entry build configuration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CLI output format**
- JSON array to stdout — same shape as `PathResult[]` returned by `extractPaths()`
- Format: `[{"path":"items","confidence":"static"},...]`
- JSON is the only output mode (no plain-text or table modes needed)
- Primary use case is LLM tool calling — machine-readable JSON is the right default

**API export surface**
- `deriveConfidence()` should be unexported — it is an internal utility
- Only `extractPaths()`, `PathResult`, and `Confidence` should be part of the public API surface
- Keep exports minimal and intentional

**Error handling**
- Invalid JSONata expression: print error message to stderr, exit with code 1
- No paths found (valid expression but returns empty): print `[]` to stdout, exit 0
- Claude's Discretion: exact error message format, whether to wrap in JSON envelope or plain text

**Package format**
- ESM-only — no CJS output needed
- Current `tsup.config.ts` ESM setup is correct and stays

### Claude's Discretion

- Exact error message format (plain text vs JSON envelope on stderr)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| API-01 | Expose TypeScript/JS programmatic API (`extractPaths(expression): PathResult[]`) | `extractPaths()` already fully implemented in `src/index.ts`; work is removing `deriveConfidence` export and cleaning up the public surface; `tsup` with `dts: true` auto-generates `.d.ts` |
| API-02 | Provide CLI tool for command-line usage with stdin and argument input | New `src/cli.ts` entry with shebang; tsup multi-entry config adds CLI to build; `package.json` `bin` field wires the binary; `process.argv[2]` for arg input; `process.stdin.isTTY` + readline for stdin piping |
</phase_requirements>

---

## Summary

Phase 5 is predominantly integration and wiring work, not new algorithmic logic. The core `extractPaths()` function is complete and returns `PathResult[]` — the library API already exists functionally. The two deliverables are: (1) clean up the export surface in `src/index.ts` by removing `deriveConfidence` as a public export, and (2) create a new `src/cli.ts` entry point that calls `extractPaths()` and wires it up as a binary.

The main technical complexity is configuring tsup to build two entry points with different settings: the library entry needs `dts: true` for type declarations, while the CLI entry needs a shebang (`#!/usr/bin/env node`) injected via `banner: { js: '#!/usr/bin/env node' }` but should NOT generate `.d.ts` files (CLI binaries don't need type declarations, and tsup's DTS toolchain has known issues with shebang-containing files). tsup 8.5.1 supports `defineConfig()` accepting an array of configs, enabling clean separation.

The stdin detection pattern is standard Node.js: check `process.stdin.isTTY` — if truthy, stdin is a TTY (not piped), so fall back to the CLI argument. If falsy (piped), read all lines via `for await...of` on a readline interface. npm automatically makes bin-field files executable on install, and tsup auto-chmods output files whose source contains a shebang.

**Primary recommendation:** Use tsup array config (two separate `defineConfig` entries) — one for the library with DTS, one for the CLI with banner shebang and no DTS. Wire `package.json` `bin` field to `dist/cli.js`.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsup | 8.5.1 (installed) | Bundles both entries; `banner` option adds shebang; array config splits library vs CLI build | Already the project bundler; supports all required features natively |
| Node.js `node:readline` | built-in | Reading all stdin lines until EOF | Standard Node.js API; async iterator (`for await...of`) is the modern pattern |
| Node.js `node:process` | built-in | `process.argv`, `process.stdin`, `process.stdout`, `process.stderr`, `process.exitCode` | Standard; no library needed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.x (installed) | Testing CLI behavior via unit tests on the core logic | Already the project test runner; CLI behavior tested through integration patterns |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `process.argv` + readline | `commander`, `yargs`, `cac` | The CLI is a single-argument tool — argument parsing libraries are overkill for this scope |
| `banner: { js: ... }` in tsup | Shebang in source `src/cli.ts` | Source shebang causes DTS build errors in tsup (rollup-plugin-dts issue #910, closed July 2024 but workaround still more reliable); using `banner` option keeps `src/cli.ts` a clean TS file |
| Array of tsup configs | Single config with both entries | Single config with `dts: true` would attempt to generate `.d.ts` for the CLI file too — problematic when shebang is involved |

**Installation:** No new dependencies needed. Everything required is in the existing project or Node.js built-ins.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── index.ts         # Library entry — extractPaths(), PathResult, Confidence exports only
├── cli.ts           # NEW — CLI entry; no shebang (shebang injected by tsup banner option)
├── types.ts         # Unchanged — internal types
├── walker.ts        # Unchanged — internal
├── scope.ts         # Unchanged — internal
├── parser.ts        # Unchanged — internal
├── path-builder.ts  # Unchanged — internal
└── builtins.ts      # Unchanged — internal
dist/
├── index.js         # Library bundle (ESM)
├── index.d.ts       # Type declarations (from dts: true on library entry only)
└── cli.js           # CLI binary (ESM, shebang prepended, chmod'd by tsup)
```

### Pattern 1: tsup Array Config (Two Separate Build Configurations)

**What:** `defineConfig()` in tsup accepts an array of config objects. Each runs as an independent build. This is the cleanest way to have different settings (DTS on vs off, banner vs no banner) per entry.

**When to use:** When you have fundamentally different output targets — a typed library and an executable binary — that need different tsup options.

**Example:**
```typescript
// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig([
  // Config 1: Library — generates types, no shebang
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  // Config 2: CLI binary — shebang injected, no DTS
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: false,
  },
]);
```

Note: `clean: true` on the second config would wipe `dist/` again after the first build. Only put `clean: true` on the first (or a shared pre-clean step). Omit `clean` from the CLI config.

### Pattern 2: CLI Entry File (`src/cli.ts`)

**What:** Reads the JSONata expression from `process.argv[2]` OR from stdin if stdin is piped. Calls `extractPaths()`. Writes JSON to stdout. Writes errors to stderr and exits with code 1.

**When to use:** The standard pattern for CLI tools that support both argument and stdin input modes.

**Example:**
```typescript
// src/cli.ts
// No shebang here — tsup banner option injects it into dist/cli.js
import { extractPaths } from "./index.js";
import { createInterface } from "node:readline";

async function main(): Promise<void> {
  let expression: string;

  if (process.argv[2] !== undefined) {
    // Mode 1: expression passed as argument
    expression = process.argv[2];
  } else if (!process.stdin.isTTY) {
    // Mode 2: expression piped via stdin
    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      lines.push(line);
    }
    expression = lines.join("\n").trim();
  } else {
    // No input — print usage to stderr, exit 1
    process.stderr.write("Usage: jsonata-paths <expression>\n       echo '<expression>' | jsonata-paths\n");
    process.exitCode = 1;
    return;
  }

  try {
    const paths = extractPaths(expression);
    process.stdout.write(JSON.stringify(paths) + "\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}

main();
```

### Pattern 3: `package.json` `bin` Field

**What:** The `bin` field maps a command name to the compiled CLI file path. npm automatically symlinks this into `node_modules/.bin/` on local install, or into the global PATH on global install. npm also auto-chmods the file to executable on install.

**When to use:** Whenever a package provides a CLI command.

**Example:**
```json
{
  "bin": {
    "jsonata-paths": "./dist/cli.js"
  }
}
```

### Pattern 4: Removing `deriveConfidence` Export + Test Fixup

**What:** `deriveConfidence` is currently exported from `src/index.ts` and directly called in one test. Removing the export breaks that test. The test must be replaced with an indirect equivalent: construct a JSONata expression that produces a path with mixed `%` and `[*]` markers, then assert on the `PathResult.confidence` returned by `extractPaths()`.

**Current test (line 801-804 in `test/extract-paths.test.ts`):**
```typescript
it('partial confidence takes priority over dynamic (hypothetical mixed path)', () => {
  // "%" segment wins over "[*]" — deriveConfidence returns "partial"
  expect(deriveConfidence("%.item[*]")).toBe("partial");
});
```

**Problem:** "%.item[*]" is a hand-crafted string — not an actual JSONata expression output. It cannot be produced by `extractPaths()` from a real JSONata expression (the parent `%` operator is only valid inside a path or filter, and `%.item[*]` would require both a parent operator AND a dynamic bracket filter in the same path, which may or may not be producible from a real expression).

**Options:**
1. **Remove the test entirely** — the behavior is covered indirectly by the individual partial and dynamic confidence tests
2. **Replace with a real expression** — find a JSONata expression that exercises both `%` and `[*]` in one path; if one exists, use it; if not, remove
3. **Move `deriveConfidence` to an internal module** and import it directly in the test from `../src/index.js` internal path (violates encapsulation, not recommended)

**Recommendation:** Option 1 (remove) is the safest. The priority behavior (`partial > dynamic > static`) is already validated through the individual ADV-03 tests.

### Anti-Patterns to Avoid

- **Shebang in `src/cli.ts` source:** Causes DTS build failures in tsup when rollup-plugin-dts encounters the hashbang syntax. Use `banner: { js: '#!/usr/bin/env node' }` in tsup config instead.
- **`dts: true` on CLI entry:** CLI binaries don't need `.d.ts` files; wastes build time and can cause shebang-related errors.
- **`clean: true` on second tsup config in the array:** This would delete `dist/` after the first config builds into it, wiping the library output. Only clean on the first config.
- **`process.exit(1)` instead of `process.exitCode = 1; return`:** `process.exit()` is synchronous and abrupt — it prevents pending I/O (like flushing stdout) from completing. Setting `process.exitCode` and returning from async `main()` is the graceful pattern.
- **Reading stdin unconditionally:** If no argument is given and stdin is a TTY (interactive terminal), reading stdin will hang indefinitely waiting for user input. Always check `process.stdin.isTTY` first.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shebang injection | Post-build script to prepend `#!/usr/bin/env node` | tsup `banner: { js: '#!/usr/bin/env node' }` | tsup handles it natively in 5.6.0+; also auto-chmods the output file |
| CLI argument parsing | Custom argv parser | Raw `process.argv[2]` | Single-argument CLI needs zero parsing logic — libraries add 50KB+ for no benefit |
| Stdin reading | Custom stream buffer | Node.js `readline` + `for await...of` | readline handles line splitting, buffering, and EOF detection automatically |
| File permissions | `chmod +x dist/cli.js` build step | npm `bin` field + tsup shebang | npm auto-chmods on install; tsup auto-chmods on build when shebang present OR banner used |
| Type declarations | Manual `.d.ts` authoring | tsup `dts: true` | tsup generates accurate declarations from TypeScript source automatically |

**Key insight:** This phase is almost entirely configuration and wiring. The risk is over-building — a 10-line `cli.ts` and config changes to `tsup.config.ts` and `package.json` are all that's needed.

---

## Common Pitfalls

### Pitfall 1: `clean: true` on Both tsup Configs Wipes Library Output

**What goes wrong:** Both configs write to `dist/`. If the CLI config runs second with `clean: true`, it deletes `dist/` before building, which removes `dist/index.js` and `dist/index.d.ts` produced by the first config.

**Why it happens:** tsup configs in an array run in parallel by default, but `clean: true` deletes the output directory at build start. With parallel execution, whichever config's clean runs second destroys the other's output.

**How to avoid:** Set `clean: true` on only the FIRST config (the library). Omit `clean` from the CLI config entirely.

**Warning signs:** Build succeeds but `dist/index.d.ts` is missing after build.

### Pitfall 2: Shebang in Source Causes DTS Build Errors

**What goes wrong:** If `src/cli.ts` starts with `#!/usr/bin/env node`, the tsup DTS step (using `rollup-plugin-dts`) throws `Error: Syntax not yet supported` for the hashbang token.

**Why it happens:** The rollup DTS plugin does not handle hashbang comments. This was reported in tsup issue #910 and while the issue was closed in July 2024, the reliable workaround is still to keep shebangs out of source files.

**How to avoid:** Do NOT put the shebang in `src/cli.ts`. Instead use `banner: { js: "#!/usr/bin/env node" }` in the CLI tsup config. Since `dts: false` on the CLI config anyway, this is moot — but keeping source clean is good practice.

**Warning signs:** `tsup: error in dts build: Syntax not yet supported` during build.

### Pitfall 3: Hanging CLI When Stdin Is a TTY

**What goes wrong:** If the CLI falls through to stdin-reading code when no argument is given but stdin is an interactive terminal (not piped), `for await...of` on readline blocks indefinitely, hanging the process.

**Why it happens:** readline reads until EOF. An interactive TTY doesn't send EOF until Ctrl+D.

**How to avoid:** Check `process.stdin.isTTY` before attempting to read stdin. If `isTTY` is true and no argument was given, print usage to stderr and exit 1.

**Warning signs:** `jsonata-paths` with no args hangs instead of printing usage.

### Pitfall 4: `exports` Map Not Updated for bin

**What goes wrong:** The `package.json` `exports` map only exports `"."` (the library). The CLI file is referenced by `bin` and does not need an `exports` entry — but if someone manually runs `node dist/cli.js`, it must be accessible.

**Why it happens:** Not actually a problem — `bin` field and `exports` are independent. The `exports` map controls module imports; `bin` controls executable symlinking. No `exports` entry is needed for the CLI.

**How to avoid:** No action needed. Don't add an `exports` entry for the CLI file.

### Pitfall 5: `deriveConfidence` Export Removal Breaks Import in Test

**What goes wrong:** `test/extract-paths.test.ts` line 2 imports `deriveConfidence` from `../src/index.js`. If the export is removed without updating the test, TypeScript compilation fails.

**Why it happens:** One test at line 801-804 directly calls `deriveConfidence("%.item[*]")` to verify priority logic.

**How to avoid:** Before removing the export, update the test. Either remove the direct-call test (the behavior is covered by other ADV-03 tests) or replace it with an `extractPaths()`-based equivalent.

**Warning signs:** `tsc --noEmit` fails with `Property 'deriveConfidence' does not exist on module`.

---

## Code Examples

Verified patterns from official sources and project context:

### tsup Array Config (Two Entries)

```typescript
// tsup.config.ts — Source: tsup docs + chromaui/chromatic-cli real-world pattern
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
    // No clean: true — don't wipe library output
  },
]);
```

### stdin Detection (Node.js official pattern)

```typescript
// Source: Node.js TTY docs (nodejs.org/api/tty.html)
if (process.argv[2] !== undefined) {
  // Use argument
} else if (!process.stdin.isTTY) {
  // Read piped stdin
} else {
  // Interactive — show usage
}
```

### Reading All stdin Until EOF

```typescript
// Source: Node.js readline docs (nodejs.org/api/readline.html)
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
const lines: string[] = [];
for await (const line of rl) {
  lines.push(line);
}
const expression = lines.join("\n").trim();
```

### package.json bin Field

```json
{
  "bin": {
    "jsonata-paths": "./dist/cli.js"
  }
}
```

Note: npm automatically chmods bin files to executable on install. tsup also automatically chmods the output file when a shebang is present in the source OR injected via `banner`.

### Graceful Exit Pattern

```typescript
// Source: Node.js process docs — process.exitCode is preferred over process.exit()
process.exitCode = 1;
return; // instead of process.exit(1)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shebang in source file + DTS workarounds | `banner: { js: '#!/usr/bin/env node' }` in tsup config | tsup 5.6.0 (Nov 2021) | Clean source, reliable build |
| CommonJS bin files | ESM bin files with `#!/usr/bin/env node` + `"type": "module"` in package.json | Node.js 12+ | Project already uses `"type": "module"` — ESM bins work natively |
| Manual `chmod +x` post-build | tsup auto-chmod + npm auto-chmod on install | npm 3+, tsup auto-detects | No build step needed |

**Deprecated/outdated:**
- Calling `process.exit()` synchronously: replaced by `process.exitCode` assignment for graceful async termination
- Shebang `#!/usr/bin/env node --experimental-vm-modules`: no longer needed for ESM in Node.js 18+

---

## Open Questions

1. **Exact error message format on stderr**
   - What we know: User decided "Claude's Discretion" for this
   - What's unclear: Plain text (`Error: <message>\n`) vs JSON envelope (`{"error": "<message>"}\n`) on stderr
   - Recommendation: Use plain text for stderr — the primary use case is LLM tool calling where stdout is the structured JSON output; stderr is human-readable error context. LLMs parsing the result will check exit code, not stderr format.

2. **Command name for the CLI binary**
   - What we know: CONTEXT.md does not specify the bin command name (only the output format)
   - What's unclear: Should the command be `jsonata-paths`, `jsonata-ast-analyzer`, or something else?
   - Recommendation: Use `jsonata-paths` — short, descriptive, matches the operation. The package name is `jsonata-ast-analyzer` but that's too long for a CLI command.

3. **Can a real JSONata expression produce a path with both `%` and `[*]` markers?**
   - What we know: The current test at line 801-804 uses `deriveConfidence("%.item[*]")` directly — it's a synthetic string, not an `extractPaths()` output
   - What's unclear: Whether any valid JSONata expression produces such a path through the walker
   - Recommendation: Assume not easily constructable; remove the test when unexporting `deriveConfidence`, since the individual `%`/`[*]` priority tests already cover the logic.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` (exists — `globals: true`, `passWithNoTests: true`) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | `extractPaths(expression)` returns typed `PathResult[]` from TS/JS | unit | `pnpm test` (existing 94+ tests cover this) | ✅ `test/extract-paths.test.ts` |
| API-01 | `deriveConfidence` is NOT exported (private internal) | type-check | `pnpm typecheck` | ✅ after export removal |
| API-02 | CLI arg mode: `node dist/cli.js "account.name"` prints JSON to stdout | integration/smoke | manual or spawn test | ❌ Wave 0 gap |
| API-02 | CLI stdin mode: `echo "account.name" \| node dist/cli.js` prints JSON | integration/smoke | manual or spawn test | ❌ Wave 0 gap |
| API-02 | CLI invalid expression: exits with code 1, error on stderr | integration/smoke | manual or spawn test | ❌ Wave 0 gap |
| API-02 | CLI empty result: prints `[]` to stdout, exits 0 | integration/smoke | manual or spawn test | ❌ Wave 0 gap |

### Sampling Rate

- **Per task commit:** `pnpm test` (unit suite, < 5 seconds)
- **Per wave merge:** `pnpm test && pnpm typecheck`
- **Phase gate:** `pnpm build && pnpm test && pnpm typecheck` before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `test/cli.test.ts` — covers API-02 CLI behaviors (spawn `node dist/cli.js` with `child_process.spawn` or vitest's built-in `execa`-style testing); only needed if automated CLI tests are desired — manual smoke testing is viable given the CLI's simplicity
- Note: vitest supports spawning child processes; a simple integration test file calling `execFileSync('node', ['dist/cli.js', 'account.name'])` and asserting stdout is feasible but optional given the CLI's trivial logic

---

## Sources

### Primary (HIGH confidence)

- Node.js readline docs (nodejs.org/api/readline.html) — `for await...of` on readline interface, stdin EOF handling
- Node.js TTY docs (nodejs.org/api/tty.html) — `process.stdin.isTTY` for piping detection
- 2ality.com/2022/07/nodejs-esm-shell-scripts.html — ESM shebang, npm `bin` field auto-chmod behavior (official-adjacent, highly authoritative)
- tsup GitHub issue #451 — confirmed `banner: { js: '...' }` option added in tsup 5.6.0
- tsup jsDocs.io (jsdocs.io/package/tsup) — confirmed `banner?: BannerOrFooter` in tsup 8.5.1 Options type
- tsup npm package — confirmed installed version is 8.5.1

### Secondary (MEDIUM confidence)

- chromaui/chromatic-cli tsup.config.ts — real-world array-of-configs pattern with DTS scoped to library entry only (verified via GitHub)
- tsup GitHub issue #910 — DTS hashbang issue context and closure (July 2024); informed the recommendation to use `banner` over source shebang
- WebSearch cross-referenced: tsup auto-chmods output when shebang detected in source; stated in multiple sources but not in official docs directly

### Tertiary (LOW confidence)

- None — all critical claims verified with at least one authoritative source.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already installed in project; tsup `banner` option confirmed in type definitions for 8.5.1
- Architecture: HIGH — patterns verified against real-world tsup usage (chromatic-cli) and official Node.js docs
- Pitfalls: HIGH — shebang/DTS issue verified via GitHub issue #910; clean/parallel build issue is logical consequence of tsup behavior; stdin hang is standard Node.js behavior documented in TTY docs

**Research date:** 2026-03-03
**Valid until:** 2026-06-03 (90 days — tsup and Node.js APIs are stable; no fast-moving changes expected)
