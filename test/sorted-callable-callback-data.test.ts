import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  enabled: true,
  record: { details: { amount: 30 } },
  items: [
    { details: { amount: 10 }, name: { label: "One" } },
    { details: { amount: 20 }, name: { label: "Two" } },
  ],
};

describe("data aliases from sorted callable containers in callbacks", () => {
  for (const capture of [false, true]) {
    for (const dynamic of [false, true]) {
      const dataKey = dynamic ? '(enabled?"data":"otherData")' : '"data"';
      const body = capture ? "$row.details" : "$r.details";
      const producer = `$map(items,function($row){{"fn":function($r){${body}},${dataKey}:{"copy":$row}}})`;
      for (const sorted of [
        '$objects^(<fn($record).amount)',
        '$objects#$i^(<fn($record).amount)',
        '$objects^(<fn($record).amount)#$i',
        '$objects^(<fn($record).amount)^(>fn($record).amount)',
      ]) {
        it.each([
          '$x.data.copy.name.label',
          '$lookup($x,"data").copy.name.label',
          '$eval("data.copy.name.label",$x)',
        ])("retains data through %s (capture=" + capture + ", dynamic=" + dynamic + ") after " + sorted, async (selection) => {
          const expression = `($record:=record;$objects:=${producer};${sorted}~>$map(function($x){${selection}}))`;
          expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(
            capture && sorted.includes("^(>") ? ["Two", "One"] : ["One", "Two"],
          );
          expect(analyzeExpression(expression).accesses.map((access) => access.path)).toContain("items.name.label");
        });
      }
    }
  }
});
