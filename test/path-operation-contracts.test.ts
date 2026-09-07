import { describe, expect, it } from "vitest";
import { parse } from "../src/parser.js";
import { bindLambda, bindObjectAlias, bindVariable, createScope } from "../src/scope.js";
import type { AstNode, FunctionNode, LambdaNode, NameNode, PathNode, VariableNode } from "../src/types.js";
import { ROOT_PATH } from "../src/walker/constants.js";
import { walkerRuntime } from "./support/walker-runtime.js";

const name = (value: string): NameNode => ({ type: "name", value, position: 0 });
const variable = (value: string): VariableNode => ({ type: "variable", value, position: 0 });
const focus = { type: "context-binding" as const, name: "item", position: 0 };
const index = { type: "position-binding" as const, name: "index", position: 0 };
const filter = (expr: AstNode): AstNode => ({ type: "filter", expr });

describe("path operation context contracts", () => {
  it("retains the input context for an unresolved stored procedure", () => {
    const fn: FunctionNode = { type: "function", value: "(", position: 0, procedure: { type: "path", steps: [name("unknown")] }, arguments: [] };
    expect(walkerRuntime().paths.walkPath({ type: "path", steps: [name("items"), fn] }, createScope())).toEqual(["items"]);
  });

  it("retains alias suffix filter reads after a positional scope binding", () => {
    const literal: AstNode = { type: "number", value: 1, position: 0, indexBinding: index };
    const suffix: AstNode = { ...name("copy"), stages: [filter(name("active"))] };
    const node: PathNode = { type: "path", steps: [literal, variable("index"), parse('{"copy":source}'), suffix] };
    expect(new Set(walkerRuntime().paths.walkPath(node, createScope()))).toEqual(new Set(["source", "source.active"]));
  });

  it("uses the resolved base for suffix contexts containing an unrepresentable variable", () => {
    const suffix: AstNode[] = [variable("unknown"), { ...name("items"), stages: [filter(name("active"))] }];
    const sort: AstNode = { type: "sort", terms: [{ descending: false, expression: name("price") }] };
    const paths = walkerRuntime().paths;
    expect(paths.walkResolvedVariableSuffixFilterStages(suffix, "source", createScope(), new Set())).toEqual(["source.active"]);
    expect(paths.walkResolvedVariableSuffixSortTerms([...suffix, sort], "source", createScope(), new Set())).toEqual(["source.price"]);
  });

  it("shares focus and index scope for grouping a path object result", () => {
    const object: AstNode = { ...parse('{"copy":source}'), focusBinding: focus, indexBinding: index };
    const node: PathNode = { type: "path", steps: [object], group: { type: "group", entries: [[parse('"key"'), parse("$$.settings")]] } };
    expect(new Set(walkerRuntime().paths.walkPath(node, createScope()))).toEqual(new Set(["source", `${ROOT_PATH}.settings`]));
  });

  it("walks grouping reads on a conditional result without focus metadata", () => {
    const node: PathNode = { type: "path", steps: [parse("true?1:2")], group: { type: "group", entries: [[parse('"key"'), parse("$$.settings")]] } };
    expect(walkerRuntime().paths.walkPath(node, createScope())).toEqual([`${ROOT_PATH}.settings`]);
  });
  it("prefixes local selection reads in a block that references current context", () => {
    expect(walkerRuntime().paths.walkContextCallableSelection(parse("(price;$)"), "source", createScope())).toEqual(["source.price"]);
  });

  it("checks an inline non-defaulted lambda without inventing current-context reads", () => {
    const node: FunctionNode = { type: "function", value: "(", position: 0, procedure: parse("function(){1}") as LambdaNode, arguments: [] };
    expect(walkerRuntime().paths.walkContextExpression(node, "source", createScope())).toEqual([]);
  });

  it("accepts current and root path steps without predicate metadata", () => {
    const runtime = walkerRuntime();
    expect(runtime.paths.walkPath({ type: "path", steps: [variable(""), name("price")] }, bindVariable(createScope(), "", ["source"]))).toEqual(["source.price"]);
    expect(runtime.paths.walkPath({ type: "path", steps: [variable("$"), name("price")] }, createScope())).toEqual([`${ROOT_PATH}.price`]);
    expect(runtime.paths.walkPath({ type: "path", steps: [name("source"), variable("$")] }, createScope())).toEqual(["source", ROOT_PATH]);
  });

  it("walks a context-default lookup that terminates a path", () => {
    expect([...new Set(walkerRuntime().core.walkNode(parse('source.$lookup("copy")'), createScope()))]).toEqual(["source", "source.copy"]);
  });

  it("supports alias-only variables with focused grouping and non-filter metadata", () => {
    const scope = bindObjectAlias(createScope(), "selected", new Map([["copy", ["source"]]]));
    const first: AstNode = { ...variable("selected"), focusBinding: focus, predicate: [index], group: { type: "group", entries: [[parse('"key"'), parse("$$.settings")]] } };
    expect(new Set(walkerRuntime().paths.walkPath({ type: "path", steps: [first, name("copy")] }, scope))).toEqual(new Set(["source", `${ROOT_PATH}.settings`]));
  });

  it("shares a variable's focus scope with its position binding", () => {
    const first: AstNode = { ...variable("selected"), focusBinding: focus, indexBinding: index, predicate: [filter(variable("index"))] };
    expect(new Set(walkerRuntime().paths.walkPath({ type: "path", steps: [first, name("price")] }, bindVariable(createScope(), "selected", ["source"])))).toEqual(new Set(["source.price"]));
  });

  it("does not invent a projection from a focused variable into a constant block", () => {
    const first = { ...variable("selected"), focusBinding: focus };
    expect(walkerRuntime().paths.walkPath({ type: "path", steps: [first, { type: "block", position: 0, expressions: [parse("1")] }] }, bindVariable(createScope(), "selected", ["source"]))).toEqual([]);
  });

  it.each([
    { type: "path", steps: [{ ...name(""), focusBinding: focus }] },
    { type: "path", steps: [parse("1"), { ...variable(""), focusBinding: focus }] },
    { type: "path", steps: [{ ...name("source"), indexBinding: index }, variable("index")] },
    { type: "path", steps: [{ type: "future-extension" }] },
  ])("does not manufacture focus or index data for a source-less path", (node) => {
    expect(walkerRuntime().paths.walkPath(node as PathNode, createScope())).toEqual([]);
  });

  it("retains root grouping reads on a literal path step without predicate metadata", () => {
    const node = { ...parse("1"), group: { type: "group" as const, entries: [[parse('"key"'), parse("$$.settings")]] as [AstNode, AstNode][] } };
    expect(walkerRuntime().paths.walkPath({ type: "path", steps: [name("outer"), node] }, createScope())).toEqual(["outer", `${ROOT_PATH}.settings`]);
  });

  it("accepts a sort step without predicate metadata", () => {
    const sort: AstNode = { type: "sort", terms: [{ descending: false, expression: name("price") }] };
    expect(walkerRuntime().paths.walkPath({ type: "path", steps: [name("items"), sort] }, createScope())).toEqual(["items", "items.price"]);
  });

  it.each([
    { type: "object", entries: [[parse('"copy"'), name("source")]], predicate: [filter(parse("$$.settings"))] },
    { type: "array", expressions: [name("source")], predicate: [filter(parse("$$.settings"))] },
  ])("accepts a $type predicate without an index binding", (step) => {
    expect(new Set(walkerRuntime().paths.walkPath({ type: "path", steps: [name("outer"), step as AstNode] }, createScope()))).toEqual(new Set(["outer", "outer.source", `${ROOT_PATH}.settings`]));
  });

  it("uses the preceding context for predicates on a constant block", () => {
    const block: AstNode = { type: "block", position: 0, expressions: [parse("1")], predicate: [filter(parse("$$.settings"))] };
    expect(walkerRuntime().paths.walkPath({ type: "path", steps: [name("outer"), block] }, createScope())).toEqual([`${ROOT_PATH}.settings`, "outer"]);
  });

  it("keeps empty suffix focus and position bindings source-less", () => {
    const step: AstNode = { ...name(""), focusBinding: focus, indexBinding: index, stages: [filter(variable("index"))] };
    const sort: AstNode = { type: "sort", terms: [{ descending: false, expression: variable("index") }] };
    const paths = walkerRuntime().paths;
    expect(paths.walkResolvedVariableSuffixFilterStages([step], "", createScope(), new Set())).toEqual([]);
    expect(paths.walkResolvedVariableSuffixSortTerms([step, sort], "", createScope(), new Set())).toEqual([]);
  });

  it("resolves standalone sort expressions through an object alias step", () => {
    expect(walkerRuntime().paths.walkSortTerms({ type: "sort", terms: [{ descending: false, expression: name("copy") }] }, "", createScope(), new Set(), parse('{"copy":source}'))).toEqual(["source", "source"]);
  });

  it("reads a resolved data variable used directly as a filter", () => {
    expect(walkerRuntime().paths.walkFilterStages([filter(variable("selected"))], "items", bindVariable(createScope(), "selected", ["settings"]))).toEqual(["settings"]);
  });
  it.each(["[$default()]", '$default() & "suffix"'])("binds current context for a nested call to a named defaulted lambda: %s", (expression) => {
    const scope = bindLambda(createScope(), "default", parse("function($x)<s-:s>{$x}") as LambdaNode);
    expect([...new Set(walkerRuntime().paths.walkContextExpression(parse(expression), "source", scope))]).toEqual(["source"]);
  });

  it("retains grouping reads when a previous path step introduces the selected variable", () => {
    const node: AstNode = { type: "path", steps: [{ ...name("orders"), focusBinding: focus }, variable("item"), name("items")], group: { type: "group", entries: [[name("kind"), name("price")]] } };
    expect([...new Set(walkerRuntime().core.walkNode(node, createScope()))]).toEqual(["orders.items", "orders.items.kind", "orders.items.price"]);
  });

  it.each(["array", "block"] as const)("projects a %s expression through an immediately preceding object alias", (type) => {
    const projection: AstNode = { type, position: 0, expressions: [name("copy")] };
    const node: AstNode = { type: "path", steps: [parse('{"copy":source}'), projection] };
    expect([...new Set(walkerRuntime().core.walkNode(node, createScope()))]).toEqual(["source"]);
  });

  it("walks an array suffix exactly once after resolving a function result", () => {
    const node: AstNode = { type: "path", steps: [parse("$reverse(items)"), { type: "array", expressions: [name("price")] }] };
    expect([...new Set(walkerRuntime().core.walkNode(node, createScope()))]).toEqual(["items", "items.price"]);
  });
  it("does not resolve local reads from an explicitly source-less current context", () => {
    expect(walkerRuntime().paths.walkPath({ type: "path", steps: [variable(""), name("price")] }, bindVariable(createScope(), "", []))).toEqual([]);
  });

  it("binds a root focus before walking its filter", () => {
    const root = { ...variable("$"), focusBinding: focus, predicate: [filter(parse("$item.active"))] };
    expect(walkerRuntime().paths.walkPath({ type: "path", steps: [root, name("price")] }, createScope())).toEqual([`${ROOT_PATH}.active`, `${ROOT_PATH}.price`]);
  });

  it("binds focus and position when a path resets to the root in its middle", () => {
    const root = { ...variable("$"), focusBinding: focus, indexBinding: index };
    expect(walkerRuntime().paths.walkPath({ type: "path", steps: [name("orders"), root, name("price")] }, createScope())).toEqual(["orders", `${ROOT_PATH}.price`]);
  });

  it.each(["wildcard", "descendant"] as const)("keeps %s path positions out of filter dependencies", (type) => {
    const step = { type, value: type === "wildcard" ? "*" : "**", position: 0, focusBinding: focus, indexBinding: index, predicate: [filter(variable("index"))] };
    expect(walkerRuntime().paths.walkPath({ type: "path", steps: [name("orders"), step] }, createScope())).toEqual([`orders.${step.value}`]);
  });

  it("resolves a focused suffix predicate against the resolved variable source", () => {
    const step = { ...name("items"), focusBinding: focus, indexBinding: index, stages: [filter(parse("$item.price")), filter(variable("index"))] };
    expect(walkerRuntime().paths.walkResolvedVariableSuffixFilterStages([step], "orders", createScope(), new Set())).toEqual(["orders.items.price"]);
  });

  it("resolves focused sort terms against the resolved variable source", () => {
    const step = { ...name("items"), focusBinding: focus, indexBinding: index };
    const sort: AstNode = { type: "sort", terms: [{ descending: false, expression: parse("$item.price") }, { descending: false, expression: variable("index") }] };
    expect(walkerRuntime().paths.walkResolvedVariableSuffixSortTerms([step, sort], "orders", createScope(), new Set())).toEqual(["orders.items.price"]);
  });

  it("ignores unrelated stage kinds without losing a following filter", () => {
    expect(walkerRuntime().paths.walkFilterStages([name("notAStage"), filter(name("active"))], "orders", createScope())).toEqual(["orders.active"]);
  });

  it("binds positional stages and ignores unrelated stages in source-less filters", () => {
    expect(walkerRuntime().paths.walkSourceLessFilterStages([index, name("notAStage"), filter(variable("index")), filter(parse("$$.settings"))], createScope())).toEqual([`${ROOT_PATH}.settings`]);
  });

  it("preserves captured reads while contextualizing a callable-selection expression", () => {
    const scope = bindVariable(createScope(), "captured", ["settings"]);
    expect(walkerRuntime().paths.walkContextCallableSelection(parse("[$.price,$captured]"), "orders", scope)).toEqual(["orders.price", "settings"]);
  });

  it("adds captured reads that are absent from an unbound callable-selection context", () => {
    const scope = bindVariable(createScope(), "captured", ["settings"]);
    expect(walkerRuntime().paths.walkContextCallableSelection(parse("[price,$captured]"), "orders", scope)).toEqual(["orders.price", "settings"]);
  });
});
