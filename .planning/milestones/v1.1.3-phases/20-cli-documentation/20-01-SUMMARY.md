---
phase: 20-cli-documentation
plan: 01
subsystem: docs
tags: [cli, readme, documentation, shell-quoting]

# Dependency graph
requires:
  - phase: 18-overview-and-installation
    provides: "README skeleton with empty ## CLI Usage heading and formatting patterns"
provides:
  - "Complete CLI Usage section with argument mode, stdin mode, quoting note, and error behavior"
affects: [21-progressive-examples]

# Tech tracking
tech-stack:
  added: []
  patterns: ["blockquote callout for shell quoting note matching ESM notice style"]

key-files:
  created: []
  modified: [README.md]

key-decisions:
  - "Quoting note uses embedded sh code block with # Correct / # Wrong comments inside blockquote"
  - "Error behavior documented as single sentence, no error output example"

patterns-established:
  - "CLI documentation pattern: subsection per mode, command + output blocks, callout for pitfalls"

requirements-completed: [CLI-01, CLI-02, CLI-03]

# Metrics
duration: 1min
completed: 2026-03-10
---

# Phase 20 Plan 01: CLI Documentation Summary

**CLI usage section with argument mode, stdin/pipe mode, shell quoting callout for $ expressions, and error behavior**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-10T08:14:12Z
- **Completed:** 2026-03-10T08:14:55Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Argument Mode subsection with `jsonata-paths 'account.name'` example and compact JSON output
- Stdin Mode subsection with `echo '$sum(orders.total)' | jsonata-paths` example and compact JSON output
- Shell quoting note with correct/wrong comparison using `$sum(prices)`, matching existing `> **Note:**` callout style
- Error behavior one-liner: exit code 1, error to stderr

## Task Commits

Each task was committed atomically:

1. **Task 1: Write CLI Usage content in README.md** - `3388864` (docs)

**Plan metadata:** `94d1713` (docs: complete plan)

## Files Created/Modified
- `README.md` - Added CLI Usage content: Argument Mode, Stdin Mode, shell quoting note, error behavior (36 lines inserted)

## Decisions Made
- Quoting note uses an embedded `sh` code block inside the blockquote with `# Correct` and `# Wrong` comments, keeping the pattern self-contained
- Error behavior documented as a single standalone sentence after the quoting note, no code block for error output

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CLI Usage section complete, `## Examples` heading remains empty for Phase 21 (Progressive Examples)
- All three requirements (CLI-01, CLI-02, CLI-03) satisfied
- README section order preserved: API Reference > CLI Usage > Examples

## Self-Check: PASSED

All artifacts verified:
- README.md exists with Argument Mode, Stdin Mode, # Correct, # Wrong content
- Commit 3388864 exists in git log
- SUMMARY.md created at expected path

---
*Phase: 20-cli-documentation*
*Completed: 2026-03-10*
