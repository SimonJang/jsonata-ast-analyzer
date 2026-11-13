import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { record: { details: { amount: 10 } }, other: { details: { amount: 20 } }, key: "copy" };

describe("function argument assignment effects", () => {
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
