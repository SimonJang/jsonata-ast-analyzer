import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 } },
  other: { details: { amount: 20 } },
};
const producers = ["$v.wrap", '$lookup($v,"wrap")', '$map([$v],function($x){$x.wrap})'];
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const subtree = (path: string) => ({ path, confidence: "static", coverage: "subtree" });

describe("callables selected from the current constructed context", () => {
  for (const [procedure, args] of [
    ['function($r){$r.details}', '$record'],
    ['$lookup', '$record,"details"'],
    ['$lookup(?,"details")', '$record'],
  ]) {
    const selections = [
      `($.fn(${args}).amount)`,
      `($f:=$.fn;$f(${args}).amount)`,
      `($f:=$lookup($,"fn");$f(${args}).amount)`,
      `($f:=fn;$f(${args}).amount)`,
    ];
    for (const producer of producers) {
      it.each(selections)(`reads the result of ${procedure} through ${producer} (%s)`, async (selection) => {
        const source = `($record:=record;$v:={"wrap":{"fn":${procedure},"data":{"copy":other}}};(${producer}).${selection})`;
        expect(await jsonata(source).evaluate(input)).toBe(10);
        expect(analyzeExpression(source).accesses.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
          exact("other"), exact("record"), exact("record.details"), subtree("record.details.amount"),
        ]);
      });
    }
  }

  it.each(["($v.wrap)", "[$v.wrap]"])("traces calls from %s under a scalar consumer", async (producer) => {
    for (const selection of ["($f:=$.fn;$f($record).amount)", "($.fn($record).amount)"]) {
      const call = `(${producer}).${selection}`;
      for (const consumer of [`$count(${call})`, `$boolean(${call})`]) {
        const source = `($record:=record;$v:={"wrap":{"fn":function($r){$r.details},"data":{"copy":other}}};${consumer})`;
        expect(await jsonata(source).evaluate(input)).toBe(consumer.startsWith("$count") ? 1 : true);
        const paths = analyzeExpression(source).accesses.map((access) => access.path);
        expect(paths).toContain("record.details.amount");
        expect(paths).not.toContain("fn");
      }
    }
  });
});
