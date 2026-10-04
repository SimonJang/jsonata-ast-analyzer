import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  enabled: true,
  record: { details: { amount: 30 } },
  items: [{ details: { amount: 10 } }, { details: { amount: 20 } }],
};

describe("current contexts from named callable containers", () => {
  for (const dynamic of [false, true]) {
    const key = dynamic ? '(enabled?"fn":"otherFn")' : '"fn"';
    for (const producer of [
      `$map(items,function($row){{${key}:function($unused){$row.details}}})`,
      `$reverse($map(items,function($row){{${key}:function($unused){$row.details}}}))`,
    ]) {
      it.each([
        '.{"out":$.fn($record)}',
        '.{"out":fn($record)}',
        '.{"out":$lookup($,"fn")($record)}',
        '.{"out":($f:=fn;$f($record))}',
      ])("retains captured origins through %s (dynamic=" + dynamic + ") from " + producer, async (suffix) => {
        const expression = `($record:=record;$objects:=${producer};$objects${suffix})`;
        const expected = producer.startsWith("$reverse") ? [...input.items].reverse() : input.items;
        expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(
          expected.map((item) => ({ out: item.details })),
        );
        expect(analyzeExpression(expression).accesses).toContainEqual({
          path: "items.details", confidence: "static", coverage: "subtree",
        });
      });
    }
  }
});
