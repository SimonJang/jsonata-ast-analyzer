import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("captured projection assignment origins", () => {
  it.each([
    '($x:=seed;rows.{"a":$y:=$x.next};$y.amount)',
    '($x:=seed;rows[$exists($y:=$x.next)];$y.amount)',
    '($x:=seed;rows{"a":$y:=$x.next};$y.amount)',
    '($x:=seed;rows.{"a":$y:=$x};$y.next.amount)',
    '($x:={"holder":seed};rows.{"a":$y:=$x.holder.next};$y.amount)',
    '($x:={(key):seed};rows.{"a":$y:=$x.holder.next};$y.amount)',
    '($x:=seed;rows.{"a":$y:={"box":$x.next}};$y.box.amount)',
    '($x:=seed;rows.{"a":$y:={($$.key):$x.next}};$y.holder.amount)',
    '($x:=seed;rows.{"a":$y:=$lookup({"picked":$x},"picked").next};$y.amount)',
  ])("keeps captured variables anchored to their original source in %s", async (source) => {
    let reads = 0;
    const seed = { next: { get amount() { reads++; return 10; } } };
    expect(await jsonata(source).evaluate({ seed, rows: [{}], key: "holder" })).toBe(10);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "seed.next.amount", confidence: "static", coverage: "subtree",
    });
  });
});
