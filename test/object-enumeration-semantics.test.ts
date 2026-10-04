import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("object enumeration dependencies", () => {
  it.each([
    ['$count($spread(record))', "record.*", 1, 2],
    ['$count($keys(record))', "record.*", 1, 2],
    ['$count($spread($lookup(dict, selected)))', "dict[*].*", 1, 2],
    ['$count($keys($map(items, function($v) { $v.details })))', "items.details.*", 1, 2],
    ['($v := record; $count($spread($v)))', "record.*", 1, 2],
    ['($v := record; $count($keys($v)))', "record.*", 1, 2],
    ['$count($keys([$v := record, $v]))', "record.*", 1, 2],
    ['$count($keys($merge([record])))', "record.*", 1, 2],
    ['$count($keys($eval("details", record)))', "record.details.*", 1, 2],
  ] as const)("records property enumeration in %s", async (expression, path, before, after) => {
    const input = { record: { details: { amount: 10 } }, dict: { a: { amount: 10 } }, selected: "a", items: [{ details: { amount: 10 } }] };
    expect(await jsonata(expression).evaluate(input)).toBe(before);
    const changed = { record: { details: { amount: 10, active: true }, extra: true }, dict: { a: { amount: 10, active: true } }, selected: "a", items: [{ details: { amount: 10, active: true } }] };
    expect(await jsonata(expression).evaluate(changed)).toBe(after);
    expect(analyzeExpression(expression).accesses).toContainEqual({ path, confidence: path.includes("[*]") ? "dynamic" : "static", coverage: "exact" });
  });

  it.each(["boolean", "not"])("records object shape consumed by $%s", async (name) => {
    const expression = `$${name}(record)`;
    expect(await jsonata(expression).evaluate({ record: {} })).toBe(name === "not");
    expect(await jsonata(expression).evaluate({ record: { active: true } })).toBe(name === "boolean");
    expect(analyzeExpression(expression).accesses).toContainEqual({ path: "record.*", confidence: "static", coverage: "exact" });
  });

  it.each([
    '$count($spread({"v": record}))',
    '($v := {"v": record}; $count($spread($v)))',
    '($v := {selected: record}; $count($keys($v)))',
    '$count($keys($merge([{"v": record}])))',
    '$count($keys($eval("$", {"v": record})))',
    '$count({"v": record}.$spread())',
  ])("does not enumerate fields of a constructed object's values in %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ selected: "v", record: { amount: 10 } })).toBe(1);
    expect(analyzeExpression(expression).accesses.some(({ path }) => path === "record.*")).toBe(false);
  });

  it("enumerates only the direct branch of a mixed constructed alias", async () => {
    const expression = '($v := enabled ? {"v": record} : other; $count($spread($v)))';
    const input = { record: { amount: 10 }, other: { a: 1, b: 2 } };
    expect(await jsonata(expression).evaluate({ ...input, enabled: true })).toBe(1);
    expect(await jsonata(expression).evaluate({ ...input, enabled: false })).toBe(2);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "other.*", confidence: "static", coverage: "exact" });
    expect(accesses.some(({ path }) => path === "record.*")).toBe(false);
  });

  it("keeps enumeration relative to a function path step", async () => {
    const expression = 'items.$count($keys(details))';
    expect(await jsonata(expression).evaluate({ items: [{ details: { a: 1, b: 2 } }] })).toBe(2);
    expect(analyzeExpression(expression).accesses).toContainEqual({ path: "items.details.*", confidence: "static", coverage: "exact" });
  });

  it("skips enumeration semantics for opaque replacements", () => {
    for (const name of ["keys", "spread", "boolean", "not", "merge"]) {
      expect(analyzeExpression(`$${name}(record)`, { opaqueFunctions: [name] }).accesses).toEqual([
        { path: "record", confidence: "static", coverage: "exact" },
      ]);
    }
  });
});
