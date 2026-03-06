---
phase: 16
slug: filter-predicate-scope-awareness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~1 second |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 2 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | FILT-01 | integration | `npx vitest run test/integration/data-transforms.test.ts` | Exists (skip) | pending |
| 16-01-02 | 01 | 1 | FILT-02 | integration | `npx vitest run test/integration/data-transforms.test.ts` | Exists (skip) | pending |
| 16-01-03 | 01 | 1 | FILT-03 | integration | `npx vitest run test/integration/data-transforms.test.ts` | Wave 0 | pending |
| 16-01-04 | 01 | 1 | FILT-04 | integration | `npx vitest run test/integration/business-rules.test.ts` | Exists (skip) | pending |
| 16-01-05 | 01 | 1 | FILT-05 | integration | `npx vitest run test/integration/data-transforms.test.ts` | Wave 0 | pending |
| 16-02-01 | 02 | 2 | FOCV-01 | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Exists (skip) | pending |
| 16-02-02 | 02 | 2 | FOCV-02 | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Exists (skip) | pending |
| 16-02-03 | 02 | 2 | FOCV-03 | integration | `npx vitest run test/integration/api-reshaping.test.ts` | Wave 0 | pending |

*Status: pending · green · red · flaky*

---

## Wave 0 Requirements

- [ ] FILT regression tests in `test/integration/data-transforms.test.ts` and `test/integration/business-rules.test.ts` — 10+ new tests as new `describe` blocks covering filter+HOF variations
- [ ] FOCV regression tests in `test/integration/api-reshaping.test.ts` — 10+ new tests as new `describe` block covering focus variable and variable-in-filter variations

*Existing infrastructure covers all phase requirements. No new test files or framework changes needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
