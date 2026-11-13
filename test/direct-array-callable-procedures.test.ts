import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("direct array-selected function procedures", () => {
  it.each([
    '[function(){other.amount}][0]()',
    '[function(){0},function(){other.amount}][1]()',
    '[function($x){$x.amount}][0](other)',
  ])("retains callable dependencies in %s", async (source) => {
    let reads = 0;
    expect(await jsonata(source).evaluate({ other: { get amount() { reads++; return 10; } } })).toBe(10);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("other.amount");
  });
});
