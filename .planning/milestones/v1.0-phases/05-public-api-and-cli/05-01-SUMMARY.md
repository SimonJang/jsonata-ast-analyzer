---
phase: 05-public-api-and-cli
plan: 01
subsystem: api
tags: [typescript, tsup, cli, esm, vitest, node]

# Dependency graph
requires:
  - phase: 04-advanced-analysis
    provides: extractPaths() with confidence annotations, deriveConfidence internal utility

provides:
  - Clean public API: extractPaths, PathResult, Confidence exported; deriveConfidence internal only
  - CLI binary src/cli.ts reading from argv[2] or piped stdin, outputting PathResult[] JSON
  - tsup array config building typed library bundle + executable CLI with shebang
  - package.json bin field wiring jsonata-paths command to dist/cli.js

affects: [consumers, packaging, npm-publish, integration-tests]

# Tech tracking
tech-stack:
  added: ["@types/node ^25.3.3 (devDependency for CLI TypeScript compilation)"]
  patterns: ["tsup array config for multi-entry builds (library + CLI)", "process.exitCode pattern for graceful async CLI termination"]

key-files:
  created:
    - src/cli.ts
  modified:
    - src/index.ts
    - tsup.config.ts
    - package.json
    - tsconfig.json
    - test/extract-paths.test.ts

key-decisions:
  - "deriveConfidence removed from export surface — internal utility stays in src/index.ts but not accessible to library consumers"
  - "@types/node added to devDependencies and tsconfig types array to resolve CLI compilation errors"
  - "tsup array config: first entry has clean:true (wipes dist/), second entry omits clean to preserve library output"
  - "process.exitCode=1 + return pattern used instead of process.exit(1) for graceful async termination without truncating output"

patterns-established:
  - "Multi-entry tsup builds: array defineConfig with clean only on first entry to avoid wipe conflicts"
  - "CLI stdin detection: process.stdin.isTTY check prevents hang on interactive terminal"

requirements-completed: [API-01, API-02]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 5 Plan 01: Public API and CLI Summary

**Clean TypeScript library API (extractPaths/PathResult/Confidence only) plus jsonata-paths CLI binary built with tsup array config producing dist/index.js, dist/index.d.ts, and dist/cli.js**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-03T09:51:37Z
- **Completed:** 2026-03-03T09:53:30Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Removed `deriveConfidence` from public export surface — clean API with only `extractPaths`, `PathResult`, `Confidence`
- Created `src/cli.ts` binary reading from argv[2] or piped stdin, outputs PathResult[] JSON to stdout
- Converted tsup.config.ts to array config building typed library and shebang-injected CLI binary
- Added `bin` field to package.json wiring `jsonata-paths` command to `./dist/cli.js`
- All 101 vitest tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Clean src/index.ts export surface and fix test** - `9e51061` (feat)
2. **Task 2: Create src/cli.ts CLI entry** - `302622f` (feat)
3. **Task 3: Update tsup.config.ts and package.json, then build** - `81fdb62` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/index.ts` - Removed `export` from `deriveConfidence`; function remains as internal utility
- `src/cli.ts` - New CLI entry point: argv[2] or stdin, PathResult[] JSON to stdout, errors to stderr
- `tsup.config.ts` - Array config: library entry (dts:true, clean:true) + CLI entry (banner shebang, dts:false)
- `package.json` - Added `bin` field: `"jsonata-paths": "./dist/cli.js"`; added `@types/node` devDependency
- `tsconfig.json` - Added `"node"` to `types` array to enable Node.js globals in CLI source
- `test/extract-paths.test.ts` - Removed `deriveConfidence` import and direct-call test case

## Decisions Made
- `deriveConfidence` stays as non-exported function in `src/index.ts` — used internally by `extractPaths()`, kept for readability but not public API
- `@types/node` required as devDependency because tsconfig had explicit `types` array that excluded Node.js globals
- `clean:true` on library entry only — CLI entry must not clean dist/ or it wipes the previously-built library output
- `process.exitCode = 1; return` used instead of `process.exit(1)` to allow async writes to flush before exit

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed @types/node and updated tsconfig**
- **Found during:** Task 2 (Create src/cli.ts CLI entry)
- **Issue:** tsconfig.json had `"types": ["vitest/globals"]` which excluded Node.js type definitions; `process`, `process.argv`, `process.stdin.isTTY`, and `node:readline` were all unresolved, producing 10 TypeScript errors
- **Fix:** Ran `pnpm add -D @types/node`; added `"node"` to `types` array in tsconfig.json
- **Files modified:** `package.json`, `tsconfig.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm typecheck` exits 0 with zero errors; `pnpm test` still passes 101 tests
- **Committed in:** `302622f` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix was essential for compilation. No scope creep — @types/node is a standard Node.js dev dependency.

## Issues Encountered
None beyond the @types/node blocking issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 5 Plan 01 is the only plan in Phase 5 — this completes the phase
- All deliverables ready: typed library (`dist/index.js` + `dist/index.d.ts`) and CLI binary (`dist/cli.js`)
- `pnpm build` is fully functional; `pnpm test` passes 101 tests
- Package ready for publishing: `bin` field wired, exports configured, types declared

## Self-Check: PASSED

All created files verified present:
- src/index.ts: FOUND
- src/cli.ts: FOUND
- tsup.config.ts: FOUND
- dist/index.js: FOUND
- dist/index.d.ts: FOUND
- dist/cli.js: FOUND
- 05-01-SUMMARY.md: FOUND

All task commits verified:
- 9e51061: FOUND (Task 1)
- 302622f: FOUND (Task 2)
- 81fdb62: FOUND (Task 3)

---
*Phase: 05-public-api-and-cli*
*Completed: 2026-03-03*
