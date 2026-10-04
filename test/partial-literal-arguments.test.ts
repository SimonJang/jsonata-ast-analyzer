import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, second: { nested: { total: 20 } } };
const sorted = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));

describe("literal arguments captured by partial application", () => {
  it.each([
    '($p:=$lookup(?,"a");$p({"a":first,"b":second}).nested)',
    '($f:=$lookup(?,"a");$p:=$f(?);$p({"a":first,"b":second}).nested)',
    '($l:=$lookup;$p:=$l(?,"a");$p({"a":first,"b":second}).nested)',
    '($p:=$lookup(?,"");$p({"":first,"b":second}).nested)',
  ])("keeps a captured property selector static in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.nested", confidence: "static", coverage: "subtree" },
      { path: "second", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each([
    '($p:=$lookup(?,"nested");$p(first))',
    '($p:=$lookup(?,"nested");$q:=$p(?);$q(first))',
    '($e:=$eval("nested",?);$e(first))',
    '($e:=$eval("nested",?);$p:=$e(?);$p(first))',
    '($a:=$eval;$e:=$a("nested",?);$e(first))',
  ])("retains the selected property from a known literal in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.nested", confidence: "static", coverage: "subtree" },
    ]);
  });

  it.each([
    '($e:=$eval("first.nested",?);$e($))',
    '($e:=$eval("first.nested",?);$p:=$e(?);$p($))',
    '($e:=$eval("$string(first)",?);$e($))',
  ])("analyzes captured literal eval programs in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(
      expression.includes("$string") ? JSON.stringify(input.first) : input.first.nested,
    );
    expect(sorted(expression)).toEqual(expression.includes("$string") ? [
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "first.**", confidence: "static", coverage: "exact" },
    ] : [
      { path: "first.nested", confidence: "static", coverage: "subtree" },
    ]);
  });

  it.each([
    '($e:=$eval("nested",?);record.$e(first))',
    'record.$eval("nested",first)',
  ])("retains caller context for literal eval program %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ record: input })).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      { path: "record.first", confidence: "static", coverage: "exact" },
      { path: "record.first.nested", confidence: "static", coverage: "subtree" },
    ]);
  });

  it.each([
    '$eval("nested",first.nested.total+1)',
    '($e:=$eval("nested",?);$e(first.nested.total+1))',
  ])("does not treat scalar context evaluation reads as returned objects in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBeUndefined();
    expect(sorted(expression)).toEqual([
      { path: "first.nested.total", confidence: "static", coverage: "exact" },
    ]);
  });
});
