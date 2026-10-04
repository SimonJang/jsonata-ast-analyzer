import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 } },
  other: { details: { amount: 20 } },
};
const shape = '{"wrap":{"left":{"copy":record},"other":{"different":other}}}';
const producers = [
  '$v.wrap', '($v.wrap)', '$lookup($v,"wrap")',
  '($l:=$lookup;$l($v,"wrap"))', '$map([$v],function($x){$x.wrap})',
];
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const subtree = (path: string) => ({ path, confidence: "static", coverage: "subtree" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));

describe("bindings that shadow a constructed producer", () => {
  for (const binding of ['.other@$v', '.other@$child#$v']) {
    it.each(producers)(`preserves parent selections after ${binding} from %s`, async (producer) => {
      const source = `($v:=${shape};(${producer})${binding}.left.copy)`;
      expect(await jsonata(source).evaluate(input)).toEqual(input.record);
      expect(accesses(source)).toEqual([exact("other"), subtree("record")]);
    });

    it.each(producers)(`preserves terminal parent results after ${binding} from %s`, async (producer) => {
      const source = `($v:=${shape};(${producer})${binding})`;
      expect(await jsonata(source).evaluate(input)).toEqual({ left: { copy: input.record }, other: { different: input.other } });
      expect(accesses(source)).toEqual([subtree("other"), subtree("record")]);
    });

    it.each(producers)(`preserves grouped parent selections after ${binding} from %s`, async (producer) => {
      const source = `($v:=${shape};(${producer})${binding}{"group":left.copy})`;
      expect(await jsonata(source).evaluate(input)).toEqual({ group: input.record });
      expect(accesses(source)).toEqual([exact("other"), subtree("record")]);
    });
  }

  it.each(producers)("preserves a parent before a filter stage shadows the producer from %s", async (producer) => {
    const source = `($v:=${shape};(${producer}).other@$child[$child.different.details]#$v.left.copy)`;
    expect(await jsonata(source).evaluate(input)).toEqual(input.record);
    expect(accesses(source)).toEqual([
      exact("other"), exact("other.details"), exact("other.details.*"), subtree("record"),
    ]);
  });

  it.each(producers)("preserves sorted parent selections when their focus shadows the producer from %s", async (producer) => {
    const source = `($v:=${shape};(${producer}).other@$v^(<$v.different.details.amount).left.copy)`;
    expect(await jsonata(source).evaluate(input)).toEqual(input.record);
    expect(accesses(source)).toEqual([exact("other"), exact("other.details.amount"), subtree("record")]);
  });
});
