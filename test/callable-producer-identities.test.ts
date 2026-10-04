import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, second: { nested: { total: 20 } }, key: "call" };
const sorted = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));

describe("callable producer identities", () => {
  it.each([
    '($r:=$reverse;$lookup($r({"call":function(){first.nested}}),"call")())',
    '($r:=$reverse;$lookup($r({"call":function(){first.nested}}),key)())',
    '($a:=$append;$lookup($a({"call":function(){first.nested}},[]),key)())',
    '($l:=$lookup;$l({"call":function(){first.nested}},"call")())',
    '($l:=$lookup;$l({"call":function(){first.nested}},key)())',
    '($e:=$eval;$e("function(){first.nested}")())',
    '($r:=$reverse;$reverse:=function(){0};$lookup($r({"call":function(){first.nested}}),key)())',
    '($l:=$lookup;$lookup:=function(){0};$l({"call":function(){first.nested}},key)())',
    '($e:=$eval;$eval:=function(){0};$e("function(){first.nested}")())',
  ])("resolves returned lambdas through builtin aliases in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first.nested", confidence: "static", coverage: "subtree" },
      ...(expression.includes(",key)") ? [{ path: "key", confidence: "static", coverage: "exact" }] : []),
    ]);
  });

  it.each([
    '($l:=$lookup;$l({"call":$string},key)(first))',
    '($r:=$reverse;$lookup($r({"call":$string}),key)(first))',
    '($e:=$eval;$e("$string")(first))',
    '($a:=$append;$lookup($a({"call":$string},[]),key)(first))',
  ])("retains descendant reads of returned builtin callables in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBe(JSON.stringify(input.first));
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.**", confidence: "static", coverage: "exact" },
      ...(expression.includes(",key)") ? [{ path: "key", confidence: "static", coverage: "exact" }] : []),
    ]);
  });

  it.each([
    '($reverse:=function($v){{"call":function(){second.nested}}};$lookup($reverse({"call":function(){first.nested}}),"call")())',
    '($reverse:=function($v){{"call":function(){second.nested}}};$lookup($reverse({"call":function(){first.nested}}),key)())',
    '($lookup:=function($v,$k){function(){second.nested}};$lookup({"call":function(){first.nested}},"call")())',
    '($eval:=function($v){function(){second.nested}};$eval("first.nested")())',
  ])("uses locally replaced builtin names as lambda producers in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.second.nested);
    expect(sorted(expression)).toEqual([
      ...(expression.includes(",key)") ? [{ path: "key", confidence: "static", coverage: "exact" }] : []),
      { path: "second.nested", confidence: "static", coverage: "subtree" },
    ]);
  });
});
