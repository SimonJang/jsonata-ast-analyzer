import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, second: { nested: { total: 20 } }, key: "call" };
const sorted = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));

describe("partially applied callable producers", () => {
  it.each([
    '($l:=$lookup(?,?);$l({"call":function(){first.nested}},key)())',
    '($l:=$lookup(?,"call");$l({"call":function(){first.nested}})())',
    '($l:=$lookup({"call":function(){first.nested}},?);$l(key)())',
    '($l:=$lookup(?,?);$p:=$l(?,?);$p({"call":function(){first.nested}},key)())',
    '($l:=$lookup(?,?);$p:=$l(?,"call");$p({"call":function(){first.nested}})())',
    '($a:=$append(?,[]);$lookup($a({"call":function(){first.nested}}),key)())',
    '($r:=$reverse(?);$r([function(){first.nested}])[0]())',
    '($e:=$eval(?,$);$e("function(){first.nested}")())',
    '($a:=$lookup;$l:=$a(?,?);$lookup:=function(){0};$l({"call":function(){first.nested}},key)())',
    '($o:={"call":function(){first.nested}};$l:=$lookup($o,?);$o:={"call":function(){second.nested}};$l(key)())',
  ])("retains a lambda returned by a partial builtin in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first.nested", confidence: "static", coverage: "subtree" },
      ...(expression.includes(",key)") || expression.includes("$l(key)") ? [{ path: "key", confidence: "static", coverage: "exact" }] : []),
    ]);
  });

  it.each([
    '($l:=$lookup(?,?);$l({"call":$string},key)(first))',
    '($r:=$reverse(?);$r([$string])[0](first))',
    '($e:=$eval(?,$);$e("$string")(first))',
  ])("retains descendant reads of a builtin returned by a partial in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBe(JSON.stringify(input.first));
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.**", confidence: "static", coverage: "exact" },
      ...(expression.includes(",key)") ? [{ path: "key", confidence: "static", coverage: "exact" }] : []),
    ]);
  });

  it.each([
    '($l:=$lookup(?,?);record.($l({"call":function(){first.nested}},key)()))',
    '($l:=$lookup;record.($l({"call":function(){first.nested}},key)()))',
  ])("retains the caller context for a callback argument in %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ record: input })).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "record.first.nested", confidence: "static", coverage: "subtree" },
      { path: "record.key", confidence: "static", coverage: "exact" },
    ]);
  });

  it("retains methods from a partial eval result", async () => {
    const source = JSON.stringify('{"call":function(){first.nested}}');
    const expression = `($e:=$eval(?,$);$e(${source}).call())`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first.nested", confidence: "static", coverage: "subtree" },
    ]);
  });

  it("keeps a captured callback in its definition context when invoked from a projection", async () => {
    const expression = '($l:=$lookup({"call":function(){first.nested}},?);record.($l(key)()))';
    expect(await jsonata(expression).evaluate({ ...input, record: { first: input.second, key: input.key } })).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first.nested", confidence: "static", coverage: "subtree" },
      { path: "record.key", confidence: "static", coverage: "exact" },
    ]);
  });
});
