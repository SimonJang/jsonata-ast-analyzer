import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("external reads in projected alias suffixes", () => {
  it.each([
    '($f:=function(){other.amount};rows.{"copy":details}.{"out":$f()})',
    '($f:=function(){other.amount};rows.{"copy":details}^($count(copy)).{"out":$f()})',
    '($x:=other;rows.{"copy":details}.{"out":$x.amount})',
    '($x:=other;rows.{"copy":details}.[$x.amount])',
    '($x:=other;rows.{"copy":details}.($x.amount+1))',
  ])("keeps external origins absolute in %s", async (source) => {
    let reads = 0;
    const input = { other: { get amount() { reads++; return 20; } }, rows: [{ details: { amount: 10 } }, { details: { amount: 10 } }] };
    expect(await jsonata(source).evaluate(input)).toBeDefined();
    expect(reads).toBeGreaterThan(0);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("other.amount");
  });
});
