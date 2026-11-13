import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

function covers(pattern: string[], actual: string[], subtree: boolean): boolean {
  if (pattern.length === 0) return subtree || actual.length === 0;
  if (pattern[0] === "**") return Array.from({ length: actual.length + 1 }, (_, index) => index)
    .some((index) => covers(pattern.slice(1), actual.slice(index), subtree));
  return actual.length > 0 && (pattern[0] === "*" || pattern[0] === actual[0]) &&
    covers(pattern.slice(1), actual.slice(1), subtree);
}

describe("iterated assignment origins", () => {
  it("keeps uninvoked assigned functions lazy", async () => {
    const source = '($x:=seed;rows.{"a":$x:=function(){$x.next}};$count(rows))';
    let reads = 0;
    const seed = { get next() { reads++; return {}; } };
    expect(await jsonata(source).evaluate({ seed, rows: [{}] })).toBe(1);
    expect(reads).toBe(0);
    expect(analyzeExpression(source).accesses.some(({ path }) => path.startsWith("seed.**"))).toBe(false);
  });

  for (const source of [
    '($x:=seed;rows.{"a":$x:=$x.next};$x.amount)',
    '($x:=seed;rows.[$x:=$x.next];$x.amount)',
    '($x:=seed;rows[$exists($x:=$x.next)];$x.amount)',
    '($x:=seed;$next:=function($v){$v.next};rows.{"a":$x:=$next($x)};$x.amount)',
    '($x:=seed;$next:=function(){$x.next};rows.{"a":$x:=$next()};$x.amount)',
    '($x:={"copy":seed};rows.{"a":$x:={"copy":$x.copy.next}};$x.copy.amount)',
    '($x:={(key):seed};rows.{"a":$x:={($$.key):$x.copy.next}};$x.copy.amount)',
  ]) {
    it.each([0, 1, 2, 8])(`covers every visited source for ${source} with %i rows`, async (count) => {
      let reads = 0;
      let seed: Record<string, unknown> = { get amount() { reads++; return 10; } };
      for (let index = 0; index < count; index++) seed = { next: seed };
      expect(await jsonata(source).evaluate({ seed, rows: Array.from({ length: count }, () => ({})), key: "copy" })).toBe(10);
      expect(reads).toBeGreaterThan(0);
      const actual = ["seed", ...Array.from({ length: count }, () => "next"), "amount"];
      expect(analyzeExpression(source).accesses.some(({ path, coverage }) =>
        covers(path.split("."), actual, coverage === "subtree"))).toBe(true);
    });
  }
});
