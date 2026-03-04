import { describe, it, expect } from "vitest";
import { sortPaths, assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";
import type { PathResult } from "../../src/index.js";

describe("sortPaths", () => {
  it("sorts by path string (primary key)", () => {
    const input: PathResult[] = [
      { path: "b", confidence: "static" },
      { path: "a", confidence: "static" },
    ];
    const result = sortPaths(input);
    expect(result).toEqual([
      { path: "a", confidence: "static" },
      { path: "b", confidence: "static" },
    ]);
  });

  it("sorts by confidence string (secondary key) when paths are equal", () => {
    const input: PathResult[] = [
      { path: "a", confidence: "static" },
      { path: "a", confidence: "dynamic" },
    ];
    const result = sortPaths(input);
    expect(result).toEqual([
      { path: "a", confidence: "dynamic" },
      { path: "a", confidence: "static" },
    ]);
  });

  it("does not mutate the input array", () => {
    const input: PathResult[] = [
      { path: "b", confidence: "static" },
      { path: "a", confidence: "static" },
    ];
    const inputCopy = [...input];
    sortPaths(input);
    expect(input).toEqual(inputCopy);
  });
});

describe("assertFixture", () => {
  describe("exact mode", () => {
    it("passes when expectedPaths match extractPaths() output", () => {
      const fixture: IntegrationFixture = {
        name: "simple dot-path",
        expression: "account.name",
        expectedPaths: [{ path: "account.name", confidence: "static" }],
      };
      // Should not throw
      expect(() => assertFixture(fixture)).not.toThrow();
    });

    it("fails when expectedPaths differ from extractPaths() output", () => {
      const fixture: IntegrationFixture = {
        name: "wrong expected paths",
        expression: "account.name",
        expectedPaths: [{ path: "wrong.path", confidence: "static" }],
      };
      // Should throw because paths don't match
      expect(() => assertFixture(fixture)).toThrow();
    });
  });

  describe("subset mode (mustContain)", () => {
    it("passes when all required paths are present in output", () => {
      const fixture: IntegrationFixture = {
        name: "contains required path",
        expression: "account.name",
        mustContain: [{ path: "account.name", confidence: "static" }],
      };
      expect(() => assertFixture(fixture)).not.toThrow();
    });

    it("fails when a required path is missing from output", () => {
      const fixture: IntegrationFixture = {
        name: "missing required path",
        expression: "account.name",
        mustContain: [{ path: "missing.path", confidence: "static" }],
      };
      expect(() => assertFixture(fixture)).toThrow();
    });
  });

  describe("subset mode (mustNotContain)", () => {
    it("fails when a forbidden path appears in output", () => {
      const fixture: IntegrationFixture = {
        name: "has forbidden path",
        expression: "account.name",
        mustNotContain: [{ path: "account.name", confidence: "static" }],
      };
      expect(() => assertFixture(fixture)).toThrow();
    });

    it("passes when forbidden paths are not in output", () => {
      const fixture: IntegrationFixture = {
        name: "no forbidden paths",
        expression: "account.name",
        mustNotContain: [{ path: "not.present", confidence: "static" }],
      };
      expect(() => assertFixture(fixture)).not.toThrow();
    });
  });
});
