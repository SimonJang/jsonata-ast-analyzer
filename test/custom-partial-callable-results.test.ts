import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, second: { nested: { total: 20 } }, key: "call" };
const sorted = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));

describe("custom partial callable results", () => {
  it.each([
    '($f:=function($v){function(){$v.nested}};$p:=$f(?);$p(first)())',
    '($f:=function($v){function(){$v.nested}};$p:=$f(?);$q:=$p(?);$q(first)())',
    '($f:=function($v){function(){$v.nested}};$p:=$f(?);$q:=$p(?);$r:=$q(?);$r(first)())',
    '($f:=function($v){{"call":function(){$v.nested}}};$p:=$f(?);$p(first).call())',
    '($f:=function($v){[function(){$v.nested}]};$p:=$f(?);$p(first)[0]())',
    '($f:=function($v){$lookup($v,?)};$p:=$f(?);$p(first)("nested"))',
    '(function($v){function(){$v.nested}})(?)(first)()',
  ])("retains returned lambda and partial effects in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.nested", confidence: "static", coverage: "subtree" },
    ]);
  });

  it.each([
    '($f:=function($v){$string};$p:=$f(?);$p(first)(first))',
    '($f:=function($v){$string};$p:=$f(?);$q:=$p(?);$q(first)(first))',
    '($f:=function($v){{"call":$string}};$p:=$f(?);$p(first).call($$.first))',
  ])("retains builtin descendant reads from a custom partial result in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBe(JSON.stringify(input.first));
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.**", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each([
    '($f:=function($v,$x){function(){$v.nested}};$a:=first;$p:=$f($a,?);$a:=second;$p(0)())',
    '($f:=function($v,$x){{"call":function(){$v.nested}}};$a:=first;$p:=$f($a,?);$a:=second;$p(0).call())',
    '($f:=function($v,$x){function(){$v.nested}};$a:=first;$p:=$f($a,?);$q:=$p(?);$a:=second;$q(0)())',
  ])("keeps a captured argument in its definition scope after rebinding in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.nested", confidence: "static", coverage: "subtree" },
      { path: "second", confidence: "static", coverage: "exact" },
    ]);
  });

  it("keeps invocation data in the projected caller context", async () => {
    const expression = '($f:=function($v){function(){$v.nested}};$p:=$f(?);record.($p(first)()))';
    expect(await jsonata(expression).evaluate({ record: input })).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "record.first", confidence: "static", coverage: "exact" },
      { path: "record.first.nested", confidence: "static", coverage: "subtree" },
    ]);
  });

  it("keeps a captured argument at the root when invoked from a projection", async () => {
    const expression = '($f:=function($v,$x){function(){$v.nested}};$p:=$f(first,?);record.($p(0)()))';
    expect(await jsonata(expression).evaluate({ ...input, record: { first: input.second } })).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.nested", confidence: "static", coverage: "subtree" },
      { path: "record", confidence: "static", coverage: "exact" },
    ]);
  });
});
