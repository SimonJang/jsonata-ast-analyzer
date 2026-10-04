import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, second: { nested: { total: 20 } } };
const accesses = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const expected = [exact("first"), exact("first.nested.total"), exact("second")];

const children = '{"child":{"copy":first},"ignored":{"different":second}}';
const source = (prefix: string) => prefix === "*" ? children : `{"a":${children}}`;

describe("wildcard stages on constructed values", () => {
  it.each(["*", "a.*"].flatMap((prefix) => [
    [prefix, "copy.nested.total>0"],
    [prefix, '$lookup($,"copy").nested.total>0'],
    [prefix, "$.copy.nested.total>0"],
  ]))("traces the predicate %s[%s] without selecting the consumed values", async (prefix, predicate) => {
    const expression = `($v:=${source(prefix)};$count($v.${prefix}[${predicate}]))`;
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual(expected);
  });

  it.each(["*", "a.*"].flatMap((prefix) => [
    [prefix, "copy.nested.total"],
    [prefix, '$lookup($,"copy").nested.total'],
    [prefix, "$.copy.nested.total"],
  ]))("traces the sort term %s^(%s) through selected aliases", async (prefix, term) => {
    const expression = `($v:=${source(prefix)};$count($v.${prefix}^(${term})))`;
    expect(await jsonata(expression).evaluate(input)).toBe(2);
    expect(accesses(expression)).toEqual(expected);
  });

  it("retains captured reads alongside wildcard predicate context", async () => {
    const expression = `($limit:=second.nested.total;$v:=${source("a.*")};$count($v.a.*[copy.nested.total<$limit]))`;
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([...expected, exact("second.nested.total")]);
  });

  it("retains field reads through multiple wildcard levels", async () => {
    const expression = '($v:={"a":{"child":{"":first}}};$count($v.a.*.*[nested.total>0]))';
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(accesses(expression)).toEqual([exact("first"), exact("first.nested.total")]);
  });

  it("keeps predicate reads exact when another field is the selected result", async () => {
    const expression = '($v:={"a":{"child":{"check":first,"out":second}}};$v.a.*[check.nested.total>0].out.nested)';
    expect(await jsonata(expression).evaluate(input)).toEqual(input.second.nested);
    expect(accesses(expression)).toEqual([
      exact("first"), exact("first.nested.total"), exact("second"),
      { path: "second.nested", confidence: "static", coverage: "subtree" },
    ]);
  });

  it.each([
    '($v:={"copy":first,"other":second};$v.($.copy.nested))',
    '($v:={"copy":first,"other":second};$v.($.copy).nested)',
    '($v:={"copy":first,"other":second};$v.{"out":$.copy.nested})',
  ])("resolves explicit current-context paths through constructed aliases in %s", async (expression) => {
    const result = expression.includes('{"out"') ? { out: input.first.nested } : input.first.nested;
    expect(await jsonata(expression).evaluate(input)).toEqual(result);
    expect(accesses(expression)).toEqual([
      exact("first"), { path: "first.nested", confidence: "static", coverage: "subtree" }, exact("second"),
    ]);
  });

  it("keeps explicit current-context lookup of a missing constructed field absent", async () => {
    const expression = '($v:={"copy":first,"other":second};$v.($.missing))';
    expect(await jsonata(expression).evaluate(input)).toBeUndefined();
    expect(accesses(expression)).toEqual([exact("first"), exact("second")]);
  });
});
