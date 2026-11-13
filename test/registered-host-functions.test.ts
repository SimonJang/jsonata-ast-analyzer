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
});
