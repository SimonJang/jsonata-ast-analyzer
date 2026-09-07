import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";
import { createScope } from "../src/scope.js";
import { walkerRuntime } from "./support/walker-runtime.js";

describe("function-analysis boundaries", () => {
  it.each([
    { label: "partial", expression: "($local := $substring(?,0,2); $local(name))", accesses: [{ path: "name", confidence: "static", coverage: "exact" }] },
    { label: "transform", expression: '($local := |$|{"copy":name}|; $local(item))', accesses: [{ path: "item", confidence: "static", coverage: "subtree" }, { path: "item.name", confidence: "static", coverage: "exact" }] },
    { label: "stored builtin", expression: "($local := [$uppercase,$lowercase]; $local[0](name))", accesses: [{ path: "name", confidence: "static", coverage: "exact" }] },
    { label: "stored lambda", expression: "($local := [function($x){$x.name},function($x){$x.code}]; $local[0](item))", accesses: [{ path: "item", confidence: "static", coverage: "exact" }, { path: "item.name", confidence: "static", coverage: "subtree" }] },
  ])("honors a local $label binding even when its name is configured as opaque", ({ expression, accesses }) => {
    expect(analyzeExpression(expression, { opaqueFunctions: ["local"] })).toEqual({ accesses });
  });

  it("retains closure reads from a lambda passed to an unknown function", () => {
    expect(analyzeExpression("$custom(function($v){customer.name})")).toEqual({ accesses: [
      { path: "customer.name", confidence: "static", coverage: "exact" },
    ] });
  });

  it("follows a partially applied matcher callback without treating the generated match input as source data", () => {
    expect(analyzeExpression("$contains(text,(function($x){suffix})(?))")).toEqual({ accesses: [
      { path: "text", confidence: "static", coverage: "exact" },
      { path: "suffix", confidence: "static", coverage: "exact" },
    ] });
  });

  it("does not propagate an inner parser error from a statically invalid eval program", () => {
    expect(analyzeExpression("$eval('[')")).toEqual({ accesses: [] });
  });

  it.each(["price.$formatNumber('#.00')", "price.$power(2)"])("tracks the implicit numeric input for %s", (expression) => {
    expect(analyzeExpression(expression)).toEqual({ accesses: [
      { path: "price", confidence: "static", coverage: "exact" },
    ] });
  });

  it("preserves both reads in an apply whose right-hand path is not a function", () => {
    expect(analyzeExpression("items ~> other.path")).toEqual({ accesses: [
      { path: "items", confidence: "static", coverage: "exact" },
      { path: "other.path", confidence: "static", coverage: "exact" },
    ] });
  });

  it("follows a callable-selection thunk and retains preceding block reads", () => {
    const node = {
      type: "lambda" as const, arguments: [], thunk: true,
      body: { type: "block" as const, expressions: [
        { type: "name" as const, value: "sideEffectInput", position: 0 },
        { type: "variable" as const, value: "callback", position: 0 },
      ] },
    };
    expect(walkerRuntime().functions.walkCallableSelection(node, createScope())).toEqual(["sideEffectInput"]);
  });

  it("does not expand a non-conditional procedure into conditional calls", () => {
    expect(walkerRuntime().functions.conditionalProcedureCalls({ type: "function", value: "(", position: 0, procedure: { type: "variable", value: "sum", position: 0 }, arguments: [] })).toEqual([]);
  });
});
