import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { record: { details: { amount: 10 } }, other: { details: { amount: 20 } }, key: "copy" };

describe("function argument assignment effects", () => {
  it("selects the callee before an argument reassigns its name", async () => {
    const source = '($f:=function($unused){record.details.amount};$count($f($f:=function(){other.details.amount})))';
    expect(await jsonata(source).evaluate(input)).toBe(1);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("record.details.amount");
    expect(paths).not.toContain("other.details.amount");
  });

  it("captures each argument value before later arguments overwrite its source", async () => {
    const source = '$clone($append($x:=record,$x:=other))';
    expect(await jsonata(source).evaluate(input)).toEqual([input.record, input.other]);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("record.**");
    expect(paths).toContain("other.**");
  });

  it("applies registered host consumption to a later argument's source", async () => {
    const source = '($consume:=function($a,$b){$custom($b)};$consume($x:=record,$x.details))';
    const expression = jsonata(source);
    expression.registerFunction("custom", (details: { amount: number }) => details.amount, "<o:n>");
    expect(await expression.evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.details.**", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '$count($append($x:=record,$x.details.amount))',
    '($consume:=function($a,$b){$count($b)};$consume($x:=record,$x.details.amount))',
    '($take:=function($a,$b){$b};$count($take($x:=record,$x.details.amount)))',
  ])("evaluates later arguments with earlier assignments in %s", async (source) => {
    let reads = 0;
    const record = { details: { get amount() { reads++; return 10; } } };
    expect(await jsonata(source).evaluate({ ...input, record })).toBe(source.includes("$append") ? 2 : 1);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.details.amount", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '$clone($lookup($x:=record,$x.key))',
    '($take:=function($a,$b){$b};$clone($take($x:=record,$x.details)))',
  ])("retains later argument result origins in %s", async (source) => {
    let reads = 0;
    const record = { key: "details", details: { get amount() { reads++; return 10; } } };
    expect(await jsonata(source).evaluate({ ...input, record })).toEqual({ amount: 10 });
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.some(({ path }) =>
      path === "record.details.**" || path === "record[*].**")).toBe(true);
  });

  it.each([
    '($count($x:=record);$x.details.amount)',
    '($count([$x:=record]);$x.details.amount)',
    '($count({"a":$x:=record});$x.details.amount)',
    '($count($reverse([$x:=record]));$x.details.amount)',
    '($lookup({"a":$x:=record},"a");$x.details.amount)',
    '($count($x:={"copy":record});$x.copy.details.amount)',
    '($count($x:={(key):record});$x.copy.details.amount)',
    '($count($f:=function(){record.details.amount});$f())',
    '(function(){($count($x:=record);$x.details.amount)})()',
  ])("preserves caller assignments after %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("keeps assignments in argument blocks local", async () => {
    const source = '($x:=other;$count(($x:=record));$x.details.amount)';
    expect(await jsonata(source).evaluate(input)).toBe(20);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("other.details.amount");
    expect(paths).not.toContain("record.details.amount");
  });
});
