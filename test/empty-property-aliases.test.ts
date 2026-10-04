import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  first: { nested: { total: 10 } },
  second: { nested: { total: 20 } },
  key: "copy",
};
const sorted = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));

describe("empty property names in constructed aliases", () => {
  it.each([
    '($v:={"":first,"other":second};$v.other.nested)',
    '($v:={"":first,"other":second};$lookup($v,"other").nested)',
    '({"":first,"other":second}).other.nested',
    '($f:=function(){{"":first,"other":second}};$f().other.nested)',
    '(function($v){$v.other.nested})({"":first,"other":second})',
    '$map([{"":first,"other":second}],function($v){$v.other.nested})',
    '$reduce([{"":first,"other":second}],function($a,$v){$v.other.nested},0)',
    '($v:={"":{"copy":first},"other":second};$v.other.nested)',
  ])("does not treat the empty name as an unknown computed key in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.second.nested);
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "second", confidence: "static", coverage: "exact" },
      { path: "second.nested", confidence: "static", coverage: "subtree" },
    ]);
  });

  it.each([
    '($v:={"":first,"other":second};$v.``.nested)',
    '($v:={"":first,"other":second};$lookup($v,"").nested)',
    '($v:={"":{"copy":first},"other":second};$v.``.copy.nested)',
    '($v:={"":{"copy":first},"other":second};$lookup($v,"").copy.nested)',
    '($f:=function(){{"":first,"other":second}};$f().``.nested)',
    '$map([{"":first,"other":second}],function($v){$v.``.nested})',
  ])("preserves the selected empty property in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.nested", confidence: "static", coverage: "subtree" },
      { path: "second", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each([
    '($v:={"":first,"other":second};$v.unknown.nested)',
    '($v:={"":first,"other":second};$lookup($v,"unknown").nested)',
  ])("keeps nonexistent property selections empty in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBeUndefined();
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "second", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each([
    '($v:={"":{(key):first},"other":second};$v.``.copy.nested)',
    '($v:={"":{(key):first},"other":second};$lookup($v,"").copy.nested)',
  ])("preserves computed children under an empty property in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.nested", confidence: "static", coverage: "subtree" },
      { path: "key", confidence: "static", coverage: "exact" },
      { path: "second", confidence: "static", coverage: "exact" },
    ]);
  });
});
