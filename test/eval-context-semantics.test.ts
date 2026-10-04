import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression, extractPaths } from "../src/index.js";

const data = {
  dict: { a: { details: { amount: 10 }, key: "out", items: [
    { name: "One", active: true }, { name: "Two", active: false },
  ] } },
  label: "ROOT",
};

describe("static eval context semantics", () => {
  it.each([
    "v.details.amount",
    "$.v.details.amount",
    '$lookup($, "v").details.amount',
  ])("resolves constructed context fields in %s", async (program) => {
    const expression = `($a := {"v": dict.a}; $eval(${JSON.stringify(program)}, $a))`;
    expect(await jsonata(expression).evaluate(data)).toBe(10);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "dict.a.details.amount", confidence: "static", coverage: "subtree" });
    expect(accesses.some(({ path }) => path.includes(".v"))).toBe(false);
    expect(extractPaths(expression)).toEqual(accesses.map(({ coverage, ...path }) => path));
  });

  it.each(["v.items[active].name", "v.items[$.active].name"])
    ("keeps predicates relative to selected items in %s", async (program) => {
      const expression = `$eval(${JSON.stringify(program)}, {"v": dict.a})`;
      expect(await jsonata(expression).evaluate(data)).toBe("One");
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "dict.a.items.active", confidence: "static", coverage: "exact",
      });
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "dict.a.items.name", confidence: "static", coverage: "subtree",
      });
    });

  it("preserves the root input alongside the constructed eval context", async () => {
    const expression = '$eval("[v.details, $$.label]", {"v": dict.a})';
    expect(await jsonata(expression).evaluate(data)).toEqual([{ amount: 10 }, "ROOT"]);
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "dict.a", confidence: "static", coverage: "exact" },
      { path: "dict.a.details", confidence: "static", coverage: "subtree" },
      { path: "label", confidence: "static", coverage: "subtree" },
    ]);
  });

  it("captures constructed contexts in returned lambdas", async () => {
    const expression = '$eval("function(){v.details.amount}", {"v": dict.a})()';
    expect(await jsonata(expression).evaluate(data)).toBe(10);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "dict.a.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each(['{"out": details}', '{key: details}'])
    ("selects object values returned by %s", async (program) => {
      const expression = `$eval(${JSON.stringify(program)}, dict.a)`;
      expect(await jsonata(expression).evaluate(data)).toEqual({ out: { amount: 10 } });
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "dict.a.details", confidence: "static", coverage: "subtree",
      });
      if (program.includes("key")) {
        expect(analyzeExpression(expression).accesses).toContainEqual({
          path: "dict.a.key", confidence: "static", coverage: "exact",
        });
      }
    });

  it("keeps lookup argument reads out of the selected eval result", async () => {
    const expression = '$eval("$lookup($, \\"details\\")", dict.a).amount';
    expect(await jsonata(expression).evaluate(data)).toBe(10);
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "dict.a.details", confidence: "static", coverage: "exact" },
      { path: "dict.a.details.amount", confidence: "static", coverage: "subtree" },
      { path: "dict.a", confidence: "static", coverage: "exact" },
    ]);
  });

  it("keeps computed keys and scalar calls at exact coverage", async () => {
    const expression = '$eval("{key: $count(details)}", dict.a)';
    expect(await jsonata(expression).evaluate(data)).toEqual({ out: 1 });
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "dict.a", confidence: "static", coverage: "exact" },
      { path: "dict.a.key", confidence: "static", coverage: "exact" },
      { path: "dict.a.details", confidence: "static", coverage: "exact" },
    ]);
  });
});
