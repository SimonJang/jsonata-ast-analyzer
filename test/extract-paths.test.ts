import { describe, it, expect } from "vitest";
import { extractPaths } from "../src/index.js";

describe("extractPaths", () => {
  // ---------- PATH-01: Simple dot-path references ----------
  describe("PATH-01: Simple dot-path references", () => {
    it('extracts single field name: "name"', () => {
      expect(extractPaths("name")).toEqual([{ path: "name" }]);
    });

    it('extracts two-step dot-path: "account.name"', () => {
      expect(extractPaths("account.name")).toEqual([{ path: "account.name" }]);
    });
  });

  // ---------- PATH-02: Nested multi-step paths ----------
  describe("PATH-02: Nested multi-step paths", () => {
    it('extracts three-step path: "order.items.price"', () => {
      expect(extractPaths("order.items.price")).toEqual([
        { path: "order.items.price" },
      ]);
    });

    it('extracts five-step path: "a.b.c.d.e"', () => {
      expect(extractPaths("a.b.c.d.e")).toEqual([{ path: "a.b.c.d.e" }]);
    });
  });

  // ---------- PATH-03: Wildcard operator ----------
  describe("PATH-03: Wildcard operator", () => {
    it('extracts wildcard in path: "order.*"', () => {
      expect(extractPaths("order.*")).toEqual([{ path: "order.*" }]);
    });

    it('extracts standalone wildcard: "*"', () => {
      expect(extractPaths("*")).toEqual([{ path: "*" }]);
    });

    it('extracts wildcard in middle of path: "a.*.b"', () => {
      expect(extractPaths("a.*.b")).toEqual([{ path: "a.*.b" }]);
    });
  });

  // ---------- PATH-04: Descendant operator ----------
  describe("PATH-04: Descendant operator", () => {
    it('extracts descendant operator: "**.price"', () => {
      expect(extractPaths("**.price")).toEqual([{ path: "**.price" }]);
    });

    it('extracts descendant in middle of path: "account.**.price"', () => {
      expect(extractPaths("account.**.price")).toEqual([
        { path: "account.**.price" },
      ]);
    });
  });

  // ---------- PATH-05: Literals produce no paths ----------
  describe("PATH-05: Literals produce no paths", () => {
    it("produces no paths for string literal", () => {
      expect(extractPaths('"hello"')).toEqual([]);
    });

    it("produces no paths for number literal", () => {
      expect(extractPaths("42")).toEqual([]);
    });

    it("produces no paths for true", () => {
      expect(extractPaths("true")).toEqual([]);
    });

    it("produces no paths for false", () => {
      expect(extractPaths("false")).toEqual([]);
    });

    it("produces no paths for null", () => {
      expect(extractPaths("null")).toEqual([]);
    });
  });

  // ---------- EXPR-01: Binary operator paths ----------
  describe("EXPR-01: Binary operator paths", () => {
    it('extracts both operands: "price * quantity"', () => {
      expect(extractPaths("price * quantity")).toEqual([
        { path: "price" },
        { path: "quantity" },
      ]);
    });

    it('extracts both operands: "a + b"', () => {
      expect(extractPaths("a + b")).toEqual([
        { path: "a" },
        { path: "b" },
      ]);
    });

    it('extracts only path operand when other is literal: "a > 1"', () => {
      expect(extractPaths("a > 1")).toEqual([{ path: "a" }]);
    });

    it('extracts only path operand when other is string literal: name & " suffix"', () => {
      expect(extractPaths('name & " suffix"')).toEqual([{ path: "name" }]);
    });

    it('extracts paths from nested binary: "a + b * c"', () => {
      const result = extractPaths("a + b * c");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "a" },
          { path: "b" },
          { path: "c" },
        ]),
      );
      expect(result).toHaveLength(3);
    });
  });

  // ---------- EXPR-02: Conditional expression paths ----------
  describe("EXPR-02: Conditional expression paths", () => {
    it('extracts all three branches: "a ? b : c"', () => {
      expect(extractPaths("a ? b : c")).toEqual([
        { path: "a" },
        { path: "b" },
        { path: "c" },
      ]);
    });

    it('extracts condition and then without else: "condition ? thenBranch"', () => {
      expect(extractPaths("condition ? thenBranch")).toEqual([
        { path: "condition" },
        { path: "thenBranch" },
      ]);
    });

    it('extracts dot-paths from all branches: "x.y ? a.b : c.d"', () => {
      expect(extractPaths("x.y ? a.b : c.d")).toEqual([
        { path: "x.y" },
        { path: "a.b" },
        { path: "c.d" },
      ]);
    });
  });

  // ---------- EXPR-04: Block expression paths ----------
  describe("EXPR-04: Block expression paths", () => {
    it('extracts paths from all block sub-expressions: "(a; b; c)"', () => {
      expect(extractPaths("(a; b; c)")).toEqual([
        { path: "a" },
        { path: "b" },
        { path: "c" },
      ]);
    });

    it('extracts paths from block with dot-paths: "(x.y; z)"', () => {
      expect(extractPaths("(x.y; z)")).toEqual([
        { path: "x.y" },
        { path: "z" },
      ]);
    });
  });

  // ---------- Deduplication ----------
  describe("Deduplication", () => {
    it('deduplicates identical paths: "a + a"', () => {
      expect(extractPaths("a + a")).toEqual([{ path: "a" }]);
    });

    it('deduplicates within block: "(x; x; y)"', () => {
      expect(extractPaths("(x; x; y)")).toEqual([
        { path: "x" },
        { path: "y" },
      ]);
    });
  });

  // ---------- Edge cases ----------
  describe("Edge cases", () => {
    it('produces no paths for variable reference: "$x"', () => {
      expect(extractPaths("$x")).toEqual([]);
    });

    it('extracts path from unary negation: "-price"', () => {
      expect(extractPaths("-price")).toEqual([{ path: "price" }]);
    });

    it('extracts paths from array constructor: "[a, b, c]"', () => {
      expect(extractPaths("[a, b, c]")).toEqual([
        { path: "a" },
        { path: "b" },
        { path: "c" },
      ]);
    });

    it('extracts value path from object constructor: {"key": value}', () => {
      expect(extractPaths('{"key": value}')).toEqual([{ path: "value" }]);
    });
  });

  // ---------- Error handling ----------
  describe("Error handling", () => {
    it("throws on empty input", () => {
      expect(() => extractPaths("")).toThrow();
    });

    it("throws on whitespace-only input", () => {
      expect(() => extractPaths("   ")).toThrow();
    });
  });
});
