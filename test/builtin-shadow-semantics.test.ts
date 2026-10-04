import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const record = { child: { amount: 10 }, amount: 20 };

describe("local bindings that shadow built-in function names", () => {
  it.each(["map", "filter", "single", "reduce", "sift", "each", "lookup"])(
    "invokes a local $%s lambda with its actual arguments",
    async (name) => {
      const expression = `($${name} := function($v){$v.child.amount}; $${name}(record))`;
      expect(await jsonata(expression).evaluate({ record })).toBe(10);
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "record.child.amount", confidence: "static", coverage: "subtree",
      });
    },
  );

  it.each(["map", "lookup"])("invokes $%s bound to another builtin", async (name) => {
    const expression = `($${name} := $clone; $${name}(record).child.amount)`;
    expect(await jsonata(expression).evaluate({ record })).toBe(10);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("record.**");
    expect(paths).toContain("record.child.amount");
  });

  it("uses the aliased builtin's enumeration behavior", async () => {
    const expression = "($string := $keys; $count($string(record)))";
    expect(await jsonata(expression).evaluate({ record })).toBe(2);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("record.*");
    expect(paths).not.toContain("record.**");
  });

  it("uses the aliased builtin's dynamic property selection", async () => {
    const expression = "($keys := $lookup; $keys(record, selected).amount)";
    expect(await jsonata(expression).evaluate({ record, selected: "child" })).toBe(10);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record[*].amount", confidence: "dynamic", coverage: "subtree",
    });
  });

  it("invokes a local partial before builtin higher-order dispatch", async () => {
    const expression = "($map := $lookup(?, selected); $map(record).amount)";
    expect(await jsonata(expression).evaluate({ record, selected: "child" })).toBe(10);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record[*].amount", confidence: "dynamic", coverage: "subtree",
    });
  });

  it("uses the local lambda's context signature", async () => {
    const expression = "($lookup := function($v)<x-:x>{$v.child}; record.$lookup().amount)";
    expect(await jsonata(expression).evaluate({ record })).toBe(10);
    expect(analyzeExpression(expression).accesses.map(({ path }) => path)).toContain("record.child.amount");
  });

  it.each([
    "($f := $clone; $clone := function($v){$v.child}; $f(record).amount)",
    '($f := {"copy":$clone}; $clone := function($v){$v.child}; ($f.copy)(record).amount)',
    "($f := $clone(?); $clone := function($v){$v.child}; $f(record).amount)",
    "($f := $clone; $clone := function($v){$v.child}; $map([record], $f).amount)",
  ])("keeps a captured builtin when its name is subsequently rebound in %s", async (expression) => {
    expect(await jsonata(expression).evaluate({ record })).toBe(20);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("record.**");
    expect(paths).toContain("record.amount");
    expect(paths).not.toContain("record.child.amount");
  });

  it("keeps local callbacks when invoking a captured higher-order builtin", async () => {
    const expression = "($f := $map; $map := function($v){$v.child.amount}; $f([record], $map))";
    expect(await jsonata(expression).evaluate({ record })).toBe(10);
    expect(analyzeExpression(expression).accesses.map(({ path }) => path)).toContain("record.child.amount");
  });

  it("does not supply a builtin context default to an unsigned local lambda", async () => {
    const expression = "($lookup := function($v){$exists($v) ? $v.child.amount : fallback.amount}; record.$lookup())";
    expect(await jsonata(expression).evaluate({ record, fallback: { amount: 30 } })).toBe(30);
    const paths = analyzeExpression(expression).accesses.map(({ path }) => path);
    expect(paths).toContain("fallback.amount");
    expect(paths).not.toContain("record.child.amount");
    expect(paths).not.toContain("child.amount");
  });
});
