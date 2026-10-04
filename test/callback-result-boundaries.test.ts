import { describe, expect, it } from "vitest";
import { analyzeExpression, extractPaths } from "../src/index.js";
import { parse } from "../src/parser.js";
import { createScope } from "../src/scope.js";
import type { FunctionNode, LambdaNode } from "../src/types.js";
import { walkerRuntime } from "./support/walker-runtime.js";

describe("callback result boundary reads", () => {
  it.each([
    { label: "static object", expression: '($f:=function($x){{"copy":$x}};$p:=$f(?);$q:=$p(?);$q(source).copy.price)', expected: ["source", "source.price"] },
    { label: "dynamic object", expression: '($f:=function($x){{(key):$x}};$p:=$f(?);$q:=$p(?);$q(source).copy.price)', expected: ["source", "source.price", "key"] },
  ])("preserves source reads through nested partials returning a $label", ({ expression, expected }) => {
    const paths = expected.map(path => ({ path, confidence: "static" }));
    expect(extractPaths(expression)).toEqual(paths);
    expect(analyzeExpression(expression).accesses.map(({ path, confidence }) => ({ path, confidence }))).toEqual(paths);
  });

  it.each([
    '$map(items,function($value,$index,$array,$extra){{"copy":$value.price,(key):$value.cost}})',
    '$reduce(items,function($acc,$value,$index,$array,$extra){{"copy":$value.price,(key):$value.cost}}, {})',
  ])("ignores surplus parameters when resolving callback result reads: %s", (expression) => {
    const paths = ["items", "items.price", "key", "items.cost"].map(path => ({ path, confidence: "static" }));
    expect(extractPaths(expression)).toEqual(paths);
    expect(analyzeExpression(expression).accesses.map(({ path, confidence }) => ({ path, confidence }))).toEqual(paths);
    // Exercise the independently consumed result-shape API too: only the static
    // output key belongs to the static object alias.
    expect(walkerRuntime().results.getFunctionResultObjectAlias(parse(expression) as FunctionNode, createScope())).toEqual(new Map([["copy", ["items.price"]]]));
  });

  it("keeps excess each callback parameters unbound while retaining the selected value", () => {
    const runtime = walkerRuntime();
    const lambda = parse("function($value,$key,$object,$extra){$value.price}") as LambdaNode;
    const scope = createScope();
    const bound = runtime.higherOrder.bindHigherOrderLambdaCallbackScope("each", { lambda, scope }, ["source"], parse("source"), scope);
    expect(runtime.core.walkNode(lambda.body, bound)).toEqual(["source.price"]);
  });
});
