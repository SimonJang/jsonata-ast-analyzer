import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10, active: true } },
  items: [{ name: "One" }, { name: "Two" }],
};
const callables = [
  ["lambda", "function($r){$r.details}", "$.fn($record)"],
  ["builtin", "$lookup", '$.fn($record,"details")'],
  ["partial", '($f:=function($r,$unused){$r.details};$f(?,0))', "$.fn($record)"],
];

describe("callable entries in the current grouped value", () => {
  for (const [kind, callable, call] of callables) {
    for (const dataAlias of [false, true]) {
      const mapped = `$map($input,function($row){{"fn":${callable}${dataAlias ? ',"data":{"copy":$row}' : ''}}})`;
      for (const source of ["items", "[items[0]]"]) {
        it.each(["($objects)", mapped, '$lookup({"wrap":$objects},"wrap")', "($objects).$"])(
          `calls ${kind} from %s (source=${source}, dataAlias=${dataAlias})`,
          async (producer) => {
            const expression = `($record:=record;$input:=${source};$objects:=${mapped};${producer}{"out":${call}})`;
            const result = JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)));
            expect(result).toEqual({ out: source === "items" ? [input.record.details, input.record.details] : input.record.details });
            expect(analyzeExpression(expression).accesses).toContainEqual({
              path: "record.details", confidence: "static", coverage: "subtree",
            });
          },
        );
      }
    }
  }

  it("reads a callable result when it supplies the group key", async () => {
    const expression = '($record:=record;$objects:=$map(items,function($row){{"fn":function($r){$r.details}}});($objects){$string($.fn($record).amount[0]):true})';
    expect(await jsonata(expression).evaluate(input)).toEqual({ "10": true });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record.details.amount", confidence: "static", coverage: "exact",
    });
  });

  it.each(["$map(items,function($row){{\"fn\":function($r){$r.details}}})", '$lookup({"wrap":$objects},"wrap")'])(
    "keeps group reads attached to a producer step in %s",
    async (producer) => {
      const expression = `($record:=record;$objects:=$map(items,function($row){{"fn":function($r){$r.details}}});${producer}{"out":$keys($.fn($record))}.*)`;
      expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(["amount", "active"]);
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path: "record.details.*", confidence: "static", coverage: "exact",
      });
    },
  );

  it("retains data fields beside callables after a grouped identity projection", async () => {
    const expression = '($record:=record;$objects:=$map(items,function($row){{"fn":function($r){$r.details},"data":{"copy":$row}}});($objects).${$.data.copy.name[0]:$.fn($record).amount})';
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual({ One: 10, Two: 10 });
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "items.name", confidence: "static", coverage: "exact" });
    expect(accesses).toContainEqual({ path: "record.details.amount", confidence: "static", coverage: "subtree" });
  });
});
