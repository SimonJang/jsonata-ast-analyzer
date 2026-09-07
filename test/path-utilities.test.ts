import { describe, expect, it } from "vitest";
import type { AstNode, BlockNode } from "../src/types.js";
import { ROOT_PATH } from "../src/walker/constants.js";
import { appendPath, collectVariableNames, flattenSimpleContextBlocks, flattenTransparentPathBlocks, hasPendingFocusReset, isNumericIndex, markAbsolute, parentPath, prefixPaths, prefixTransformContextPaths, resolveParentPathSegments, stripParentRelativePath } from "../src/walker/path-utils.js";

const name = (value: string): AstNode => ({ type: "name", value, position: 0 });
const variable = (value: string): AstNode => ({ type: "variable", value, position: 0 });
const block = (steps: AstNode[]): BlockNode => ({ type: "block", position: 0, expressions: [{ type: "path", steps }] });

describe("path boundary operations", () => {
  it("preserves absolute paths while prefixing relative siblings in an absolute context", () => {
    expect(prefixPaths(`${ROOT_PATH}.orders`, [`${ROOT_PATH}.settings`, "total"])).toEqual([`${ROOT_PATH}.settings`, `${ROOT_PATH}.orders.total`]);
    expect(markAbsolute([`${ROOT_PATH}.settings`, "orders"])).toEqual([`${ROOT_PATH}.settings`, `${ROOT_PATH}.orders`]);
  });

  it("appends a path without introducing a leading separator for an empty context", () => {
    expect(appendPath("", "price")).toBe("price");
  });

  it("rebases transform-root reads and the transform root itself onto the selected object", () => {
    expect(prefixTransformContextPaths("orders.item", [`${ROOT_PATH}.price`, ROOT_PATH])).toEqual(["orders.item.price", "orders.item"]);
  });

  it("keeps unresolved leading parent traversal instead of discarding it", () => {
    expect(resolveParentPathSegments("%.name")).toBe("%.name");
    expect(parentPath("name")).toBe("");
    expect(stripParentRelativePath("%")).toBe("");
  });

  it("collects variable references from nested metadata-free AST children", () => {
    const ast = {
      type: "extension",
      children: [null, 1, variable("first")],
      child: variable("second"),
      source: { type: "variable", value: "upstreamOnly" },
    } as unknown as AstNode;
    expect(collectVariableNames(ast)).toEqual(new Set(["first", "second"]));
  });

  it.each([
    { expression: { type: "negate", expression: { type: "number", value: 1, position: 0 } }, expected: true },
    { expression: { type: "negate", expression: name("offset") }, expected: false },
    { expression: { type: "negate" }, expected: false },
  ])("recognizes numeric indexing only for a numeric negated operand ($expected)", ({ expression, expected }) => {
    expect(isNumericIndex(expression as AstNode)).toBe(expected);
  });

  it("keeps context blocks containing an evaluated variable rather than flattening them into static paths", () => {
    const input = block([variable("value")]);
    expect(flattenSimpleContextBlocks([input])).toEqual([input]);
  });

  it("flattens an empty simple path to no steps", () => {
    expect(flattenSimpleContextBlocks([block([])])).toEqual([]);
  });

  it.each([
    { focusBinding: { name: "item", type: "context-binding" as const, position: 0 } },
    { indexBinding: { name: "offset", type: "position-binding" as const, position: 0 } },
    { focusBinding: { name: "item", type: "context-binding" as const, position: 0 }, indexBinding: { name: "offset", type: "position-binding" as const, position: 0 } },
  ])("moves block bindings to the final flattened path step: %j", (bindings) => {
    expect(flattenSimpleContextBlocks([{ ...block([name("orders"), name("items")]), ...bindings }])).toEqual([
      name("orders"), { ...name("items"), ...bindings },
    ]);
  });

  it("recursively flattens transparent blocks while retaining a predicate-bearing block", () => {
    const filtered = { ...block([name("items")]), predicate: [{ type: "filter" as const, expr: name("active") }] };
    expect(flattenTransparentPathBlocks([block([name("orders"), block([name("details")])]), filtered])).toEqual([
      name("orders"), name("details"), filtered,
    ]);
  });

  it("consumes a pending focus reset only when a variable refers to the pending binding", () => {
    const focused = { ...name("items"), focusBinding: { name: "item", type: "context-binding" as const, position: 0 } };
    expect(hasPendingFocusReset([focused, variable("item")])).toBe(false);
    expect(hasPendingFocusReset([focused, variable("other")])).toBe(false);
    expect(hasPendingFocusReset([focused, variable("item"), focused])).toBe(true);
  });
});
