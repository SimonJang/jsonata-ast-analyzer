import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 } },
  other: { details: { amount: 20 } },
};
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const subtree = (path: string) => ({ path, confidence: "static", coverage: "subtree" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));
const producers = [
  '$v.wrap', '($v.wrap)', '$lookup($v,"wrap")',
  '($l:=$lookup;$l($v,"wrap"))', '$map([$v],function($x){$x.wrap})',
];

describe("mixed function and data values in callbacks", () => {
  for (const [procedure, call] of [
    ['function($r){$r.details}', '$value($record)'],
    ['$lookup', '$value($record,"details")'],
    ['$lookup(?,"details")', '$value($record)'],
  ]) {
    const object = `{"fn":${procedure},"data":{"copy":other}}`;
    const cases = [
      (name: string, callback: string) => `$${name}(${object},${callback})`,
      (name: string, callback: string) => `$${name}($v.wrap,${callback})`,
      ...producers.map((producer) => (name: string, callback: string) =>
        `(${producer}).$${name}($,${callback})`),
    ];

    it.each(cases)(`retains data selections and calls through ${procedure} (case=%#)`, async (invoke) => {
      const callback = `function($value){$type($value)="function"?${call}.amount:$value.copy}`;
      const invocation = invoke("each", callback);
      const source = `($record:=record;$v:={"wrap":${object}};${invocation})`;
      expect(Array.from(await jsonata(source).evaluate(input))).toEqual([10, input.other]);
      expect(accesses(source)).toEqual([
        subtree("other"),
        ...(invocation.startsWith("(") ? [exact("other.*")] : []),
        exact("record"), exact("record.details"), subtree("record.details.amount"),
      ]);
    });

    it.each(cases)(`retains predicate reads through ${procedure} (case=%#)`, async (invoke) => {
      const callback = `function($value){$type($value)="function"?${call}:$value.copy}`;
      const source = `($record:=record;$v:={"wrap":${object}};$keys(${invoke("sift", callback)}))`;
      expect(Array.from(await jsonata(source).evaluate(input))).toEqual(["fn", "data"]);
      expect(accesses(source)).toEqual([
        exact("other"), exact("other.*"), exact("record"), exact("record.details"), exact("record.details.*"),
      ]);
    });
  }
});
