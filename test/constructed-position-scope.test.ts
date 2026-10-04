import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 } },
  other: { details: { amount: 20 } },
};
const shape = '{"wrap":{"left":{"copy":record},"other":{"different":other}}}';
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));
const producers = [
  '$v.wrap', '($v.wrap)', '$lookup($v,"wrap")',
  '($l:=$lookup;$l($v,"wrap"))', '$map([$v],function($x){$x.wrap})',
];

describe("constructed positions without focus bindings", () => {
  it.each(producers)("preserves an outer index variable after a leading explicit array of %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};[${producer}]#$i.$i)`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.record);
    expect(accesses(expression)).toEqual([
      exact("other"), { ...exact("record"), coverage: "subtree" },
    ]);
  });

  it.each(producers)("skips tuple stages on a leading explicit array of %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};[${producer}][other.different.details]#$i[$i].$i)`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.record);
    expect(accesses(expression)).toEqual([
      exact("other"), { ...exact("record"), coverage: "subtree" },
    ]);
  });

  it.each(producers)("preserves an outer focus variable after a leading explicit array of %s", async (producer) => {
    const expression = `($child:=other;$v:=${shape};[${producer}]@$child#$i.$child)`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.other);
    expect(accesses(expression)).toEqual([
      { ...exact("other"), coverage: "subtree" }, exact("record"),
    ]);
  });

  it.each(producers)("keeps parent context when a leading explicit array of %s has focus metadata", async (producer) => {
    const expression = `($v:=${shape};[${producer}]@$child[$child.other.different.details]#$i.other.details)`;
    expect(await jsonata(expression).evaluate(input)).toEqual(input.other.details);
    expect(accesses(expression)).toEqual([
      exact("other"), { ...exact("other.details"), coverage: "subtree" }, exact("record"),
    ]);
  });

  it.each(producers)("preserves an outer variable in a group after a leading explicit array of %s", async (producer) => {
    const expression = `($i:=record;$v:=${shape};[${producer}]#$i.$i{"group":$i})`;
    expect(await jsonata(expression).evaluate(input)).toEqual({ group: input.record });
    expect(accesses(expression)).toEqual([
      exact("other"), { ...exact("record"), coverage: "subtree" },
    ]);
  });

  for (const [predicate, predicateBase] of [
    ["other.different.details", "other"], ["$i.details", "record"],
  ]) {
    it.each([
      '($v.wrap)', '$lookup($v,"wrap")', '($l:=$lookup;$l($v,"wrap"))',
      '$map([$v],function($x){$x.wrap})', '{"left":{"copy":record},"other":{"different":other}}',
    ])(`clears outer object metadata after first producer predicate ${predicate} in %s`, async (producer) => {
      const expression = `($i:=record;$v:=${shape};${producer}[${predicate}]#$i[$i].$i)`;
      expect(await jsonata(expression).evaluate(input)).toBe(0);
      expect(accesses(expression)).toEqual([
        exact("other"), ...(predicateBase === "other" ? [exact("other.details"), exact("other.details.*")] : []),
        exact("record"), ...(predicateBase === "record" ? [exact("record.details"), exact("record.details.*")] : []),
      ]);
    });
  }

  for (const [suffix, predicateBase] of [
    ['.*[copy.details]#$i.$i', "record"],
    ['.other[different.details]#$i.$i', "other"],
    ['[other.different.details]#$i.$i', "other"],
    ['.*[$i.details]#$i[$i=0].$i', "record"],
    ['.*#$i[copy.details].$i', "record"],
    ['.other#$i[different.details].$i', "other"],
    ['#$i[other.different.details].$i', "other"],
    ['.*#$i[$i].$i', "none"],
  ]) {
    it.each(producers)(`reads predicates and returns a scalar index through ${suffix} from %s`, async (producer) => {
      const expression = `($i:=record;$v:=${shape};(${producer})${suffix})`;
      const result = await jsonata(expression).evaluate(input);
      if (predicateBase === "none") expect(Array.from(result)).toEqual([0, 1]);
      else expect(result).toBe(0);
      expect(accesses(expression)).toEqual([
        exact("other"), ...(predicateBase === "other" ? [exact("other.details"), exact("other.details.*")] : []),
        exact("record"), ...(predicateBase === "record" ? [exact("record.details"), exact("record.details.*")] : []),
      ]);
    });
  }
});
