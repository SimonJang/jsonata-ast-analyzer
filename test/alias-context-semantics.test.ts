import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("constructed alias contexts", () => {
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
