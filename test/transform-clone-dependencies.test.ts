import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("transform input cloning dependencies", () => {
  it.each([
    '$count(record ~> |$|{"tag":true}|)',
    '($t := |$|{"tag":true}|; $count($t(record)))',
    '($t := |$|{"tag":true}|; $count($t({"copy":record})))',
  ])("includes descendants cloned before a transform result is counted: %s", async (source) => {
    const reads: string[] = [];
    expect(await jsonata(source).evaluate({
      record: { details: { get amount() { reads.push("record.details.amount"); return 10; } } },
    })).toBe(1);
    expect(reads).toEqual(["record.details.amount"]);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.**", confidence: "static", coverage: "exact",
    });
  });

  it("keeps clone dependencies within the current path context", async () => {
    const source = 'items.($t:=|$|{"tag":true}|; $count($t($)))';
    const reads: string[] = [];
    expect(await jsonata(source).evaluate({
      items: [{ details: { get amount() { reads.push("items.details.amount"); return 10; } } }],
    })).toBe(1);
    expect(reads).toEqual(["items.details.amount"]);
    const accesses = analyzeExpression(source).accesses;
    expect(accesses).toContainEqual({ path: "items.**", confidence: "static", coverage: "exact" });
    expect(accesses.some(({ path }) => path === "**")).toBe(false);
  });
});
