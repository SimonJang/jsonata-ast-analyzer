import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { record: { details: { amount: 10 } }, other: { details: { amount: 20 } } };

describe("operator assignment effects", () => {
  it.each([
    ['$count($x:=record)+$x.details.amount', 11],
    ['$exists($x:=record) and $x.details.amount=10', true],
    ['$count($x:=record)=$x.details.amount', false],
    ['$count([$x:=record] ~> $append($x.details.amount))', 2],
  ] as const)("makes left-side assignments visible to the right in %s", async (source, expected) => {
    let reads = 0;
    const record = { details: { get amount() { reads++; return 10; } } };
    expect(await jsonata(source).evaluate({ ...input, record })).toBe(expected);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.details.amount", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '($exists($x:=record) and true;$x.details.amount)',
    '($count($x:=record)+1;$x.details.amount)',
    '($count($x:=record)>0;$x.details.amount)',
    '(-$count($x:=record);$x.details.amount)',
    '([$x:=record] ~> $count();$x.details.amount)',
  ])("retains assignments evaluated by %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '($x:=other;enabled and $exists($x:=record);$x.details.amount)',
    '($x:=other;enabled or $exists($x:=record);$x.details.amount)',
  ])("retains both short-circuit outcomes in %s", async (source) => {
    for (const enabled of [true, false]) {
      const assigned = source.includes(" or ") ? !enabled : enabled;
      expect(await jsonata(source).evaluate({ ...input, enabled })).toBe(assigned ? 10 : 20);
    }
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("record.details.amount");
    expect(paths).toContain("other.details.amount");
  });

  it("keeps assignments in a nested operator block local", async () => {
    const source = '($x:=other;($count($x:=record)+1);$x.details.amount)';
    expect(await jsonata(source).evaluate(input)).toBe(20);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("other.details.amount");
    expect(paths).not.toContain("record.details.amount");
  });
});
