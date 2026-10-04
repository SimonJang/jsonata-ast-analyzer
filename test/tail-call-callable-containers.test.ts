import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 30 } },
  items: [{ details: { amount: 10 } }, { details: { amount: 20 } }],
};

describe("callable containers returned through tail calls", () => {
  for (const capture of [false, true]) {
    for (const dataAlias of [false, true]) {
      const callable = `function($r){${capture ? "$row.details" : "$r.details"}}`;
      const mapped = `$map(items,function($row){{"fn":${callable}${dataAlias ? ',"data":{"copy":$row}' : ''}}})`;
      it.each([
        "$reduce($objects,function($acc,$x){$append($acc,$x)},[])",
        "($cb:=function($acc,$x,$unused){$append($acc,$x)};$reduce($objects,$cb(?,?,0),[]))",
        "($build:=function(){$append($objects,[])};$build())",
      ])("preserves callable entries from %s (capture=" + capture + ", dataAlias=" + dataAlias + ")", async (producer) => {
        const expression = `($record:=record;$objects:=${mapped};${producer}.{"out":$.fn($record)})`;
        expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual([
          { out: capture ? input.items[0].details : input.record.details },
          { out: capture ? input.items[1].details : input.record.details },
        ]);
        expect(analyzeExpression(expression).accesses).toContainEqual({
          path: capture ? "items.details" : "record.details", confidence: "static", coverage: "subtree",
        });
      });
    }
  }

  it.each(["$lookup", '($f:=function($r,$unused){$r.details};$f(?,0))'])("retains stored builtins and partials through reductions from %s", async (callable) => {
    const args = callable === "$lookup" ? '$record,"details"' : "$record";
    const expression = `($record:=record;$objects:=$map(items,function($row){{"fn":${callable}}});$reduce($objects,function($acc,$x){$append($acc,$x)},[]).{"out":$.fn(${args})})`;
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual([
      { out: input.record.details }, { out: input.record.details },
    ]);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "record.details", confidence: "static", coverage: "subtree",
    });
  });
});
