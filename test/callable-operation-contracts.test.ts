import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";
import { parse } from "../src/parser.js";
import { bindLambda, bindValue, createScope } from "../src/scope.js";
import type { ApplyNode, AstNode, FunctionNode, LambdaNode, PartialNode, PathNode } from "../src/types.js";
import { walkerRuntime } from "./support/walker-runtime.js";

const name = (value: string): AstNode => ({ type: "name", value, position: 0 });
const variable = (value: string): AstNode => ({ type: "variable", value, position: 0 });
const lambda: LambdaNode = { type: "lambda", position: 0, arguments: [], body: name("source") };
const partial: PartialNode = { type: "partial", value: "(", position: 0, procedure: { type: "variable", value: "callback", position: 0 }, arguments: [] };
const callNode = (expression: string): FunctionNode => parse(expression) as FunctionNode;

describe("callable resolution contracts", () => {
  it("does not mistake a path-bound lambda for a data value", () => {
    const scope = bindLambda(createScope(), "callback", lambda);
    expect(walkerRuntime().callables.resolveCallableValues({ type: "path", steps: [variable("callback")] }, scope).map(value => value.kind)).toEqual(["lambda"]);
  });

  it("ignores scalar extension metadata when collecting procedure variables", () => {
    const node = { ...callNode("$callback(source)"), extensions: [null, 1, "metadata"] };
    expect(walkerRuntime().callables.callableProcedureVariableNames(node)).toEqual(new Set(["callback"]));
  });

  it("does not invent callable elements beyond a bound array's length", () => {
    const scope = bindValue(createScope(), "callbacks", parse("[function(){source},$sum]"));
    const selector: AstNode = { ...variable("callbacks"), predicate: [{ type: "filter", expr: { type: "number", value: 9, position: 0 } }] };
    const runtime = walkerRuntime();
    expect(runtime.callables.resolveCallableValues(selector, scope)).toEqual([]);
    expect(runtime.callables.resolveBuiltinCallableNames(selector, scope)).toEqual([]);
  });

  it("does not invent callable elements beyond a directly selected array's length", () => {
    const array: AstNode = { type: "array", expressions: [lambda], predicate: [{ type: "filter", expr: { type: "number", value: 9, position: 0 } }] };
    const runtime = walkerRuntime();
    expect(runtime.callables.resolveCallableValues({ type: "path", steps: [array] }, createScope())).toEqual([]);
    expect(runtime.callables.resolveCallableValues({ type: "path", steps: [{ type: "array", expressions: [lambda] }] }, createScope()).map(value => value.kind)).toEqual(["lambda"]);
  });

  it("resolves custom result callables without a further selector", () => {
    const runtime = walkerRuntime();
    expect(runtime.callables.customFunctionResultCallableValues(callNode('(function(){function(){source}})()'), createScope()).map(value => value.kind)).toEqual(["lambda"]);
    expect(runtime.callables.customFunctionResultBuiltinCallableNames(callNode('(function(){$sum})()'), createScope())).toEqual(["sum"]);
  });

  it("selects a builtin nested under a grouping key", () => {
    const node = parse('items{"chosen":{"value":$sum}}') as PathNode;
    expect(walkerRuntime().callables.groupedPathBuiltinCallableNames(node, createScope(), [name("chosen"), name("value")])).toEqual(["sum"]);
  });

  it.each([
    { expression: 'flag?function(){source}:$sum', kinds: ["lambda"], names: ["sum"] },
    { expression: '$reverse([function(){source},$sum])', kinds: ["lambda"], names: ["sum"] },
    { expression: "$eval('[')", kinds: [], names: [] },
  ])("resolves an unselected path source: $expression", ({ expression, kinds, names }) => {
    const node: PathNode = { type: "path", steps: [parse(expression)] };
    const runtime = walkerRuntime();
    expect(runtime.callables.resolveCallableValues(node, createScope()).map(value => value.kind)).toEqual(kinds);
    expect(runtime.callables.resolveBuiltinCallableNames(node, createScope())).toEqual(names);
  });

  it("resolves an applied producer as an unselected callable path source", () => {
    const pipeline: ApplyNode = { type: "apply", value: "~>", position: 0, lhs: { type: "array", expressions: [lambda] }, rhs: callNode("$reverse()") };
    const runtime = walkerRuntime();
    expect(runtime.callables.resolveCallableValues({ type: "path", steps: [pipeline] }, createScope()).map(value => value.kind)).toEqual(["lambda"]);
    const invalid: ApplyNode = { ...pipeline, rhs: name("invalid") };
    expect(runtime.callables.resolveCallableValues({ type: "path", steps: [invalid] }, createScope())).toEqual([]);
    expect(runtime.callables.resolveBuiltinCallableNames(invalid, createScope())).toEqual([]);
  });

  it("does not treat a returned transform as a returned builtin", () => {
    const node: FunctionNode = { ...callNode("$callback()"), procedure: { type: "block", position: 0, expressions: [parse('|$|{}|')] } };
    expect(walkerRuntime().callables.resolveBuiltinCallableNames(node, createScope())).toEqual([]);
  });
  it("resolves the name behind nested partial procedures and respects the recursion limit", () => {
    const callable = { kind: "partial" as const, binding: { partial: { ...partial, procedure: partial }, scope: createScope() } };
    const callables = walkerRuntime().callables;
    expect(callables.resolvedCallableNames(callable)).toEqual(["callback"]);
    expect(callables.resolvedCallableNames(callable, 8)).toEqual([]);
  });

  it("preserves input dependencies through nested function composition", () => {
    expect(analyzeExpression("($f := ($uppercase ~> $trim) ~> $lowercase; $f(source))")).toEqual({ accesses: [
      { path: "source", confidence: "static", coverage: "exact" },
    ] });
  });

  it("builds a callable for composition whose left operand is another composition", () => {
    const apply = (lhs: AstNode, rhs: AstNode): ApplyNode => ({ type: "apply", value: "~>", position: 0, lhs, rhs });
    const scope = createScope();
    const runtime = walkerRuntime();
    const composed = runtime.callables.compositionLambda(apply(apply(variable("uppercase"), variable("trim")), variable("lowercase")), scope);
    expect(composed).not.toBeNull();
    expect(runtime.higherOrder.walkCustomFunctionCall({ lambda: composed!, scope }, [parse("source")], scope)).toContain("source");
  });

  it.each([
    { expression: "items{'chosen':$sum}", expected: ["sum"] },
    { expression: "items.($sum)", expected: ["sum"] },
    { expression: "items#$index.($sum)", expected: ["sum"] },
    { expression: "$lookup($sum,key)", expected: ["sum"] },
    { expression: '$lookup({"selected":$sum},key)', expected: ["sum"] },
    { expression: "$lookup({'value':1},key)", expected: [] },
    { expression: "$lookup(flag?1:2,key)", expected: [] },
    { expression: "$lookup(flag?1,key)", expected: [] },
  ])("resolves builtin container contracts for %s", ({ expression, expected }) => {
    expect(walkerRuntime().callables.resolveBuiltinCallableNames(parse(expression), createScope())).toEqual(expected);
  });

  it("retains a directly supplied lambda during dynamic lookup resolution", () => {
    const values = walkerRuntime().callables.resolveCallableValues(callNode("$lookup(function(){source},key)"), createScope());
    expect(values.map(value => value.kind)).toEqual(["lambda"]);
  });

  it("does not resolve an application with no callable right operand", () => {
    const node: ApplyNode = { type: "apply", value: "~>", position: 0, lhs: name("source"), rhs: name("invalid") };
    expect(walkerRuntime().callables.resolveCallableValues(node, createScope())).toEqual([]);
  });

  it("finds callable producer inputs after an empty grouped container is unwrapped", () => {
    const runtime = walkerRuntime();
    const makeLookup = (expression: string): FunctionNode => ({ ...callNode("$lookup()"), arguments: [{ type: "block", position: 0, group: { type: "group", entries: [] }, expressions: [parse("1"), parse(expression)] }, name("key")] });
    const values = runtime.callables.resolveCallableValues(makeLookup("$reverse([function(){source}])"), createScope());
    expect(values.map(value => value.kind)).toEqual(["lambda"]);
    expect(runtime.callables.resolveBuiltinCallableNames(makeLookup("$reverse([$sum])"), createScope())).toEqual(["sum"]);
  });

  it("resolves builtin values from a pipeline used as a path source", () => {
    const pipeline: ApplyNode = { type: "apply", value: "~>", position: 0, lhs: parse("[$sum]"), rhs: callNode("$reverse()") };
    const runtime = walkerRuntime();
    expect(runtime.callables.resolveBuiltinCallableNames({ type: "path", steps: [pipeline] }, createScope())).toEqual(["sum"]);
    expect(runtime.callables.resolveBuiltinCallableNames({ type: "path", steps: [pipeline, name("missing")] }, createScope())).toEqual([]);
    expect(runtime.callables.resolveBuiltinCallableNames({ type: "path", steps: [{ ...pipeline, rhs: name("invalid") }] }, createScope())).toEqual([]);
  });

  it("stops unwrapping excessively nested callable containers", () => {
    let container: AstNode = { type: "object", entries: [[{ type: "string", value: "chosen", position: 0 }, lambda]] };
    for (let i = 0; i < 18; i++) container = { type: "block", position: 0, expressions: [container] };
    const runtime = walkerRuntime();
    const selection: PathNode = { type: "path", steps: [container, name("chosen")] };
    expect(runtime.callables.resolveCallableValues(selection, createScope())).toEqual([]);
    expect(runtime.callables.resolveBuiltinCallableNames(selection, createScope())).toEqual([]);
  });

  it("resolves a callable returned by a partially applied higher-order callback", () => {
    const scope = createScope();
    const runtime = walkerRuntime();
    const values = runtime.callables.higherOrderResultCallableValues(callNode("$map(items,(function($item){function($value){$value.price}})(?))"), scope);
    expect(values).toHaveLength(1);
    expect(values[0].kind).toBe("lambda");
    if (values[0].kind !== "lambda") throw new Error("Expected a returned lambda");
    expect(runtime.higherOrder.walkCustomFunctionCall(values[0].binding, [parse("source")], scope)).toEqual(["source", "source.price"]);
  });

  it.each([
    { label: "empty block", node: { type: "block", position: 0, expressions: [] } },
    { label: "empty path", node: { type: "path", steps: [] } },
  ])("does not invent callable values from an $label", ({ node }) => {
    const callables = walkerRuntime().callables;
    expect(callables.resolveCallableValues(node as AstNode, createScope())).toEqual([]);
    expect(callables.resolveBuiltinCallableNames(node as AstNode, createScope())).toEqual([]);
  });

  it.each([
    { label: "invalid static eval", expression: "$eval('[')" },
    { label: "lookup without an object", expression: "$lookup()" },
    { label: "lookup of an empty object", expression: "$lookup({}, key)" },
    { label: "lookup of a non-callable object value", expression: '$lookup({"value":1}, key)' },
    { label: "lookup of a conditional object", expression: "$lookup(flag ? {} : {}, key)" },
    { label: "lookup of a one-sided conditional object", expression: "$lookup(flag ? {}, key)" },
    { label: "lookup of a constructed object", expression: "$lookup($merge([{},{}]), key)" },
    { label: "lookup of a custom result", expression: "$lookup((function(){ {} })(), key)" },
    { label: "lookup of a grouped object", expression: "$lookup(items{'group':{}}, key)" },
  ])("does not invent callbacks for $label", ({ expression }) => {
    const callables = walkerRuntime().callables;
    expect(callables.resolveCallableValues(parse(expression), createScope())).toEqual([]);
    expect(callables.resolveBuiltinCallableNames(parse(expression), createScope())).toEqual([]);
  });

  it("does not select a callable from a different grouping key", () => {
    const scope = createScope();
    const path: PathNode = { type: "path", steps: [name("items")], group: { type: "group", entries: [[{ type: "string", value: "chosen", position: 0 }, lambda]] } };
    expect(walkerRuntime().callables.groupedPathCallableValues(path, scope, [name("other")])).toEqual([]);
  });

  it("does not select a builtin from a different grouping key", () => {
    const path: PathNode = { type: "path", steps: [name("items")], group: { type: "group", entries: [[{ type: "string", value: "chosen", position: 0 }, variable("sum")]] } };
    expect(walkerRuntime().callables.groupedPathBuiltinCallableNames(path, createScope(), [name("other")])).toEqual([]);
  });

  it("resolves builtins stored in a grouped non-path node", () => {
    const node: AstNode = { type: "number", value: 1, position: 0, group: { type: "group", entries: [[{ type: "string", value: "chosen", position: 0 }, variable("sum")]] } };
    expect(walkerRuntime().callables.resolveBuiltinCallableNames(node, createScope())).toEqual(["sum"]);
    expect(walkerRuntime().callables.resolveBuiltinCallableNames({ type: "path", steps: [node, name("chosen")] }, createScope())).toEqual(["sum"]);
  });

  it("resolves lambdas stored in a grouped non-path node", () => {
    const node: AstNode = { type: "number", value: 1, position: 0, group: { type: "group", entries: [[{ type: "string", value: "chosen", position: 0 }, lambda]] } };
    const results = walkerRuntime().callables.resolveCallableValues({ type: "path", steps: [node, name("chosen")] }, createScope());
    expect(results.map(value => value.kind === "lambda" ? value.binding.lambda : null)).toEqual([lambda]);
  });
});
