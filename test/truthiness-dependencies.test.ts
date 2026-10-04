import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { record: { details: { amount: 10 }, name: { label: "One" } }, items: [{ check: { label: "One" } }], flag: true };
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const accesses = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));

describe("object truthiness dependencies", () => {
  it.each([
    ["record ? 1 : 0", 1], ["record and true", true], ["false or record", true],
    ["record ?: 0", input.record], ["$boolean(record)", true], ["$not(record)", false],
  ] as const)("records object enumeration in %s", async (expression, value) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(value);
    const expected = expression.includes("?:")
      ? [{ path: "record", confidence: "static", coverage: "subtree" }, exact("record.*")]
      : [exact("record"), exact("record.*")];
    expect(accesses(expression)).toEqual(expected);
  });

  it.each([
    '$count(items[check])',
    '$count($filter(items,function($x){$x.check}))',
    '$count($single(items,function($x){$x.check}))',
    '$count($sift({"one":items[0]},function($x){$x.check}))',
  ])("records predicate result enumeration in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([exact("items"), exact("items.check"), exact("items.check.*")]);
  });

  it.each([
    '$count(({"copy":items.check})[copy])',
    '$count([{"copy":items.check}][copy])',
    '$count(($v:={"copy":items.check};$v)[copy])',
    '$count($reverse([{"copy":items.check}])[copy])',
    '$count((function(){{"copy":items.check}})()[copy])',
  ])("records truthiness through constructed predicate sources in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([exact("items.check"), exact("items.check.*")]);
  });

  it("does not execute a function-valued predicate", async () => {
    const expression = '$count(items[function(){record}])';
    expect(await jsonata(expression).evaluate(input)).toBe(0);
    expect(accesses(expression)).toEqual([exact("items")]);
  });

  it.each([
    '($p:=function($x){$x.check};$count($filter(items,$p)))',
    '($p:=function($x,$unused){$x.check}(?,0);$count($filter(items,$p)))',
    '($p:=$lookup(?,"check");$count($filter(items,$p)))',
  ])("traces truthiness of resolved callback results in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([exact("items"), exact("items.check"), exact("items.check.*")]);
  });

  it.each([
    '$boolean(record.details.amount+1)',
    '(record.details.amount+1)?1:0',
    '($p:=record.details.amount+1;$p?1:0)',
  ])("keeps derived scalar reads exact in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBeTruthy();
    expect(accesses(expression)).toEqual([exact("record.details.amount")]);
  });

  it.each([
    '{"copy":record}?1:0',
    '($v:={"copy":record};$v?1:0)',
    '$boolean({"copy":record})',
    'function(){record}?1:0',
    '$boolean(function(){record})',
    '($f:=function(){record};$f?1:0)',
  ])("does not consume input-object keys through a constant constructor in %s", async (expression) => {
    const result = await jsonata(expression).evaluate(input);
    expect(result).toBe(expression.includes("function") ? expression.startsWith("$boolean") ? false : 0 : expression.startsWith("$boolean") ? true : 1);
    expect(accesses(expression)).toEqual(expression.includes("function") ? [] : [exact("record")]);
  });

  it("covers truthiness reads separately from a selected nested value", async () => {
    const expression = '($v:={"copy":record};$v.copy?$v.copy.details:0)';
    expect(await jsonata(expression).evaluate(input)).toEqual(input.record.details);
    expect(accesses(expression)).toEqual([
      exact("record"), exact("record.*"), { path: "record.details", confidence: "static", coverage: "subtree" },
    ]);
  });
});
