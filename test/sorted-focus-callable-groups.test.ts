import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  items: [{ details: { amount: 10 } }, { details: { amount: 20 } }],
  other: { details: { amount: 30 } },
};

describe("callables in groups after a tuple-stream sort", () => {
  for (const [procedure, args] of [
    ['function($r){$r.details}', '$record'],
    ['$lookup', '$record,"details"'],
    ['$lookup(?,"details")', '$record'],
  ]) {
    it.each([false, true])(`retains focused and outer ${procedure} scopes (singleton=%s)`, async (single) => {
      const producer = single ? "$objects[0]" : "$objects";
      const source = `($record:=record;$w:={"fn":function($r){$r.name},"data":{"copy":other}};$objects:=$map(items,function($row){{"fn":${procedure},"data":{"copy":$row}}});(${producer})@$w^(<$w.data.copy.details.amount){"out":$w.fn(${args})})`;
      expect(await jsonata(source).evaluate(input)).toEqual({ out: single ? input.record.details : input.record.name });
      const accesses = analyzeExpression(source).accesses;
      for (const path of ["record.details", "record.name"]) {
        expect(accesses).toContainEqual({ path, confidence: "static", coverage: "subtree" });
      }
      expect(accesses.map((access) => access.path)).not.toContain("fn");
    });
  }

  it.each([false, true])("retains an outer callable without data aliases (singleton=%s)", async (single) => {
    const producer = single ? "$objects[0]" : "$objects";
    const source = `($record:=record;$w:={"fn":function($r){$r.name}};$objects:=$map(items,function($row){{"fn":function($r){$r.details},"data":{"copy":$row}}});(${producer})@$w^(<$w.data.copy.details.amount){"out":$join($keys($w.fn($record)),",")})`;
    expect(await jsonata(source).evaluate(input)).toEqual({ out: single ? "amount" : "label" });
    for (const path of ["record.details.*", "record.name.*"]) {
      expect(analyzeExpression(source).accesses).toContainEqual({ path, confidence: "static", coverage: "exact" });
    }
  });

  it("keeps an unsorted group in the focused callable scope", async () => {
    const source = '($record:=record;$w:={"fn":function($r){$r.name}};$objects:=$map(items,function($row){{"fn":function($r){$r.details},"data":{"copy":$row}}});($objects[0])@$w.${"out":$w.fn($record)})';
    expect(await jsonata(source).evaluate(input)).toEqual({ out: input.record.details });
    const accesses = analyzeExpression(source).accesses;
    expect(accesses).toContainEqual({ path: "record.details", confidence: "static", coverage: "subtree" });
    expect(accesses.map((access) => access.path)).not.toContain("record.name");
  });
});
