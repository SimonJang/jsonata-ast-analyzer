import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("deep consumption dependencies", () => {
  it.each(["=", "!="])('records both operands of deep equality %s', async (operator) => {
    const expression = `record ${operator} other`;
    const input = { record: { details: { amount: 10 } }, other: { details: { amount: 10 } } };
    expect(await jsonata(expression).evaluate(input)).toBe(operator === "=");
    input.other.details.amount = 20;
    expect(await jsonata(expression).evaluate(input)).toBe(operator === "!=");
    const accesses = analyzeExpression(expression).accesses;
    for (const source of ["record", "other"]) {
      expect(accesses).toContainEqual({ path: `${source}.**`, confidence: "static", coverage: "exact" });
    }
  });

  it.each([
    '$count($distinct([record, other]))',
    '($d := $distinct; $count($d([record, other])))',
    '($d := $distinct(?); $count($d([record, other])))',
  ])("records structurally compared descendants in %s", async (expression) => {
    const input = { record: { details: { amount: 10 } }, other: { details: { amount: 10 } } };
    expect(await jsonata(expression).evaluate(input)).toBe(1);
    input.other.details.amount = 20;
    expect(await jsonata(expression).evaluate(input)).toBe(2);
    const accesses = analyzeExpression(expression).accesses;
    for (const source of ["record", "other"]) {
      expect(accesses).toContainEqual({ path: `${source}.**`, confidence: "static", coverage: "exact" });
    }
  });

  it("records descendants serialized by concatenation", async () => {
    const expression = '"Value: " & record';
    expect(await jsonata(expression).evaluate({ record: { details: { amount: 10 } } })).toBe('Value: {"details":{"amount":10}}');
    expect(analyzeExpression(expression).accesses).toContainEqual({ path: "record.**", confidence: "static", coverage: "exact" });
  });

  it("rebases serialization reads to a transform's matched object", async () => {
    const expression = 'record ~> |details|{"seen": value & "!"}|';
    expect(await jsonata(expression).evaluate({ record: { details: { value: { amount: 10 } } } })).toEqual({
      details: { value: { amount: 10 }, seen: '{"amount":10}!' },
    });
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "record.details.value.**", confidence: "static", coverage: "exact" });
    expect(accesses.some(({ path }) => path === "value.**")).toBe(false);
  });

  it("rebases deep reads through constructed and direct alias branches", async () => {
    const expression = '($r := enabled ? {"v": record} : other; $r.v.(details & "!"))';
    const input = { record: { details: { amount: 10 } }, other: { v: { details: { amount: 20 } } } };
    for (const enabled of [true, false]) {
      expect(await jsonata(expression).evaluate({ ...input, enabled })).toBe(`{"amount":${enabled ? 10 : 20}}!`);
    }
    const accesses = analyzeExpression(expression).accesses;
    for (const path of ["record.details.**", "other.v.details.**"]) {
      expect(accesses).toContainEqual({ path, confidence: "static", coverage: "exact" });
    }
    expect(accesses.some(({ path }) => /[\u0000\u0001]/.test(path))).toBe(false);
  });

  it("keeps literal scalar comparisons and identity membership shallow", () => {
    for (const expression of ['record = "x"', 'record != 10', 'record in [other]']) {
      expect(analyzeExpression(expression).accesses.some(({ path }) => path.includes("**"))).toBe(false);
    }
  });

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
