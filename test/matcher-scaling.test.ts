import jsonata from "jsonata";
import { expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

it("analyzes a short matcher continuation chain without repeatedly expanding prior calls", async () => {
  let match = "$nothing";
  for (let index = 2; index >= 0; index--) {
    match = `{"match":"x","start":${index},"end":${index + 1},"groups":config.g${index},"next":function(){${match}}}`;
  }
  const expression = `($m:=function($s){${match}}; $match(text,$m).groups.label)`;
  const result = await jsonata(expression).evaluate({
    text: "xxx", config: { g0: [{ label: "a" }], g1: [{ label: "b" }], g2: [{ label: "c" }] },
  });
  expect(Array.from(result)).toEqual(["a", "b", "c"]);
  const started = performance.now();
  const accesses = analyzeExpression(expression).accesses;
  const elapsed = performance.now() - started;
  for (let index = 0; index < 3; index++) {
    expect(accesses).toContainEqual({ path: `config.g${index}.label`, confidence: "static", coverage: "subtree" });
  }
  expect(elapsed).toBeLessThan(500);
});
