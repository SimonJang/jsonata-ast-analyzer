import { performance } from "node:perf_hooks";
import jsonata from "jsonata";
import { expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

it("resolves nested constructor assignments without repeated scope expansion", async () => {
  let value = "record";
  for (let index = 0; index < 16; index++) value = `{"a":$x${index}:=${value}}`;
  const source = `(${value};$x0.details.amount)`;
  expect(await jsonata(source).evaluate({ record: { details: { amount: 10 } } })).toBe(10);
  const start = performance.now();
  expect(analyzeExpression(source).accesses).toContainEqual({
    path: "record.details.amount", confidence: "static", coverage: "subtree",
  });
  expect(performance.now() - start).toBeLessThan(2000);
});
