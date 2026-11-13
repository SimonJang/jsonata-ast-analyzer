import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("assignment scope after tuple sorting", () => {
  it.each([
    'rows@$r^($r.name).{"a":$x:=$$.record}',
    'rows@$r^($r.name).[$x:=$$.record]',
    'rows@$r^($count($x:=$$.record))',
  ])("keeps tuple projection and initial sort key writes local in %s", async (setup) => {
    const source = `($x:=other;${setup};$x.details.amount)`;
    const input = { record: { details: { amount: 10 } }, other: { details: { amount: 20 } }, rows: [{ name: "a" }, { name: "b" }] };
    expect(await jsonata(source).evaluate(input)).toBe(20);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).not.toContain("record.details.amount");
  });

  it.each([0, 1, 2])("retains callbacks assigned after sorting %i tuples", async (count) => {
    const source = '($f:=function(){other.details.amount};rows@$r^($r.name)[$exists($f:=function(){r.details.amount})];$f())';
    const input = { other: { details: { amount: 20 } }, rows: Array.from({ length: count }, (_, index) => ({ name: String(index), details: { amount: 10 } })) };
    expect(await jsonata(source).evaluate(input)).toBe(count < 2 ? 20 : 10);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("other.details.amount");
    expect(paths).toContain("rows.details.amount");
  });

  for (const [setup, origin] of [
    ['rows@$r^($r.name)[$exists($x:=$$.record)]', "record"],
    ['rows#$i^(name)[$exists($x:=$$.record)]', "record"],
    ['rows@$r^($r.name)^($count($x:=$$.record))', "record"],
    ['rows@$r^($r.name){"a":$x:=$$.record}', "record"],
    ['rows@$r^($r.name)[$exists($x:=r)]', "rows"],
    ['rows@$r^($r.name)[$exists($x:=`@`.record)]', "record"],
  ]) {
    it.each([0, 1, 2])(`retains both runtime scopes for ${setup} with %i rows`, async (count) => {
      const source = `($x:=other;${setup};$x.details.amount)`;
      const reads = new Set<string>();
      const leaf = (path: string, amount: number) => ({ details: { get amount() { reads.add(`${path}.details.amount`); return amount; } } });
      const input = { record: leaf("record", 10), other: leaf("other", 20), rows: Array.from({ length: count }, (_, index) => ({ name: String(index), ...leaf("rows", 10) })) };
      expect(await jsonata(source).evaluate(input)).toBe(count < 2 ? 20 : 10);
      expect(reads).toContain(`${count < 2 ? "other" : origin}.details.amount`);
      const paths = analyzeExpression(source).accesses.map(({ path }) => path);
      expect(paths).toContain("other.details.amount");
      expect(paths, JSON.stringify(paths)).toContain(`${origin}.details.amount`);
    });
  }
});
