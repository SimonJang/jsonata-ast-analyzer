import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  enabled: true,
  items: [
    { details: { amount: 10 }, name: { label: "One" } },
    { details: { amount: 20 }, name: { label: "Two" } },
  ],
};

describe("static eval in implicit constructed contexts", () => {
  for (const callable of [false, true]) {
    for (const dynamic of [false, true]) {
      const key = dynamic ? '(enabled?"data":"otherData")' : '"data"';
      const mapped = `$map(items,function($row){{${key}:{"copy":$row}${callable ? ',"fn":function($r){$r.details}' : ''}}})`;
      for (const producer of [
        '$objects',
        '$reverse($objects)',
        '($build:=function(){$append($objects,[])};$build())',
      ]) {
        it.each([
          { program: 'data.copy.name.label', invoke: '' },
          { program: '$lookup(data,"copy").name.label', invoke: '' },
          { program: 'function(){data.copy.name.label}', invoke: '()' },
        ])("resolves $program (callable=" + callable + ", dynamic=" + dynamic + ") after " + producer, async ({ program, invoke }) => {
          const expression = `($objects:=${mapped};${producer}.{"out":$eval(${JSON.stringify(program)})${invoke}})`;
          const labels = producer.startsWith('$reverse') ? ['Two', 'One'] : ['One', 'Two'];
          expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(
            labels.map((label) => ({ out: label })),
          );
          expect(analyzeExpression(expression).accesses.map((access) => access.path)).toContain("items.name.label");
        });
      }
    }
  }
});
