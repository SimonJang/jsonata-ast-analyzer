import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  first: { nested: { total: 10 } },
  second: { nested: { total: 20 } },
  key: "copy", enabled: true,
};

describe("lambda result selection", () => {
  it.each([
    '(function($v){{"a":$count($v)}})(first)',
    '($f:=function($v){{"a":$count($v)}};$f(first))',
    '$map([first],function($v){{"a":$count($v)}})',
    '$each({"copy":first},function($v){{"a":$count($v)}})',
    '$reduce([first],function($a,$v){{"a":$count($v)}},0)',
    '$map([first],function($v){($x:=$v;{"a":$count($x)})})',
  ])("keeps scalar constructor reads exact in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual({ a: 1 });
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each([
    '(function(){{(key):$count(first)}})()',
    '$map([first],function($v){{(key):$count($v)}})',
    '$each({"copy":first},function($v){{(key):$count($v)}})',
    '$reduce([first],function($a,$v){{(key):$count($v)}},0)',
    '($f:=function($v){{(key):$count($v)}};$p:=$f(?);$q:=$p(?);$q(first))',
  ])("keeps computed keys and scalar values exact in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual({ copy: 1 });
    expect(analyzeExpression(expression).accesses).toEqual(expect.arrayContaining([
      { path: "key", confidence: "static", coverage: "exact" },
      { path: "first", confidence: "static", coverage: "exact" },
    ]));
    expect(analyzeExpression(expression).accesses).toHaveLength(2);
  });

  it.each([
    '(function($v){{"a":$v.nested.total + 1}})(first)',
    '$map([first],function($v){{"a":$v.nested.total + 1}})',
    '$each({"copy":first},function($v){{"a":$v.nested.total + 1}})',
    '$reduce([first],function($a,$v){{"a":$v.nested.total + 1}},0)',
  ])("keeps arithmetic inputs exact in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual({ a: 11 });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.nested.total", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '(function($v){{"scalar":$count($v),"data":second.nested}})(first)',
    '$map([first],function($v){{"scalar":$count($v),"data":second.nested}})',
    '$reduce([first],function($a,$v){{"scalar":$count($v),"data":second.nested}},0)',
  ])("selects only the input-backed fields from mixed results in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual({ scalar: 1, data: input.second.nested });
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "first", confidence: "static", coverage: "exact" });
    expect(accesses).toContainEqual({ path: "second.nested", confidence: "static", coverage: "subtree" });
  });
});
