# Requirements: JSONata AST Path Analyzer

**Defined:** 2026-03-09
**Core Value:** Given any JSONata expression, accurately identify every data path read from the input object -- including paths accessed through variable assignments, filter predicates, and function arguments.

## v1.1.3 Requirements

Requirements for documentation milestone. Each maps to roadmap phases.

### Overview

- [x] **OVVW-01**: README opens with a clear one-line description of what the library does and who it's for
- [x] **OVVW-02**: README includes a quick example (expression -> output) before installation instructions

### Installation

- [x] **INST-01**: README shows pnpm/npm/yarn install commands
- [x] **INST-02**: README notes ESM-only requirement (no CommonJS/require)

### API Reference

- [x] **API-01**: README documents the `extractPaths(expression)` function with signature, parameters, return type, and error behavior
- [x] **API-02**: README documents the `PathResult` interface (`path` + `confidence` fields)
- [x] **API-03**: README documents the `Confidence` type with a table explaining `static`, `dynamic`, and `partial` levels with examples

### CLI

- [ ] **CLI-01**: README documents `jsonata-paths` argument mode with example
- [ ] **CLI-02**: README documents `jsonata-paths` stdin/pipe mode with example
- [ ] **CLI-03**: README includes shell quoting note for `$` in JSONata expressions

### Examples

- [ ] **EXMP-01**: README includes 3-5 progressive examples demonstrating all three confidence levels across real usage patterns

### Architecture

- [ ] **ARCH-01**: README includes a "How it works" section with ASCII pipeline diagram showing expression -> parse -> walk -> extract -> classify flow
- [ ] **ARCH-02**: README explains the over-approximation design principle (superset of actual paths)

### Limitations

- [ ] **LMTS-01**: README documents limitations framed as design decisions (static-only, over-approximation, dynamic path wildcards)

### License

- [x] **LIC-01**: README includes license section

## Future Requirements

None -- documentation milestone is self-contained.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Badges (CI, TypeScript, Node, ESM) | User chose clean content without badges |
| Table of contents | User chose clean content without TOC |
| Separate docs site (TypeDoc/Docusaurus) | API surface is 1 function + 2 types -- overkill |
| Mermaid diagrams | npm doesn't render Mermaid; ASCII art is universal |
| test:readme script | Nice-to-have but out of scope for this milestone |
| Contributing guide | Single-maintainer project, not needed yet |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OVVW-01 | Phase 18 | Complete |
| OVVW-02 | Phase 18 | Complete |
| INST-01 | Phase 18 | Complete |
| INST-02 | Phase 18 | Complete |
| LIC-01 | Phase 18 | Complete |
| API-01 | Phase 19 | Complete |
| API-02 | Phase 19 | Complete |
| API-03 | Phase 19 | Complete |
| CLI-01 | Phase 20 | Pending |
| CLI-02 | Phase 20 | Pending |
| CLI-03 | Phase 20 | Pending |
| EXMP-01 | Phase 21 | Pending |
| ARCH-01 | Phase 22 | Pending |
| ARCH-02 | Phase 22 | Pending |
| LMTS-01 | Phase 22 | Pending |

**Coverage:**
- v1.1.3 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-03-09*
*Last updated: 2026-03-09 after roadmap creation*
