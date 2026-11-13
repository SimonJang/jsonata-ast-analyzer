import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("registered functions over constructed contexts", () => {
  it.each([
    'rows.{"copy":details}.$custom(copy)',
    '($r:=rows;$r.{"copy":details}.$custom(copy))',
    '($r:=rows;$r.{"copy":details,"name":name}^($count($x:=copy),$custom($x)).name)',
    '($r:=rows;$r.{"copy":details,"name":name}^($count($x:=copy))[$custom($x)>0].name)',
    '$map(rows.{"copy":details},function($v){$custom($v.copy)})',
  ])("covers the actual argument sources in %s", async (source) => {
    let reads = 0;
    const input = { rows: Array.from({ length: 2 }, () => ({ name: "row", details: { get amount() { reads++; return 10; } } })) };
    const expression = jsonata(source);
    expression.registerFunction("custom", (value: { amount: number }) => value.amount);
    expect(await expression.evaluate(input)).toBeDefined();
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("rows.details.**");
  });
});
