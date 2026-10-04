import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const record = { v: { amount: 10 }, amount: 20 };
const producers = [
  'enabled ? {"v":record} : record',
  'enabled ? {(key):record} : record',
  'enabled ? $clone({"v":record}) : record',
  'enabled ? {"v":record} : $clone(record)',
  '$map([record], function($r){enabled ? {"v":$r} : $r})',
  'function($r){enabled ? {"v":$r} : $r}(record)',
] as const;

describe("constructed and pass-through branches sharing a physical source", () => {
  it.each(producers)("retains static suffixes through %s", async (producer) => {
    const expression = `($value := ${producer}; $value.v.amount)`;
    expect(await jsonata(expression).evaluate({ record, enabled: true, key: "v" })).toBe(20);
    expect(await jsonata(expression).evaluate({ record, enabled: false, key: "v" })).toBe(10);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("record.amount");
    expect(paths).toContain("record.v.amount");
  });

  it.each(producers)("retains dynamic lookup suffixes through %s", async (producer) => {
    const expression = `($value := ${producer}; $lookup($value, selected).amount)`;
    expect(await jsonata(expression).evaluate({ record, enabled: true, key: "v", selected: "v" })).toBe(20);
    expect(await jsonata(expression).evaluate({ record, enabled: false, key: "v", selected: "v" })).toBe(10);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("record.amount");
    expect(paths).toContain("record[*].amount");
  });

  it.each(producers)("retains property enumeration through %s", async (producer) => {
    const expression = `($value := ${producer}; $count($spread($value)))`;
    expect(await jsonata(expression).evaluate({ record, enabled: true, key: "v" })).toBe(1);
    expect(await jsonata(expression).evaluate({ record, enabled: false, key: "v" })).toBe(2);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record.*", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '{"v":record}',
    '$clone({"v":record})',
    'function($r){{"v":$r}}(record)',
    '$map([record], function($r){{"v":$r}})',
    'enabled ? $clone({"v":record}) : {"v":record}',
    '$map([record], function($r){enabled ? $clone({"v":$r}) : {"v":$r}})',
    '$append([$clone({"v":record})], [])',
    '$zip([$clone({"v":record})])',
    '$reduce([record], function($acc, $v){$acc}, $clone({"v":record}))',
  ])("keeps a constructed-only source out of pass-through suffixes in %s", async (producer) => {
    const expression = `($value := ${producer}; $value.v.amount)`;
    expect(await jsonata(expression).evaluate({ record, enabled: true })).toBe(20);
    expect(await jsonata(expression).evaluate({ record, enabled: false })).toBe(20);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("record.amount");
    expect(paths).not.toContain("record.v.amount");
    const enumeration = `($value := ${producer}; $count($keys($value)))`;
    expect(await jsonata(enumeration).evaluate({ record, enabled: true })).toBe(1);
    expect(analyzeExpression(enumeration).accesses.map(({ path }) => path)).not.toContain("record.*");
  });

  it.each(producers.flatMap((producer) => [
    '$value.($)@$r[$r.v.amount > 0].v.amount',
    '$value.($)@$r{"out":$r.v.amount}',
    '$value.(v.amount)',
  ].map((selection) => [producer, selection] as const)))(
    "keeps both shared sources from %s in %s", async (producer, selection) => {
      const expression = `($value := ${producer}; ${selection})`;
      const grouped = selection.includes('"out"');
      expect(await jsonata(expression).evaluate({ record, enabled: true, key: "v" })).toEqual(grouped ? { out: 20 } : 20);
      expect(await jsonata(expression).evaluate({ record, enabled: false, key: "v" })).toEqual(grouped ? { out: 10 } : 10);
      const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
      expect(paths).toContain("record.amount");
      expect(paths).toContain("record.v.amount");
    },
  );
});
