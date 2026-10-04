import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("constructed alias contexts", () => {
  it.each([
    '($a := items; $a.(details).amount)',
    '($a := items; $r := $a.(details); $r.amount)',
    '($a := items; $r := $a.($.details); $r.amount)',
    '($o := {"v": items}; $o.v.(details).amount)',
    '($o := {"v": items}; $r := $o.v.(details); $r.amount)',
    '($o := {"v": items}; $r := $o.v.{"x": details}; $r.x.amount)',
    '($a := items; $a.(details)).amount',
    '($o := {"v": items}; $o.v.(details)).amount',
    '(($o := {"v": items}; $o.v.(details))).amount',
    '($o := {"v": {"x": items}}; $o.v.x.(details)).amount',
    '($o := {$$.selected: items}; $lookup($o, $$.selected).details).amount',
  ])("preserves selected sources through the variable projection %s", async (expression) => {
    const value = await jsonata(expression).evaluate({ selected: "v", items: [
      { details: { amount: 10 } }, { details: { amount: 20 } },
    ] });
    expect(JSON.parse(JSON.stringify(value))).toEqual([10, 20]);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "items.details.amount", confidence: "static", coverage: "subtree" });
    expect(accesses.some(({ path }) => ["items.amount", "details.amount", "items.x.amount"].includes(path))).toBe(false);
  });

  it.each(['($a := items; $a.(details))', '($o := {"v": items}; $o.v.{"x": details})'])
    ("selects projected values without forwarding their source in %s", (expression) => {
      const accesses = analyzeExpression(expression).accesses;
      expect(accesses).toContainEqual({ path: "items", confidence: "static", coverage: "exact" });
      expect(accesses).toContainEqual({ path: "items.details", confidence: "static", coverage: "subtree" });
    });

  it("keeps scalar consumption of a projected result at exact coverage", () => {
    expect(analyzeExpression('($a := items; $count($a.(details)))').accesses).toEqual([
      { path: "items", confidence: "static", coverage: "exact" },
      { path: "items.details", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each(['$.active', '$lookup($, "active")'])
    ("evaluates %s against the selected alias field", async (predicate) => {
      const expression = `($o := {"v": dict.a}; $o.v.items[${predicate}].name)`;
      expect(await jsonata(expression).evaluate({ dict: { a: { items: [
        { active: true, name: "One" }, { active: false, name: "Two" },
      ] } } })).toBe("One");
      const accesses = analyzeExpression(expression).accesses;
      expect(accesses).toContainEqual({ path: "dict.a.items.active", confidence: "static", coverage: "exact" });
      expect(accesses.some(({ path }) => path === "active")).toBe(false);
    });

  it("preserves dynamic property reads and root selectors in an alias predicate", async () => {
    const expression = '($o := {"v": dict.a}; $o.v.items[$lookup($, $$.flag)].name)';
    expect(await jsonata(expression).evaluate({
      flag: "active", dict: { a: { items: [
        { active: true, name: "One" }, { active: false, name: "Two" },
      ] } },
    })).toBe("One");
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "dict.a.items[*]", confidence: "dynamic", coverage: "exact" });
    expect(accesses).toContainEqual({ path: "flag", confidence: "static", coverage: "exact" });
  });

  it("combines current item reads with a captured input variable", async () => {
    const expression = '($allowed := config.allowed; $o := {"v": dict.a}; $o.v.items[$.active and name in $allowed].name)';
    expect(await jsonata(expression).evaluate({
      config: { allowed: ["One"] }, dict: { a: { items: [
        { active: true, name: "One" }, { active: true, name: "Two" },
      ] } },
    })).toBe("One");
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "dict.a.items.active", confidence: "static", coverage: "exact" });
    expect(accesses).toContainEqual({ path: "config.allowed", confidence: "static", coverage: "exact" });
    expect(accesses.some(({ path }) => path === "active")).toBe(false);
  });
});
