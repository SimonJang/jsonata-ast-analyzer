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
