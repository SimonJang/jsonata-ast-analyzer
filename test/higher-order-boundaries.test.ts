import { describe, expect, it } from "vitest";
import { parse } from "../src/parser.js";
import { bindLambda, bindObjectAlias, bindValue, createScope, resolveVariable, resolveObjectAlias } from "../src/scope.js";
import type { AstNode, FunctionNode, LambdaNode, PartialNode, VariableNode } from "../src/types.js";
import { walkerRuntime } from "./support/walker-runtime.js";
import { ROOT_PATH } from "../src/walker/constants.js";

const variable = (value: string): VariableNode => ({ type: "variable", value, position: 0 });
const fn = (expression: string): FunctionNode => parse(expression) as FunctionNode;

describe("higher-order fallback boundaries", () => {
  it("recognizes a lambda behind nested partial applications", () => {
    const inner = parse("(function($x){$x.price})(?)") as PartialNode;
    const outer: PartialNode = { ...inner, procedure: inner };
    expect(walkerRuntime().higherOrder.partialCanInvokeLambda({ partial: outer, scope: createScope() })).toBe(true);
  });
  it("terminates wildcard detection after a value resolves to an unknown variable", () => {
    const scope = bindValue(createScope(), "known", variable("missing"));
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataPaths("each", variable("known"), scope)).toEqual([]);
  });

  it("does not infer wildcard value reads from an invalid eval in a container", () => {
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataPaths("each", parse("(1;$eval('['))"), createScope())).toEqual([]);
  });

  it("keeps explicitly constructed multiple callback values distinct", () => {
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataPaths("each", parse("[source,other]"), createScope())).toEqual(["source.*", "other.*"]);
  });

  it("does not add wildcard reads to an explicitly selected callback value", () => {
    const runtime = walkerRuntime();
    expect(runtime.higherOrder.higherOrderCallbackDataPaths("each", parse("[source,other][0]"), createScope())).toEqual(["source"]);
    expect(runtime.higherOrder.higherOrderCallbackDataPaths("each", parse("[{}][0]"), createScope())).toEqual([]);
  });

  it("ignores scalar extension metadata while inspecting named callback recursion", () => {
    const lambda = { ...parse("function(){source}") as LambdaNode, body: { ...parse("source"), extensions: [null, 1] } };
    const scope = createScope();
    expect(walkerRuntime().higherOrder.walkCustomFunctionCall({ lambda, scope, name: "callback" }, [], scope)).toEqual(["source"]);
    const body: FunctionNode = { type: "function", value: "(", position: 0, procedure: parse("function(){1}") as LambdaNode, arguments: [] };
    const graphScope = bindLambda(scope, "outer", { ...lambda, body: { ...body, extensions: [null, 1] } });
    expect(walkerRuntime().higherOrder.lambdaCallGraphReaches("outer", "missing", graphScope, new Set())).toBe(false);
  });

  it("has no partially applied callback invocations without collection data", () => {
    const scope = createScope();
    const partial = parse("(function($x){$x.price})(?)") as PartialNode;
    expect(walkerRuntime().higherOrder.higherOrderPartialLambdaCalls("map", { index: 1, bindings: [], partials: [{ partial, scope }] }, undefined, scope)).toEqual([]);
  });

  it("ignores an optional signature marker that does not request a context default", () => {
    const lambda = { ...parse("function($x){$x}") as LambdaNode, signature: { definition: "<s?:s>" } };
    expect(walkerRuntime().higherOrder.contextDefaultParameterIndex(lambda)).toBe(-1);
  });

  it("does not resolve transforms through the lambda-only invocation API", () => {
    expect(walkerRuntime().higherOrder.resolveLambdaFunctionCalls(parse('|$|{}|') as FunctionNode["procedure"], [parse("source")], createScope())).toEqual([]);
    const partial: PartialNode = { type: "partial", value: "(", position: 0, procedure: parse('|$|{}|') as FunctionNode["procedure"], arguments: [] };
    expect(walkerRuntime().higherOrder.partialCanInvokeLambda({ partial, scope: createScope() })).toBe(false);
  });
  it("preserves argument reads when semantic walking receives an unnamed procedure", () => {
    const node = { ...fn("$map(items,function($value){$value.price})"), procedure: parse("function(){1}") as LambdaNode };
    expect(walkerRuntime().higherOrder.walkHigherOrderCall(node, { 0: "element" }, createScope())).toEqual(["items", "items.price"]);
  });

  it.each(["each", "sift"])("walks an implicit-root transform callback supplied to $%s", (name) => {
    expect([...new Set(walkerRuntime().higherOrder.walkHigherOrderCall(fn(`$${name}(|$|{"copy":price}|)`), { 0: "value" }, createScope()))]).toEqual(["*", "*.price"]);
  });

  it("preserves closure reads from an implicit-root partial each callback", () => {
    const node = fn('$each((function($value){source})(?))');
    expect([...new Set(walkerRuntime().higherOrder.walkHigherOrderCall(node, { 0: "value" }, createScope()))]).toEqual(["*", "source"]);
  });

  it("has no callback base paths without data or implicit context", () => {
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataPaths("map", undefined, createScope())).toEqual([]);
  });

  it.each([
    { label: "unresolved variable", expression: "$missing" },
    { label: "invalid static eval", expression: "$eval('[')" },
  ])("retains unresolved each input structure for an $label", ({ expression }) => {
    const node = parse(expression);
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("each", node, createScope())).toEqual([node]);
  });

  it("declines a numeric callback-data selection outside the array", () => {
    const node: AstNode = { type: "array", expressions: [parse("source")], predicate: [{ type: "filter", expr: { type: "number", value: 9, position: 0 } }] };
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("map", node, createScope())).toEqual([parse("source")]);
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("map", { type: "array", expressions: [parse("source")] }, createScope())).toEqual([parse("source")]);
  });

  it("keeps only matching constructed container keys for each", () => {
    const node = parse('({"container":{"copy":source},"other":ignored}).container');
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("each", node, createScope())).toMatchObject([{ type: "path", steps: [{ type: "name", value: "source" }] }]);
  });

  it("retains an apply input whose right operand is not callable", () => {
    const node: AstNode = { type: "apply", value: "~>", position: 0, lhs: parse("source"), rhs: parse("invalid") };
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("each", node, createScope())).toEqual([node]);
  });

  it("finds each data in an inline lambda result", () => {
    const node: FunctionNode = { ...fn("$operation()"), procedure: parse('function(){{"copy":source}}') as LambdaNode };
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("each", node, createScope())).toMatchObject([{ type: "path", steps: [{ type: "name", value: "source" }] }]);
  });

  it.each([
    { selector: '"copy"', values: ["source"] },
    { selector: "key", values: ["source", "other"] },
  ])("selects each data through a bound object lookup with $selector", ({ selector, values }) => {
    const scope = bindValue(createScope(), "object", parse('{"copy":source,"other":other}'));
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("each", fn(`$lookup($object,${selector})`), scope)).toMatchObject(values.map(value => ({ type: "path", steps: [{ type: "name", value }] })));
  });

  it("retains a lookup of unknown data and an unresolved path container", () => {
    const runtime = walkerRuntime();
    for (const node of [parse("$lookup(source,key)"), parse("$missing.container")]) {
      expect(runtime.higherOrder.higherOrderCallbackDataNodes("each", node, createScope())).toEqual([node]);
    }
  });

  it("does not classify a transform as a lambda callback", () => {
    expect(walkerRuntime().higherOrder.findResolvedHigherOrderLambdaCallbacks([parse("source"), parse('|$|{}|')], createScope())).toBeNull();
  });

  it("ignores a default marker hidden inside a nested signature type", () => {
    const lambda = { ...parse("function($x){$x}") as LambdaNode, signature: { definition: "<a<s->:a>" } };
    expect(walkerRuntime().higherOrder.contextDefaultParameterIndex(lambda)).toBe(-1);
  });

  it("defaults omitted per-argument scopes to the caller", () => {
    const scope = createScope();
    const lambda = parse("function($x){$x.price}") as LambdaNode;
    const runtime = walkerRuntime();
    expect(runtime.higherOrder.walkCustomFunctionCall({ lambda, scope }, [parse("source")], scope, true, [])).toEqual(["source", "source.price"]);
    const scoped = runtime.higherOrder.scopePartialArguments([parse("source")], [], scope);
    expect(scoped.arguments).toEqual([parse("source")]);
    expect(scoped.scope.parent).toBe(scope);
  });

  it("does not assign a caller scope to an unfilled partial placeholder", () => {
    const scope = createScope();
    const partial = parse("$sum(?)") as PartialNode;
    expect(walkerRuntime().higherOrder.applyPartialArgumentScopes(partial, [], scope, scope)).toEqual([]);
  });
  it.each(["each", "sift"])("binds implicit root values for a one-argument $%s callback", (name) => {
    const paths = walkerRuntime().higherOrder.walkHigherOrderCall(fn(`$${name}(function($value){$value.price})`), { 0: "value" }, createScope());
    expect(paths).toEqual(["*", `${ROOT_PATH}.*.price`, ...(name === "sift" ? [`${ROOT_PATH}.*.price.*`] : [])]);
  });

  it("binds a non-object each parameter to value paths without copying object aliases", () => {
    const scope = createScope();
    const result = walkerRuntime().higherOrder.bindHigherOrderParameter(scope, "each", variable("item"), "element", ["source"], parse('{"copy":source}'), scope);
    expect(resolveVariable(result, "item")).toEqual(["source"]);
    expect(resolveObjectAlias(result, "item")).toBeNull();
  });

  it("terminates a same-name value chain when selecting an each container", () => {
    const scope = bindValue(createScope(), "value", variable("value"));
    const node: AstNode = { type: "path", steps: [variable("value"), { type: "name", value: "container", position: 0 }] };
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("each", node, scope)).toEqual([node]);
  });
  it("uses known object aliases when a value has no structural object AST", () => {
    const scope = bindObjectAlias(createScope(), "object", new Map([["first", ["source"]], ["second", ["other"]]]));
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataPaths("each", variable("object"), scope)).toEqual(["source", "other"]);
  });

  it.each([
    "($local := 1; {})",
    "flag ? {} : {}",
    "flag ? {}",
    "($local := {}; $local)",
  ])("does not invent input values for an empty constructed each input: %s", (expression) => {
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataPaths("each", parse(expression), createScope())).toEqual([]);
  });

  it("returns no callback data nodes when no argument is supplied", () => {
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("map", undefined, createScope())).toEqual([]);
  });

  it("stops following a variable already being resolved", () => {
    const node = variable("value");
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("map", node, createScope(), new Set(["value"]))).toEqual([node]);
  });

  it("terminates a same-name value chain with a conservative empty data-path result", () => {
    const scope = bindValue(createScope(), "value", variable("value"));
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataPaths("each", variable("value"), scope)).toEqual([]);
  });

  it("terminates static-eval detection when alias metadata accompanies an unresolved same-name value chain", () => {
    const initial = bindValue(createScope(), "value", variable("value"));
    const scope = bindObjectAlias(initial, "value", new Map([["copy", ["source"]]]));
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataPaths("each", variable("value"), scope)).toEqual([]);
  });

  it("does not flatten a non-name selector into each object values", () => {
    const node: AstNode = { type: "path", steps: [parse('{"copy":source}'), { type: "wildcard", value: "*", position: 0 }] };
    expect(walkerRuntime().higherOrder.higherOrderCallbackDataNodes("each", node, createScope())).toEqual([node]);
  });

  it.each([
    "($local := 1; {\"container\": {\"copy\":source}}).container",
    "(flag ? {\"container\": {\"copy\":source}} : {\"container\": {\"copy\":other}}).container",
    "(flag ? {\"container\": {\"copy\":source}}).container",
  ])("finds values through a constructed container: %s", (expression) => {
    const result = walkerRuntime().higherOrder.higherOrderCallbackDataNodes("each", parse(expression), createScope());
    expect(result).toMatchObject((expression.includes("other") ? ["source", "other"] : ["source"]).map(value => ({ type: "path", steps: [{ type: "name", value }] })));
  });

  it("finds a callback supplied by a named lambda binding", () => {
    const root = createScope();
    const lambda = parse("function($x){$x.price}") as LambdaNode;
    const scope = bindLambda(root, "callback", lambda);
    expect(walkerRuntime().higherOrder.findHigherOrderCallback([parse("items"), variable("callback")], scope)).toEqual({ index: 1, lambda, scope: root });
  });

  it("stops searching an already-visited function call graph", () => {
    expect(walkerRuntime().higherOrder.lambdaCallGraphReaches("first", "target", createScope(), new Set(["first"]))).toBe(false);
  });

  it("follows nested partial applications to the captured input read", () => {
    const scope = createScope();
    const partial = parse("(function($x){$x.price})(?)") as PartialNode;
    const outer: PartialNode = { ...partial, procedure: partial };
    expect(walkerRuntime().higherOrder.walkPartialCall({ partial: outer, scope }, [parse("source")], scope)).toEqual(["source", "source", "source", "source.price"]);
  });

  it("keeps callback parameters beyond known semantic roles from acquiring input dependencies", () => {
    const runtime = walkerRuntime();
    const node = fn("$map(items,function($value,$index,$array,$extra){$value.price})");
    expect(runtime.higherOrder.walkHigherOrderCall(node, { 0: "element", 1: "index", 2: "array" }, createScope())).toEqual(["items", "items.price"]);
  });
});
