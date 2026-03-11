---
phase: 22-architecture-and-limitations
plan: 01
subsystem: docs
tags: [readme, architecture, limitations, ascii-diagram, over-approximation]

# Dependency graph
requires:
  - phase: 21-progressive-examples
    provides: "Examples section demonstrating all confidence levels"
  - phase: 19-api-reference
    provides: "API types and confidence level definitions"
provides:
  - "How It Works section with ASCII pipeline diagram and stage descriptions"
  - "Over-approximation design principle explanation"
  - "Limitations section with three design-decision-framed items"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["ASCII pipeline diagram for architecture visualization", "Limitations framed as design decisions with rationale"]

key-files:
  created: []
  modified: ["README.md"]

key-decisions:
  - "Over-approximation paragraph placed inline at end of How It Works (not a separate subsection)"
  - "Walk stage description mentions variable assignments, filter predicates, and function arguments without exposing implementation details"
  - "Limitations use active voice framing: 'The analyzer does X' not 'Unfortunately the analyzer cannot'"

patterns-established:
  - "Design limitation framing: bold heading + rationale sentence explaining deliberate trade-off"

requirements-completed: [ARCH-01, ARCH-02, LMTS-01]

# Metrics
duration: 2min
completed: 2026-03-11
---

# Phase 22 Plan 01: Architecture and Limitations Summary

**README How It Works section with ASCII pipeline diagram showing parse/walk/dedupe/classify stages, over-approximation design principle, and three limitations framed as deliberate design decisions**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-11T09:56:20Z
- **Completed:** 2026-03-11T09:57:53Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- ASCII pipeline diagram showing the 5-stage flow from expression string to PathResult[] with conceptual labels
- Prose descriptions of parse, walk, dedupe, and classify stages covering JSONata parser delegation, scope-aware variable tracing, Set dedup, and confidence classification
- Over-approximation paragraph explaining superset design and why false positives are safer than false negatives
- Three limitations (static analysis only, dynamic path wildcards, parent operator approximation) framed as deliberate design decisions with rationale

## Task Commits

Each task was committed atomically:

1. **Task 1: Write How It Works section** - `2e180d9` (feat)
2. **Task 2: Write Limitations section** - `6c4ad4f` (feat)

## Files Created/Modified
- `README.md` - Added How It Works content (pipeline diagram, stage descriptions, over-approximation paragraph) and Limitations content (three design-decision items)

## Decisions Made
- Over-approximation explanation placed as a closing paragraph within How It Works, bridging naturally to the Limitations section
- Walk stage description mentions the core value proposition (variable assignments, filter predicates, function arguments) at conceptual level without exposing scope chain or filter algorithm internals
- All three limitations use active voice and frame constraints as trade-offs with clear rationale

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- This is the final phase of the v1.1.3 documentation milestone
- All 15 requirements (OVVW-01/02, INST-01/02, API-01/02/03, CLI-01/02/03, EXMP-01, ARCH-01/02, LMTS-01, LIC-01) are now complete
- README is fully documented with all planned sections populated

## Self-Check: PASSED

- FOUND: README.md
- FOUND: 22-01-SUMMARY.md
- FOUND: 2e180d9 (Task 1 commit)
- FOUND: 6c4ad4f (Task 2 commit)

---
*Phase: 22-architecture-and-limitations*
*Completed: 2026-03-11*
