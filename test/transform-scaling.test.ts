import jsonata from "jsonata";
import { expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

it("analyzes nested transforms without repeatedly resolving preceding results", async () => {
  let source = "{}";
  for (let index = 0; index < 10; index++) {
    source = `(${source} ~> |$|{"copy":$$.record}|)`;
  }
  const input = { record: { details: { amount: 10 } } };
  expect(await jsonata(source).evaluate(input)).toEqual({ copy: input.record });
  const started = performance.now();
  const accesses = analyzeExpression(source).accesses;
  expect(performance.now() - started).toBeLessThan(2000);
  expect(accesses).toContainEqual({ path: "record.**", confidence: "static", coverage: "exact" });
}, 20000);
