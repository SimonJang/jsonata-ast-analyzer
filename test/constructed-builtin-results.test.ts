import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const first = { nested: { total: 10 } };
const second = { nested: { total: 20 } };
const object = { a: first, b: second };
const source = '{"a":first,"b":second}';
const cases: [string, unknown][] = [
  [`$spread(${source})`, [{ a: first }, { b: second }]],
  [`$clone(${source})`, object],
  [`$filter(${source},function($v){true})`, object],
  [`$single(${source},function($v){true})`, object],
  [`$sift(${source},function($v){true})`, object],
  [`$reverse(${source})`, [object]],
  [`$shuffle(${source})`, [object]],
  [`$sort(${source})`, [object]],
  [`$append(${source},[])`, [object]],
  [`$zip(${source},[1])`, [[object, 1]]],
  [`$reverse([${source}])`, [object]],
  [`$filter([${source}],function($v){true})`, object],
  [`$append([${source}],[])`, [object]],
  [`$zip([${source}],[1])`, [[object, 1]]],
  ['$spread({(key):first,"b":second})', [{ chosen: first }, { b: second }]],
];

describe("constructed builtin result sources", () => {
  it.each(cases)("selects every returned object source in %s", async (expression, expected) => {
    const reads = new Set<string>();
    const input = {
      key: "chosen",
      first: { nested: { get total() { reads.add('first.nested.total'); return 10; } } },
      second: { nested: { get total() { reads.add('second.nested.total'); return 20; } } },
    };
    const result = await jsonata(expression).evaluate(input);
    expect(JSON.parse(JSON.stringify(result))).toEqual(expected);
    expect([...reads].sort()).toEqual(['first.nested.total', 'second.nested.total']);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "first", confidence: "static", coverage: "subtree" });
    expect(accesses).toContainEqual({ path: "second", confidence: "static", coverage: "subtree" });
    if (expression.includes('(key)')) {
      expect(accesses).toContainEqual({ path: "key", confidence: "static", coverage: "exact" });
    }
  });

  it.each([
    ['$reverse([$count(first),$count(second)])', [1, 1], ['first', 'second']],
    ['$append({"a":$count(first),"b":$count(second)},[])', [{ a: 1, b: 1 }], ['first', 'second']],
    ['$filter([{"a":$count(first)}],function($v){true})', { a: 1 }, ['first']],
    ['$reverse([first.nested.total + second.nested.total])', [30], ['first.nested.total', 'second.nested.total']],
  ] as const)("keeps scalar constructor reads exact in %s", async (expression, expected, paths) => {
    expect(await jsonata(expression).evaluate({ first, second })).toEqual(expected);
    expect(analyzeExpression(expression).accesses).toEqual(paths.map((path) => ({
      path, confidence: "static", coverage: "exact",
    })));
  });

  it("retains every possible constructor branch while keeping its condition exact", async () => {
    const expression = '$reverse(enabled ? {"a":first,"b":second} : {"a":other})';
    const other = { nested: { total: 30 } };
    for (const enabled of [true, false]) {
      expect(await jsonata(expression).evaluate({ first, second, other, enabled })).toEqual(
        enabled ? [object] : [{ a: other }],
      );
    }
    const accesses = analyzeExpression(expression).accesses;
    for (const path of ['first', 'second', 'other']) {
      expect(accesses).toContainEqual({ path, confidence: "static", coverage: "subtree" });
    }
    expect(accesses).toContainEqual({ path: "enabled", confidence: "static", coverage: "exact" });
  });
});
