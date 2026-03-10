---
phase: 20
slug: cli-documentation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | CLI-01 | grep verification | `grep -c "### Argument Mode" README.md` | N/A (doc) | ⬜ pending |
| 20-01-02 | 01 | 1 | CLI-02 | grep verification | `grep -c "### Stdin Mode" README.md` | N/A (doc) | ⬜ pending |
| 20-01-03 | 01 | 1 | CLI-03 | grep verification | `grep -c "Correct" README.md && grep -c "Wrong" README.md` | N/A (doc) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. This is a documentation-only phase — verification is structural (grep-based) rather than test-based.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Documented examples are runnable | CLI-01, CLI-02 | Requires shell execution | Run `jsonata-paths 'account.name'` and `echo '$sum(orders.total)' \| jsonata-paths` — verify output matches README |
| Quoting note is clear and accurate | CLI-03 | Requires human readability check | Read the quoting note — verify correct/wrong comparison is understandable |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 3s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
