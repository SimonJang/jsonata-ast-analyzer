import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("projections consuming earlier assignment effects", () => {
  it("retains registered function argument origins after sort assignments", async () => {
    const source = '($x:=other;rows^($count($x:=details)).{"out":$custom($x)})';
    let reads = 0;
    const rows = Array.from({ length: 2 }, () => ({ details: { get amount() { reads++; return 10; } } }));
    const expression = jsonata(source);
    expression.registerFunction("custom", (value: { amount: number }) => value.amount);
    expect(await expression.evaluate({ other: { amount: 20 }, rows })).toBeDefined();
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("rows.details.**");
  });

  it.each([
    '($x:=other;rows^($count($x:=details)).{"out":$x.amount})',
    '($x:=other;rows^($count($x:=details)).[$x.amount])',
    '($x:=other;rows^($count($x:=details)).($x.amount+1))',
    '($x:=other;$r:=rows;$r^($count($x:=details)).{"out":$x.amount})',
    '($x:=other;$reverse(rows)^($count($x:=details)).{"out":$x.amount})',
    '($x:=other;rows.{"copy":details}^($count($x:=copy)).{"out":$x.amount})',
    '($x:=other;rows.{"a":$x:=details}.{"out":$x.amount})',
    '($x:=other;rows[$exists($x:=details)].{"out":$x.amount})',
    '($f:=function(){other.amount};rows^($count($f:=function(){details.amount})).{"out":$f()})',
  ])("retains prefix assignment origins in %s", async (source) => {
    let reads = 0;
    const rows = Array.from({ length: 2 }, () => ({ details: { get amount() { reads++; return 10; } } }));
    const result = await jsonata(source).evaluate({ other: { amount: 20 }, rows });
    expect(result).toBeDefined();
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("rows.details.amount");
  });
});
