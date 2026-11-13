import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("assignments over constructed projection contexts", () => {
  it.each([
    '$map(rows.{"copy":details}.{"run":function(){copy.amount}}.run,function($f){$f()})',
    '$map(rows.{"copy":details}.{($$.key):function(){copy.amount}}.copy,function($f){$f()})',
    '($f:=function(){other.amount};rows.{"copy":details}^($count($f:=function(){copy.amount}));$f())',
    '($f:=function(){other.amount};$r:=rows;$r.{"copy":details}^($count($f:=function(){copy.amount}));$f())',
    '($f:=function(){other.amount};rows.{"copy":details}^($count($f:=function(){copy.amount})).{"out":$f()})',
    '($x:=other;rows.{"copy":details}^($count($x:={"copy":copy}));$x.copy.amount)',
    '($x:=other;$r:=rows;$r.{"copy":details}^($count($x:={"copy":copy}));$x.copy.amount)',
    '($x:=other;rows.{"copy":details}^($count($x:={($$.key):copy}));$x.copy.amount)',
  ])("preserves constructed source fields in %s", async (source) => {
    let reads = 0;
    const input = { key: "copy", other: { amount: 20 }, rows: Array.from({ length: 2 }, () => ({ details: { get amount() { reads++; return 10; } } })) };
    expect(await jsonata(source).evaluate(input)).toBeDefined();
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("rows.details.amount");
  });
});
