import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("computed registry key dependencies", () => {
  const registry = '$merge($map(items,function($row){{($row.name):{"run":function(){$row.details}}}}))';
  it.each([
    [`${registry}.*.run().amount`, [10, 20]],
    [`$lookup(${registry},"a").run().amount`, 10],
    [`($box := ${registry}.*; $box).run().amount`, [10, 20]],
  ] as const)("retains key reads before invoking a selected method: %s", async (source, expected) => {
    const reads: string[] = [];
    const result = await jsonata(source).evaluate({ items: [
      { get name() { reads.push("items.name"); return "a"; }, details: { amount: 10 } },
      { get name() { reads.push("items.name"); return "b"; }, details: { amount: 20 } },
    ] });
    expect(JSON.parse(JSON.stringify(result))).toEqual(expected);
    expect(reads).toEqual(["items.name", "items.name"]);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "items.name", confidence: "static", coverage: "exact",
    });
  });
});
