import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const items = [{ active: true, rank: 1, group: "one", details: { total: 10 } }];

describe("group result source scopes", () => {
  it.each([
    'items@$r{"out":$r.details}',
    'items@$r[$r.active]{"out":$r.details}',
    'items@$r^(rank){"out":$r.details}',
    'items.($)@$r{"out":$r.details}',
    '($v := items; $v.($)@$r{"out":$r.details})',
    '($v := items; $v{"out":details})',
    '(items ~> $map(function($v){$v}))@$r^(<$r.rank){"out":$r.details}',
  ])("selects the complete focused result in %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ items })).toEqual({ out: { total: 10 } });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details", confidence: "static", coverage: "subtree",
    });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '$value{"out":v.amount}',
    '$value.($)@$r{"out":$r.v.amount}',
  ])("selects both shared alias branches in %s", async (selection) => {
    let reads = 0;
    const record = {
      amount: { get total() { reads++; return 20; } },
      v: { amount: { get total() { reads++; return 10; } } },
    };
    const expression = `($value := enabled ? {"v":record} : record; ${selection})`;
    for (const enabled of [true, false]) {
      const result = await jsonata(expression).evaluate({ record, enabled });
      expect(JSON.parse(JSON.stringify(result))).toEqual({ out: { total: enabled ? 20 : 10 } });
    }
    expect(reads).toBeGreaterThan(0);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "record.amount", confidence: "static", coverage: "subtree" });
    expect(accesses).toContainEqual({ path: "record.v.amount", confidence: "static", coverage: "subtree" });
  });

  it("keeps group keys and scalar callback reads exact", async () => {
    const expression = 'items@$r{$r.group:$count($r.details)}';
    expect(await jsonata(expression).evaluate({ items })).toEqual({ one: 1 });
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "items", confidence: "static", coverage: "exact" },
      { path: "items.group", confidence: "static", coverage: "exact" },
      { path: "items.details", confidence: "static", coverage: "exact" },
    ]);
  });

  it("retains the previous context after a focus binding", async () => {
    const expression = 'items@$r{"out":details}';
    expect(await jsonata(expression).evaluate({ items, details: { total: 30 } })).toEqual({ out: { total: 30 } });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "details", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    'items.{"x":details}^(<x.total){"out":x}',
    'items.({"x":details})^(<x.total){"out":x}',
  ])("selects sorted constructor values in %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ items })).toEqual({ out: { total: 10 } });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details", confidence: "static", coverage: "subtree",
    });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details.total", confidence: "static", coverage: "exact",
    });
  });

  it("selects sorted array constructor elements", async () => {
    const expression = 'items.[details]^(<total){"out":$}';
    expect(await jsonata(expression).evaluate({ items })).toEqual({ out: [{ total: 10 }] });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details", confidence: "static", coverage: "subtree",
    });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details.total", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    'record.$sift(function($value){true}){"out":first.details}',
    'record.(flag ? $spread : $clone)(){"out":first.details}',
  ])("selects context-default function values in %s", async (expression) => {
    for (const flag of [true, false]) {
      const record = { flag, first: { details: { total: 10 } } };
      expect(await jsonata(expression).evaluate({ record })).toEqual({ out: { total: 10 } });
    }
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record.first.details", confidence: "static", coverage: "subtree",
    });
  });
});
