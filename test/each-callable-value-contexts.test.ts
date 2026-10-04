import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  enabled: true,
  record: { details: { amount: 30, active: true } },
  items: [
    { details: { amount: 10, active: true }, name: { label: "One" } },
    { details: { amount: 20, active: false }, name: { label: "Two" } },
  ],
  other: { details: { amount: 15 }, name: { label: "Three" } },
};

describe("callable values in each callback contexts", () => {
  for (const capture of [false, true]) {
    for (const dynamic of [false, true]) {
      const key = dynamic ? '(enabled?"data":"otherData")' : '"data"';
      const body = capture ? "$row.details" : "$r.details";
      const registry = `$merge($map(items,function($row){{($row.name.label):{"fn":function($r){${body}},${key}:{"copy":$row}}}}))`;
      for (const source of [
        '$registry',
        '$sift($registry,function($v){$v.fn($record).amount>0})',
        '$registry.$sift(function($v){$v.fn($record).amount>0})',
        '$merge([$registry,{"extra":{"fn":function($r){$r.details},"data":{"copy":other}}}])',
      ]) {
        it.each(['$v.fn($record)', '$lookup($v,"fn")($record)'])("selects complete values through %s (capture=" + capture + ", dynamic=" + dynamic + ") from " + source, async (selection) => {
          const expression = `($record:=record;$registry:=${registry};$each(${source},function($v,$k){${selection}}))`;
          const expected = input.items.map((item) => capture ? item.details : input.record.details);
          if (source.includes('"extra"')) expected.push(input.record.details);
          expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(expected);
          const accesses = analyzeExpression(expression).accesses;
          expect(accesses).toContainEqual({
            path: capture ? "items.details" : "record.details", confidence: "static", coverage: "subtree",
          });
          if (source.includes('"extra"')) expect(accesses).toContainEqual({
            path: "record.details", confidence: "static", coverage: "subtree",
          });
        });
      }
    }
  }
});
