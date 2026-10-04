import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  items: [{ details: { amount: 10 } }, { details: { amount: 20 } }],
  other: { details: { amount: 30 } },
};
const mapped = '$map(items,function($row){{"fn":function($r){$r.details},"data":{"copy":$row}}})';
const producers = ["($objects)", mapped, '$lookup({"wrap":$objects},"wrap")'];

describe("callable scope before producer tuple bindings", () => {
  for (const dataAlias of [false, true]) {
    const outer = `{"fn":function($r){$r.name}${dataAlias ? ',"data":{"copy":other}' : ''}}`;
    it.each(producers)(`uses the incoming callable for early groups from %s (dataAlias=${dataAlias})`, async (producer) => {
      const source = `($record:=record;$w:=${outer};$objects:=${mapped};${producer}@$w{"out":$w.fn($record)})`;
      expect(await jsonata(source).evaluate(input)).toEqual({ out: input.record.name });
      const accesses = analyzeExpression(source).accesses;
      expect(accesses).toContainEqual({ path: "record.name", confidence: "static", coverage: "subtree" });
      expect(accesses.map((access) => access.path)).not.toContain("record.details");
    });

    it.each(producers)(`uses the incoming callable for early predicates from %s (dataAlias=${dataAlias})`, async (producer) => {
      const source = `($record:=record;$w:=${outer};$objects:=${mapped};$count(${producer}@$w[$w.fn($record)]))`;
      expect(await jsonata(source).evaluate(input)).toBe(2);
      const accesses = analyzeExpression(source).accesses;
      expect(accesses).toContainEqual({ path: "record.name.*", confidence: "static", coverage: "exact" });
      expect(accesses.map((access) => access.path)).not.toContain("record.details");
    });
  }

  it.each(producers)("uses the newly bound callable for tuple stages from %s", async (producer) => {
    const source = `($record:=record;$w:={"fn":function($r){$r.name}};$objects:=${mapped};$count(${producer}@$w#$i[$w.fn($record)]))`;
    expect(await jsonata(source).evaluate(input)).toBe(2);
    const accesses = analyzeExpression(source).accesses;
    expect(accesses).toContainEqual({ path: "record.details.*", confidence: "static", coverage: "exact" });
    expect(accesses.map((access) => access.path)).not.toContain("record.name");
  });
});
