import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("assignments over constructed projection contexts", () => {
  it.each([
    '($x:=other;rows.{"copy":details}^($count($x:={"copy":copy}));$x.copy.amount)',
    '($x:=other;$r:=rows;$r.{"copy":details}^($count($x:={"copy":copy}));$x.copy.amount)',
    '($x:=other;rows.{"copy":details}^($count($x:={($$.key):copy}));$x.copy.amount)',
  ])("preserves constructed source fields in %s", async (source) => {
    let reads = 0;
    const input = { key: "copy", other: { amount: 20 }, rows: Array.from({ length: 2 }, () => ({ details: { get amount() { reads++; return 10; } } })) };
    expect(await jsonata(source).evaluate(input)).toBeDefined();
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("rows.details.amount");
  });
});
