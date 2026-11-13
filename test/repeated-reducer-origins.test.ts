import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

function covers(pattern: string[], actual: string[], subtree: boolean): boolean {
  if (pattern.length === 0) return subtree || actual.length === 0;
  if (pattern[0] === "**") return covers(pattern.slice(1), actual, subtree) ||
    actual.length > 0 && covers(pattern, actual.slice(1), subtree);
  return actual.length > 0 && (pattern[0] === "*" || pattern[0] === actual[0]) &&
    covers(pattern.slice(1), actual.slice(1), subtree);
}

describe("repeated reducer value origins", () => {
  it.each([1, 2, 8])("follows an implicit accumulator through %i items", async (count) => {
    const source = '$reduce(rows,function($a,$r){$a.next}).amount';
    let reads = 0;
    let first: Record<string, unknown> = { get amount() { reads++; return 10; } };
    for (let index = 1; index < count; index++) first = { next: first };
    expect(await jsonata(source).evaluate({ rows: [first, ...Array(count - 1).fill({})] })).toBe(10);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("rows.**");
  });

  for (const source of [
    '$reduce(rows,function($a,$r){$a.next},seed).amount',
    '$reduce(rows,function($a,$r){{"copy":$a.copy.next}},{"copy":seed}).copy.amount',
    '($next:=function($v){$v.next};$reduce(rows,function($a,$r){$next($a)},seed).amount)',
    '($step:=function($p,$a,$r){$a.next};$f:=$step(0,?,?);$reduce(rows,$f,seed).amount)',
    '$reduce(rows,function($a,$r){$a.next ? $a.next : {"copy":fallback}},seed).amount',
  ]) {
    it.each([0, 1, 2, 8])(`covers every iteration of ${source} with %i rows`, async (count) => {
      let reads = 0;
      let seed: Record<string, unknown> = { get amount() { reads++; return 10; } };
      for (let index = 0; index < count; index++) seed = { next: seed };
      expect(await jsonata(source).evaluate({ seed, rows: Array(count).fill({}) })).toBe(10);
      expect(reads).toBeGreaterThan(0);
      const actual = ["seed", ...Array(count).fill("next"), "amount"];
      expect(analyzeExpression(source).accesses.some(({ path, coverage }) =>
        covers(path.replaceAll("[*]", ".*").split("."), actual, coverage === "subtree"))).toBe(true);
    });
  }

  it.each([2, 3])("covers %i nested accumulator wrappers", async (count) => {
    const source = `$reduce(rows,function($a,$r){{"copy":$a}},seed).${Array(count).fill("copy").join(".")}.amount`;
    let reads = 0;
    expect(await jsonata(source).evaluate({ seed: { get amount() { reads++; return 10; } }, rows: Array(count).fill({}) })).toBe(10);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.some(({ path, coverage }) =>
      covers(path.split("."), ["seed", "amount"], coverage === "subtree"))).toBe(true);
  });

  it("covers repeated lookup used as a reducer callback", async () => {
    const source = '$reduce(keys,$lookup,seed).amount';
    let reads = 0;
    expect(await jsonata(source).evaluate({ keys: ["next", "next"], seed: { next: { next: { get amount() { reads++; return 10; } } } } })).toBe(10);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.map(({ path }) => path)).toContain("seed.**");
  });

  it("follows a captured replacement accumulator through later iterations", async () => {
    const source = '$reduce(rows,function($a,$r){$r.reset ? other : $a.next},seed).amount';
    let reads = 0;
    const input = { seed: {}, other: { next: { next: { get amount() { reads++; return 10; } } } }, rows: [{ reset: true }, {}, {}] };
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses.some(({ path, coverage }) =>
      covers(path.split("."), ["other", "next", "next", "amount"], coverage === "subtree"))).toBe(true);
  });

  it("keeps identity and numeric reducers precise", () => {
    for (const source of [
      '$reduce(rows,function($a,$r){$a},seed).amount',
      '$reduce(rows,function($a,$r){$a+$r.amount},initial)',
      '$reduce(rows,function($a,$r){{"copy":$append($a.copy,$r.details)}},{"copy":seed}).copy.amount',
    ]) expect(analyzeExpression(source).accesses.some(({ path }) => path.includes("**"))).toBe(false);
  });
});
