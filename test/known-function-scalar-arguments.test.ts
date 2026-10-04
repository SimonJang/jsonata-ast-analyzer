import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } } };

describe("known function argument result origins", () => {
  it.each([
    '$map($count(first),function($v){$v.nested.total})',
    '(function($v){$v.nested.total})($count(first))',
    '($f:=$count;$map($f(first),function($v){$v.nested.total}))',
    '($f:=$count(?);$map($f(first),function($v){$v.nested.total}))',
    '(function($v){$v.nested.total})((function($x){$count($x)})(first))',
    '($f:=function($x){$count($x)};$map($f(first),function($v){$v.nested.total}))',
    '($f:=function($x){$count($x)};$p:=$f(?);$map($p(first),function($v){$v.nested.total}))',
    '$map($exists(first),function($v){$v.nested.total})',
    '(function($v){$v.nested.total})([$count(first)])',
    '(function($v){$v.copy.nested.total})({"copy":$count(first)})',
    '$reduce([$count(first)],function($a,$v){$v.nested.total},0)',
  ])("does not treat scalar argument reads as returned objects in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBeUndefined();
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each(['$string(first)', '$keys(first)', '$sum(first.nested.total)'])
    ("retains reads without inventing suffixes for %s", async (value) => {
      const expression = `$map(${value},function($v){$v.unused})`;
      expect(await jsonata(expression).evaluate(input)).toBeUndefined();
      const accesses = analyzeExpression(expression).accesses;
      expect(accesses.length).toBeGreaterThan(0);
      expect(accesses.every(({ path }) => !path.includes("unused"))).toBe(true);
    });

  it("retains the input-backed result of a local builtin-name replacement", async () => {
    const expression = '($count:=function($v){$v};$map($count(first),function($v){$v.nested}))';
    expect(await jsonata(expression).evaluate(input)).toEqual(input.first.nested);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.nested", confidence: "static", coverage: "subtree",
    });
  });

  it("binds the returned source separately from other function argument reads", async () => {
    const expression = '(function($v){$v.nested})((function(){(first;second)})())';
    const second = { nested: { total: 20 } };
    expect(await jsonata(expression).evaluate({ ...input, second })).toEqual(second.nested);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "first", confidence: "static", coverage: "exact" });
    expect(accesses).toContainEqual({ path: "second.nested", confidence: "static", coverage: "subtree" });
    expect(accesses.some(({ path }) => path === "first.nested")).toBe(false);
  });

  it("retains the producer context for unresolved host function arguments", async () => {
    const expression = 'record.(function($v){$v.nested})($hostCopy(first))';
    const compiled = jsonata(expression);
    compiled.registerFunction("hostCopy", (value: unknown) => value);
    expect(await compiled.evaluate({ record: input })).toEqual(input.first.nested);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record.first.nested", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '($f:=function($v){$v.nested};record.$f(first))',
    '($f:=function($v){$v};record.$f(first.nested))',
    'record.$map(first,function($v){$v.nested})',
    'record.$reduce([first],function($a,$v){$v.nested},0)',
    'record.$each({"copy":first},function($v){$v.nested})',
  ])("retains data path context in function result metadata for %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ record: input })).toEqual(input.first.nested);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record.first.nested", confidence: "static", coverage: "subtree",
    });
  });

  it("retains captured closure input while accounting for the traversed context", async () => {
    const expression = '($f:=function(){first.nested};record.$f())';
    expect(await jsonata(expression).evaluate({ ...input, record: {} })).toEqual(input.first.nested);
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "record", confidence: "static", coverage: "exact" },
      { path: "first.nested", confidence: "static", coverage: "subtree" },
    ]);
  });

  it("records traversal dependencies when function arguments read only constants", async () => {
    const expression = 'items.$count(1)';
    expect(Array.from(await jsonata(expression).evaluate({ items: [{}, {}] }))).toEqual([1, 1]);
    expect(await jsonata(expression).evaluate({ items: [] })).toBeUndefined();
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "items", confidence: "static", coverage: "exact" },
    ]);
  });

  it("records traversal dependencies when a builtin argument reads from the root", async () => {
    const expression = 'Account.$string($$.root)';
    expect(Array.from(await jsonata(expression).evaluate({ Account: [{}, {}], root: input.first }))).toEqual([
      JSON.stringify(input.first), JSON.stringify(input.first),
    ]);
    expect(await jsonata(expression).evaluate({ root: input.first })).toBeUndefined();
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "Account", confidence: "static", coverage: "exact",
    });
  });

  it("preserves the conservative result fallback for unresolved host functions", async () => {
    const expression = '$map($hostCopy(first),function($v){$v.nested})';
    const compiled = jsonata(expression);
    compiled.registerFunction("hostCopy", (value: unknown) => value);
    expect(await compiled.evaluate(input)).toEqual(input.first.nested);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "first.nested", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '$map($count(first),function($v){$v.nested})',
    '($f:=$count;$map($f(first),function($v){$v.nested}))',
    '($f:=$count(?);$map($f(first),function($v){$v.nested}))',
    '($f:=$count(?);$g:=$f(?);$map($g(first),function($v){$v.nested}))',
  ])("preserves the result fallback for explicitly opaque builtin replacements in %s", async (expression) => {
    const compiled = jsonata(expression);
    compiled.registerFunction("count", (value: unknown) => value);
    expect(await compiled.evaluate(input)).toEqual(input.first.nested);
    expect(analyzeExpression(expression, { opaqueFunctions: ["count"] }).accesses).toContainEqual({
      path: "first.nested", confidence: "static", coverage: "subtree",
    });
  });
});
