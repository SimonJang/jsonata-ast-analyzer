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

describe("data projections from constructed contexts", () => {
  for (const projection of [
    '([left.copy,other.different])', '[left.copy,other.different]',
    '($x:=left.copy;$x)', '($x:=[left.copy,other.different];$x)',
  ]) {
    const isArray = projection.includes("[");
    const result = isArray ? [input.record.details, input.other.details] : input.record.details;
    const fields = isArray ? ["other.details", "record.details"] : ["record.details"];

    it.each(producers)(`reads selected fields when counting ${projection} from %s`, async (producer) => {
      const source = `($v:=${shape};$count((${producer}).${projection}.details))`;
      expect(await jsonata(source).evaluate(input)).toBe(isArray ? 2 : 1);
      expect(accesses(source)).toEqual([
        exact("other"), exact("record"), ...fields.map(exact),
      ].sort((a, b) => a.path.localeCompare(b.path)));
    });

    it.each(producers)(`preserves returned field origins through ${projection} from %s`, async (producer) => {
      const source = `($v:=${shape};(${producer}).${projection}.details)`;
      const actual = await jsonata(source).evaluate(input);
      expect(isArray ? Array.from(actual) : actual).toEqual(result);
      expect(accesses(source)).toEqual([
        exact("other"), exact("record"), ...fields.map(subtree),
      ].sort((a, b) => a.path.localeCompare(b.path)));
    });

    it.each(producers)(`preserves stringified field origins through ${projection} from %s`, async (producer) => {
      const source = `($v:=${shape};$string((${producer}).${projection}.details))`;
      expect(await jsonata(source).evaluate(input)).toBe(JSON.stringify(result));
      expect(accesses(source)).toEqual([
        exact("other"), exact("record"), ...fields.flatMap((field) => [exact(field), exact(`${field}.**`)]),
      ].sort((a, b) => a.path.localeCompare(b.path)));
    });
  }
});
