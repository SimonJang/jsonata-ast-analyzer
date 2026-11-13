import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("sort keys capturing external values", () => {
  it.each([
    ['($x:=other.details;rows.{"copy":details}^($x.amount).copy)', 2],
    ['($f:=function(){other.details.amount};rows.{"copy":details}^($f()).copy)', 2],
    ['($x:=other.details;rows.{"copy":details}^($custom($x)).copy)', 2],
    ['($x:=other.details;rows.{"copy":details,"name":name}^($count($x:=copy))[$x.amount>0].name)', 1],
    ['($f:=function(){other.details.amount};rows.{"copy":details,"name":name}^($count($f:=function(){copy.amount}))[$f()>0].name)', 1],
  ] as const)("keeps external paths absolute in %s", async (source, count) => {
    let reads = 0;
    const input = {
      other: { details: { get amount() { reads++; return 20; } } },
      rows: Array.from({ length: count }, () => ({ name: "row", details: { amount: 10 } })),
    };
    const expression = jsonata(source);
    expression.registerFunction("custom", (value: { amount: number }) => value.amount);
    expect(await expression.evaluate(input)).toBeDefined();
    expect(reads).toBeGreaterThan(0);
    const accesses = analyzeExpression(source).accesses;
    expect(accesses.some(({ path, coverage }) =>
      path === "other.details.amount" || path === "other.details.**" ||
      path === "other.details" && coverage === "subtree")).toBe(true);
    expect(accesses.some(({ path }) => path.startsWith("rows.other."))).toBe(false);
  });
});
