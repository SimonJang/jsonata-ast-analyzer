import jsonata from "jsonata";
import { expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

it("analyzes a short matcher continuation chain without repeatedly expanding prior calls", async () => {
  let match = "$nothing";
  const length = 4;
  for (let index = length - 1; index >= 0; index--) {
    match = `{"match":"x","start":${index},"end":${index + 1},"groups":config.g${index},"next":function(){${match}}}`;
  }
  const expression = `($m:=function($s){${match}}; $match(text,$m).groups.label)`;
  const result = await jsonata(expression).evaluate({
    text: "xxxx", config: { g0: [{ label: "a" }], g1: [{ label: "b" }], g2: [{ label: "c" }], g3: [{ label: "d" }] },
  });
  expect(Array.from(result)).toEqual(["a", "b", "c", "d"]);
  const started = performance.now();
  const accesses = analyzeExpression(expression).accesses;
  const elapsed = performance.now() - started;
  for (let index = 0; index < length; index++) {
    expect(accesses).toContainEqual({ path: `config.g${index}.label`, confidence: "static", coverage: "subtree" });
  }
  // The former nested expansion takes over eight seconds at this depth.
  expect(elapsed).toBeLessThan(3000);
});
