import { describe, expect, it } from "vitest";
import { parse } from "../src/parser.js";
import { bindVariable, createScope } from "../src/scope.js";
import type { AstNode, FunctionNode, LambdaNode, PartialNode, VariableNode } from "../src/types.js";
import { ROOT_PATH } from "../src/walker/constants.js";
import { walkerRuntime } from "./support/walker-runtime.js";

const variable = (value: string): VariableNode => ({ type: "variable", value, position: 0 });
const index = { type: "position-binding" as const, name: "index", position: 0 };
const group = { type: "group" as const, entries: [[parse('"key"'), parse("$$.settings")]] as [AstNode, AstNode][] };

describe("optional AST metadata boundaries", () => {
  it("accepts callable AST nodes without optional predicate metadata", () => {
    const runtime = walkerRuntime();
    const partial: PartialNode = { type: "partial", value: "(", position: 0, procedure: variable("sum"), arguments: [] };
    const lambda: LambdaNode = { type: "lambda", position: 0, arguments: [], body: parse("unused") };
    expect(runtime.functions.walkPartial(partial, createScope())).toEqual([]);
    expect(runtime.functions.walkLambda(lambda, createScope())).toEqual([]);
    expect(runtime.functions.walkCallableSelection({ type: "transform", pattern: variable("$"), update: parse("{}") }, createScope())).toEqual([]);
  });
  it.each([
    { type: "block", position: 0, expressions: [parse('{"copy":source}')], predicate: [index] },
    { type: "array", expressions: [parse('{"copy":source}')], predicate: [index] },
  ])("ignores non-filter predicate metadata on an alias-producing $type", (node) => {
    expect(walkerRuntime().core.walkNode(node as AstNode, createScope())).toEqual(["source"]);
  });

  it("retains grouping reads through an array of constructed objects", () => {
    const node: AstNode = { type: "array", expressions: [parse('{"copy":source}')], group };
    expect(walkerRuntime().core.walkNode(node, createScope())).toEqual(["source", `${ROOT_PATH}.settings`]);
  });

  it("does not invent reads for an incomplete negation", () => {
    expect(walkerRuntime().core.walkNode({ type: "negate" } as AstNode, createScope())).toEqual([]);
  });

  it("does not emit an identity binding as a separate array read", () => {
    const node: AstNode = { type: "array", expressions: [parse("$copy := $"), parse("$copy.price")] };
    expect(walkerRuntime().core.walkNode(node, createScope())).toEqual([`${ROOT_PATH}.price`]);
  });

  it("handles empty and non-binding block prefixes when checking context defaults", () => {
    const functions = walkerRuntime().functions;
    expect(functions.resultUsesContextDefault({ type: "path", steps: [] }, createScope())).toBe(false);
    expect(functions.resultUsesContextDefault(parse('(1;$uppercase())'), createScope())).toBe(true);
  });

  it.each(["partial", "lambda", "transform", "block"])("retains explicit root grouping reads on a %s callable", (type) => {
    const nodes: Record<string, AstNode> = {
      partial: { ...parse("$sum(?)"), predicate: [index], group },
      lambda: { ...parse("function(){unused}"), predicate: [index], group },
      transform: { ...parse('|$|{"copy":unused}|'), predicate: [index], group },
      block: { ...parse('(1;$sum)'), predicate: [index], group },
    };
    const runtime = walkerRuntime();
    const paths = type === "partial"
      ? runtime.functions.walkPartial(nodes[type] as PartialNode, createScope())
      : type === "lambda"
        ? runtime.functions.walkLambda(nodes[type] as LambdaNode, createScope())
        : runtime.functions.walkCallableSelection(nodes[type], createScope());
    expect(paths).toEqual([`${ROOT_PATH}.settings`]);
  });

  it("skips invalid conditional procedure branches but retains the condition read", () => {
    const partial = parse("$sum(?)") as PartialNode;
    const procedure = parse("flag ? 1 : 2") as FunctionNode["procedure"];
    const functions = walkerRuntime().functions;
    expect(functions.walkPartial({ ...partial, procedure }, createScope())).toEqual(["flag"]);
    expect(functions.conditionalProcedureCalls({ type: "function", value: "(", position: 0, procedure, arguments: [] })).toEqual([]);
    expect(functions.walkCallableSelection(parse("flag ? $sum"), createScope())).toEqual(["flag"]);
  });

  it("does not treat an unresolved procedure block as a callable selection", () => {
    const partial = parse("$sum(?)") as PartialNode;
    expect(walkerRuntime().functions.walkPartial({ ...partial, procedure: parse('(1;2)') as FunctionNode["procedure"] }, createScope())).toEqual([]);
  });

  it("ignores non-filter metadata on a source-less variable", () => {
    const scope = bindVariable(createScope(), "value", []);
    expect(walkerRuntime().functions.walkVariable({ ...variable("value"), predicate: [index] }, scope)).toEqual([]);
  });

  it("keeps a function result's positional binding out of its source dependencies", () => {
    const node = { ...parse('(function(){{"copy":source}})()'), indexBinding: index, predicate: [index, { type: "filter", expr: variable("index") }] } as FunctionNode;
    expect(walkerRuntime().functions.walkFunction(node, createScope())).toEqual(["source"]);
  });

  it("does not invoke a transform supplied in a matcher callback position", () => {
    expect(walkerRuntime().core.walkNode(parse('$contains(text, |$|{"copy":unused}|)'), createScope())).toEqual(["text"]);
  });
});
