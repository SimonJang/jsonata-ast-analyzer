import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { record: { details: { amount: 10 } }, other: { details: { amount: 20 } }, key: "copy" };

describe("conditional assignment effects", () => {
  it.each([
    '($x:=other;enabled ? $x:=record : 0;$x.details.amount)',
    '($x:=other;enabled ? [$x:=record] : [];$x.details.amount)',
    '($x:=other;enabled ? {"a":$x:=record} : {};$x.details.amount)',
    '($x:=other;$count(enabled ? $x:=record : null);$x.details.amount)',
    '($x:={"copy":other};enabled ? $x:={"copy":record} : 0;$x.copy.details.amount)',
    '($x:={(key):other};enabled ? $x:={(key):record} : 0;$x.copy.details.amount)',
    '($f:=function(){other.details.amount};enabled ? $f:=function(){record.details.amount} : 0;$f())',
  ])("retains the assigned and unchanged branches in %s", async (source) => {
    for (const enabled of [true, false]) {
      expect(await jsonata(source).evaluate({ ...input, enabled })).toBe(enabled ? 10 : 20);
    }
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("record.details.amount");
    expect(paths).toContain("other.details.amount");
  });

  it.each([
    '($x:=other;enabled ? ($x:=record) : 0;$x.details.amount)',
    '($x:=other;$f:=function(){enabled ? $x:=record : 0};$x.details.amount)',
  ])("keeps isolated assignments local in %s", async (source) => {
    expect(await jsonata(source).evaluate({ ...input, enabled: true })).toBe(20);
    const paths = analyzeExpression(source).accesses.map(({ path }) => path);
    expect(paths).toContain("other.details.amount");
    expect(paths).not.toContain("record.details.amount");
  });
});
