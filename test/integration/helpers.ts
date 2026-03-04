import { expect } from "vitest";
import { extractPaths } from "../../src/index.js";
import type { PathResult } from "../../src/index.js";

// --- Fixture Types ---

/** Base fields shared by all fixture modes */
interface FixtureBase {
  /** Human-readable test name -- IS the documentation */
  name: string;
  /** JSONata expression to analyze */
  expression: string;
}

/** Exact match mode -- asserts the full set of paths */
interface ExactFixture extends FixtureBase {
  expectedPaths: PathResult[];
  mustContain?: never;
  mustNotContain?: never;
}

/** Subset match mode -- asserts presence/absence of specific paths */
interface SubsetFixture extends FixtureBase {
  expectedPaths?: never;
  mustContain?: PathResult[];
  mustNotContain?: PathResult[];
}

export type IntegrationFixture = ExactFixture | SubsetFixture;

// --- Utilities ---

/**
 * Sort PathResult arrays deterministically for order-agnostic comparison.
 * Primary sort: path string (localeCompare)
 * Secondary sort: confidence string (localeCompare)
 * Does NOT mutate the input array.
 */
export function sortPaths(paths: PathResult[]): PathResult[] {
  return [...paths].sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return a.confidence.localeCompare(b.confidence);
  });
}

// --- Assertion ---

/**
 * One-liner assertion for integration test fixtures.
 * Calls extractPaths() internally and compares sorted results.
 *
 * Exact mode: expects sorted actual to equal sorted expectedPaths
 * Subset mode: checks mustContain paths are present, mustNotContain paths are absent
 */
export function assertFixture(fixture: IntegrationFixture): void {
  const actual = extractPaths(fixture.expression);
  const sortedActual = sortPaths(actual);

  if ("expectedPaths" in fixture && fixture.expectedPaths !== undefined) {
    // Exact match mode
    const sortedExpected = sortPaths(fixture.expectedPaths);
    expect(
      sortedActual,
      `Expression: ${fixture.expression}\n` +
        `Expected ${sortedExpected.length} paths, got ${sortedActual.length}`,
    ).toEqual(sortedExpected);
  } else {
    // Subset match mode
    if (fixture.mustContain) {
      for (const required of fixture.mustContain) {
        const found = sortedActual.some(
          (p) =>
            p.path === required.path && p.confidence === required.confidence,
        );
        expect(
          found,
          `Expression: ${fixture.expression}\n` +
            `Missing: ${JSON.stringify(required)}\n` +
            `Actual paths: ${JSON.stringify(sortedActual, null, 2)}`,
        ).toBe(true);
      }
    }
    if (fixture.mustNotContain) {
      for (const forbidden of fixture.mustNotContain) {
        const found = sortedActual.some(
          (p) =>
            p.path === forbidden.path && p.confidence === forbidden.confidence,
        );
        expect(
          found,
          `Expression: ${fixture.expression}\n` +
            `Unexpected: ${JSON.stringify(forbidden)}\n` +
            `Actual paths: ${JSON.stringify(sortedActual, null, 2)}`,
        ).toBe(false);
      }
    }
  }
}
