import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, second: { nested: { total: 20 } }, key: "copy" };

describe("object assignment effects", () => {
  it.each([
    '$count($clone({"a":$f:=function(){first},"b":$append([],$f())}))',
    '($v:={"a":$f:=function(){first},"b":$append([],$f())};$count($clone($v)))',
    '($v:={"a":$f:=function(){first},"b":$append([],$f())};$count($clone($v.b)))',
    '$count($clone($lookup({"a":$f:=function(){first},"b":$append([],$f())},"b")))',
    '($v:={"a":$f:=function(){first},(key):$append([],$f())};$count($clone($v.copy)))',
  ])("retains result origins from sibling assignments in %s", async (source) => {
    let reads = 0;
    const first = { nested: { get total() { reads++; return 10; } } };
    expect(await jsonata(source).evaluate({ ...input, first })).toBe(1);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "first.**", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '($x:=second;$count({"a":$x:=first,"b":$count([])+$x.nested.total}))',
    '$count({"a":$f:=function(){first.nested.total},"b":$count([])+$f()})',
  ])("includes assignments observed by a concurrent entry in %s", async (source) => {
    let reads = 0;
    const first = { nested: { get total() { reads++; return 10; } } };
    expect(await jsonata(source).evaluate({ ...input, first })).toBe(1);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "first.nested.total", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '({"a":$x:=first};$x.nested)',
    '({"a":[$x:=first]};$x.nested)',
    '({"a":{"b":$x:=first}};$x.nested)',
    '($p:={"a":$x:=first};$x.nested)',
    '({"a":$x:={"copy":first}};$x.copy.nested)',
    '({"a":$x:={(key):first}};$x.copy.nested)',
    '(function(){({"a":$x:=first};$x.nested)})()',
    '({"a":$f:=function(){first.nested}};$f())',
    '($p:=({"a":$f:=function(){first.nested}};$f);$p())',
  ])("retains assignments after construction in %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toEqual(input.first.nested);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "first.nested", confidence: "static", coverage: "subtree",
    });
  });

  it("keeps assignments in nested blocks local", async () => {
    const source = '($x:=second;{"a":($x:=first)};$x.nested)';
    expect(await jsonata(source).evaluate(input)).toEqual(input.second.nested);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("second.nested");
    expect(paths).not.toContain("first.nested");
  });
});
