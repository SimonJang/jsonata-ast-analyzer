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
    '{"out":{($$.enabled?"copy":"copy"):other}}',
    '{"fixed":details,"out":{($$.enabled?"copy":"copy"):other}}',
  ])("tracks all dynamic projection fields consumed by cloning: %s", async (projection) => {
    const source = `$count($clone(items.${projection}))`;
    let activeReads = 0;
    const data = { enabled: true, items: [{
      other: { amount: 10, get active() { activeReads++; return true; } },
      details: { amount: 20 },
    }] };
    expect(await jsonata(source).evaluate(data)).toBe(1);
    expect(activeReads).toBeGreaterThan(0);
    expect(accesses(source)).toContainEqual(exact("items.other.**"));
  });

  it.each([
    '$sum((items.{"out":$$.items{"copy":other}}).out.copy.amount)',
    '$sum($map((items.{"out":$$.items{"copy":other}}).out,function($v){$sum($v.copy.amount)}))',
  ])("preserves grouped results used as projected field values: %s", async (source) => {
    const data = { items: [{ other: { amount: 10 } }, { other: { amount: 20 } }] };
    expect(await jsonata(source).evaluate(data)).toBe(60);
    expect(accesses(source)).toContainEqual(exact("items.other.amount"));
  });

  it.each([
    '{"outer":items{"group":details}}.outer.group.amount',
    '($v:={"outer":items{"group":details}};$v.outer.group.amount)',
  ])("preserves grouped fields stored inside a constructor: %s", async (source) => {
    const data = { items: [{ details: { amount: 10 } }, { details: { amount: 20 } }] };
    expect(Array.from(await jsonata(source).evaluate(data))).toEqual([10, 20]);
    expect(accesses(source)).toContainEqual(subtree("items.details.amount"));
  });

  it("preserves dynamic group keys inside a constructor", async () => {
    const source = '{"outer":items{name:details}}.outer.one.amount';
    const data = { items: [
      { name: "one", details: { amount: 10 } },
      { name: "two", details: { amount: 20 } },
    ] };
    expect(await jsonata(source).evaluate(data)).toBe(10);
    expect(accesses(source)).toContainEqual(subtree("items.details.amount"));
    expect(accesses(source)).toContainEqual(exact("items.name"));
  });

  it("keeps predicates on nested constructed values relative to their input sources", async () => {
    const source = '($map(items,function($r){{"out":[$$.enabled?{"copy":$r.other}:{"copy":$r.details}]}}).{"wrapper":$}.wrapper).out.copy[active].amount';
    const data = { enabled: true, items: [
      { other: { amount: 10, active: true }, details: { amount: 20, active: false } },
    ] };
    expect(await jsonata(source).evaluate(data)).toBe(10);
    for (const path of ["items.other.active", "items.details.active"]) {
      expect(accesses(source)).toContainEqual(exact(path));
    }
  });

  it.each([
    '$append([{"copy":other}],[])',
    '$merge([{"copy":other}])',
    '$lookup({"box":{"copy":other}},"box")',
    '(function($x){{"copy":$x}})(other)',
  ])("preserves constructed fields returned by a projected function: %s", async (producer) => {
    const source = `(items.{"out":${producer}}).out.copy.amount`;
    const data = { items: [{ other: { amount: 10 } }, { other: { amount: 20 } }] };
    expect(Array.from(await jsonata(source).evaluate(data))).toEqual([10, 20]);
    expect(accesses(source)).toContainEqual(subtree("items.other.amount"));
  });

  it.each([
    '(items.{"out":($v:=other;{"copy":$v})}).out.copy.amount',
    '($rows:=items.{"out":($v:=other;{"copy":$v})};$rows.out.copy.amount)',
  ])("preserves nested fields returned by a projection block: %s", async (source) => {
    const data = { items: [{ other: { amount: 10 } }, { other: { amount: 20 } }] };
    expect(Array.from(await jsonata(source).evaluate(data))).toEqual([10, 20]);
    expect(accesses(source)).toContainEqual(subtree("items.other.amount"));
  });

  it("preserves captured variables and raw alternatives in a projection block", async () => {
    const source = '($r:=record;$v:=items.{"out":($x:=other;[$x,{"copy":$x,"captured":$r}])};[$v.out.amount,$v.out.copy.amount,$v.out.captured.details.amount])';
    const data = { ...input, items: [{ other: { amount: 30 } }] };
    expect(await jsonata(source).evaluate(data)).toEqual([30, 30, 10]);
    for (const path of ["items.other.amount", "record.details.amount"]) {
      expect(accesses(source)).toContainEqual(subtree(path));
    }
  });

  it.each([
    '$string((items.{($$.enabled?"out":"alt"):{"copy":other}}).out)',
    '$string(([items.{($$.enabled?"out":"alt"):{"copy":other}}]^(1)).out)',
  ])("retains dynamically named constructor fields: %s", async (source) => {
    const data = { enabled: true, items: [{ other: { amount: 10 } }] };
    expect(await jsonata(source).evaluate(data)).toBe('{"copy":{"amount":10}}');
    expect(accesses(source)).toContainEqual(exact("items.other.**"));
  });

  it("preserves input and captured origins under a nested dynamic field", async () => {
    const source = '($r:=record;$v:=items.{"wrap":{($$.enabled?"out":"alt"):{"local":other,"captured":$r}}};[$v.wrap.out.local.amount,$v.wrap.out.captured.details.amount])';
    const data = { ...input, enabled: true, items: [{ other: { amount: 30 } }] };
    expect(await jsonata(source).evaluate(data)).toEqual([30, 10]);
    expect(accesses(source)).toContainEqual(subtree("items.other.amount"));
    expect(accesses(source)).toContainEqual(subtree("record.details.amount"));
  });

  it.each(["$string", "$distinct"])("preserves nested data after sorting constructed values with %s", async (consumer) => {
    const source = `${consumer}(([items.{"out":{"copy":other}}]^($.out.copy.amount)).out)`;
    const data = { items: [
      { other: { amount: 20, active: true } },
      { other: { amount: 10, active: false } },
    ] };
    const expected = [{ copy: { amount: 10, active: false } }, { copy: { amount: 20, active: true } }];
    const actual = await jsonata(source).evaluate(data);
    expect(consumer === "$string" ? JSON.parse(actual) : JSON.parse(JSON.stringify(actual))).toEqual(expected);
    expect(accesses(source)).toContainEqual(exact("items.other.**"));
  });

  it("reads a selected nested object's predicate after sorting its output wrapper", async () => {
    const source = '([items.{"out":{"copy":other}}]^($.out.copy.amount)).out.copy[active].amount';
    const data = { items: [{ other: { amount: 10, active: true } }] };
    expect(await jsonata(source).evaluate(data)).toBe(10);
    expect(accesses(source)).toContainEqual(exact("items.other.active"));
    expect(accesses(source)).toContainEqual(subtree("items.other.amount"));
  });


  it.each([
    '(items.{"out":[{"copy":other}]}).out.copy.amount',
    '($v:=items.{"out":[[{"copy":other}]]};$v.out.copy.amount)',
    '(items.{"out":($$.enabled?{"copy":other}:{"copy":details})}).out.copy.amount',
  ])("preserves constructor branches inside projected fields: %s", async (source) => {
    const data = { enabled: true, items: [
      { other: { amount: 10 }, details: { amount: 30 } },
      { other: { amount: 20 }, details: { amount: 40 } },
    ] };
    expect(Array.from(await jsonata(source).evaluate(data))).toEqual([10, 20]);
    expect(accesses(source)).toContainEqual(subtree("items.other.amount"));
  });

  it.each([
    '{"out":[{"copy":other},{"copy":details}]}',
    '{"out":($$.enabled?{"copy":other}:{"copy":details})}',
  ])("retains all possible nested constructor origins in %s", async (projection) => {
    const source = `(items.${projection}).out.copy.amount`;
    const data = { enabled: false, items: [{ other: { amount: 10 }, details: { amount: 20 } }] };
    const actual = await jsonata(source).evaluate(data);
    expect(projection.includes("[") ? Array.from(actual) : actual)
      .toEqual(projection.includes("[") ? [10, 20] : 20);
    for (const path of ["items.other.amount", "items.details.amount"]) {
      expect(accesses(source)).toContainEqual(subtree(path));
    }
  });

  it.each([
    '(items.{"out":{"copy":other}}).{"wrapper":$}.wrapper.out.copy.amount',
    '((items.{"out":{"copy":other}})).{"wrapper":$}.wrapper.out.copy.amount',
    '($v:=items.{"out":{"copy":other}};$v.{"wrapper":$}.wrapper.out.copy.amount)',
  ])("retains nested item origins through a current-value wrapper: %s", async (source) => {
    const data = { items: [{ other: { amount: 10 } }, { other: { amount: 20 } }] };
    expect(Array.from(await jsonata(source).evaluate(data))).toEqual([10, 20]);
    expect(accesses(source)).toContainEqual(subtree("items.other.amount"));
  });

  it("retains serialization dependencies after wrapping a parenthesized projection", async () => {
    const source = '$string((items.{"out":{"copy":other}}).{"wrapper":$}.wrapper)';
    const data = { items: [{ other: { amount: 10 } }] };
    expect(await jsonata(source).evaluate(data)).toBe('{"out":{"copy":{"amount":10}}}');
    expect(accesses(source)).toContainEqual(exact("items.other.**"));
  });

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
