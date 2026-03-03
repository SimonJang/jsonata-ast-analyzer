---
phase: 04-advanced-analysis
plan: "02"
subsystem: path-extraction
tags: [tdd, types, confidence, annotation, adv-03]
dependency_graph:
  requires: [04-01]
  provides: [confidence-annotation, derive-confidence]
  affects: [src/types.ts, src/index.ts, test/extract-paths.test.ts]
tech_stack:
  added: []
  patterns: [confidence-derivation, post-processing-pass, tdd-red-green]
key_files:
  created: []
  modified:
    - src/types.ts
    - src/index.ts
    - test/extract-paths.test.ts
decisions:
  - "Export deriveConfidence from src/index.ts to enable direct unit testing"
  - "Standalone '%' is a S0217 parse error in JSONata — ADV-03 test corrected to toThrow()"
  - "Confidence derivation is a post-processing pass after dedup — no walker refactor needed"
metrics:
  duration: "4 min"
  completed: "2026-03-03"
  tasks_completed: 4
  files_modified: 3
---

# Phase 4 Plan 02: Confidence Annotation on PathResult Summary

**One-liner:** Post-processing confidence annotation on all PathResult objects using split-based `%` detection and string-level `[*]` detection with priority partial > dynamic > static.

## What Was Built

ADV-03 adds a machine-readable `confidence` field to every `PathResult` returned by `extractPaths`. The field classifies how certain the path is at analysis time:

- `"static"` — fully resolvable: plain paths, explicit wildcards (`item.*`, `**.price`)
- `"dynamic"` — contains a computed bracket wildcard (`item[*]`), emitted by Plan 04-01 for unresolvable `$variable` filters
- `"partial"` — contains a parent operator `%` as a whole dot-segment (`items.%.name`), emitted by Plan 04-01

Priority: `"partial"` beats `"dynamic"` beats `"static"`.

The `deriveConfidence(path: string): Confidence` function is exported from `src/index.ts` for direct testability.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Confidence type and update PathResult (RED) | 4605fcb | src/types.ts |
| 2 | Implement deriveConfidence and update extractPaths (partial GREEN) | e7c7b0e | src/index.ts |
| 3 | Update all 94 existing test assertions to include confidence (GREEN) | ca8b066 | test/extract-paths.test.ts |
| 4 | Add ADV-03 confidence-specific tests | 8cdd987 | test/extract-paths.test.ts |

## Verification Results

```
Test Files  1 passed (1)
      Tests  102 passed (102)
   Duration  191ms
```

TypeScript: `npx tsc --noEmit` exits 0, no errors.

All three ADV requirements now satisfied:
- ADV-01: parent operator `%` segment from Plan 04-01
- ADV-02: dynamic `[*]` bracket wildcard from Plan 04-01
- ADV-03: confidence annotation on all PathResult objects (this plan)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed standalone '%' test in ADV-03 block**
- **Found during:** Task 4
- **Issue:** Plan spec included `expect(extractPaths("%")).toEqual([{ path: "%", confidence: "partial" }])` but standalone `%` is a JSONata S0217 parse error — only valid inside a multi-step path or filter context (documented in STATE.md decisions from Plan 04-01)
- **Fix:** Changed test to `expect(() => extractPaths("%")).toThrow()` which correctly documents the parse error behavior
- **Files modified:** test/extract-paths.test.ts
- **Commit:** 8cdd987

## Key Decisions

1. **Export deriveConfidence:** Made `deriveConfidence` a named export from `src/index.ts` rather than keeping it internal. This allows direct unit testing of the priority logic (partial > dynamic > static) without needing contrived integration test expressions.

2. **Standalone '%' test corrected:** The plan spec's `extractPaths("%")` test was wrong — JSONata S0217 error applies. Corrected to `toThrow()`. This aligns with the documented decision from Plan 04-01.

3. **Post-processing pattern:** Confidence derivation is a pure string post-processing pass applied after deduplication in `extractPaths`. No walker changes needed — the walker already emits `%` and `[*]` markers correctly from Plan 04-01.

## Self-Check: PASSED

- FOUND: src/types.ts
- FOUND: src/index.ts
- FOUND: test/extract-paths.test.ts
- FOUND: 04-02-SUMMARY.md
- FOUND commit: 4605fcb (RED - types)
- FOUND commit: e7c7b0e (partial GREEN - index.ts)
- FOUND commit: ca8b066 (GREEN - test assertions)
- FOUND commit: 8cdd987 (ADV-03 tests)
