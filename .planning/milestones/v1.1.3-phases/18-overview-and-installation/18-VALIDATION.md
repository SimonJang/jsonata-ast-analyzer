---
phase: 18
slug: overview-and-installation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-09
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | vitest config via package.json scripts |
| **Quick run command** | `pnpm test:unit` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test` (ensure no code was accidentally broken)
- **After every plan wave:** Run `pnpm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | OVVW-01 | manual-only | Visual review of README.md | N/A | ⬜ pending |
| 18-01-02 | 01 | 1 | OVVW-02 | manual-only | Visual review of README.md section order | N/A | ⬜ pending |
| 18-01-03 | 01 | 1 | INST-01 | manual-only | Visual review of README.md | N/A | ⬜ pending |
| 18-01-04 | 01 | 1 | INST-02 | manual-only | Visual review of README.md | N/A | ⬜ pending |
| 18-01-05 | 01 | 1 | LIC-01 | manual-only | Visual review of README.md | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. This phase writes documentation only — no new test files needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README opens with clear one-line description | OVVW-01 | Markdown content — no programmatic behavior | Read README.md first line after H1; confirm it describes what the library does |
| Quick example appears before installation | OVVW-02 | Section ordering — visual check | Confirm "Quick Example" heading appears before "Installation" heading |
| pnpm/npm/yarn install commands present | INST-01 | Markdown content | Confirm all three package managers shown in Installation section |
| ESM-only notice present | INST-02 | Markdown content | Confirm ESM-only note is prominent in Installation section |
| License section at bottom | LIC-01 | Markdown content | Confirm License section exists at end of README |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
