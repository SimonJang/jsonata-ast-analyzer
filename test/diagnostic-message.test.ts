import { describe, expect, it } from "vitest";

import { analyzeExpressionWithContext } from "../src/index.js";

describe("analysis diagnostics", () => {
  it("preserves structured JSONata parse error details", () => {
    const result = analyzeExpressionWithContext("$.foo[");

    expect(result).toEqual({
      accesses: [],
      diagnostics: [
        {
          kind: "parse",
          message: 'S0203 at position 6 near "(end)": Expected "]" before end of expression',
        },
      ],
    });
  });
});
