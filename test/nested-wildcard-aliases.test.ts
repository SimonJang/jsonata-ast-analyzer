import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, second: { nested: { total: 20 } } };
const sorted = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));
const access = (path: string, coverage = "exact", confidence = "static") => ({ path, coverage, confidence });

describe("nested constructed wildcard aliases", () => {
  it.each([
    '($v:={"a":{"":first,"b":second}};$v.a.*.nested)',
    '($v:={"a":{"b":second,"":first}};$v.a.*.nested)',
    '($v:={"a":{"":first,"b":second}};$v.(a.*.nested))',
    '($v:={"a":{"":first,"b":second}};$lookup($v,"a").*.nested)',
    '$map([{"a":{"":first,"b":second}}],function($v){$v.a.*.nested})',
  ])("selects empty named wildcard children in %s", async (expression) => {
    const result = await jsonata(expression).evaluate(input) as Array<{ total: number }>;
    expect(Array.from(result).sort((a, b) => a.total - b.total)).toEqual([input.first.nested, input.second.nested]);
    expect(sorted(expression)).toEqual([
      access("first"), access("first.nested", "subtree"),
      access("second"), access("second.nested", "subtree"),
    ]);
  });

  it.each([
    '($v:={"a":{"":{"copy":first}}};$v.a.*.copy.nested)',
    '($v:={"a":{"child":{"copy":first}}};$v.a.*.copy.nested)',
    '($v:={"a":{"child":{"copy":first}}};$v.a.*.*.nested)',
    '($v:={"a":{"a.b":{"copy":first}}};$v.a.*.copy.nested)',
    '(function($v){$v.a.*.copy.nested})({"a":{"child":{"copy":first}}})',
  ])("consumes virtual wildcard levels before following physical sources in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([access("first"), access("first.nested", "subtree")]);
  });

  it.each([
    '($v:={"a":{"nested":{"copy":first},"other":second}};$v.a.*)',
    '($v:={"a":{"":{"copy":first},"other":second}};$v.a.*)',
  ])("selects descendants of constructed wildcard results in %s", async (expression) => {
    expect(Array.from(await jsonata(expression).evaluate(input))).toEqual([{ copy: input.first }, input.second]);
    expect(sorted(expression)).toEqual([access("first", "subtree"), access("second", "subtree")]);
  });

  it.each([
    '($v:={"a":{"child":{"copy":first},"ignored":{"different":second}}};$v.a.*.copy.nested)',
    '($v:={"child":{"copy":first},"ignored":{"different":second}};$v.*.copy.nested)',
  ])("excludes unmatched virtual siblings from wildcard suffix results in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([access("first"), access("first.nested", "subtree"), access("second")]);
  });

  it.each(["a.*", "*"].flatMap((prefix) => [
    ".(copy.nested)", '.{"out":copy.nested}', '.$lookup($,"copy").nested',
  ].map((suffix) => [prefix, suffix] as const)))("preserves selected object context for %s%s", async (prefix, suffix) => {
    const children = '{"child":{"copy":first},"ignored":{"different":second}}';
    const object = prefix === "*" ? children : `{"a":${children}}`;
    const expression = `($v:=${object};$v.${prefix}${suffix})`;
    const value = suffix.startsWith('.{"out"') ? [{ out: input.first.nested }, {}] : input.first.nested;
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(value);
    expect(sorted(expression)).toEqual([access("first"), access("first.nested", "subtree"), access("second")]);
  });

  it.each(["a.*", "*"])("serializes every selected constructed context in %s", async (prefix) => {
    const children = '{"child":{"copy":first},"ignored":{"different":second}}';
    const object = prefix === "*" ? children : `{"a":${children}}`;
    const expression = `($v:=${object};$v.${prefix}.($string()))`;
    expect(Array.from(await jsonata(expression).evaluate(input))).toEqual([
      JSON.stringify({ copy: input.first }), JSON.stringify({ different: input.second }),
    ]);
    expect(sorted(expression)).toEqual([
      access("first"), access("first.**"), access("second"), access("second.**"),
    ]);
  });

  it("retains constructed values in a wildcard focus binding", async () => {
    const expression = '($v:={"a":{"child":{"copy":first}}};$v.a.*@$x.$x.copy.nested)';
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([access("first"), access("first.nested", "subtree")]);
  });
});
