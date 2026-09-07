import { describe, expect, it } from "vitest";
import { parse } from "../src/parser.js";
import { bindLambda, bindPartial, bindTransform, bindValue, bindVariable, createScope } from "../src/scope.js";
import type { AstNode, FunctionNode, LambdaNode, TransformNode, VariableNode } from "../src/types.js";
import { walkerRuntime } from "./support/walker-runtime.js";

const name = (value: string): AstNode => ({ type: "name", value, position: 0 });
const variable = (value: string): VariableNode => ({ type: "variable", value, position: 0 });
const call = (procedure: FunctionNode["procedure"], args: AstNode[] = []): FunctionNode => ({ type: "function", value: "(", position: 0, procedure, arguments: args });
const identity: LambdaNode = { type: "lambda", position: 0, arguments: [variable("x")], body: variable("x") };
const selectValue: LambdaNode = { ...identity, body: parse("$x.value") };
const identityTransform: TransformNode = { type: "transform", pattern: variable("$"), update: { type: "object", position: 0, entries: [] } };

describe("function result contracts", () => {
  it.each(["inline", "named", "container", "partial"])("does not invent transform result aliases without input through an %s procedure", (kind) => {
    const root = createScope();
    const scope = kind === "partial"
      ? bindPartial(root, "operation", { type: "partial", value: "(", position: 0, procedure: identityTransform, arguments: [] })
      : bindTransform(root, "operation", identityTransform);
    const procedure = kind === "inline" ? identityTransform
      : kind === "container" ? { type: "block" as const, position: 0, expressions: [identityTransform] }
      : variable("operation");
    const node = call(procedure);
    const results = walkerRuntime().results;
    expect(results.getFunctionResultObjectAlias(node, scope)).toBeNull();
    expect(results.getFunctionResultDynamicObjectAlias(node, scope)).toBeNull();
    expect(results.getFunctionResultBasePaths(node, scope)).toEqual([]);
    expect(results.getFunctionResultSuffixBasePaths(node, scope)).toEqual([]);
  });

  it("leaves missing lambda parameters without result dependencies", () => {
    const results = walkerRuntime().results;
    const node = call(selectValue);
    expect(results.getFunctionResultObjectAlias(node, createScope())).toBeNull();
    expect(results.getFunctionResultDynamicObjectAlias(node, createScope())).toBeNull();
    expect(results.getFunctionResultBasePaths(node, createScope())).toEqual([]);
    expect(results.getFunctionResultSuffixBasePaths(node, createScope())).toEqual([]);
  });

  it("preserves input suffix bases for a grouped named transform", () => {
    const scope = bindTransform(createScope(), "operation", identityTransform);
    const procedure = { ...variable("operation"), group: { type: "group" as const, entries: [] } };
    expect(walkerRuntime().results.getFunctionResultSuffixBasePaths(call(procedure, [parse("source")]), scope)).toEqual(["source"]);
  });

  it.each(["$map(items,$sum)", "$reduce(items,$sum,0)"])("does not treat non-path-preserving builtin callback results as source bases: %s", (expression) => {
    const node = parse(expression) as FunctionNode;
    const results = walkerRuntime().results;
    expect(results.getFunctionResultBasePaths(node, createScope())).toEqual([]);
    expect(results.getFunctionResultSuffixBasePaths(node, createScope())).toEqual([]);
  });

  it("preserves plain data input suffix bases through a path-preserving callback", () => {
    expect(walkerRuntime().results.getFunctionResultSuffixBasePaths(parse("$map(items,$reverse)"), createScope())).toEqual(["items"]);
  });

  it("keeps a one-sided conditional result's source suffixes", () => {
    const results = walkerRuntime().results;
    expect(results.getResultSuffixBasePaths(parse("flag?source"), createScope())).toEqual(["source"]);
    expect(results.getFunctionResultSuffixBasePaths(parse('$lookup(flag?{"copy":source},"copy")'), createScope())).toEqual(["source"]);
  });

  it("flattens nested arrays when collecting result base paths", () => {
    const results = walkerRuntime().results;
    expect(results.getSuffixableResultBasePaths(parse("[source,other]"), createScope())).toEqual(["source", "other"]);
    expect(results.getResultBasePathsFromArg(parse("[[source],other]"), createScope())).toEqual(["source", "other"]);
    expect(results.getSuffixableResultBasePaths(name("source"), createScope())).toEqual(["source"]);
  });

  it("conservatively retains input bases for an apply with an unresolved right operand", () => {
    expect(walkerRuntime().results.getResultBasePathsFromArg({ type: "apply", value: "~>", position: 0, lhs: parse("source"), rhs: name("invalid") }, createScope())).toEqual(["source"]);
  });

  it("handles a reduce callback in the data position without inventing suffix bases", () => {
    expect(walkerRuntime().results.getFunctionResultSuffixBasePaths(parse("$reduce(function($value){$value.price})"), createScope())).toEqual([]);
  });
  it("resolves suffix bases from a named partial whose procedure is an inline lambda", () => {
    const scope = bindPartial(createScope(), "operation", { type: "partial", value: "(", position: 0, procedure: selectValue, arguments: [] });
    expect(walkerRuntime().results.getFunctionResultSuffixBasePaths(call(variable("operation"), [parse("source")]), scope)).toEqual(["source.value"]);
  });

  it("ignores surplus reduce parameters when resolving dynamic results and suffix bases", () => {
    const runtime = walkerRuntime();
    const node = parse('$reduce(items,function($acc,$value,$index,$array,$extra){{(key):$value.price}}, {})') as FunctionNode;
    const alias = runtime.results.getFunctionResultDynamicObjectAlias(node, createScope());
    expect(alias).not.toBeNull();
    expect(runtime.aliases.selectLookupDynamicObjectAliasPaths(alias!, [name("amount")])).toEqual(["items.price.amount"]);
    const pathResult = parse('$reduce(items,function($acc,$value,$index,$array,$extra){$value.price}, {})') as FunctionNode;
    expect(runtime.results.getFunctionResultSuffixBasePaths(pathResult, createScope())).toEqual(["items.price"]);
  });
  it.each(["lookup", "each", "sift", "reduce"])("does not invent result aliases for $%s without input", (fn) => {
    const results = walkerRuntime().results;
    const node = call(variable(fn));
    expect(results.getFunctionResultObjectAlias(node, createScope())).toBeNull();
    expect(results.getFunctionResultDynamicObjectAlias(node, createScope())).toBeNull();
    expect(results.getFunctionResultSuffixBasePaths(node, createScope())).toEqual([]);
  });

  it.each([{ args: [] }, { args: [parse("source")] }])("keeps transform result suffixes tied to supplied inputs: $args", ({ args }) => {
    const result = walkerRuntime().results.getFunctionResultSuffixBasePaths(call(identityTransform, args), createScope());
    expect(result).toEqual(args.length ? ["source"] : []);
  });

  it("unions suffix bases from conditional callable branches", () => {
    const procedure = { type: "condition" as const, position: 0, condition: name("flag"), then: selectValue, else: identityTransform };
    expect(walkerRuntime().results.getFunctionResultSuffixBasePaths(call(procedure, [parse("source")]), createScope())).toEqual(["source.value", "source"]);
  });

  it.each([
    { label: "lambda", node: selectValue, expected: "source.value" },
    { label: "transform", node: identityTransform, expected: "source" },
  ])("preserves suffix bases for a $label selected from a callable container", ({ node, expected }) => {
    const container = { type: "block" as const, position: 0, expressions: [node] };
    expect(walkerRuntime().results.getFunctionResultSuffixBasePaths(call(container, [parse("source")]), createScope())).toEqual([expected]);
  });

  it("preserves suffix bases for a stored builtin function alias", () => {
    const scope = bindValue(createScope(), "operation", variable("reverse"));
    expect(walkerRuntime().results.getFunctionResultSuffixBasePaths(call(variable("operation"), [parse("source")]), scope)).toEqual(["source"]);
  });

  it("does not infer suffixable results through an opaque function", () => {
    expect(walkerRuntime(["operation"]).results.getFunctionResultSuffixBasePaths(call(variable("operation"), [name("source")]), createScope())).toEqual([]);
  });

  it("uses captured context for a defaulted lambda result", () => {
    const contextIdentity = { ...selectValue, signature: { definition: "<a-:a>" } };
    const scope = bindVariable(createScope(), "", ["source"]);
    expect(walkerRuntime().results.getFunctionResultSuffixBasePaths(call(contextIdentity), scope)).toEqual(["source.value"]);
  });

  it("preserves a local lambda result when a grouped procedure has no callable entries", () => {
    const scope = bindLambda(createScope(), "operation", identity);
    const proc = { ...variable("operation"), group: { type: "group" as const, entries: [] } };
    const object = parse('{"copy":source}');
    const results = walkerRuntime().results;
    expect(results.getFunctionResultObjectAlias(call(proc, [object]), scope)).toEqual(new Map([["copy", ["source"]]]));
    expect(results.getFunctionResultBasePaths(call(proc, [name("source")]), scope)).toEqual(["source"]);
    const dynamic = parse('{(key):source}');
    const alias = results.getFunctionResultDynamicObjectAlias(call(proc, [dynamic]), scope);
    expect(alias).not.toBeNull();
    expect(walkerRuntime().aliases.selectLookupDynamicObjectAliasPaths(alias!, [name("price")])).toEqual(["source.price"]);
  });

  it("preserves a local transform result when a grouped procedure has no callable entries", () => {
    const scope = bindTransform(createScope(), "operation", identityTransform);
    const proc = { ...variable("operation"), group: { type: "group" as const, entries: [] } };
    const results = walkerRuntime().results;
    expect(results.getFunctionResultObjectAlias(call(proc, [parse('{"copy":source}')]), scope)).toEqual(new Map([["copy", ["source"]]]));
    expect(results.getFunctionResultBasePaths(call(proc, [name("source")]), scope)).toEqual(["source"]);
    expect(results.getFunctionResultObjectAlias(call(proc), scope)).toBeNull();
    expect(results.getFunctionResultBasePaths(call(proc), scope)).toEqual([]);
    expect(results.getFunctionResultSuffixBasePaths(call(proc), scope)).toEqual([]);
    expect(results.getFunctionResultDynamicObjectAlias(call(proc), scope)).toBeNull();
    const alias = results.getFunctionResultDynamicObjectAlias(call(proc, [parse('{(key):source}')]), scope);
    expect(alias).not.toBeNull();
    expect(walkerRuntime().aliases.selectLookupDynamicObjectAliasPaths(alias!, [name("price")])).toEqual(["source.price"]);
  });

  it.each([
    { expression: '$lookup([{"copy":source}], "copy")', expected: ["source"] },
    { expression: '$lookup((1; {"copy":source}), "copy")', expected: ["source"] },
    { expression: '$lookup({"copy":source,"other":ignored}, "copy")', expected: ["source"] },
  ])("selects only the matching source values for %s", ({ expression, expected }) => {
    expect(walkerRuntime().results.getFunctionResultSuffixBasePaths(parse(expression) as FunctionNode, createScope())).toEqual(expected);
  });

  it("does not infer lookup result bases without an object argument", () => {
    expect(walkerRuntime().results.getLookupResultBasePaths([], createScope())).toEqual([]);
  });
});
