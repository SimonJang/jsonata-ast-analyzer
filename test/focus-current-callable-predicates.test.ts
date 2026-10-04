import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  items: [{ name: "First" }, { name: "Second" }],
  other: { name: "Outer" },
};
const callables = [
  ["lambda", "function($r){$r.details}", "$.fn($record)"],
  ["builtin", "$lookup", '$.fn($record,"details")'],
  ["partial", '($f:=function($r,$unused){$r.details};$f(?,0))', "$.fn($record)"],
];

describe("current callable context around producer focus bindings", () => {
  for (const [kind, callable, call] of callables) {
    for (const outerBinding of [false, true]) {
      for (const dataAlias of [false, true]) {
        const mapped = `$map(items,function($row){{"fn":${callable}${dataAlias ? ',"data":{"copy":$row}' : ''}}})`;
        it.each(["($objects)", mapped, '$lookup({"wrap":$objects},"wrap")'])(
          `calls ${kind} before %s creates its focus (outerBinding=${outerBinding}, dataAlias=${dataAlias})`,
          async (producer) => {
            const expression = `($record:=record;${outerBinding ? '$w:={"fn":function($r){$r.name}};' : ''}$objects:=${mapped};$count(${producer}@$w[${call}]))`;
            expect(await jsonata(expression).evaluate(input)).toBe(2);
            const accesses = analyzeExpression(expression).accesses;
            expect(accesses).toContainEqual({ path: "record.details.*", confidence: "static", coverage: "exact" });
            expect(accesses.map((access) => access.path)).not.toContain("record.name");
          },
        );
      }
    }
  }

  for (const [kind, callable, call] of callables) {
    const parentCallable = callable.replaceAll("$r.details", "$r.name");
    const parentCall = call.replaceAll('"details"', '"name"');
    for (const dataAlias of [false, true]) {
      it.each(["", "#$i"])(`uses the parent ${kind} after a focus binding (dataAlias=${dataAlias}, index=%s)`, async (index) => {
        const expression = `($record:=record;$objects:=$map(items,function($row){{"fn":function($r){$r.details},"data":{"copy":$row}}});$outer:={"fn":${parentCallable},"children":$objects${dataAlias ? ',"data":{"copy":other}' : ''}};$count($outer.children@$w${index}[${parentCall}]))`;
        expect(await jsonata(expression).evaluate(input)).toBe(2);
        const accesses = analyzeExpression(expression).accesses;
        expect(accesses).toContainEqual({ path: "record.name.*", confidence: "static", coverage: "exact" });
        expect(accesses.map((access) => access.path)).not.toContain("record.details");
      });
      for (const index of ["", "#$i"]) {
        it.each(["value", "keys"])(`groups the returned parent ${kind} context (dataAlias=${dataAlias}, index=${index}, consumer=%s)`, async (consumer) => {
          const value = consumer === "keys" ? `$keys(${parentCall})` : parentCall;
          const expression = `($record:=record;$objects:=$map(items,function($row){{"fn":function($r){$r.details},"data":{"copy":$row}}});$outer:={"fn":${parentCallable},"children":$objects${dataAlias ? ',"data":{"copy":other}' : ''}};($outer.children@$w${index}[$exists(${parentCall})]){"out":${value}})`;
          expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual({
            out: consumer === "keys" ? "label" : [input.record.name, input.record.name],
          });
          const accesses = analyzeExpression(expression).accesses;
          expect(accesses).toContainEqual({
            path: consumer === "keys" ? "record.name.*" : "record.name",
            confidence: "static", coverage: consumer === "keys" ? "exact" : "subtree",
          });
          expect(accesses.map((access) => access.path)).not.toContain("record.details");
        });
      }
    }
  }
});
