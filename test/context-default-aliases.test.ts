import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const calls = ['$spread()', '$clone()', '$sift(function($v){true})', '($$.enabled ? $spread : $clone)()'];
const items = [{ details: { total: 10 } }];

describe("context-default result aliases", () => {
  it.each(calls)("retains constructed input fields through %s", async (call) => {
    const expression = `items.{"v":details}.${call}.v`;
    expect(await jsonata(expression).evaluate({ items, enabled: true })).toEqual({ total: 10 });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details", confidence: "static", coverage: "subtree",
    });
  });

  it.each(calls)("retains both mixed source roles through %s", async (call) => {
    const expression = `($x := enabled ? {"v":record} : record; $x.${call}.v.details)`;
    const record = { details: { total: 20 }, v: { details: { total: 10 } } };
    for (const enabled of [true, false]) {
      expect(await jsonata(expression).evaluate({ record, enabled })).toEqual({ total: enabled ? 20 : 10 });
    }
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "record.details", confidence: "static", coverage: "subtree" });
    expect(accesses).toContainEqual({ path: "record.v.details", confidence: "static", coverage: "subtree" });
  });

  it.each(['$spread', '$clone', '$sift'])
    ("retains the input aliases through captured builtin %s", async (builtin) => {
      const args = builtin === '$sift' ? 'function($v){true}' : '';
      const expression = `($f := ${builtin}; items.{"v":details}.$f(${args}).v)`;
      expect(await jsonata(expression).evaluate({ items })).toEqual({ total: 10 });
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "items.details", confidence: "static", coverage: "subtree",
      });
    });

  it.each(['items.{"v":details}.$spread()', 'items.{"v":details}.($)'])
    ("selects constructed current-context values in %s", async (expression) => {
      expect(await jsonata(expression).evaluate({ items })).toEqual({ v: { total: 10 } });
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "items.details", confidence: "static", coverage: "subtree",
      });
    });

  it("records clone descendant reads when its result is consumed by a scalar", async () => {
    let reads = 0;
    const input = { items: [{ details: { get total() { reads++; return 10; } } }] };
    const expression = '$count(items.{"v":details}.$clone())';
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details.**", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '$each(function($v){$v})',
    '$lookup("v")',
    '$lookup($$.enabled ? "v" : "unused")',
    '$sift(function($v){$v.total > 0}).v',
  ])("resolves constructed callback and lookup values through %s", async (call) => {
    const expression = `items.{"v":details}.${call}`;
    expect(await jsonata(expression).evaluate({ items, enabled: true })).toEqual({ total: 10 });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details", confidence: "static", coverage: "subtree",
    });
    if (call.startsWith('$sift')) {
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "items.details.total", confidence: "static", coverage: "exact",
      });
    }
  });
});
