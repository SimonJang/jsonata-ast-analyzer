import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("chained assignment origins", () => {
  it.each([
    '($x:=other;[$x:=record,$y:=$append([],$x)];$clone($y))',
    '($x:=other;{"a":$x:=record,"b":$y:=$append([],$x)};$clone($y))',
    '($x:=other;$append($x:=record,$y:=$x);$clone($y))',
    '($x:=other;$g:=function(){$x};[$x:=record,$y:=$append([],$g())];$clone($y))',
    '($x:=other;[$y:=$append($reverse([]),$x),$x:=record];$clone($y))',
    '($x:=other;{"b":$y:=$append($reverse([]),$x),"a":$x:=record};$clone($y))',
    '($x:=other;$y:=other;[$z:=$append($reverse($reverse($reverse($reverse([])))),$y),$y:=$append($reverse([]),$x),$x:=record];$clone($z))',
  ])("retains new sources captured by a later assignment in %s", async (source) => {
    let reads = 0;
    const record = { details: { get amount() { reads++; return 10; } } };
    await jsonata(source).evaluate({ record, other: { details: { amount: 20 } } });
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
  });

  it("retains old values captured before a sibling write completes", async () => {
    const source = '($x:=other;[$x:=record,$y:=$x];$clone($y))';
    const other = { details: { amount: 20 } };
    expect(await jsonata(source).evaluate({ record: { details: { amount: 10 } }, other })).toEqual(other);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.**", confidence: "static", coverage: "exact",
    });
  });

  it("keeps scalar results separate from their variable dependencies", async () => {
    const source = '($x:=other;[$x:=record,$y:=$count($x)];$custom($y))';
    const expression = jsonata(source);
    expression.registerFunction("custom", (value: number) => value + 1, "<n:n>");
    expect(await expression.evaluate({ record: { details: { amount: 10 } }, other: {} })).toBe(2);
    expect(analyzeExpression(source).accesses.some(({ path }) => path.endsWith(".**"))).toBe(false);
  });
});
