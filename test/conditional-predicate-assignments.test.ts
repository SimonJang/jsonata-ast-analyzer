import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { record: { details: { amount: 10 } }, key: "copy" };

describe("conditional predicate assignments", () => {
  it.each([
    '$exists($x:=record) ? $x.details.amount : 0',
    '$not($exists($x:=record)) ? 0 : $x.details.amount',
    '$count([$x:=record])=1 ? $x.details.amount : 0',
    '$count({"a":$x:=record})=1 ? $x.details.amount : 0',
    '$exists($x:={"copy":record}) ? $x.copy.details.amount : 0',
    '$exists($x:={(key):record}) ? $x.copy.details.amount : 0',
    '$exists($f:=function(){record.details.amount}) ? $f() : 0',
    '$exists($f:=$lookup) ? $f(record,"details").amount : 0',
    '($exists($f:=function($r){$r.details.amount}) ? $f : function(){0})(record)',
    '($exists($f:=$lookup) ? $f : function($a,$b){null})(record,"details").amount',
    '($exists($f:=$lookup(?,"details")) ? $f : function($r){null})(record).amount',
  ])("uses predicate assignments while resolving %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("record.details.amount");
  });

  it.each([
    '$clone($exists($x:=record) ? $x.details : {})',
    '($v:=$exists($x:=record) ? {"copy":$x.details} : {};$clone($v.copy))',
    '($v:=$exists($x:=record) ? {(key):$x.details} : {};$clone($v.copy))',
    '$clone($lookup($exists($x:=record) ? {"copy":$x.details} : {},"copy"))',
  ])("retains selected branch data origins in %s", async (source) => {
    let reads = 0;
    const record = { details: { get amount() { reads++; return 10; } } };
    expect(await jsonata(source).evaluate({ ...input, record })).toEqual({ amount: 10 });
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.details.**", confidence: "static", coverage: "exact",
    });
  });

  it("retains registered callables assigned in the predicate", async () => {
    const source = '$exists($f:=$custom) ? $f(record) : 0';
    const expression = jsonata(source);
    expression.registerFunction("custom", (record: { details: { amount: number } }) => record.details.amount, "<o:n>");
    expect(await expression.evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
  });
});
