import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("deep consumption dependencies", () => {
  it.each([
    '$string(record)',
    '$length($string(record))',
    '$string({"value": record})',
    '($v := record; $string($v))',
    '$string($lookup(dict, selected))',
    '$string($map(items, function($v) { $v.details }))',
    'items.$string(details)',
    '$string($eval("details", record))',
    '$count($clone(record))',
  ])("records descendants consumed by %s", async (expression) => {
    let descendantReads = 0;
    const valueWithGetter = () => ({ get amount() { descendantReads++; return 10; } });
    const input = { record: { details: valueWithGetter() }, dict: { a: valueWithGetter() }, selected: "a", items: [{ details: valueWithGetter() }] };
    const value = await jsonata(expression).evaluate(input);
    expect(value).toBeDefined();
    expect(descendantReads).toBeGreaterThan(0);
    const accesses = analyzeExpression(expression).accesses;
    const source = expression.includes("lookup") ? "dict[*]"
      : expression.includes("items") ? "items.details"
      : expression.includes("eval") ? "record.details" : "record";
    expect(accesses).toContainEqual({
      path: `${source}.**`, confidence: source.includes("[*]") ? "dynamic" : "static", coverage: "exact",
    });
  });

  it("ignores deep built-in semantics for opaque replacements", () => {
    expect(analyzeExpression('$string(record)', { opaqueFunctions: ["string"] }).accesses).toEqual([
      { path: "record", confidence: "static", coverage: "exact" },
    ]);
  });

  it("keeps serialization reads out of a returned value's source paths", async () => {
    const expression = '($clone ~> function($fn){$fn})(record).details.amount';
    expect(await jsonata(expression).evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "record.**", confidence: "static", coverage: "exact" });
    expect(accesses).toContainEqual({ path: "record.details.amount", confidence: "static", coverage: "subtree" });
    expect(accesses.some(({ path }) => path.includes("**."))).toBe(false);
  });

  it("uses a locally shadowed string function's actual reads", async () => {
    const expression = '($string := function($v) { $v.details.amount }; $string(record))';
    expect(await jsonata(expression).evaluate({ record: { details: { amount: 10 } } })).toBe(10);
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "record", confidence: "static", coverage: "exact" },
      { path: "record.details.amount", confidence: "static", coverage: "subtree" },
    ]);
  });
});
