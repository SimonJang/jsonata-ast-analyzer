import { describe, expect, it } from "vitest";
import type { AstNode } from "../src/types.js";
import { bindVariable, createScope } from "../src/scope.js";
import { createWalker } from "../src/walker/index.js";
import { parse } from "../src/parser.js";
import { walkerRuntime } from "./support/walker-runtime.js";

const name = (value: string): AstNode => ({ type: "name", value, position: 0 });
const variable = (value: string): AstNode => ({ type: "variable", value, position: 0 });
const focus = { type: "context-binding" as const, name: "item", position: 0 };
const index = { type: "position-binding" as const, name: "index", position: 0 };
const predicate = [{ type: "filter" as const, expr: variable("index") }];
const literalKey: AstNode = { type: "string", value: "copy", position: 0 };

describe("walker-owned AST context bindings", () => {
  it.each([
    { label: "current context", node: { ...variable(""), focusBinding: focus, indexBinding: index, predicate }, expected: ["outer"] },
    { label: "literal", node: { type: "number", value: 1, position: 0, focusBinding: focus, indexBinding: index, predicate }, expected: ["outer"] },
    { label: "array", node: { type: "array", expressions: [name("source")], focusBinding: focus, indexBinding: index, predicate }, expected: ["outer", "outer.source"] },
    { label: "object", node: { type: "object", entries: [[literalKey, name("source")]], focusBinding: focus, indexBinding: index, predicate: [...predicate, index] }, expected: ["outer", "outer.source"] },
    { label: "object block", node: { type: "block", position: 0, expressions: [{ type: "object", entries: [[literalKey, name("source")]] }], predicate: [index] }, expected: ["outer.source"] },
  ])("binds a $label path step without turning position metadata into data reads", ({ node, expected }) => {
    const paths = createWalker().walkNode({ type: "path", steps: [name("outer"), node as AstNode] }, createScope());
    expect([...new Set(paths)]).toEqual(expected);
  });

  it("walks grouping reads after a locally bound variable path step", () => {
    const scope = bindVariable(createScope(), "selected", ["source"]);
    const node: AstNode = { type: "path", steps: [name("outer"), variable("selected"), name("items")], group: { type: "group", entries: [[name("kind"), name("price")]] } };
    expect([...new Set(createWalker().walkNode(node, scope))]).toEqual(["source.items", "source.items.kind", "source.items.price"]);
  });

  it.each([
    { expression: 'outer.([$uppercase()])', expected: ["outer"] },
    { expression: 'outer.($uppercase() & "suffix")', expected: ["outer"] },
    { expression: 'outer.([(function($x)<s-:s>{$x})()])', expected: ["outer"] },
    { expression: 'outer.((function($x)<s-:s>{$x})() & "suffix")', expected: ["outer", "outer.**"] },
  ])("finds context-default calls nested in a projection: $expression", ({ expression, expected }) => {
    expect([...new Set(walkerRuntime().core.walkNode(parse(expression), createScope()))]).toEqual(expected);
  });
  it("accepts standalone names and skips unknown extension nodes", () => {
    const walker = createWalker();
    expect(walker.walkNode(name("source"), createScope())).toEqual(["source"]);
    expect(walker.walkNode({ type: "future-extension" } as unknown as AstNode, createScope())).toEqual([]);
  });

  it.each([
    { label: "index", indexBinding: index },
    { label: "focus and index", focusBinding: focus, indexBinding: index },
  ])("keeps literal $label bindings source-less", ({ label: _, ...bindings }) => {
    expect(createWalker().walkNode({ type: "number", value: 1, position: 0, predicate, ...bindings }, createScope())).toEqual([]);
  });

  it.each(["wildcard", "descendant"] as const)("binds the positional variable of a %s without inventing an index dependency", (type) => {
    expect(createWalker().walkNode({ type, value: type === "wildcard" ? "*" : "**", position: 0, predicate, indexBinding: index }, createScope())).toEqual([type === "wildcard" ? "*" : "**"]);
  });

  it.each(["wildcard", "descendant"] as const)("reads grouping keys and values in a %s context", (type) => {
    const prefix = type === "wildcard" ? "*" : "**";
    expect(createWalker().walkNode({ type, value: prefix, position: 0, group: { type: "group", entries: [[name("kind"), name("amount")]] } }, createScope())).toEqual([prefix, `${prefix}.kind`, `${prefix}.amount`]);
  });

  it.each([
    { label: "index", indexBinding: index },
    { label: "focus and index", focusBinding: focus, indexBinding: index },
  ])("keeps array $label bindings out of source dependencies", ({ label: _, ...bindings }) => {
    expect(createWalker().walkNode({ type: "array", expressions: [name("source")], predicate, ...bindings }, createScope())).toEqual(["source"]);
  });

  it.each([
    { label: "index", indexBinding: index },
    { label: "focus and index", focusBinding: focus, indexBinding: index },
  ])("keeps object $label bindings out of predicate dependencies", ({ label: _, ...bindings }) => {
    expect(createWalker().walkNode({ type: "object", entries: [[literalKey, name("source")]], predicate, ...bindings }, createScope())).toEqual(["source"]);
  });

  it.each([
    { label: "index", indexBinding: index },
    { label: "focus and index", focusBinding: focus, indexBinding: index },
  ])("keeps object $label bindings out of grouping dependencies", ({ label: _, ...bindings }) => {
    expect(createWalker().walkNode({ type: "object", entries: [[literalKey, name("source")]], group: { type: "group", entries: [[variable("index"), name("copy")]] }, ...bindings }, createScope())).toEqual(["source", "source"]);
  });

  it("ignores non-filter stages on an object constructor", () => {
    expect(createWalker().walkNode({ type: "object", entries: [[literalKey, name("source")]], predicate: [{ type: "position-binding", name: "index", position: 0 }] }, createScope())).toEqual(["source"]);
  });

  it.each([
    { label: "index", indexBinding: index },
    { label: "focus and index", focusBinding: focus, indexBinding: index },
  ])("keeps root $label bindings out of source dependencies", ({ label: _, ...bindings }) => {
    expect(createWalker().walkNode({ type: "variable", value: "$", position: 0, predicate, ...bindings }, createScope())).toEqual([]);
  });

  it.each([
    { label: "index", indexBinding: index },
    { label: "focus and index", focusBinding: focus, indexBinding: index },
  ])("binds a resolved variable's $label while filtering and grouping its source", ({ label: _, ...bindings }) => {
    const scope = bindVariable(createScope(), "selected", ["source"]);
    const node = { type: "variable" as const, value: "selected", position: 0, predicate, group: { type: "group" as const, entries: [[variable("index"), name("amount")]] as [AstNode, AstNode][] }, ...bindings };
    expect(createWalker().walkNode(node, scope)).toEqual(["source", "source.amount"]);
  });
});
