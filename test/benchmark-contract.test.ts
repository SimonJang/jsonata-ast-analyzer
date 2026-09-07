import { describe, expect, it } from "vitest";
import { __benchmarkExpression } from "../src/index.js";

describe("benchmark statistics", () => {
  it("distinguishes repeated reads from deduplicated dependencies", () => {
    const expression = "price + price + tax";
    const result = __benchmarkExpression(expression);
    expect(result).toMatchObject({ expression, rawPathCount: 3, uniquePathCount: 2 });
    expect(Number.isFinite(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
