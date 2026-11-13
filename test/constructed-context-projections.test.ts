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
  it.each([
    'items.{"out":{"copy":other}}.out.copy.amount',
    '($v:=items.{"out":{"copy":other}};$v.out.copy.amount)',
  ])("preserves nested output fields in an item projection: %s", async (source) => {
    const data = { items: [{ other: { amount: 10 } }, { other: { amount: 20 } }] };
    expect(Array.from(await jsonata(source).evaluate(data))).toEqual([10, 20]);
    expect(accesses(source)).toContainEqual(subtree("items.other.amount"));
    expect(accesses(source).some(({ path }) => path.includes("other.copy"))).toBe(false);
  });

  it("keeps root and captured variables outside the item context in nested projections", async () => {
    const source = '($r:=record;$v:=items.{"out":{"local":other,"captured":$r,"root":$$.record}};[$v.out.local.amount,$v.out.captured.details.amount,$v.out.root.details.amount])';
    const data = { ...input, items: [{ other: { amount: 30 } }] };
    expect(await jsonata(source).evaluate(data)).toEqual([30, 10, 10]);
    expect(accesses(source)).toContainEqual(subtree("items.other.amount"));
    expect(accesses(source)).toContainEqual(subtree("record.details.amount"));
  });

  it.each([
    '(items@$row.{"out":{"copy":$row.other}}).out.copy.amount',
    '($v:=items@$row.{"out":{"copy":$row.other}};$v.out.copy.amount)',
  ])("retains focus-bound sources in nested projections: %s", async (source) => {
    const data = { items: [{ other: { amount: 10 } }, { other: { amount: 20 } }] };
    expect(Array.from(await jsonata(source).evaluate(data))).toEqual([10, 20]);
    expect(accesses(source)).toContainEqual(subtree("items.other.amount"));
  });

  it("keeps a focus projection's current value at the focused item's parent", async () => {
    const source = '($v:=orders.items@$row.{"out":{"item":$row.other,"parent":other}};[$v.out.item.amount,$v.out.parent.amount])';
    const data = { orders: { items: [{ other: { amount: 10 } }], other: { amount: 20 } } };
    expect(await jsonata(source).evaluate(data)).toEqual([10, 20]);
    expect(accesses(source)).toContainEqual(subtree("orders.items.other.amount"));
    expect(accesses(source)).toContainEqual(subtree("orders.other.amount"));
  });

  it.each([
    '{"copy":record}.{"wrapper":$}.wrapper.copy.details.amount',
    '({"copy":record}).{"wrapper":$}.wrapper.copy.details.amount',
    '{"copy":record}.{"wrapper":$}.wrapper.{"next":$}.next.copy.details.amount',
  ])("traces a literal object's current value through an object wrapper: %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(accesses(source)).toContainEqual(subtree("record.details.amount"));
  });

  it("traces the original root through a wrapper after a literal object", async () => {
    const source = '{"copy":other}.{"wrapper":$$}.wrapper.record.details.amount';
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(accesses(source)).toContainEqual(subtree("record.details.amount"));
  });

  it("retains every constructed item when wrapping an array's current values", async () => {
    const source = '[{"copy":record},{"copy":other}].{"wrapper":$}.wrapper.copy.details.amount';
    expect(Array.from(await jsonata(source).evaluate(input))).toEqual([10, 20]);
    for (const path of ["record.details.amount", "other.details.amount"]) {
      expect(accesses(source)).toContainEqual(subtree(path));
    }
  });

  it("retains serialization dependencies through a current-value wrapper", async () => {
    const source = '$string({"copy":record}.{"wrapper":$}.wrapper)';
    expect(await jsonata(source).evaluate(input)).toBe(JSON.stringify({ copy: input.record }));
    expect(accesses(source)).toContainEqual(exact("record.**"));
  });

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
