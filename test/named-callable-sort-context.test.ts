import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  enabled: true,
  record: { details: { amount: 30 } },
  items: [
    { details: { amount: 10 }, name: { label: "One" } },
    { details: { amount: 20 }, name: { label: "Two" } },
  ],
};

describe("sorting named callable containers", () => {
  it.each([
    "function(){$$.items.details}",
    "(function($ignored){$$.items.details})(?)",
  ])("retains captured reads when invoking %s after a parenthesized focus sort", async (procedure) => {
    const source = `(({"fn":${procedure},"copy":record})@$v^($v.copy.details.amount).$v).fn().amount`;
    expect(Array.from(await jsonata(source).evaluate(input))).toEqual([10, 20]);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "items.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("retains builtin semantics after a parenthesized focus sort", async () => {
    const source = '(({"fn":$eval,"copy":record})@$v^($v.copy.details.amount).$v).fn("$$.items.details.amount")';
    expect(Array.from(await jsonata(source).evaluate(input))).toEqual([10, 20]);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "items.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each(["key.rank", "$.key.rank"])("traces constructed callable sort keys through %s", async (key) => {
    const source = `$map(rows,function($r){{"fn":function(){$r.details},"key":$r.key}})^(${key}).fn().amount`;
    let rankReads = 0;
    expect(Array.from(await jsonata(source).evaluate({ rows: [
      { details: { amount: 10 }, key: { get rank() { rankReads++; return 2; } } },
      { details: { amount: 20 }, key: { get rank() { rankReads++; return 1; } } },
    ] }))).toEqual([20, 10]);
    expect(rankReads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "rows.key.rank", confidence: "static", coverage: "exact",
    });
  });

  for (const capture of [false, true]) {
    for (const data of [false, true]) {
      for (const dynamic of [false, true]) {
        const key = dynamic ? '(enabled?"fn":"otherFn")' : '"fn"';
        const body = capture ? "$row.details" : "$r.details";
        const producer = `$map(items,function($row){{${key}:function($r){${body}}${data ? ',"data":{"copy":$row}' : ''}}})`;
        for (const stage of [
          '$objects^(<fn($record).amount)',
          '$objects#$i^(<fn($record).amount)',
          '$objects^(<fn($record).amount)#$i',
        ]) {
          it.each([
            { suffix: '.{"count":$count(fn($record))}', expected: [{ count: 1 }, { count: 1 }] },
            ...(data ? [{ suffix: '.{"out":data.copy.name.label}', expected: [{ out: "One" }, { out: "Two" }] }] : []),
          ])("traces stage reads through " + stage + " (capture=" + capture + ", data=" + data + ", dynamic=" + dynamic + ") with $suffix", async ({ suffix, expected }) => {
            const expression = `($record:=record;$objects:=${producer};${stage}${suffix})`;
            expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(expected);
            const paths = analyzeExpression(expression).accesses.map((access) => access.path);
            expect(paths).toContain(capture ? "items.details.amount" : "record.details.amount");
            if (data && suffix.includes('"out"')) expect(paths).toContain("items.name.label");
          });
        }
      }
    }
  }
});
