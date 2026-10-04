import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const first = { nested: { total: 10 } };
const second = { nested: { total: 20 } };
const input = { first, second, key: "copy" };

describe("array assignment result values", () => {
  it.each([
    ['[$x:=first]', [first], ['first']],
    ['[$x:=first,second]', [first, second], ['first', 'second']],
    ['[$x:=first,$x:=second]', [first, second], ['first', 'second']],
    ['[[$x:=first],$x]', [[first]], ['first']],
    ['[$x:={"a":first,"b":second}]', [{ a: first, b: second }], ['first', 'second']],
    ['$reverse([$x:=first])', [first], ['first']],
    ['$append([$x:=first],[])', [first], ['first']],
  ] as const)("selects assignment values returned by %s", async (expression, expected, paths) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(expected);
    const accesses = analyzeExpression(expression).accesses;
    for (const path of paths) {
      expect(accesses).toContainEqual({ path, confidence: "static", coverage: "subtree" });
    }
  });

  it.each([
    '($p := [$x:=first]; $p.nested)',
    '($p := [$x:={"copy":first}]; $p.copy.nested)',
    '($p := [$x:={(key):first}]; $p.copy.nested)',
    '$map([$x:=first],function($v){$v.nested})',
    '$map([$x:={"copy":first}],function($v){$v.copy.nested})',
    '(function($v){$v.nested})([$x:=first])',
    '($p := [$fn:=function(){first.nested}]; $p[0]())',
    '([$fn:=function(){first.nested}][0])()',
    '($p := [$f:=$lookup]; $p[0](first,"nested"))',
  ])("retains assignment source aliases through %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual({ total: 10 });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.nested", confidence: "static", coverage: "subtree",
    });
  });

  it("records serialization reads from assigned array values", async () => {
    let reads = 0;
    const expression = '$string([$x:=first])';
    const first = { nested: { get total() { reads++; return 10; } } };
    expect(await jsonata(expression).evaluate({ first })).toBe('[{"nested":{"total":10}}]');
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.**", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    ['$count([$x:=first])', 1],
    ['$count($reverse([$x:=first]))', 1],
    ['[$x:=$count(first)]', [1]],
  ] as const)("keeps scalar consumption exact in %s", async (expression, expected) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(expected);
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each(['$clone', '$clone(?)', 'function($v){$string($v)}'])
    ("invokes an assigned callback stored in an array: %s", async (callback) => {
      let reads = 0;
      const expression = `$count($map([first], [$f:=${callback}][0]))`;
      const first = { nested: { get total() { reads++; return 10; } } };
      expect(await jsonata(expression).evaluate({ first })).toBe(1);
      expect(reads).toBeGreaterThan(0);
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "first.**", confidence: "static", coverage: "exact",
      });
    });
});
