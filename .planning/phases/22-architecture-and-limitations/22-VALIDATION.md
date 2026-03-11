---
phase: 22
slug: architecture-and-limitations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test:unit` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Visual review of README section content
- **After every plan wave:** Run `pnpm test` (ensure no existing tests broken by file edits)
- **Before `/gsd:verify-work`:** Full suite must be green; visual confirmation of all three sections
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 22-01-01 | 01 | 1 | ARCH-01 | manual-only | N/A — prose content in README | N/A | ⬜ pending |
| 22-01-02 | 01 | 1 | ARCH-02 | manual-only | N/A — prose content in README | N/A | ⬜ pending |
| 22-01-03 | 01 | 1 | LMTS-01 | manual-only | N/A — prose content in README | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No new test files needed — this is a documentation-only phase.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| README has "How it works" section with ASCII pipeline diagram | ARCH-01 | Prose content — not testable via automated tests | Verify README contains diagram showing expression string → parse → walk → dedupe → classify → PathResult[] flow |
| README explains over-approximation design principle | ARCH-02 | Prose content — not testable via automated tests | Verify paragraph explains superset reporting and why false positives are preferable to false negatives |
| README documents 3 limitations as design decisions | LMTS-01 | Prose content — not testable via automated tests | Verify static-only analysis, dynamic path wildcards, and parent operator approximation are each framed as deliberate choices with rationale |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
