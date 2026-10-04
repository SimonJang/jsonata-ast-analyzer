import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const first = { nested: { total: 10 } };
const input = { first, key: "call" };

describe("stored method results and argument context", () => {
  it.each([
    '($p:={"call":function(){first.nested}};$p.call())',
    '($p:={(key):function(){first.nested}};$p.call())',
    '($p:={"methods":{"call":function(){first.nested}}};$p.methods.call())',
    '($p:={"call":function(){{"copy":first}}};$p.call().copy.nested)',
    '($p:={"call":function(){{(key):first}}};$p.call().call.nested)',
    '($p:={"call":function(){first}};$p.call().nested)',
    '($p:=([$f:=function(){first.nested}];{"call":$f});$p.call())',
    '($p:={"call":function($v){$v.nested},"value":first};$p.call(value))',
    '($p:={"call":function($v){$v.nested},"value":first};$p.call($.value))',
    '($p:={"call":function($v){$v.nested},"value":first};$p.call($lookup($,"value")))',
    '($p:={"call":$lookup,"value":first};$p.call(value,"nested"))',
    '($p:={"call":$lookup,"value":first};$p.call($$.first,"nested"))',
    '($p:={"call":function(){function(){first.nested}}};$p.call()())',
    '($p:={"call":function(){{"next":function(){first.nested}}}};$p.call().next())',
    '({"call":function(){first.nested}}).call()',
    '($p:={"call":$lookup(?,?),"value":first};$p.call(value,"nested"))',
  ])("selects returned input objects from %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(first.nested);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.nested", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '($p:={"call":$clone};$count($p.call($$.first)))',
    '($p:={"call":$string};$count($p.call($$.first)))',
    '($p:={"call":$clone,"value":first};$count($p.call(value)))',
    '($p:={"call":$string,"value":first};$count($p.call(value)))',
    '($p:={"call":$clone,"value":first};$count($p.call()))',
    '($p:={"call":$string,"value":first};$count($p.call()))',
    '($p:={(key):$clone};$count($p.call($$.first)))',
  ])("records builtin method descendant reads in %s", async (expression) => {
    let reads = 0;
    const first = { nested: { get total() { reads++; return 10; } } };
    expect(await jsonata(expression).evaluate({ ...input, first })).toBe(1);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.**", confidence: "static", coverage: "exact",
    });
  });

  it("uses the containing object for method arguments and the input for extracted calls", async () => {
    const value = { nested: { total: 20 } };
    for (const [call, result, path] of [
      ['$p.call(value)', first.nested, 'first.nested'],
      ['($p.call)(value)', value.nested, 'value.nested'],
    ] as const) {
      const expression = `($p:={"call":function($v){$v.nested},"value":first};${call})`;
      expect(await jsonata(expression).evaluate({ ...input, value })).toEqual(result);
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path, confidence: "static", coverage: "subtree",
      });
    }
  });

  it("does not read a missing method argument from the root input", async () => {
    const expression = '($p:={"call":function($v){$v.nested}};$p.call(first))';
    expect(await jsonata(expression).evaluate(input)).toBeUndefined();
    expect(analyzeExpression(expression).accesses).toEqual([]);
  });

  it.each([
    '($p:={"call":|nested|{"copy":total}|};$p.call($$.first))',
    '($p:={"call":|nested|{"copy":total}|,"value":first};$p.call(value))',
  ])("retains transform method input and update dependencies in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual({ nested: { total: 10, copy: 10 } });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.nested.total", confidence: "static", coverage: "exact",
    });
  });

  it("terminates callable result analysis for self application", async () => {
    const expression = 'function($f){function($x){$x($x)}(function($g){$f(function($a){$g($g)($a)})})}' +
      '(function($f){function($n){$n < 2 ? 1 : $n * $f($n-1)}})(number)';
    expect(await jsonata(expression).evaluate({ number: 5 })).toBe(120);
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "number", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each([
    '({(key):function(){first.nested}}).call()',
    '({(key):$clone}).call($$.first).nested',
    '($make:=function(){{(key):function(){first.nested}}};$make().call())',
  ])("retains computed key reads from inline method producers in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(first.nested);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "key", confidence: "static", coverage: "exact",
    });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.nested", confidence: "static", coverage: "subtree",
    });
  });
});
