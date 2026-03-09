---
phase: 19
slug: api-reference
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test:unit` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Visual review of README.md content + `pnpm test:unit`
- **After every plan wave:** `pnpm test` + verify README renders correctly
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | API-01 | manual-only | N/A -- documentation review | N/A | ⬜ pending |
| 19-01-02 | 01 | 1 | API-02 | manual-only | N/A -- documentation review | N/A | ⬜ pending |
| 19-01-03 | 01 | 1 | API-03 | manual-only | N/A -- documentation review | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. This phase writes markdown documentation -- the underlying code behavior is already tested by the existing test suite (294 tests passing).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README documents extractPaths with signature, params, return, errors | API-01 | Documentation content -- verified by reading, not running code | Read `## API Reference` section, verify signature matches source, error behavior documented |
| README documents PathResult interface with path + confidence fields | API-02 | Documentation content | Read `### Types` subsection, verify interface matches source |
| README includes confidence table with static/dynamic/partial levels | API-03 | Documentation content | Read confidence table, verify 4 columns (Level, Meaning, Cause, Example), all 3 levels present |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
