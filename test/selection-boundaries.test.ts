import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";
import { createScope } from "../src/scope.js";
import { createWalker } from "../src/walker/index.js";

describe("selected-result boundaries", () => {
  it("selects the final nested block result without selecting earlier bindings", () => {
    expect(analyzeExpression("(($x := items); ($y := other; $y))")).toEqual({ accesses: [
      { path: "items", confidence: "static", coverage: "exact" },
      { path: "other", confidence: "static", coverage: "subtree" },
    ] });
  });

  it("makes an array-local binding available to later selected elements", () => {
    expect(analyzeExpression("[$x := items, $x]")).toEqual({ accesses: [
      { path: "items", confidence: "static", coverage: "subtree" },
    ] });
  });

  it("selects the value returned by a top-level assignment", () => {
    expect(analyzeExpression("$x := items")).toEqual({ accesses: [
      { path: "items", confidence: "static", coverage: "subtree" },
    ] });
  });

  it("does not require an else branch to select a conditional result", () => {
    expect(analyzeExpression("flag ? items")).toEqual({ accesses: [
      { path: "flag", confidence: "static", coverage: "exact" },
      { path: "items", confidence: "static", coverage: "subtree" },
    ] });
  });

  it("retains reads without inventing a selected result for a non-callable apply target", () => {
    expect(analyzeExpression("items ~> 1")).toEqual({ accesses: [
      { path: "items", confidence: "static", coverage: "exact" },
    ] });
  });

  it("follows the returned value of a thunk rather than treating it as an unevaluated function", () => {
    const walker = createWalker();
    const node = { type: "lambda" as const, arguments: [], thunk: true, body: { type: "name" as const, value: "items", position: 0 } };
    expect(walker.getSelectedResultPaths(node, createScope())).toEqual(["items"]);
  });

  it("selects a direct name node supplied by internal AST composition", () => {
    expect(createWalker().getSelectedResultPaths({ type: "name", value: "items", position: 0 }, createScope())).toEqual(["items"]);
  });
});
