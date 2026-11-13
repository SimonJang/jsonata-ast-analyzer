import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { record: { details: { amount: 10 } }, other: { details: { amount: 20 } } };

describe("path assignment effects", () => {
  it.each([
    '(record.{"a":$x:=$};$x.details.amount)',
    '(record.[$x:=$];$x.details.amount)',
    '(record.{"a":$x:=details};$x.amount)',
    '(record.details.{"a":$x:=$};$x.amount)',
    '($r:=record;$r.{"a":$x:=$};$x.details.amount)',
    '(record.{"a":$x:={"copy":details}};$x.copy.amount)',
    '(record.{"a":$x:={("copy"):details}};$x.copy.amount)',
    '(record.{"a":$f:=function(){details.amount}};$f())',
    '(record.{"a":$f:=$lookup};$f(record,"details").amount)',
    '(record.{"a":$f:=$lookup($,?)};$f("details").amount)',
  ])("retains projection assignments in %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("record.details.amount");
  });

  it("preserves absolute sources assigned inside a projection", async () => {
    const source = '(record.{"a":$x:=$$.other};$x.details.amount)';
    expect(await jsonata(source).evaluate(input)).toBe(20);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '($x:=other;record@$row.{"a":$x:=$row};$x.details.amount)',
    '($x:=other;record#$index.{"a":$x:=$};$x.details.amount)',
    '($x:=other;record.($x:=$);$x.details.amount)',
  ])("keeps tuple and block assignments local in %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(20);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("other.details.amount");
    expect(paths).not.toContain("record.details.amount");
  });

  it("retains initial constructor assignments before a tuple binding", async () => {
    const source = '([$x:=record]@$row;$x.details.amount)';
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("record.details.amount");
  });

  it("keeps projected scalar assignment values separate from their context", async () => {
    const source = '(record.{"a":$x:=1};$count($x))';
    expect(await jsonata(source).evaluate(input)).toBe(1);
    expect(analyzeExpression(source).accesses).toEqual([
      { path: "record", confidence: "static", coverage: "exact" },
    ]);
  });
});
