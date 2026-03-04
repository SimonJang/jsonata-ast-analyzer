import { describe, it } from "vitest";
import { assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("Data Transforms", () => {
  // Phase 8: smoke-test fixture to verify infrastructure
  // Phase 9 will expand with TRFM-01 through TRFM-05 scenarios
  const fixtures: IntegrationFixture[] = [
    {
      name: "simple dot-path extraction (infrastructure smoke test)",
      expression: "account.name",
      expectedPaths: [{ path: "account.name", confidence: "static" }],
    },
  ];

  for (const fixture of fixtures) {
    it(fixture.name, () => {
      assertFixture(fixture);
    });
  }
});
