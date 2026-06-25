import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { extractPaths } from "../../src/index.js";
import { sortPaths } from "../integration/helpers.js";
import { corpusFixtures } from "./corpus-fixtures.js";

describe("500+ JSONata corpus", () => {
  it("contains at least 500 distinct expressions", () => {
    const expressions = new Set(corpusFixtures.map((fixture) => fixture.expression));

    expect(corpusFixtures.length).toBeGreaterThanOrEqual(500);
    expect(expressions.size).toBe(corpusFixtures.length);
  });

  it("covers the required construct categories", () => {
    expect(new Set(corpusFixtures.map((fixture) => fixture.category))).toEqual(
      new Set([
        "basic paths",
        "path stages",
        "variables and functions",
        "partials",
        "regex",
        "constructors",
        "transforms",
        "mixed combinations",
      ]),
    );
  });

  describe("parser acceptance", () => {
    for (const fixture of corpusFixtures) {
      it(`${fixture.category}: ${fixture.name}`, () => {
        expect(() => jsonata(fixture.expression).ast()).not.toThrow();
      });
    }
  });

  describe("path extraction", () => {
    for (const fixture of corpusFixtures) {
      it(`${fixture.category}: ${fixture.name}`, () => {
        expect(sortPaths(extractPaths(fixture.expression))).toEqual(
          sortPaths(fixture.expectedPaths),
        );
      });
    }
  });
});
