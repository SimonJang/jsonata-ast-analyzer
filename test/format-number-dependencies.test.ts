import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("number format option dependencies", () => {
  it("records the option properties consumed while formatting a number", async () => {
    const expression = '$formatNumber(amount,"0.00",options)';
    let reads = 0;
    expect(await jsonata(expression).evaluate({
      amount: -1.2, options: { get ["minus-sign"]() { reads++; return "~"; } },
    })).toBe("~1.20");
    expect(reads).toBe(1);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "options.*", confidence: "static", coverage: "exact",
    });
  });

  it("keeps explicit options in the third argument inside a path step", async () => {
    const expression = 'rows.$formatNumber(amount,"0.00",options)';
    expect(await jsonata(expression).evaluate({ rows: [{ amount: -1.2, options: { "minus-sign": "~" } }] })).toBe("~1.20");
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "rows.options.*", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    'amount.$formatNumber("0.00",$$.options)',
    '($format := $formatNumber; $format(amount,"0.00",options))',
    '($format := $formatNumber(?,"0.00",options); $format(amount))',
  ])("follows option enumeration through %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ amount: -1.2, options: { "minus-sign": "~" } })).toBe("~1.20");
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "options.*", confidence: "static", coverage: "exact",
    });
  });

  it("does not enumerate descendants of individual constructed option values", async () => {
    const expression = '$formatNumber(amount,"0.00",{"minus-sign":sign})';
    expect(await jsonata(expression).evaluate({ amount: -1.2, sign: "~" })).toBe("~1.20");
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "amount", confidence: "static", coverage: "exact" },
      { path: "sign", confidence: "static", coverage: "exact" },
    ]);
  });
});
