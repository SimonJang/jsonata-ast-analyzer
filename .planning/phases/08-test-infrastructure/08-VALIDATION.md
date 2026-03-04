---
phase: 8
slug: test-infrastructure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `npx vitest run test/integration/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | INFR-01 | smoke | `npx vitest run test/integration/ --reporter verbose` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | INFR-02 | typecheck | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | INFR-03 | unit | `npx vitest run test/integration/ -t "sortPaths"` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 1 | INFR-04 | smoke | `npx vitest run test/integration/ -t "smoke test"` | ❌ W0 | ⬜ pending |
| 08-01-05 | 01 | 1 | INFR-05 | manual-only | Run each npm script | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/integration/helpers.ts` — IntegrationFixture type + sortPaths() + assertFixture()
- [ ] `test/integration/data-transforms.test.ts` — smoke test fixture
- [ ] `test/integration/business-rules.test.ts` — empty placeholder
- [ ] `test/integration/api-reshaping.test.ts` — empty placeholder
- [ ] `test/integration/data-export.test.ts` — empty placeholder
- [ ] `test/integration/edge-cases.test.ts` — empty placeholder
- [ ] NPM scripts added to `package.json`

*All files created in Wave 0 (single wave phase).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| NPM scripts work correctly | INFR-05 | Script behavior verified by running, not assertions | Run `npm run test:unit`, `npm run test:integration`, `npm run test:update-snapshots` and verify correct output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
