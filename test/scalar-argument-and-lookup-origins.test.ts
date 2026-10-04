import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, key: "t" };

describe("scalar argument and constructed lookup origins", () => {
  it.each([
    "first.nested.total + 1", "first.nested.total - 1",
    "first.nested.total * 2", "first.nested.total / 2",
    "first.nested.total % 2", "-first.nested.total",
    "first.nested.total > 1", "first.nested.total < 20",
    "first.nested.total >= 1", "first.nested.total <= 20",
    "first.nested.total = 10", "first.nested.total != 1",
    "first.nested.total and true", "first.nested.total or false",
    "first.nested.total in [10]", "[first.nested.total .. 11]",
  ])("does not append object fields to scalar result %s", async (value) => {
    for (const expression of [
      `(function($v){$v.nested})(${value})`,
      `$map(${value},function($v){$v.nested})`,
    ]) {
      expect(await jsonata(expression).evaluate(input)).toBeUndefined();
      expect(analyzeExpression(expression).accesses).toEqual([
        { path: "first.nested.total", confidence: "static", coverage: "exact" },
        ...(value.includes(" and ") || value.includes(" or ")
          ? [{ path: "first.nested.total.*", confidence: "static" as const, coverage: "exact" as const }]
          : []),
      ]);
    }
  });

  it.each([
    '($v:={"t":$count(first)};$lookup($v,key).nested)',
    '($v:={"t":first.nested.total+1};$lookup($v,key).nested)',
    '($v:={(key):$count(first)};$lookup($v,key).nested)',
    '($v:={(key):first.nested.total+1};$lookup($v,key).nested)',
    '($v:={(key):first.nested.total+1};$lookup($v,"t").nested)',
    '$lookup({(key):first.nested.total+1},key).nested',
    '($f:=function(){{(key):$count(first)}};$lookup($f(),key).nested)',
  ])("keeps computed keys and scalar field reads separate from lookup results in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBeUndefined();
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses.map(({ path }) => path).sort()).toEqual([
      expression.includes("$count") ? "first" : "first.nested.total", "key",
    ]);
    expect(accesses.every(({ coverage }) => coverage === "exact")).toBe(true);
  });
});
