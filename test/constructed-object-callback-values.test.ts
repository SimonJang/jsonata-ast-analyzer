import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 } },
  other: { details: { amount: 20 } },
  selected: "left",
};
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const subtree = (path: string) => ({ path, confidence: "static", coverage: "subtree" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));
const producers = [
  '$v.wrap', '($v.wrap)', '$lookup($v,"wrap")',
  '($l:=$lookup;$l($v,"wrap"))', '$map([$v],function($x){$x.wrap})',
];

describe("constructed object values in callbacks", () => {
  it("keeps physical value origins beside constructed value aliases", async () => {
    const source = '$each({"left":{"copy":record},"right":other},function($x){$x.copy})';
    expect(await jsonata(source).evaluate(input)).toEqual(input.record);
    expect(accesses(source)).toEqual([exact("other"), subtree("other.copy"), subtree("record")]);
  });

  it("keeps the complete object separate from callback value aliases", async () => {
    const source = '$each({"left":{"copy":record},"other":{"different":other}},function($x,$k,$obj){$obj.left.copy})';
    expect(Array.from(await jsonata(source).evaluate(input))).toEqual([input.record, input.record]);
    expect(accesses(source)).toEqual([exact("other"), subtree("record")]);
  });

  for (const dynamic of [false, true]) {
    const object = `{${dynamic ? "(selected)" : '"left"'}:{"copy":record},"other":{"different":other}}`;
    const cases = [
      (name: string, callback: string) => `$${name}(${object},${callback})`,
      (name: string, callback: string) => `$${name}($v.wrap,${callback})`,
      ...producers.map((producer) => (name: string, callback: string) =>
        `(${producer}).$${name}($,${callback})`),
    ];
    const reads = dynamic ? [exact("selected")] : [];

    it.each(cases)(`preserves returned constructed values (dynamic=${dynamic}, case=%#)`, async (call) => {
      const source = `($v:={"wrap":${object}};${call("each", "function($x,$k){$x.copy}")})`;
      expect(await jsonata(source).evaluate(input)).toEqual(input.record);
      expect(accesses(source)).toEqual([exact("other"), subtree("record"), ...reads]);
    });

    it.each(cases)(`preserves stringified constructed values (dynamic=${dynamic}, case=%#)`, async (call) => {
      const source = `($v:={"wrap":${object}};$string(${call("each", "function($x,$k){$x.copy}")}))`;
      expect(await jsonata(source).evaluate(input)).toBe(JSON.stringify(input.record));
      expect(accesses(source)).toEqual([exact("other"), exact("record"), exact("record.**"), ...reads]);
    });

    it.each(cases)(`reads constructed value fields in predicates (dynamic=${dynamic}, case=%#)`, async (call) => {
      const source = `($v:={"wrap":${object}};$count(${call("sift", "function($x,$k){$x.copy.details}")}.*.copy))`;
      expect(await jsonata(source).evaluate(input)).toBe(1);
      expect(accesses(source)).toEqual([
        exact("other"), exact("record"), exact("record.details"), exact("record.details.*"), ...reads,
      ]);
    });
  }
});
