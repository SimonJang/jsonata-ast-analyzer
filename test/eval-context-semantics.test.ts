import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const data = {
  dict: { a: { details: { amount: 10 }, key: "out" } },
};

describe("static eval context semantics", () => {
  it.each(['{"out": details}', '{key: details}'])
    ("selects object values returned by %s", async (program) => {
      const expression = `$eval(${JSON.stringify(program)}, dict.a)`;
      expect(await jsonata(expression).evaluate(data)).toEqual({ out: { amount: 10 } });
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "dict.a.details", confidence: "static", coverage: "subtree",
      });
      if (program.includes("key")) {
        expect(analyzeExpression(expression).accesses).toContainEqual({
          path: "dict.a.key", confidence: "static", coverage: "exact",
        });
      }
    });

  it("keeps lookup argument reads out of the selected eval result", async () => {
    const expression = '$eval("$lookup($, \\"details\\")", dict.a).amount';
    expect(await jsonata(expression).evaluate(data)).toBe(10);
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "dict.a.details", confidence: "static", coverage: "exact" },
      { path: "dict.a.details.amount", confidence: "static", coverage: "subtree" },
      { path: "dict.a", confidence: "static", coverage: "exact" },
    ]);
  });

  it("keeps computed keys and scalar calls at exact coverage", async () => {
    const expression = '$eval("{key: $count(details)}", dict.a)';
    expect(await jsonata(expression).evaluate(data)).toEqual({ out: 1 });
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "dict.a", confidence: "static", coverage: "exact" },
      { path: "dict.a.key", confidence: "static", coverage: "exact" },
      { path: "dict.a.details", confidence: "static", coverage: "exact" },
    ]);
  });
});
