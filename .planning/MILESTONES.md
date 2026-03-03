# Milestones

## v1.0 MVP (Shipped: 2026-03-03)

**Phases:** 7 | **Plans:** 11 | **Tests:** 105
**Source:** 1,116 LOC TypeScript + 848 LOC tests
**Timeline:** 2 days (2026-03-02 → 2026-03-03)
**Git range:** `feat(01-01)` → `feat(07-01)` (86 commits)

**Delivered:** A static analysis library that extracts every data path a JSONata expression reads from its input — including paths through variables, filters, lambdas, parent operators, and dynamic computations — as both a TypeScript API and CLI tool.

**Key accomplishments:**
1. Custom AST type system (13 discriminated union types) with parser adapter wrapping official JSONata parser
2. Recursive type-dispatch walker extracting all leaf data paths from expressions
3. Immutable scope chain with variable resolution, lambda tracing, and higher-order function binding ($map, $filter, $reduce, $each, $sift, $sort)
4. Context-relative operators: filter predicates, sort expressions, group-by, and transform with correct path prefixing
5. Parent operator resolution, dynamic path wildcarding, and confidence annotations (static/dynamic/partial)
6. Public API (`extractPaths`) and CLI tool (`jsonata-paths`) with stdin/argument input

**Archives:** `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`

---

