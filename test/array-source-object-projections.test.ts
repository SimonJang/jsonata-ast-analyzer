import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("object projections over explicit array sources", () => {
  it.each([
    '[rows].{"copy":details}.copy.amount',
    '[rows].{"copy":{"inner":details}}.copy.inner.amount',
    '($r:=[rows].{"copy":details};$r.copy.amount)',
    '($r:=[rows].{"copy":details};$lookup($r,"copy").amount)',
    '[rows].{(key):details}.copy.amount',
    '($x:=other;[rows]^($count($x:={"copy":details}));$x.copy.amount)',
  ])("preserves source fields through %s", async (source) => {
    let reads = 0;
    const rows = Array.from({ length: 2 }, () => ({ key: "copy", details: { get amount() { reads++; return 10; } } }));
    expect(await jsonata(source).evaluate({ rows, other: {} })).toBeDefined();
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("rows.details.amount");
  });
});
