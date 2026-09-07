import { describe, expect, it } from "vitest";
import { normalizeAst } from "../src/normalizer.js";

const name = { type: "name", value: "field", position: 4 };

describe("raw AST boundary normalization", () => {
  it("drops malformed object entries while preserving complete key/value pairs", () => {
    const ast = normalizeAst({ type: "unary", value: "{", lhs: [null, [], [name], [name, name]] });
    expect(ast).toMatchObject({ type: "object", entries: [[{ type: "name", value: "field" }, { type: "name", value: "field" }]] });
    expect(normalizeAst({ type: "unary", value: "{", lhs: null })).toMatchObject({ type: "object", entries: [] });
  });

  it("retains group entries even when upstream position metadata is absent", () => {
    const ast = normalizeAst({ type: "path", steps: [name], group: { lhs: [[name, name]] } });
    expect(ast).toMatchObject({
      type: "path",
      group: { type: "group", position: undefined, source: { type: "group", position: undefined }, entries: [[{ type: "name", value: "field" }, { type: "name", value: "field" }]] },
    });
  });

  it.each(["name", "variable", "string", "index"])("normalizes a missing %s value to an empty string", (type) => {
    const ast = normalizeAst({ type });
    expect(ast).toMatchObject(type === "index"
      ? { type: "position-binding", name: "", position: 0 }
      : { type, value: "", position: 0 });
  });

  it("keeps binary operands when the upstream operator value is absent", () => {
    expect(normalizeAst({ type: "binary", lhs: name, rhs: name })).toMatchObject({
      type: "binary", value: "", lhs: { type: "name", value: "field" }, rhs: { type: "name", value: "field" },
    });
  });

  it("represents an operand-less unary node without inventing an expression", () => {
    expect(normalizeAst({ type: "unary", value: "-" })).toEqual({
      type: "negate", position: 0, expression: undefined, source: { type: "unary", value: "-" },
    });
  });

  it.each([
    { type: "filter", expr: name },
    { type: "sort", terms: [{ expression: name, descending: true }] },
    { type: "transform", pattern: name, update: { type: "unary", value: "{", lhs: [] } },
  ])("does not invent a source position for $type nodes", (raw) => {
    const ast = normalizeAst(raw);
    expect(ast).toHaveProperty("position", undefined);
    expect(ast.source).toEqual({ type: raw.type });
    if (ast.type === "filter") expect(ast.expr).toMatchObject({ type: "name", value: "field" });
    if (ast.type === "sort") expect(ast.terms).toMatchObject([{ descending: true, expression: { type: "name", value: "field" } }]);
    if (ast.type === "transform") expect(ast).toMatchObject({ pattern: { type: "name", value: "field" }, update: { type: "object", entries: [] } });
  });

  it("preserves explicit parent-position metadata and its resolution slot", () => {
    const slot = { label: "ancestor", level: 1, index: 0 };
    expect(normalizeAst({ type: "parent", slot, position: 7 })).toMatchObject({
      type: "parent", slot, position: 7, source: { type: "parent", position: 7 },
    });
  });
});
