import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  other: { details: { amount: 20 }, name: { label: "Two" } },
};
const shape = '{"wrap":{"left":{"copy":record},"other":{"different":other}}}';
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));
const expression = (tail: string) =>
  `($i:=record;$child:=record;$v:=${shape};$count(($append($v.wrap,$v.wrap))${tail}.left.copy))`;

describe("sort stages after tuple-stream metadata loss", () => {
  it.each([
    'items#$i^(<details.amount)[$i.name.label="One"].details',
    'items#$i^(<details.amount)^(<$i.name.label).details',
  ])("reads outer indices in physical data paths: %s", async (path) => {
    const source = `($i:=record;$count(${path}))`;
    const data = { ...input, items: [input.record, input.other] };
    expect(await jsonata(source).evaluate(data)).toBe(2);
    expect(accesses(source)).toEqual([
      exact("items.details"), exact("items.details.amount"), exact("record"), exact("record.name.label"),
    ]);
  });

  it("reads both focus scopes in a sorted physical path", async () => {
    const source = '($child:=record;$count(items@$child^(<$child.details.amount)[$child.name.label="One"]))';
    expect(await jsonata(source).evaluate({ ...input, items: [input.record, input.other] })).toBe(2);
    expect(accesses(source)).toEqual([
      exact("items"), exact("items.details.amount"), exact("items.name.label"), exact("record"), exact("record.name.label"),
    ]);
  });

  it.each([
    ['.other@$child^(<$child.different.details.amount)[$child.name.label="One"]', "record.name.label"],
    ['.other@$child#$i^(<$child.different.details.amount)[$i.details.amount>0]', "record.details.amount"],
    ['.other@$child^(<$child.different.details.amount)^(<$child.name.label)', "record.name.label"],
    ['.other@$child#$i^(<$child.different.details.amount)^(<$i.details.amount)', "record.details.amount"],
  ])("reads an outer binding in %s", async (tail, field) => {
    const source = expression(tail);
    expect(await jsonata(source).evaluate(input)).toBe(2);
    expect(accesses(source)).toEqual([
      exact("other"), exact("other.details.amount"), exact("record"), exact(field),
    ].sort((a, b) => a.path.localeCompare(b.path)));
  });

  it("reads tuple focus fields used as bare properties in a sort filter", async () => {
    const source = expression('.other@$child^(<$child.different.details.amount)[child.different.name.label="Two"]');
    expect(await jsonata(source).evaluate(input)).toBe(2);
    expect(accesses(source)).toEqual([
      exact("other"), exact("other.details.amount"), exact("other.name.label"), exact("record"),
    ]);
  });

  it("keeps tuple indices scalar after a selection restores the stream marker", async () => {
    const source = `($i:=record;$v:=${shape};$count(($append($v.wrap,$v.wrap)).other@$child#$i^(<$child.different.details.amount).left[$i.details.amount>0].copy))`;
    expect(await jsonata(source).evaluate(input)).toBe(0);
    expect(accesses(source)).toEqual([exact("other"), exact("other.details.amount"), exact("record")]);
  });
});
