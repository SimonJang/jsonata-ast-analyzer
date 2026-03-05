---
gsd_state_version: 1.0
milestone: v1.1.1
milestone_name: Bug Fixes
status: active
stopped_at: null
last_updated: "2026-03-05"
last_activity: 2026-03-05 -- Roadmap created for v1.1.1 (3 phases, 21 requirements)
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-05)

**Core value:** Given any JSONata expression, accurately identify every data path read from the input object -- including paths accessed through variable assignments, filter predicates, and function arguments.
**Current focus:** Phase 14 -- Isolated Single-Function Fixes

## Current Position

Phase: 14 of 16 (Isolated Single-Function Fixes)
Plan: --
Status: Ready to plan
Last activity: 2026-03-05 -- Roadmap created for v1.1.1

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Cumulative:**
- v1.0: 7 phases, 11 plans, 105 tests, 1,964 LOC
- v1.1: 6 phases, 6 plans, 200 tests, 3,510 LOC
- v1.1.1: 3 phases, 0 plans so far

## Accumulated Context

### Decisions

All decisions documented in PROJECT.md Key Decisions table.
Recent: Research recommends ascending regression risk ordering -- isolated fixes first (Phase 14), pipeline fixes second (Phase 15), coupled filter/focus fixes last (Phase 16).

### Pending Todos

None.

### Blockers/Concerns

- Phase 16 requires pre-implementation design for `extractBasePaths()` helper and `walkFilterStages` scope-awareness mechanism before coding begins.
- Phase 16 touches HOF parameter binding path used by 40+ existing passing tests -- highest regression risk in milestone.

## Session Continuity

Last session: 2026-03-05
Stopped at: Roadmap created for v1.1.1, ready to plan Phase 14
Resume file: None
