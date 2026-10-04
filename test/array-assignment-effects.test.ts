import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  first: { nested: { total: 10 } },
  second: { nested: { total: 20 } },
  key: "copy",
};

describe("array assignment effects", () => {
  it.each([
    '([$x:=first];$x.nested)',
    '([[$x:=first]];$x.nested)',
    '($p:=[$x:=first];$x.nested)',
    '($p:=([[$x:={"copy":first}]];$x);$p.copy.nested)',
    '([$x:={"copy":first}];$x.copy.nested)',
    '([$x:={(key):first}];$x.copy.nested)',
    '($p:=([$x:={(key):first}];$x);$p.copy.nested)',
    '([$x:=first];$lookup($x,"nested"))',
    '(function(){([$x:=first];$x.nested)})()',
    '($p:=([$x:=first];{"copy":$x});$p.copy.nested)',
    '$map([first],function($v){([$x:=$v];$x.nested)})',
    '([$f:=function(){first.nested}];$f())',
    '(([$f:=function(){first.nested}];$f))()',
    '($p:=([$f:=function(){first.nested}];{"call":$f});($p.call)())',
  ])("retains assignments after the array completes: %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.nested", confidence: "static", coverage: "subtree",
    });
  });

  it("keeps every possible final value when multiple assignments race", async () => {
    const expression = '([$x:=first,$x:=second.nested];$x)';
    expect(await jsonata(expression).evaluate(input)).toEqual(input.second.nested);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "second.nested", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '([$f:=$clone];$count($f(first)))',
    '([$f:=$string];$count($f(first)))',
    '($p:=([$f:=$clone];$f);$count($p(first)))',
  ])("preserves assigned builtin callable effects in %s", async (expression) => {
    let reads = 0;
    const first = { nested: { get total() { reads++; return 10; } } };
    expect(await jsonata(expression).evaluate({ first })).toBe(1);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.**", confidence: "static", coverage: "exact",
    });
  });

  it("keeps assignments inside lexical blocks local", async () => {
    const expression = '($x:=second;[($x:=first)];$x.nested)';
    expect(await jsonata(expression).evaluate(input)).toEqual(input.second.nested);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "second.nested", confidence: "static", coverage: "subtree",
    });
    expect(analyzeExpression(expression).accesses).not.toContainEqual({
      path: "first.nested", confidence: "static", coverage: "subtree",
    });
  });
});
