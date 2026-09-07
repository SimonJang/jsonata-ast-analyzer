import { describe, expect, it } from "vitest";
import { parse } from "../src/parser.js";
import { bindVariable, createScope, type DynamicObjectAlias } from "../src/scope.js";
import type { AstNode, FunctionNode, ObjectNode, PathNode, SortNode } from "../src/types.js";
import { ROOT_PATH } from "../src/walker/constants.js";
import { walkerRuntime } from "./support/walker-runtime.js";

const name = (value: string): AstNode => ({ type: "name", value, position: 0 });
const key = (value: string): AstNode => ({ type: "string", value, position: 0 });
const object = (entries: [AstNode, AstNode][]): ObjectNode => ({ type: "object", position: 0, entries });

describe("alias operation contracts", () => {
  it("retains only the present branch of a conditional alias", () => {
    const runtime = walkerRuntime();
    expect(runtime.aliases.bindingAliasPaths(parse("flag?source"), createScope())).toEqual(["source"]);
    const alias = runtime.aliases.dynamicObjectAliasForNode(parse('flag?{(key):source}'), createScope());
    expect(alias).not.toBeNull();
    expect(runtime.aliases.selectLookupDynamicObjectAliasPaths(alias!, [])).toEqual(["source"]);
  });

  it("selects only immediate matching keys under a wildcard alias prefix", () => {
    const aliases = new Map([["copy.value", ["source"]], ["other", ["ignored"]], ["copy.nested.value", ["alsoIgnored"]]]);
    const operations = walkerRuntime().aliases;
    const wildcard: AstNode = { type: "wildcard", value: "*", position: 0 };
    expect(operations.selectObjectAliasPaths(aliases, [name("copy"), wildcard])).toEqual(["source"]);
    expect(operations.selectObjectAliasPaths(aliases, [name("missing"), wildcard])).toBeNull();
  });

  it("treats an empty path sort term as selection of the whole alias context", () => {
    const sort: SortNode = { type: "sort", terms: [{ descending: false, expression: { type: "path", steps: [] } }] };
    expect(walkerRuntime().aliases.walkAliasSuffixSortTerms([sort], new Map([["copy", ["source"]]]), null, createScope())).toEqual(["source"]);
  });

  it("resolves function suffix reads and bare parent references with alias parent contexts", () => {
    const aliases = new Map([["copy", ["source"]]]);
    const operations = walkerRuntime().aliases;
    expect(operations.walkAliasSuffixFunctionSteps([parse("$sum(price)")], aliases, null, createScope())).toEqual([]);
    const countParent: FunctionNode = { type: "function", value: "(", position: 0, procedure: { type: "variable", value: "count", position: 0 }, arguments: [{ type: "parent" }] };
    expect(operations.walkAliasSuffixFunctionSteps([name("copy"), name("items"), countParent], aliases, null, createScope())).toEqual(["source"]);
  });

  it("preserves a grouping position when resolving its dynamic alias", () => {
    const node: AstNode = { type: "path", steps: [name("items")], group: { type: "group", position: 42, entries: [[name("key"), name("price")]] } };
    const alias = walkerRuntime().aliases.groupResultDynamicObjectAliasForNode(node, createScope());
    expect(alias?.variants[0].node.position).toBe(42);
    expect(walkerRuntime().aliases.selectLookupDynamicObjectAliasPaths(alias!, [])).toEqual(["items.price"]);
    const withoutPosition: AstNode = { ...node, group: { type: "group", entries: [[name("key"), name("price")]] } };
    expect(walkerRuntime().aliases.groupResultDynamicObjectAliasForNode(withoutPosition, createScope())?.variants[0].node.position).toBe(0);
  });

  it("keeps result suffix reads relative when parent context steps cannot form a path", () => {
    const prefix: AstNode[] = [parse("1"), name("")];
    const operations = walkerRuntime().aliases;
    expect(operations.walkResultBaseSuffixProjectionSteps(["source"], [...prefix, parse('{"copy":price}')], createScope())).toEqual(["source.price"]);
    expect(operations.walkResultBaseSuffixFunctionSteps(["source"], [...prefix, parse("$sum(price)")], createScope())).toEqual(["source.price"]);
  });

  it("preserves scope when an apply cannot produce a callable focus", () => {
    const scope = createScope();
    expect(walkerRuntime().aliases.bindStepFocusScope({ type: "apply", value: "~>", position: 0, lhs: name("source"), rhs: name("invalid") }, scope)).toBe(scope);
  });

  it("binds both focus and position on an alias-producing step", () => {
    const scope = createScope();
    const node: AstNode = { ...object([[key("copy"), name("source")]]), focusBinding: { type: "context-binding", name: "selected", position: 0 }, indexBinding: { type: "position-binding", name: "index", position: 0 } };
    const bound = walkerRuntime().aliases.bindStepFocusScope(node, scope);
    expect(walkerRuntime().core.walkNode(parse("[$selected.copy,$index]"), bound)).toEqual(["source"]);
  });

  it("retains a conditional selection read even when neither result has an alias", () => {
    expect(walkerRuntime().aliases.selectResultAliasStepPaths(parse("flag?1:2"), [name("copy")], createScope())).toEqual(["flag"]);
  });

  it("does not invent selected reads from an empty object or an unsupported projection", () => {
    const operations = walkerRuntime().aliases;
    expect(operations.selectResultAliasExpressionPaths(parse("{}"), parse("1"), createScope())).toBeNull();
    expect(operations.selectResultAliasProjectionStepPaths(parse('{"copy":source}'), name("invalid"), createScope())).toBeNull();
  });
  it("selects nested dynamic lookup values and preserves their source suffix", () => {
    const runtime = walkerRuntime();
    const alias = runtime.aliases.dynamicObjectAliasForNode(parse('{(outerKey):{(innerKey):source}}'), createScope());
    expect(alias).not.toBeNull();
    expect(runtime.aliases.selectLookupDynamicObjectAliasPaths(alias!, [name("selected"), name("price")])).toEqual(["source.price"]);
  });

  it("rejects mismatched static lookup keys for static nested result aliases", () => {
    const scope = createScope();
    const alias: DynamicObjectAlias = { variants: [{ scope, node: object([[key("chosen"), object([[key("copy"), name("source")]])]]) }] };
    expect(walkerRuntime().aliases.selectLookupDynamicObjectResultObjectAlias(alias, [name("other")])).toBeNull();
  });

  it("reads standalone sort expressions through the alias map", () => {
    const sort: SortNode = { type: "sort", terms: [{ descending: false, expression: name("copy") }] };
    expect(walkerRuntime().aliases.walkAliasSuffixSortTerms([sort], new Map([["copy", ["source"]]]), null, createScope())).toEqual(["source"]);
  });

  it("ignores positional and numeric-index stages while resolving alias suffix filters", () => {
    const step: AstNode = { type: "name", value: "copy", position: 0, stages: [{ type: "position-binding", name: "index", position: 0 }, { type: "filter", expr: { type: "number", value: 0, position: 0 } }] };
    expect(walkerRuntime().aliases.walkAliasSuffixFilterStages([step], new Map([["copy", ["source"]]]), null, createScope())).toEqual([]);
  });

  it("keeps only statically named fields with source reads in a grouped alias", () => {
    const runtime = walkerRuntime();
    const node = parse('items{(key):price,"copy":amount,"literal":1}');
    expect(runtime.aliases.groupResultObjectAliasForNode(node, createScope())).toEqual(new Map([["copy", ["items.amount"]]]));
  });

  it("leaves unsupported focus-binding nodes in the original scope", () => {
    const scope = createScope();
    expect(walkerRuntime().aliases.bindStepFocusScope(name("source"), scope)).toBe(scope);
  });

  it.each(["", "a..b", "a[*]", "**", "%"])("preserves an unrepresentable alias suffix %j without inventing a mapping", (suffix) => {
    expect(walkerRuntime().aliases.selectAliasExpressionPaths(new Map([["copy", ["source"]]]), null, name(suffix), createScope())).toEqual([suffix]);
  });

  it("maps wildcard alias suffixes to every known object value", () => {
    expect(walkerRuntime().aliases.selectAliasExpressionPaths(new Map([["copy", ["source"]]]), null, name("*"), createScope())).toEqual(["source"]);
  });

  it("does not repeat a captured read already represented by a skipped local alias", () => {
    const scope = bindVariable(createScope(), "captured", ["source"]);
    expect(walkerRuntime().aliases.selectAliasExpressionPaths(new Map([["copy", ["source"]]]), null, parse("[copy,$captured]"), scope, [], false, true)).toEqual([]);
  });

  it("does not infer original source bases for a field overwritten by a transform", () => {
    const procedure = parse('|$|{"copy":1}|');
    const call: FunctionNode = { type: "function", value: "(", position: 0, procedure: procedure as FunctionNode["procedure"], arguments: [parse("source")] };
    const node: PathNode = { type: "path", steps: [call, name("copy")] };
    expect(walkerRuntime().aliases.pathResultAliasContextBasePaths(node, createScope())).toEqual([]);
  });
  it("resolves a standalone name against a captured current context", () => {
    const runtime = walkerRuntime();
    expect(runtime.aliases.bindingAliasPaths(name("price"), bindVariable(createScope(), "", ["orders", "returns"]))).toEqual([`${ROOT_PATH}.orders.price`, `${ROOT_PATH}.returns.price`]);
  });

  it.each([
    { node: { type: "wildcard", value: "*", position: 0 }, expected: ["*"] },
    { node: { type: "descendant", value: "**", position: 0 }, expected: ["**"] },
    { node: { type: "parent" }, expected: ["%"] },
  ])("preserves the structural meaning of a $node.type alias", ({ node, expected }) => {
    expect(walkerRuntime().aliases.bindingAliasPaths(node as AstNode, createScope())).toEqual(expected);
  });

  it("does not manufacture an alias for a context-free block projection", () => {
    expect(walkerRuntime().aliases.objectAliasForNode({ type: "path", steps: [{ type: "block", expressions: [] }] }, createScope())).toBeNull();
  });

  it("ignores dynamically named fields in a static projection alias", () => {
    expect(walkerRuntime().aliases.objectAliasForNode({ type: "path", steps: [name("orders"), object([[name("key"), name("value")]])] }, createScope())).toBeNull();
  });

  it("rejects a selector that cannot identify an object key", () => {
    expect(walkerRuntime().aliases.selectObjectAliasPaths(new Map([["copy", ["source"]]]), [{ type: "number", value: 0, position: 0 }])).toBeNull();
  });

  it("does not select nested dynamic aliases through a mismatched static key", () => {
    const scope = createScope();
    const nested = object([[name("dynamicKey"), name("source")]]);
    const alias: DynamicObjectAlias = { variants: [{ scope, node: object([[key("chosen"), nested]]) }] };
    expect(walkerRuntime().aliases.selectLookupDynamicObjectResultAlias(alias, [name("other")])).toBeNull();
  });

  it("defers lookup into a dynamic alias that still has a pending prefix", () => {
    const scope = createScope();
    const alias: DynamicObjectAlias = { variants: [{ scope, prefixSteps: ["outer"], node: object([[name("dynamicKey"), name("source")]]) }] };
    expect(walkerRuntime().aliases.selectLookupDynamicObjectResultAlias(alias, [name("outer")])).toBeNull();
  });

  it("preserves the full context before a deeply nested result projection", () => {
    expect(walkerRuntime().aliases.walkResultBaseSuffixProjectionSteps(["source"], [name("orders"), name("items"), object([[key("total"), name("price")]])], createScope())).toEqual(["source.orders.items.price"]);
  });

  it("preserves the full context before a deeply nested result function", () => {
    expect(walkerRuntime().aliases.walkResultBaseSuffixFunctionSteps(["source"], [name("orders"), name("items"), parse("$sum(price)")], createScope())).toEqual(["source.orders.items.price"]);
  });

  it("collects both original reads and alias-selected reads for an expression", () => {
    const source = object([[key("copy"), name("source")]]);
    expect(walkerRuntime().aliases.selectResultAliasExpressionPaths(source, name("copy"), createScope())).toEqual(["source", "source"]);
    expect(walkerRuntime().aliases.selectResultAliasExpressionPaths(name("source"), name("copy"), createScope())).toBeNull();
  });

  it("returns each expression in an array projection in source order", () => {
    expect(walkerRuntime().aliases.projectionStepExpressions({ type: "array", expressions: [name("first"), name("second")] })).toEqual([name("first"), name("second")]);
  });

  it("preserves explicitly requested unmapped local paths", () => {
    const aliases = new Map([["copy", ["source"]]]);
    expect(walkerRuntime().aliases.selectAliasExpressionPaths(aliases, null, name("missing"), createScope(), [], true)).toEqual(["missing"]);
  });

  it("leaves a plain path context intact when it contains no alias-producing step", () => {
    expect(walkerRuntime().aliases.pathResultAliasContextBasePaths({ type: "path", steps: [name("orders"), name("items")] }, createScope())).toEqual(["orders.items"]);
  });
});
