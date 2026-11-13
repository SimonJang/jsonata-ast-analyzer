import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { record: { name: "a", details: { amount: 10 } }, other: { details: { amount: 20 } } };

describe("filter and grouping assignment effects", () => {
  it("retains leading array assignments before tuple path stages", async () => {
    const source = '([$x:=record]@$row.details;$x.details.amount)';
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("record.details.amount");
  });

  it.each([
    '(record[$exists($x:=details)];$x.amount)',
    '($r:=record;$r[$exists($x:=details)];$x.amount)',
    '(record.details[$exists($x:=$)];$x.amount)',
    '([record][$exists($x:=details)];$x.amount)',
    '($reverse([record])[$exists($x:=details)];$x.amount)',
    '(record{"a":$x:=$};$x.details.amount)',
    '($r:=record;$r{"a":$x:=$};$x.details.amount)',
    '([record]{"a":$x:=$};$x.details.amount)',
    '($reverse([record]){"a":$x:=$};$x.details.amount)',
    '(record[$exists($f:=function(){details.amount})];$f())',
    '(record[$exists($f:=$lookup($,?))];$f("details").amount)',
    '(record{"a":$f:=function(){details.amount}};$f())',
    '(record{"a":$f:=$lookup($,?)};$f("details").amount)',
  ])("retains stage assignments after %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("record.details.amount");
  });

  it.each([
    '($x:=other.details;record[$exists($x:=details)];$x.amount)',
    '($x:=other;record{(name):$x:=$};$x.details.amount)',
  ])("retains prior bindings when stages visit no matching input in %s", async (source) => {
    for (const record of [[], input.record]) {
      expect(await jsonata(source).evaluate({ ...input, record })).toBe(record === input.record ? 10 : 20);
    }
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("record.details.amount");
    expect(paths).toContain("other.details.amount");
  });

  it.each([
    '($x:=other;record@$r[$exists($x:=$r)];$x.details.amount)',
    '($x:=other;record[($x:=$)];$x.details.amount)',
    '($x:=other;record{"a":($x:=$)};$x.details.amount)',
  ])("keeps tuple and block stage assignments local in %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(20);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("other.details.amount");
    expect(paths).not.toContain("record.details.amount");
  });
});
