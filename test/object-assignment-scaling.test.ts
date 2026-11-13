import { performance } from "node:perf_hooks";
import jsonata from "jsonata";
import { expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

it("retains eight repeated write origins without expanding captured value trees", async () => {
  const depth = 8;
  let reads = 0;
  let record: Record<string, unknown> = { get amount() { reads++; return 10; } };
  let other: Record<string, unknown> = { amount: 20 };
  const writes = ["$x:=record"];
  for (let index = 0; index < depth; index++) {
    record = { next: record };
    other = { next: other };
    let delay = "[]";
    for (let wait = 0; wait < index * 2; wait++) delay = `$reverse(${delay})`;
    writes.push(`$x:=$append(${delay},$x.next)`);
  }
  const source = `($x:=other;[${writes.join(",")}];$x.amount)`;
  expect(await jsonata(source).evaluate({ record, other })).toBe(10);
  expect(reads).toBeGreaterThan(0);
  const start = performance.now();
  const result = analyzeExpression(source);
  expect(performance.now() - start).toBeLessThan(2000);
  expect(result.accesses.map(({ path }) => path)).toContain(`record${".next".repeat(depth)}.amount`);
});

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
