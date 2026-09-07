import { describe, expect, it } from "vitest";
import { analyzeExpression, extractPaths } from "../src/index.js";

describe("static analysis of calls with missing required arguments", () => {
  // Syntax can be parsed before runtime arity is valid. Each specialized builtin
  // handler must not invent an input dependency for an absent data argument.
  it.each(["lookup", "map", "reduce", "each", "sift", "merge", "reverse", "sort", "filter", "append", "zip", "single"])("keeps $%s() free of named input dependencies", (name) => {
    expect(extractPaths(`$${name}()`)).toEqual([]);
    expect(analyzeExpression(`$${name}()`)).toEqual({ accesses: [] });
  });

  it.each([
    { name: "spread", path: "*" },
    { name: "clone", path: "**" },
    { name: "eval", path: "**" },
  ])("retains the conservative implicit-root dependency for $name()", ({ name, path }) => {
    expect(analyzeExpression(`$${name}()`)).toEqual({ accesses: [
      { path, confidence: "static", coverage: "exact" },
    ] });
  });
});
