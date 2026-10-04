import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  other: { details: { amount: 20 }, name: { label: "Two" } },
};
const shape = '{"wrap":{"left":{"copy":record},"other":{"different":other}}}';
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const subtree = (path: string) => ({ path, confidence: "static", coverage: "subtree" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));
const expression = (name: string, tail: string) =>
  `($${name}:=record;$v:=${shape};($append($v.wrap,$v.wrap))${tail})`;

describe("outer scope in groups of sorted tuples", () => {
  it("reads an outer value when sorting multiple tuples loses their stream marker", async () => {
    const source = expression("i", '.other@$child^(<$child.different.details.amount)[true]#$i{"group":$i}');
    expect(await jsonata(source).evaluate(input)).toEqual({ group: input.record });
    expect(accesses(source)).toEqual([exact("other"), exact("other.details.amount"), subtree("record")]);
  });

  it("reads fields of the outer value in the sorted group", async () => {
    const source = expression("i", '.other@$child^(<$child.different.details.amount)[true]#$i{"group":$i.name.label}');
    expect(await jsonata(source).evaluate(input)).toEqual({ group: "One" });
    expect(accesses(source)).toEqual([
      exact("other"), exact("other.details.amount"), exact("record"), subtree("record.name.label"),
    ]);
  });

  it("reads outer focus values as well as possible tuple focus values", async () => {
    const source = expression("child", '.other@$child^(<$child.different.details.amount){"group":$child}');
    expect(await jsonata(source).evaluate(input)).toEqual({ group: input.record });
    expect(accesses(source)).toEqual([subtree("other"), exact("other.details.amount"), subtree("record")]);
  });

  it("reads an outer value used as the grouping key", async () => {
    const source = expression("i", '.other@$child^(<$child.different.details.amount)[true]#$i{($i.name.label):42}');
    expect(await jsonata(source).evaluate(input)).toEqual({ One: 42 });
    expect(accesses(source)).toEqual([
      exact("other"), exact("other.details.amount"), exact("record"), exact("record.name.label"),
    ]);
  });

  it("keeps indices scalar when the sort starts the tuple stream", async () => {
    const source = expression("i", '^(<other.different.details.amount)#$i{"group":$i}');
    expect(await jsonata(source).evaluate(input)).toEqual({ group: [0, 1] });
    expect(accesses(source)).toEqual([exact("other"), exact("other.details.amount"), exact("record")]);
  });

  it("keeps indices scalar when a later selection restores the tuple stream", async () => {
    const source = expression("i", '.other@$child^(<$child.different.details.amount)[true]#$i.left.copy{"group":$i}');
    expect(await jsonata(source).evaluate(input)).toEqual({ group: [0, 1] });
    expect(accesses(source)).toEqual([exact("other"), exact("other.details.amount"), exact("record")]);
  });
});
