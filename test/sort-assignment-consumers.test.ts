import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("consumers of sort key assignments", () => {
  it.each([
    '($x:=other;rows^($count($x:=details),$x.amount).name)',
    '($x:=other;rows^($count($x:=details))[$x.amount>0].name)',
    '($x:=other;$r:=rows;$r^($count($x:=details),$x.amount).name)',
    '($x:=other;$r:=rows;$r^($count($x:=details))[$x.amount>0].name)',
    '($x:=other;$reverse(rows)^($count($x:=details),$x.amount).name)',
    '($x:=other;$reverse(rows)^($count($x:=details))[$x.amount>0].name)',
    '($x:=other;rows.{"copy":details,"name":name}^($count($x:=copy),$x.amount).name)',
    '($x:=other;rows.{"copy":details,"name":name}^($count($x:=copy))[$x.amount>0].name)',
    '($x:=other;rows^($count($f:=function(){details.amount}),$f()).name)',
    '($x:=other;rows^($count($f:=function(){details.amount}))[$f()>0].name)',
  ])("retains prior sort writes in %s", async (source) => {
    let reads = 0;
    const rows = [10, 20].map((amount) => ({ name: String(amount), details: { get amount() { reads++; return amount; } } }));
    const result = await jsonata(source).evaluate({ other: { amount: 0 }, rows });
    expect([...result].sort()).toEqual(["10", "20"]);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("rows.details.amount");
  });

  it("keeps block-local sort writes out of later sort keys", async () => {
    const source = '($x:=other;rows^(($x:=details;1),$x.amount).name)';
    let reads = 0;
    const rows = ["a", "b"].map((name) => ({ name, details: { get amount() { reads++; return 10; } } }));
    expect(Array.from(await jsonata(source).evaluate({ other: { amount: 0 }, rows }))).toEqual(["a", "b"]);
    expect(reads).toBe(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).not.toContain("rows.details.amount");
  });
});
