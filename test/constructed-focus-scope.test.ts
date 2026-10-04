import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  other: { details: { amount: 20 }, name: { label: "Two" } },
  key: "a",
};
const shape = '{"wrap":{(key):{"copy":record},"other":{"different":other}}}';
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const subtree = (path: string) => ({ path, confidence: "static", coverage: "subtree" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));
const producers = [
  '$v.wrap',
  '($v.wrap)',
  '$lookup($v,"wrap")',
  '($l:=$lookup;$l($v,"wrap"))',
  '$map([$v],function($x){$x.wrap})',
];

describe("constructed focus scopes", () => {
  it.each(producers)("keeps a predicate's focus binding before bare selections from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details].other.different.details.amount)`;
    expect(await jsonata(expression).evaluate(input)).toBe(20);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), subtree("other.details.amount"),
      exact("record"), exact("record.details"), exact("record.details.*"),
    ]);
  });

  it.each(producers)("keeps named focus predicates before parent selections from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).other@$child[$child.different.details].a.copy)`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.record);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), exact("other.details"), exact("other.details.*"),
      subtree("record"),
    ]);
  });

  it.each(producers)("preserves a later projection's selected focus value from %s", async (producer) => {
    const expression = `($v:=${shape};(${producer}).*@$child[$child.copy.details].other.($child.copy))`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.record);
    expect(accesses(expression)).toEqual([
      exact("key"), exact("other"), subtree("record"),
      exact("record.details"), exact("record.details.*"),
    ]);
  });

});
