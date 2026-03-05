---
phase: 10
slug: business-rule-tests
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | package.json (vitest config section) |
| **Quick run command** | `npx vitest run test/integration/business-rules.test.ts` |
| **Full suite command** | `npm run test:integration` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/integration/business-rules.test.ts`
- **After every plan wave:** Run `npm run test:integration`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | BIZR-01 | integration | `npx vitest run test/integration/business-rules.test.ts` | ✅ skeleton | ⬜ pending |
| 10-01-02 | 01 | 1 | BIZR-02 | integration | `npx vitest run test/integration/business-rules.test.ts` | ✅ skeleton | ⬜ pending |
| 10-01-03 | 01 | 1 | BIZR-03 | integration | `npx vitest run test/integration/business-rules.test.ts` | ✅ skeleton | ⬜ pending |
| 10-01-04 | 01 | 1 | BIZR-04 | integration | `npx vitest run test/integration/business-rules.test.ts` | ✅ skeleton | ⬜ pending |
| 10-01-05 | 01 | 1 | BIZR-05 | integration | `npx vitest run test/integration/business-rules.test.ts` | ✅ skeleton | ⬜ pending |
| 10-01-06 | 01 | 1 | BIZR-01..05 | integration | `npx vitest run test/integration/business-rules.test.ts` | ✅ skeleton | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements:
- `test/integration/helpers.ts` — assertFixture, IntegrationFixture, sortPaths
- `test/integration/business-rules.test.ts` — skeleton file exists
- vitest configured and working

*No Wave 0 tasks needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
