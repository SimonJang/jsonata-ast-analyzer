import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const first = { nested: { total: 10 } };
const second = { nested: { total: 20 } };
const input = { first, second, key: "copy" };

describe("concurrent array assignment reads", () => {
  it.each([
    ['($x:=second;[$x:=first,$x.nested])', first],
    ['($x:=second;[$x:=first,$lookup($x,"nested")])', first],
    ['($x:={"copy":second};[$x:={"copy":first},$x.copy.nested])', { copy: first }],
    ['($x:={(key):second};[$x:={(key):first},$x.copy.nested])', { copy: first }],
    ['($x:=second;[$x:=first,$y:=$x.nested])', first],
  ] as const)("retains the original sibling binding in %s", async (expression, assigned) => {
    expect(await jsonata(expression).evaluate(input)).toEqual([assigned, second.nested]);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "second.nested", confidence: "static", coverage: "subtree",
    });
  });

  it("records descendant reads from serialization of the original binding", async () => {
    let reads = 0;
    const second = { nested: { get total() { reads++; return 20; } } };
    const expression = '($x:=second;[$x:=first,$string($x)])';
    expect(await jsonata(expression).evaluate({ first, second })).toEqual([
      first, '{"nested":{"total":20}}',
    ]);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "second.**", confidence: "static", coverage: "exact",
    });
  });
});
