import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression, extractPaths } from "../src/index.js";

describe("registered host function dependencies", () => {
  it.each([
    "$custom(record)",
    "record ~> $custom()",
    "($f := $custom(?); $f(record))",
    "$custom(record).missing",
  ])("covers nested argument reads inside a registered JavaScript function: %s", async (source) => {
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    const reads: string[] = [];
    expect(await expression.evaluate({ record: { details: { get amount() { reads.push("record.details.amount"); return 10; } } } })).toBe(source.endsWith(".missing") ? undefined : 10);
    expect(reads).toEqual(["record.details.amount"]);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
    expect(extractPaths(source)).toContainEqual({ path: "record.**", confidence: "static" });
  });

  it("covers argument descendants when the host replaces a builtin", async () => {
    const source = "$count(record)";
    const expression = jsonata(source);
    expression.registerFunction("count", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    expect(await expression.evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    expect(analyzeExpression(source, { opaqueFunctions: ["count"] }).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
    expect(analyzeExpression(source).accesses).toEqual([
      { path: "record", confidence: "static", coverage: "exact" },
    ]);
  });

  it("retains conservative reads through a host-function alias", async () => {
    const source = "($f := $custom; $f(record))";
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    expect(await expression.evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    ['$custom({"copy": record})', "record.**"],
    ['($r := record; $custom($r))', "record.**"],
    ['items.$custom(details)', "items.details.**"],
    ['$custom($lookup(dict, selected))', "dict[*].**"],
  ])("resolves argument origins before adding descendant reads in %s", async (source, path) => {
    const expression = jsonata(source);
    expression.registerFunction("custom", (value: unknown) => JSON.stringify(value), "<x:s>");
    expect(await expression.evaluate({
      record: { amount: 10 }, items: [{ details: { amount: 20 } }],
      dict: { a: { amount: 30 } }, selected: "a",
    })).toBeDefined();
    expect(analyzeExpression(source).accesses).toContainEqual({
      path, confidence: path.includes("[*]") ? "dynamic" : "static", coverage: "exact",
    });
  });

  it("does not treat scalar argument computations as forwarded input objects", async () => {
    const source = "$custom($count(record))";
    const expression = jsonata(source);
    expression.registerFunction("custom", (count: number) => count + 1, "<n:n>");
    expect(await expression.evaluate({ record: { amount: 10 } })).toBe(2);
    expect(analyzeExpression(source).accesses).toEqual([
      { path: "record", confidence: "static", coverage: "exact" },
    ]);
  });

  it("retains closure reads when a registered function invokes a stored callback", async () => {
    const source = "($f := function(){record.details.amount}; $custom($f))";
    const expression = jsonata(source);
    expression.registerFunction("custom", async (callback: () => Promise<number>) => callback(), "<f:n>");
    expect(await expression.evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.details.amount", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    "($f := function(){record}; $custom($f))",
    "$custom(function(){record})",
    "($f := function($v){record}; $custom($f(?)))",
    '($f := {"callback":function(){record}}; $custom($f.callback))',
    '($f := {"callback":function(){record}}; $custom($lookup($f,"callback")))',
  ])("covers host reads of objects returned by callback arguments: %s", async (source) => {
    const expression = jsonata(source);
    expression.registerFunction("custom", async (callback: () => Promise<{ details: { amount: number } }>) => (await callback()).details.amount, "<f:n>");
    expect(await expression.evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
  });

  it("follows callbacks passed to an opaque builtin replacement", async () => {
    const source = "($f := function(){record}; $count($f))";
    const expression = jsonata(source);
    expression.registerFunction("count", async (callback: () => Promise<{ details: { amount: number } }>) => (await callback()).details.amount, "<f:n>");
    expect(await expression.evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    expect(analyzeExpression(source, { opaqueFunctions: ["count"] }).accesses).toEqual([
      { path: "record", confidence: "static", coverage: "exact" },
      { path: "record.**", confidence: "static", coverage: "exact" },
    ]);
  });

  it("terminates when a callback can recurse through its host function", async () => {
    const source = "($f := function(){$$.config.stop ? 10 : $custom($f)}; $custom($f))";
    const expression = jsonata(source);
    expression.registerFunction("custom", async (callback: () => Promise<number>) => callback(), "<f:n>");
    expect(await expression.evaluate({ config: { stop: true } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "config.stop", confidence: "static", coverage: "exact",
    });
  });

  it("honors a host-function alias that shadows a builtin name", async () => {
    const source = "($map := $custom; $map(record))";
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    expect(await expression.evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
  });

  it("keeps conservative arguments when selecting a registered function from an object", async () => {
    const source = '($f := {"run":$custom}; $lookup($f,"run")(record))';
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    expect(await expression.evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
  });

  it("keeps conservative arguments when selecting a registered function from an array", async () => {
    const source = "($f := [$custom]; $f[0](record))";
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    expect(await expression.evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
  });

  it("retains host possibilities in a mixed callable collection", async () => {
    const source = "($f := [$custom,function($r){$count($r)}]; $f[$$.index](record))";
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    expect(await expression.evaluate({ index: 0, record: { details: { amount: 10 } } })).toBe(10);
    expect(await expression.evaluate({ index: 1, record: { details: { amount: 10 } } })).toBe(1);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
  });

  it("covers nested reads when a registered function is used as a map callback", async () => {
    const source = "$sum($map(items,$custom))";
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    expect(await expression.evaluate({ items: [{ details: { amount: 10 } }] })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "items.**", confidence: "static", coverage: "exact",
    });
  });

  it("retains a registered callback alongside a local callback branch", async () => {
    const source = "$sum($map(items, enabled ? $custom : function($r){$count($r)}))";
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    for (const enabled of [true, false]) {
      expect(await expression.evaluate({ enabled, items: [{ details: { amount: 10 } }] })).toBe(enabled ? 10 : 1);
    }
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "items.**", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    ["$count($filter(items,$custom))", 1],
    ["$count($single(items,$custom))", 1],
    ["$count($sort($append(items,items),$custom))", 2],
    ["$sum($each(dict,$custom))", 10],
    ["$count($sift(dict,$custom))", 1],
  ])("covers unknown callback argument descendants in %s", async (source, expected) => {
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount);
    expect(await expression.evaluate({ items: [{ details: { amount: 10 } }], dict: { first: { details: { amount: 10 } } } })).toBe(expected);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: source.includes("dict") ? "dict.**" : "items.**", confidence: "static", coverage: "exact",
    });
  });

  it("covers both the collection and the seed passed to a host reducer", async () => {
    const source = "$reduce(items,$custom,seed).total";
    const expression = jsonata(source);
    expression.registerFunction("custom", (acc: { total: number }, record: { details: { amount: number } }) => ({ total: acc.total + record.details.amount }), "<oo:o>");
    expect(await expression.evaluate({ items: [{ details: { amount: 10 } }], seed: { total: 2 } })).toBe(12);
    for (const path of ["items.**", "seed.**"]) expect(analyzeExpression(source).accesses).toContainEqual({
      path, confidence: "static", coverage: "exact",
    });
  });
});
