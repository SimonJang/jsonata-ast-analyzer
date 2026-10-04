import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  enabled: true,
  record: { details: { amount: 30 } },
  items: [{ details: { amount: 10 } }, { details: { amount: 20 } }],
};

describe("focus bindings on named callable containers", () => {
  for (const capture of [false, true]) {
    for (const data of [false, true]) {
      for (const dynamic of [false, true]) {
        const key = dynamic ? '(enabled?"fn":"otherFn")' : '"fn"';
        const body = capture ? "$row.details" : "$r.details";
        const producer = `$map(items,function($row){{${key}:function($r){${body}}${data ? ',"data":{"copy":$row}' : ''}}})`;
        it.each([
          '$objects@$o.{"out":$o.fn($record)}',
          '$objects@$o#$i.{"out":$lookup($o,"fn")($record)}',
        ])("retains closure origins through %s (capture=" + capture + ", data=" + data + ", dynamic=" + dynamic + ")", async (projection) => {
          const expression = `($record:=record;$objects:=${producer};${projection})`;
          expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(
            input.items.map((item) => ({ out: capture ? item.details : input.record.details })),
          );
          expect(analyzeExpression(expression).accesses).toContainEqual({
            path: capture ? "items.details" : "record.details", confidence: "static", coverage: "subtree",
          });
        });
      }
    }
  }
});
