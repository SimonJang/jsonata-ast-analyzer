import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import config from "./vitest.config.js";

export default mergeConfig(config, defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.codex/**"],
    includeTaskLocation: true,
    reporters: ["default", "json", "junit"],
    outputFile: {
      json: "coverage/test-results.json",
      junit: "coverage/junit.xml",
    },
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "lcov", "json", "json-summary", "clover"],
      reportsDirectory: "coverage",
      thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
    },
  },
}));
