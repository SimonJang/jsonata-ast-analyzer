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

describe("callable current context in producer predicates", () => {
  for (const [kind, callable, call] of callables) {
    for (const dataAlias of [false, true]) {
      const mapped = `$map($input,function($row){{"fn":${callable}${dataAlias ? ',"data":{"copy":$row}' : ''}}})`;
      for (const source of ["items", "[items[0]]"]) {
        it.each(["($objects)", "$objects", mapped, '$lookup({"wrap":$objects},"wrap")', "($objects).$"])(
          `calls ${kind} from %s (source=${source}, dataAlias=${dataAlias})`,
          async (producer) => {
            const expression = `($record:=record;$input:=${source};$objects:=${mapped};$count(${producer}[$exists(${call})]))`;
            expect(await jsonata(expression).evaluate(input)).toBe(source === "items" ? 2 : 1);
            expect(analyzeExpression(expression).accesses).toContainEqual({
              path: "record.details", confidence: "static", coverage: "exact",
            });
          },
        );
      }
    }
  }

  it("enumerates a callable result used as a boolean predicate", async () => {
    const expression = '($record:=record;$objects:=$map(items,function($row){{"fn":function($r){$r.details}}});$count(($objects)[$.fn($record)]))';
    expect(await jsonata(expression).evaluate(input)).toBe(2);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record.details.*", confidence: "static", coverage: "exact",
    });
  });

  it.each([false, true])("retains predicate reads before later data selections (dataAlias=%s)", async (dataAlias) => {
    const expression = `($record:=record;$objects:=$map(items,function($row){{"fn":function($r){$r.details}${dataAlias ? ',"data":{"copy":$row}' : ''}}});($objects).$[$.fn($record)].data.copy.name)`;
    const result = await jsonata(expression).evaluate(input);
    if (dataAlias) expect(JSON.parse(JSON.stringify(result))).toEqual(["One", "Two"]);
    else expect(result).toBeUndefined();
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record.details.*", confidence: "static", coverage: "exact",
    });
  });
});
