import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  enabled: true,
  items: [
    { details: { amount: 10 }, name: { label: "One" } },
    { details: { amount: 20 }, name: { label: "Two" } },
  ],
};

describe("forward references to mixed callable and data containers", () => {
  for (const dynamic of [false, true]) {
    const key = dynamic ? '(enabled?"fn":"otherFn")' : '"fn"';
    const objects = `$map(items,function($row){{${key}:function($r){$r.details},"data":{"copy":$row}}})`;
    for (const factory of [
      '($build:=function(){$append($objects,[])};$build())',
      '($build:=function($p){$append($p,[])};$build($objects))',
      '($build:=function(){$reverse($objects)};$build())',
      '($build:=function(){$map($objects,function($x){$x})};$build())',
    ]) {
      it.each([
        { suffix: '.data.copy.name.label', path: 'items.name.label', expected: factory.includes('$reverse') ? ['Two', 'One'] : ['One', 'Two'] },
        { suffix: '.{"out":data.copy.details.amount}', path: 'items.details.amount', expected: factory.includes('$reverse') ? [{ out: 20 }, { out: 10 }] : [{ out: 10 }, { out: 20 }] },
        { suffix: '.{"out":fn(data.copy)}', path: 'items.details', expected: factory.includes('$reverse') ? [{ out: input.items[1].details }, { out: input.items[0].details }] : [{ out: input.items[0].details }, { out: input.items[1].details }] },
      ])("retains $path through " + factory + " (dynamic=" + dynamic + ")", async ({ suffix, path, expected }) => {
        const expression = `($objects:=${objects};${factory}${suffix})`;
        expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(expected);
        expect(analyzeExpression(expression).accesses).toContainEqual({
          path, confidence: "static", coverage: "subtree",
        });
      });
    }
  }
});
