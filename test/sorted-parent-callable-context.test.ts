import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  items: [{ name: "Second" }, { name: "First" }],
  other: { name: "Outer" },
};
const callables = [
  ["lambda", "function($r){$r.name}", "$record"],
  ["builtin", "$lookup", '$record,"name"'],
  ["partial", '($f:=function($r,$unused){$r.name};$f(?,0))', "$record"],
];

describe("parent callable context after tuple sorting", () => {
  for (const [kind, callable, args] of callables) {
    for (const source of ["items", "[items[0]]"]) {
      for (const dataAlias of [false, true]) {
        for (const index of ["", "#$i"]) {
          it.each(["group", "wrapped-method", "method"])(
            `calls the parent ${kind} from %s (source=${source}, dataAlias=${dataAlias}, index=${index})`,
            async (consumer) => {
              const sorted = `$outer.children@$w${index}^(<$w.data.copy.name)`;
              const call = consumer === "group" ? `(${sorted}){"out":$.fn(${args})}`
                : consumer === "wrapped-method" ? `(${sorted}).fn(${args})` : `${sorted}.fn(${args})`;
              const expression = `($record:=record;$input:=${source};$objects:=$map($input,function($row){{"fn":function($r){$r.details},"data":{"copy":$row}}});$outer:={"fn":${callable},"children":$objects${dataAlias ? ',"data":{"copy":other}' : ''}};${call})`;
              const names = source === "items" ? [input.record.name, input.record.name] : input.record.name;
              expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual(consumer === "group" ? { out: names } : names);
              const accesses = analyzeExpression(expression).accesses;
              expect(accesses).toContainEqual({ path: "record.name", confidence: "static", coverage: "subtree" });
              expect(accesses).toContainEqual({ path: "items.name", confidence: "static", coverage: "exact" });
              expect(accesses.map((access) => access.path)).not.toContain("record.details");
            },
          );
        }
      }
    }
  }
});
