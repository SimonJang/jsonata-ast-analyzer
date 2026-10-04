import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = { record: { details: { amount: 10 } }, other: { details: { amount: 20 } } };
const producers = ["$v.wrap", '$lookup($v,"wrap")', '$map([$v],function($x){$x.wrap})'];
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const subtree = (path: string) => ({ path, confidence: "static", coverage: "subtree" });

describe("callables selected from a constructed focus binding", () => {
  for (const [procedure, args] of [
    ['function($r){$r.details}', '$record'],
    ['$lookup', '$record,"details"'],
    ['$lookup(?,"details")', '$record'],
  ]) {
    const selections = [
      `($w.fn(${args}).amount)`,
      `($f:=$w.fn;$f(${args}).amount)`,
      `($f:=$lookup($w,"fn");$f(${args}).amount)`,
    ];
    for (const producer of producers) {
      it.each(selections)(`reads ${procedure} through ${producer} (%s)`, async (selection) => {
        const call = `(${producer})@$w.${selection}`;
        for (const consume of [false, true]) {
          const source = `($record:=record;$v:={"wrap":{"fn":${procedure},"data":{"copy":other}}};${consume ? `$count(${call})` : call})`;
          expect(await jsonata(source).evaluate(input)).toBe(consume ? 1 : 10);
          expect(analyzeExpression(source).accesses.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
            exact("other"), exact("record"), exact("record.details"),
            consume ? exact("record.details.amount") : subtree("record.details.amount"),
          ]);
        }
      });
    }
  }

  it("preserves a callable's captured value when the focus shadows its name", async () => {
    const source = '($v:=record;$g:={"wrap":{"fn":function(){$v.details},"data":{"copy":other}}};($g.wrap)@$v.($v.fn().amount))';
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      exact("other"), exact("record"), exact("record.details"), subtree("record.details.amount"),
    ]);
  });
});
