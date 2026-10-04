import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("built-in callable alternatives", () => {
  it.each([
    ['$count($map(items, $clone))', "items.**"],
    ['$count($map(items, $clone(?)))', "items.**"],
    ['$count($each({"v": record}, $clone))', "record.**"],
    ['$count($each({"v": record}, $clone(?)))', "record.**"],
    ['$count($each(record, $clone))', "record.*.**"],
  ] as const)("traces builtin callback reads in %s", async (expression, path) => {
    let reads = 0;
    const details = { get amount() { reads++; return 10; } };
    expect(await jsonata(expression).evaluate({ items: [{ details }], record: { details } })).toBe(1);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(expression).accesses).toContainEqual({ path, confidence: "static", coverage: "exact" });
  });

  it.each([
    '($f := enabled ? function($v){$v.details} : $clone; $f(record))',
    '($make := function(){enabled ? {"f":function($v){$v.details}} : {"f":$clone}}; ($make().f)(record))',
  ])("keeps both callable branches in %s", async (expression) => {
    const record = { details: { amount: 10 }, other: { amount: 20 } };
    expect(await jsonata(expression).evaluate({ record, enabled: true })).toEqual(record.details);
    expect(await jsonata(expression).evaluate({ record, enabled: false })).toEqual(record);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "record.**", confidence: "static", coverage: "exact" });
    expect(accesses).toContainEqual({ path: "record", confidence: "static", coverage: "subtree" });
    expect(accesses).toContainEqual({ path: "record.details", confidence: "static", coverage: "subtree" });
  });

  it("invokes a returned builtin partial with its captured argument", async () => {
    const expression = '$eval("$lookup(config, ?)", source)(selected).amount';
    expect(await jsonata(expression).evaluate({ source: { config: { a: { amount: 10 } } }, selected: "a" })).toBe(10);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "source.config[*].amount", confidence: "dynamic", coverage: "subtree" });
    expect(accesses.some(({ path }) => path === "[*]" || path === "selected.amount")).toBe(false);
  });

  it.each([
    '($f := enabled ? function($v){$v.details} : $clone; $result := $f(record); $result.amount)',
    '($make := function(){enabled ? {"f":function($v){$v.details}} : {"f":$clone}}; $result := ($make().f)(record); $result.amount)',
  ])("keeps suffixes after binding mixed callable results in %s", async (expression) => {
    const record = { details: { amount: 10 }, amount: 20 };
    expect(await jsonata(expression).evaluate({ record, enabled: true })).toBe(10);
    expect(await jsonata(expression).evaluate({ record, enabled: false })).toBe(20);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("record.details.amount");
    expect(paths).toContain("record.amount");
  });

  it.each([
    "$map(items, function($value){$lookup($value, ?)})[0]",
    "$reduce(items, function($accumulator, $value){$lookup($value, ?)})",
  ])("reads only the captured source when invoking %s", async (producer) => {
    const expression = `($lookupChildren := ${producer}; $lookupChildren("children").name)`;
    const input = {
      items: [{ children: { name: "first" } }, { children: { name: "second" } }],
      get children() { throw new Error("Unrelated root field was read"); },
    };
    expect(await jsonata(expression).evaluate(input)).toBe(producer.startsWith("$map") ? "first" : "second");
    expect(analyzeExpression(expression).accesses.some(({ path }) => path === "children")).toBe(false);
  });

  it.each([
    '($f := enabled ? function($v){{"field":$v.field.details}} : $clone; $result := $f({"field":record}); $result.field.amount)',
    '($make := function(){enabled ? {"f":function($v){{"field":$v.field.details}}} : {"f":$clone}}; $result := ($make().f)({"field":record}); $result.field.amount)',
  ])("keeps constructed aliases for both callable branches in %s", async (expression) => {
    const record = { details: { amount: 10 }, amount: 20 };
    expect(await jsonata(expression).evaluate({ record, enabled: true })).toBe(10);
    expect(await jsonata(expression).evaluate({ record, enabled: false })).toBe(20);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("record.details.amount");
    expect(paths).toContain("record.amount");
  });

  it.each([
    '($f := enabled ? function($v){{(key):$v.field.details}} : $clone; $result := $f({(key):record}); $result.field.amount)',
    '($make := function(){enabled ? {"f":function($v){{(key):$v.field.details}}} : {"f":$clone}}; $result := ($make().f)({(key):record}); $result.field.amount)',
  ])("keeps computed aliases for both callable branches in %s", async (expression) => {
    const record = { details: { amount: 10 }, amount: 20 };
    expect(await jsonata(expression).evaluate({ record, enabled: true, key: "field" })).toBe(10);
    expect(await jsonata(expression).evaluate({ record, enabled: false, key: "field" })).toBe(20);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("record.details.amount");
    expect(paths).toContain("record.amount");
  });

  it.each([
    '$each($clone(?)({"a":record}), $clone).amount',
    '($p := $clone(?); $v := {"a":record}; $each($p($v), $clone).amount)',
    '($v := {"a":record}; $p := $clone($v, ?); $v := {"a":other}; $each($p(), $clone).amount)',
  ])("preserves each values through wrapped builtins in %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ record: { amount: 10 }, other: { amount: 20 } })).toBe(10);
    expect(analyzeExpression(expression).accesses.map(({ path }) => path)).toContain("record.amount");
  });

  it.each([
    ['$count($map(items, $keys))', "items.*"],
    ['$count($each({"v": record}, $keys))', "record.*"],
    ['$count($map(items, $string))', "items.**"],
  ] as const)("applies the invoked builtin's read semantics in %s", async (expression, path) => {
    expect(await jsonata(expression).evaluate({ items: [{ details: { amount: 10 } }], record: { details: { amount: 10 } } })).toBe(1);
    expect(analyzeExpression(expression).accesses).toContainEqual({ path, confidence: "static", coverage: "exact" });
  });

  it("traces dynamic lookup suffixes through a builtin partial callback", async () => {
    const expression = "$map(items, $lookup(?, selected)).amount";
    expect(await jsonata(expression).evaluate({ items: [{ a: { amount: 10 } }], selected: "a" })).toBe(10);
    expect(analyzeExpression(expression).accesses).toContainEqual({ path: "items[*].amount", confidence: "dynamic", coverage: "subtree" });
  });
});
