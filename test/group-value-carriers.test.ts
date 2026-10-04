import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const items = [{ group: "one", rank: 1, details: { total: 10 } }];

describe("group result value carriers", () => {
  it.each([
    ['items@$r{"out":$r.details}', 'out'],
    ['items.($)@$r{"out":$r.details}', 'out'],
    ['items@$r^(<$r.rank){"out":$r.details}', 'out'],
    ['items{"out":details}', 'out'],
    ['items@$r{$r.group:$r.details}', 'one'],
    ['items.{"v":details}{"out":v}', 'out'],
    ['items.{"v":details}#$i{$string($i):v}', '`0`'],
  ])("preserves stored group values from %s", async (source, key) => {
    for (const selection of [`$g.${key}`, '$lookup($g,key)']) {
      const expression = `($g := ${source}; ${selection})`;
      expect(await jsonata(expression).evaluate({ items, key: key.replaceAll('`', '') })).toEqual({ total: 10 });
      const accesses = analyzeExpression(expression).accesses;
      expect(accesses).toContainEqual({ path: "items.details", confidence: "static", coverage: "subtree" });
      expect(accesses).toContainEqual({ path: "items", confidence: "static", coverage: "exact" });
    }
  });

  it.each([
    '$map(items,function($v){$v{"out":details}})',
    '$map(items,function($v){$v.($)@$r{"out":$r.details}})',
    '(function($v){$v{"out":details}})(items)',
    '(function($v){$v.($)@$r{"out":$r.details}})(items)',
    '$reduce(items,function($acc,$v){$v{"out":details}}, {})',
    '$map(items,function($v){($v{"out":details})})',
  ])("selects callback group values in %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ items })).toEqual({ out: { total: 10 } });
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "items.details", confidence: "static", coverage: "subtree" });
    expect(accesses).toContainEqual({ path: "items", confidence: "static", coverage: "exact" });
  });

  it.each([
    ['"out"', '$g.out.nested', 'out'],
    ['"out"', '$lookup($g,key).nested', 'out'],
    ['$r.group', '$g.one.nested', 'one'],
    ['$r.group', '$lookup($g,key).nested', 'one'],
  ])("retains nested group construction with key %s in %s", async (groupKey, selection, key) => {
    const expression = `($g := items@$r{${groupKey}:{"nested":$r.details}}; ${selection})`;
    expect(await jsonata(expression).evaluate({ items, key })).toEqual({ total: 10 });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details", confidence: "static", coverage: "subtree",
    });
  });

  it.each(['$g.out', '$g.out.total'])
    ("keeps scalar group values separate from argument sources in %s", async (selection) => {
      const expression = `($g := items@$r{"out":$count($r.details)}; ${selection})`;
      expect(await jsonata(expression).evaluate({ items })).toEqual(selection === '$g.out' ? 1 : undefined);
      expect(analyzeExpression(expression).accesses).toEqual([
        { path: "items", confidence: "static", coverage: "exact" },
        { path: "items.details", confidence: "static", coverage: "exact" },
      ]);
    });
});
