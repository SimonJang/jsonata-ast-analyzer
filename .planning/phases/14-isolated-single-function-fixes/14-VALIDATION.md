---
phase: 14
slug: isolated-single-function-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~1 second |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 1 second

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | PRNT-01 | integration | `pnpm vitest run test/integration/api-reshaping.test.ts -x` | ✅ (skipped fixture) | ⬜ pending |
| 14-01-02 | 01 | 1 | PRNT-02 | integration | `pnpm vitest run test/integration/api-reshaping.test.ts -x` | ✅ (skipped fixture) | ⬜ pending |
| 14-01-03 | 01 | 1 | PRNT-03 | integration | `pnpm vitest run test/integration/api-reshaping.test.ts -x` | ❌ (to create) | ⬜ pending |
| 14-02-01 | 02 | 1 | WVAR-01 | integration | `pnpm vitest run test/integration/data-export.test.ts -x` | ✅ (skipped fixture) | ⬜ pending |
| 14-02-02 | 02 | 1 | WVAR-02 | integration | `pnpm vitest run test/integration/data-export.test.ts -x` | ❌ (to create) | ⬜ pending |
| 14-03-01 | 03 | 1 | LOOK-01 | integration | `pnpm vitest run test/integration/business-rules.test.ts test/integration/edge-cases.test.ts -x` | ✅ (skipped fixture) | ⬜ pending |
| 14-03-02 | 03 | 1 | LOOK-02 | integration | `pnpm vitest run test/integration/edge-cases.test.ts -x` | ✅ (skipped fixture) | ⬜ pending |
| 14-03-03 | 03 | 1 | LOOK-03 | integration | `pnpm vitest run test/integration/business-rules.test.ts test/integration/edge-cases.test.ts -x` | ❌ (to create) | ⬜ pending |
| 14-04-01 | 04 | 1 | ARRS-01 | integration | `pnpm vitest run test/integration/edge-cases.test.ts -x` | ✅ (skipped fixture) | ⬜ pending |
| 14-04-02 | 04 | 1 | ARRS-02 | integration | `pnpm vitest run test/integration/edge-cases.test.ts -x` | ❌ (to create) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements:
- `assertFixture()` helper in `test/integration/helpers.ts`
- `IntegrationFixture` type (ExactFixture | SubsetFixture)
- All 4 target test files exist with BUG(v1.2) skipped fixtures
- vitest configured and running 200 tests in ~300ms

*No Wave 0 needed.*

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 1s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
