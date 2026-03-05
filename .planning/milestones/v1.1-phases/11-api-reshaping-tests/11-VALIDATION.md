---
phase: 11
slug: api-reshaping-tests
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest config via package.json |
| **Quick run command** | `npx vitest run test/integration/api-reshaping.test.ts` |
| **Full suite command** | `npm run test:integration` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/integration/api-reshaping.test.ts`
- **After every plan wave:** Run `npm run test:integration`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | APIR-01 | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only | ⬜ pending |
| 11-01-02 | 01 | 1 | APIR-02 | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only | ⬜ pending |
| 11-01-03 | 01 | 1 | APIR-03 | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only | ⬜ pending |
| 11-01-04 | 01 | 1 | APIR-04 | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only | ⬜ pending |
| 11-01-05 | 01 | 1 | APIR-05 | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only | ⬜ pending |
| 11-01-06 | 01 | 1 | APIR-01,02,03 | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Skeleton only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

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
