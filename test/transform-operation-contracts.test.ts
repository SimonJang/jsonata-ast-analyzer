import { describe, expect, it } from "vitest";
import { bindDynamicObjectAlias, bindObjectAlias, bindPartial, bindTransform, bindVariable, createScope } from "../src/scope.js";
import { parse } from "../src/parser.js";
import type { AstNode, FunctionNode, TransformNode } from "../src/types.js";
import { walkerRuntime } from "./support/walker-runtime.js";
import { ROOT_PATH } from "../src/walker/constants.js";

const name = (value: string): AstNode => ({ type: "name", value, position: 0 });
const key = (value: string): AstNode => ({ type: "string", value, position: 0 });
const wildcard: AstNode = { type: "wildcard", value: "*", position: 0 };
const root: AstNode = { type: "variable", value: "$", position: 0 };
const update: AstNode = { type: "object", entries: [[key("total"), name("price")]] };
const transform = (pattern: AstNode, body: AstNode = update): TransformNode => ({ type: "transform", pattern, update: body });
const call = (node: TransformNode, args: AstNode[] = [name("source")]): FunctionNode => ({ type: "function", value: "(", position: 0, procedure: node, arguments: args });

describe("transform output contracts", () => {
  it("retains pattern predicate reads from an incomplete transform AST missing its update", () => {
    // The parser supplies an update; this exercises the walker's defensive boundary.
    const node = { type: "transform", pattern: { type: "number", value: 1, position: 0, predicate: [{ type: "filter", expr: parse("$$.settings") }] } } as unknown as TransformNode;
    expect(walkerRuntime().transforms.walkTransform(node, createScope())).toEqual([`${ROOT_PATH}.settings`, "\u0000.settings.*"]);
  });

  it("resolves a transform pattern through a dynamic object alias", () => {
    const runtime = walkerRuntime();
    const scope = createScope();
    const alias = runtime.aliases.dynamicObjectAliasForNode(parse('{(key):source}'), scope)!;
    const bound = bindDynamicObjectAlias(scope, "selected", alias);
    const node = transform(parse("$selected.copy"));
    expect([...new Set(runtime.transforms.walkTransform(node, bound))]).toEqual(["source", "source.price"]);
  });

  it("falls back safely when an alias pattern uses an unsupported numeric selector", () => {
    const scope = bindObjectAlias(createScope(), "selected", new Map([["copy", ["source"]]]));
    const node: TransformNode = { type: "transform", pattern: { type: "path", steps: [{ type: "variable", value: "selected", position: 0 }, { type: "number", value: 0, position: 0 }] }, update: parse("1") };
    expect(walkerRuntime().transforms.walkTransform(node, scope)).toEqual([]);
  });

  it.each([
    { input: parse("1"), expected: ["item.price"] },
    { input: parse("$length(source)"), expected: ["source.item.price"] },
  ])("keeps conservative relative output selection reads when input has no suffixable base: $input", ({ input, expected }) => {
    const node = transform(root, { type: "object", entries: [[key("copy"), name("item")]] });
    expect(walkerRuntime().transforms.transformOutputSelectionSourcePaths(call(node, [input]), [name("copy"), name("price")], createScope())).toEqual(expected);
  });

  it.each([
    { input: parse("1"), expected: ["items", "items.price"] },
    { input: parse("$length(source)"), expected: ["source", "source.items", "source.items.price"] },
  ])("keeps conservative transform reads when call input has no suffixable base: $input", ({ input, expected }) => {
    const scope = createScope();
    expect(walkerRuntime().transforms.walkTransformCall({ transform: transform(name("items")), scope }, [input], scope)).toEqual(expected);
    expect(walkerRuntime().functions.walkApply({ type: "apply", value: "~>", position: 0, lhs: input, rhs: transform(name("items")) }, scope)).toEqual(expected);
  });

  it("retains projection delete reads from an incomplete transform AST missing its update", () => {
    const node = { type: "transform", pattern: { type: "path", steps: [name("copy"), { type: "block", position: 0, expressions: [name("details")] }] }, delete: name("deleteKey") } as unknown as TransformNode;
    expect(walkerRuntime().transforms.transformApplyAliasContextPaths(node, [], parse('{"copy":source}'), ["source"], createScope())).toEqual(["source.details", "source", "source.deleteKey"]);
  });

  it("falls back to observed pattern reads for a function without suffixable results", () => {
    const pattern: AstNode = { type: "path", steps: [parse("$length(source)")] };
    expect(walkerRuntime().transforms.walkTransform(transform(pattern, parse("1")), createScope())).toEqual(["source"]);
  });

  it("walks a block pattern without a representable preceding context path", () => {
    const node = transform({ type: "path", steps: [parse("{}"), { type: "block", position: 0, expressions: [name("source")] }] }, parse("1"));
    expect([...new Set(walkerRuntime().transforms.walkTransform(node, createScope()))]).toEqual(["source"]);
  });

  it.each([
    { inputPaths: [], expected: ["unrelated"] },
    { inputPaths: ["fallback"], expected: ["fallback.unrelated"] },
  ])("preserves unmatched transform reads when a variable has aliases but no base paths: $inputPaths", ({ inputPaths, expected }) => {
    const scope = bindObjectAlias(createScope(), "selected", new Map([["copy", ["source"]]]));
    expect(walkerRuntime().transforms.transformApplyAliasContextPaths(transform(name("copy")), ["unrelated"], parse("$selected"), inputPaths, scope)).toEqual(expected);
  });

  it.each([
    { label: "empty block", pattern: { type: "block", position: 0, expressions: [] }, suffix: [name("copy")] },
    { label: "one-sided conditional", pattern: { type: "condition", position: 0, condition: name("flag"), then: name("items") }, suffix: [name("items"), name("missing")] },
    { label: "numeric location", pattern: name("items"), suffix: [{ type: "number", value: 0, position: 0 }, name("copy")] },
    { label: "wildcard location", pattern: wildcard, suffix: [wildcard, name("missing")] },
  ])("does not invent a transformed callback at an unresolved $label", ({ pattern, suffix }) => {
    const transforms = walkerRuntime().transforms;
    const node = call(transform(pattern as AstNode));
    expect(transforms.transformUpdateCallableValues(node, suffix as AstNode[], createScope())).toEqual([]);
    expect(transforms.transformUpdateBuiltinCallableNames(node, suffix as AstNode[], createScope())).toEqual([]);
  });

  it("resolves a callable update without requiring a supplied source input", () => {
    const transforms = walkerRuntime().transforms;
    const lambda = parse("function(){source}");
    const value = transform(name("items"), { type: "object", entries: [[key("copy"), lambda]] });
    expect(transforms.transformUpdateCallableValues(call(value, []), [name("items"), name("copy")], createScope()).map(item => item.kind)).toEqual(["lambda"]);
    const builtinValue = transform(name("items"), { type: "object", entries: [[key("copy"), parse("$sum")]] });
    expect(transforms.transformUpdateBuiltinCallableNames(call(builtinValue, []), [name("items"), name("copy")], createScope())).toEqual(["sum"]);
  });
  it("uses local update reads when a pattern variable has no alias binding", () => {
    const node = transform({ type: "path", steps: [{ type: "variable", value: "missing", position: 0 }] });
    expect(walkerRuntime().transforms.walkTransform(node, createScope())).toEqual(["price"]);
  });
  it("walks a pattern through an alias-backed variable", () => {
    const scope = bindObjectAlias(bindVariable(createScope(), "selected", ["source"]), "selected", new Map([["copy", ["source"]]]));
    const node = transform({ type: "path", steps: [{ type: "variable", value: "selected", position: 0 }, name("copy")] });
    expect([...new Set(walkerRuntime().transforms.walkTransform(node, scope))]).toEqual(["source", "source.price"]);
  });

  it("walks the result of a block used inside a transform pattern", () => {
    const node = transform({ type: "path", steps: [name("items"), { type: "block", position: 0, expressions: [name("details")] }] });
    expect([...new Set(walkerRuntime().transforms.walkTransform(node, createScope()))]).toEqual(["items.details", "items.details.price"]);
  });

  it("finds a locally bound transform despite empty grouping metadata", () => {
    const value = transform(root);
    const scope = bindTransform(createScope(), "operation", value);
    const node: FunctionNode = { ...call(value), procedure: { type: "variable", value: "operation", position: 0, group: { type: "group", entries: [] } } };
    expect(walkerRuntime().transforms.resolveTransformFunctionCalls(node, scope)).toEqual([{ binding: { transform: value, scope: createScope() }, arguments: node.arguments }]);
  });

  it("finds a locally bound partial transform despite empty grouping metadata", () => {
    const value = transform(root);
    const scope = bindPartial(createScope(), "operation", { type: "partial", value: "(", position: 0, procedure: value, arguments: [] });
    const node: FunctionNode = { ...call(value), procedure: { type: "variable", value: "operation", position: 0, group: { type: "group", entries: [] } } };
    const calls = walkerRuntime().transforms.resolveTransformFunctionCalls(node, scope);
    expect(calls.map(result => ({ transform: result.binding.transform, arguments: result.arguments }))).toEqual([{ transform: value, arguments: node.arguments }]);
  });

  it("retains alias context when invoking a transform on a constructed input", () => {
    const scope = createScope();
    const node = transform(name("copy"));
    expect([...new Set(walkerRuntime().transforms.walkTransformCall({ transform: node, scope }, [parse('{"copy":source}')], scope))]).toEqual(["source", "source.price"]);
  });

  it("reads projection updates and deletes through the selected alias context", () => {
    const scope = createScope();
    const input = parse('{"copy":source}');
    const node: TransformNode = { ...transform({ type: "path", steps: [name("copy"), { type: "block", position: 0, expressions: [name("details")] }] }), delete: name("deleteKey") };
    expect(walkerRuntime().transforms.transformApplyAliasContextPaths(node, [], input, ["source"], scope)).toEqual(["source.details", "source", "source.price", "source.deleteKey"]);
  });

  it("declines an alias projection whose context key is absent", () => {
    const node = transform({ type: "path", steps: [name("missing"), { type: "block", position: 0, expressions: [name("details")] }] });
    expect(walkerRuntime().transforms.transformApplyAliasContextPaths(node, [], parse('{"copy":source}'), ["source"], createScope())).toBeNull();
  });
  it.each([
    { label: "root", pattern: root, suffix: ["total"], expected: true },
    { label: "name", pattern: name("items"), suffix: ["items", "total"], expected: true },
    { label: "wildcard", pattern: wildcard, suffix: ["items", "total"], expected: true },
    { label: "array alternative", pattern: { type: "array", expressions: [name("orders"), name("returns")] }, suffix: ["returns", "total"], expected: true },
    { label: "path wildcard", pattern: { type: "path", steps: [name("orders"), wildcard] }, suffix: ["orders", "items", "total"], expected: true },
    { label: "root-prefixed path", pattern: { type: "path", steps: [root, name("items")] }, suffix: ["items", "total"], expected: true },
    { label: "mismatched pattern", pattern: name("orders"), suffix: ["returns", "total"], expected: false },
    { label: "unchanged field", pattern: name("items"), suffix: ["items", "price"], expected: false },
    { label: "nested selection", pattern: name("items"), suffix: ["items", "total", "amount"], expected: false },
    { label: "non-static pattern", pattern: { type: "number", value: 0, position: 0 }, suffix: ["total"], expected: false },
    { label: "non-static path step", pattern: { type: "path", steps: [name("orders"), { type: "number", value: 0, position: 0 }] }, suffix: ["orders", "total"], expected: false },
  ])("identifies overwritten fields for a $label", ({ pattern, suffix, expected }) => {
    expect(walkerRuntime().transforms.transformWritesSuffix(call(transform(pattern as AstNode)), suffix.map(name), createScope())).toBe(expected);
  });

  it("does not claim a statically overwritten field for a dynamic update expression or key", () => {
    const transforms = walkerRuntime().transforms;
    expect(transforms.transformWritesSuffix(call(transform(root, name("changes"))), [name("total")], createScope())).toBe(false);
    expect(transforms.transformWritesSuffix(call(transform(root, { type: "object", entries: [[name("dynamicKey"), name("price")]] })), [name("total")], createScope())).toBe(false);
  });

  it("does not treat a wildcard output selection as a definite overwrite", () => {
    expect(walkerRuntime().transforms.transformWritesSuffix(call(transform(root)), [wildcard], createScope())).toBe(false);
  });

  it("declines to resolve non-name and staged output selections", () => {
    const transforms = walkerRuntime().transforms;
    expect(transforms.transformOutputSelectionSourcePaths(call(transform(root)), [wildcard], createScope())).toBeNull();
    expect(transforms.transformOutputSelectionSourcePaths(call(transform(root)), [{ ...name("total"), stages: [{ type: "filter", expr: name("active") }] } as AstNode], createScope())).toBeNull();
  });

  it("declines to resolve an output field from a non-object update", () => {
    expect(walkerRuntime().transforms.transformOutputSelectionSourcePaths(call(transform(root, name("changes"))), [name("total")], createScope())).toBeNull();
  });

  it("resolves a selected update field while skipping other update keys", () => {
    const body: AstNode = { type: "object", entries: [[key("ignored"), name("other")], [key("copy"), name("item")]] };
    expect(walkerRuntime().transforms.transformOutputSelectionSourcePaths(call(transform(root, body)), [name("copy"), name("price")], createScope())).toEqual(["source.item.price"]);
  });

  it("cannot attribute an output suffix to absent call input", () => {
    expect(walkerRuntime().transforms.transformOutputSelectionSourcePaths(call(transform(root), []), [name("total"), name("amount")], createScope())).toEqual([]);
  });

  it("keeps a transform call without input free of source dependencies", () => {
    const scope = createScope();
    expect(walkerRuntime().transforms.walkTransformCall({ transform: transform(root), scope }, [], scope)).toEqual([]);
  });

  it.each([
    { label: "shorter selection", pattern: { type: "path", steps: [name("orders"), name("items")] }, suffix: [name("orders")] },
    { label: "unrecognized step", pattern: { type: "path", steps: [name("orders"), { type: "number", value: 0, position: 0 }] }, suffix: [name("orders"), name("callback")] },
    { label: "non-static pattern", pattern: { type: "number", value: 0, position: 0 }, suffix: [name("callback")] },
    { label: "pattern with no output suffix", pattern: name("orders"), suffix: [name("orders")] },
  ])("does not invent a callable update for a $label", ({ pattern, suffix }) => {
    const transforms = walkerRuntime().transforms;
    const node = call(transform(pattern as AstNode));
    expect(transforms.transformUpdateCallableValues(node, suffix, createScope())).toEqual([]);
    expect(transforms.transformUpdateBuiltinCallableNames(node, suffix, createScope())).toEqual([]);
  });

  it("does not apply an unrepresentable pattern to an object alias", () => {
    const input: AstNode = { type: "object", entries: [[key("copy"), name("source")]] };
    expect(walkerRuntime().transforms.transformApplyAliasContextPaths(transform({ type: "number", value: 0, position: 0 }), [], input, ["source"], createScope())).toBeNull();
  });
});
