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
  other: { details: { amount: 15 }, name: { label: "Three" } },
};

describe("sorting producers with callable and physical entries", () => {
  for (const capture of [false, true]) {
    for (const dynamic of [false, true]) {
      const dataKey = dynamic ? '(enabled?"data":"otherData")' : '"data"';
      const body = capture ? "$row.details" : "$r.details";
      const objects = `$map(items,function($row){{"fn":function($r){${body}},${dataKey}:{"copy":$row}}})`;
      for (const producer of [
        '$append($objects,other)',
        '$append($objects,items)',
        '$append(items,$objects)',
        '$objects.$sift(function($v){true})',
      ]) {
        it.each(["", "#$i"])("retains sort keys and callback data with %s (capture=" + capture + ", dynamic=" + dynamic + ") from " + producer, async (index) => {
          const key = '$exists(fn)?fn($record).amount:details.amount';
          const expression = `($record:=record;$objects:=${objects};${producer}^(<(${key}))${index}~>$map(function($x){$exists($x.fn)?$x.data.copy.name.label:$x.name.label}))`;
          const expected = producer.includes("$sift") ? ["One", "Two"] : producer.includes("other")
            ? capture ? ["One", "Three", "Two"] : ["Three", "One", "Two"]
            : capture ? ["One", "One", "Two", "Two"] : ["One", "Two", "One", "Two"];
          expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(expected);
          const paths = analyzeExpression(expression).accesses.map((access) => access.path);
          expect(paths).toContain(capture ? "items.details.amount" : "record.details.amount");
          expect(paths).toContain("items.name.label");
          if (producer.includes("other")) {
            expect(paths).toContain("other.details.amount");
            expect(paths).toContain("other.name.label");
          }
        });
      }
    }
  }
});
