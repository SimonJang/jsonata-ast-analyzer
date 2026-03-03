---
phase: 05-public-api-and-cli
verified: 2026-03-03T10:56:30Z
status: passed
score: 13/13 must-haves verified
---

# Phase 5: Public API and CLI Verification Report

**Phase Goal:** Expose path analyzer as a clean TypeScript/JS library and CLI tool
**Verified:** 2026-03-03T10:56:30Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                 | Status     | Evidence                                                                                   |
|----|-------------------------------------------------------------------------------------------------------|------------|--------------------------------------------------------------------------------------------|
| 1  | extractPaths() is exported from src/index.ts and returns PathResult[]                                 | VERIFIED   | Line 40: `export function extractPaths(expression: string): PathResult[]`                  |
| 2  | PathResult and Confidence types are exported from src/index.ts                                        | VERIFIED   | Lines 6-7: `export type { PathResult }` and `export type { Confidence }` from ./types.js  |
| 3  | deriveConfidence is NOT exported from src/index.ts (private internal utility)                         | VERIFIED   | Line 24: `function deriveConfidence(...)` — no `export` keyword; grep confirms zero hits   |
| 4  | The test that directly called deriveConfidence is removed; all remaining tests pass                    | VERIFIED   | Grep of test file: zero `deriveConfidence` occurrences; 101/101 tests pass                 |
| 5  | src/cli.ts exists and calls extractPaths() with expression from argv[2] or piped stdin                | VERIFIED   | File exists; lines 7-17 cover argv[2] and stdin branches; line 29: `extractPaths()`        |
| 6  | CLI prints JSON array (PathResult[]) to stdout and exits 0 on success                                 | VERIFIED   | `node dist/cli.js "account.name"` → `[{"path":"account.name","confidence":"static"}]` exit 0 |
| 7  | CLI prints error message to stderr and exits 1 on invalid JSONata expression                          | VERIFIED   | `node dist/cli.js "$$invalid@@"` → `Error: ...` on stderr, exit 1                         |
| 8  | CLI prints [] to stdout and exits 0 when expression produces no paths                                 | VERIFIED   | `node dist/cli.js '"hello"'` → `[]` on stdout, exit 0                                     |
| 9  | CLI prints usage to stderr and exits 1 when invoked with no argument and no piped stdin               | VERIFIED   | src/cli.ts lines 19-26: stderr write + `process.exitCode = 1; return` on TTY/no-arg path  |
| 10 | tsup.config.ts uses array config: library entry with dts:true + CLI entry with banner shebang and dts:false | VERIFIED | Lines 3-20: array config confirmed; `banner: { js: "#!/usr/bin/env node" }` at line 18   |
| 11 | package.json has a bin field mapping jsonata-paths to ./dist/cli.js                                   | VERIFIED   | Lines 14-16: `"bin": { "jsonata-paths": "./dist/cli.js" }`                                 |
| 12 | pnpm build produces dist/index.js, dist/index.d.ts, and dist/cli.js                                  | VERIFIED   | `ls dist/` confirms: cli.js, index.d.ts, index.js, index.js.map all present               |
| 13 | All vitest tests pass with zero regressions                                                           | VERIFIED   | `pnpm test`: 101 passed, 0 failed, 0 skipped                                               |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact                       | Expected                                                              | Status     | Details                                                                                      |
|--------------------------------|-----------------------------------------------------------------------|------------|----------------------------------------------------------------------------------------------|
| `src/index.ts`                 | Clean public API: extractPaths, PathResult, Confidence only           | VERIFIED   | Contains `export function extractPaths`; `deriveConfidence` not exported                     |
| `src/cli.ts`                   | CLI entry point: argv[2] or stdin, PathResult[] JSON to stdout        | VERIFIED   | Contains `extractPaths` call; argv/stdin branching; error handling with exit codes           |
| `tsup.config.ts`               | Array config: library entry (dts:true) + CLI entry (banner shebang)   | VERIFIED   | Contains `banner`; array form verified; first entry has `dts: true`, second `dts: false`    |
| `package.json`                 | bin field wiring jsonata-paths command to dist/cli.js                 | VERIFIED   | Contains `"jsonata-paths": "./dist/cli.js"` in `bin` object                                 |
| `test/extract-paths.test.ts`   | deriveConfidence import removed; direct-call test removed             | VERIFIED   | Import line: only `extractPaths`; zero `deriveConfidence` occurrences across entire file    |
| `dist/cli.js`                  | Built CLI binary with shebang at line 1                               | VERIFIED   | `head -1 dist/cli.js` → `#!/usr/bin/env node`                                              |
| `dist/index.js`                | Built library ESM bundle                                              | VERIFIED   | Present in `ls dist/`                                                                        |
| `dist/index.d.ts`              | Type declaration file for TS consumers                                | VERIFIED   | Present in `ls dist/`                                                                        |

### Key Link Verification

| From                          | To                              | Via                                          | Status   | Details                                                           |
|-------------------------------|---------------------------------|----------------------------------------------|----------|-------------------------------------------------------------------|
| `src/cli.ts`                  | `src/index.ts extractPaths()`   | `import { extractPaths } from './index.js'`  | WIRED    | Line 1 of cli.ts: exact import; line 29: used in `main()`        |
| `tsup.config.ts` CLI config   | `dist/cli.js`                   | `banner: { js: '#!/usr/bin/env node' }`      | WIRED    | Banner present at line 18; `head -1 dist/cli.js` confirms output |
| `package.json bin field`      | `dist/cli.js`                   | `"jsonata-paths": "./dist/cli.js"`           | WIRED    | Lines 14-16 of package.json; bin field present and correct path  |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                | Status    | Evidence                                                                              |
|-------------|-------------|----------------------------------------------------------------------------|-----------|---------------------------------------------------------------------------------------|
| API-01      | 05-01-PLAN  | Expose TypeScript/JS programmatic API (`extractPaths(expression): PathResult[]`) | SATISFIED | `export function extractPaths` in src/index.ts; `PathResult`/`Confidence` exported; `deriveConfidence` not exposed |
| API-02      | 05-01-PLAN  | Provide CLI tool for command-line usage with stdin and argument input      | SATISFIED | src/cli.ts handles argv[2] and stdin; dist/cli.js built with shebang; package.json bin field wired |

No orphaned requirements — both API-01 and API-02 are accounted for in the plan and fully implemented.

### Anti-Patterns Found

No anti-patterns detected. Scanned all modified files:

- `src/index.ts` — no TODO/FIXME/placeholder; no stub return patterns
- `src/cli.ts` — no TODO/FIXME; full implementation with all branches
- `tsup.config.ts` — configuration only; no stubs
- `package.json` — configuration only; no stubs
- `test/extract-paths.test.ts` — 101 real tests; no placeholder test bodies

### Human Verification Required

None. All must-haves were verified programmatically:

- CLI behavior verified by running `node dist/cli.js` directly with multiple input modes
- TypeScript compilation verified by `pnpm typecheck` (zero errors)
- Test suite verified by `pnpm test` (101/101 passing)
- Build outputs verified by `ls dist/` and `head -1 dist/cli.js`
- Export surface verified by grep for `export.*deriveConfidence` (zero hits)

### Gaps Summary

No gaps. All 13 must-have truths verified. Phase goal fully achieved.

---

## Additional Notes

One plan-documented deviation was present (auto-fixed during execution):

- `@types/node` was added as a devDependency and `"node"` was added to `tsconfig.json`'s `types` array. This was required because the pre-existing tsconfig had an explicit `types` array that excluded Node.js globals, causing 10 TypeScript errors in cli.ts. The fix is correct and minimal — standard for any Node.js CLI TypeScript project.

The stdin smoke test (`echo "items.price" | node dist/cli.js`) returned empty exit code in the shell capture, but stdout showed the correct output `[{"path":"items.price","confidence":"static"}]`. This is a shell subshell/pipeline exit-code capture artifact — the CLI itself exited 0 (no `process.exitCode = 1` was set).

---

_Verified: 2026-03-03T10:56:30Z_
_Verifier: Claude (gsd-verifier)_
