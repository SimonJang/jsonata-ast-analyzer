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

  // ============================================================
  // Phase 2: Scope Infrastructure and Variable Tracing
  // ============================================================

  // ---------- SCOPE-01: Variable assignment tracing ----------
  describe("SCOPE-01: Variable assignment tracing", () => {
    it('resolves simple variable assignment: "($x := account.name; $x)"', () => {
      expect(extractPaths("($x := account.name; $x)")).toEqual([
        { path: "account.name" },
      ]);
    });

    it('extracts RHS paths even when reassigned: "($x := a; $x := b; $x)"', () => {
      expect(extractPaths("($x := a; $x := b; $x)")).toEqual([
        { path: "a" },
        { path: "b" },
      ]);
    });

    it('resolves multi-hop variable chain: "($a := x.y; $b := $a.z; $b)"', () => {
      expect(extractPaths("($a := x.y; $b := $a.z; $b)")).toEqual([
        { path: "x.y" },
        { path: "x.y.z" },
      ]);
    });

    it('inner block does not leak scope: "($x := a; ($x := b; $x); $x)"', () => {
      expect(extractPaths("($x := a; ($x := b; $x); $x)")).toEqual([
        { path: "a" },
        { path: "b" },
      ]);
    });

    it('resolves variable in path context: "($x := account; $x.name)"', () => {
      expect(extractPaths("($x := account; $x.name)")).toEqual([
        { path: "account" },
        { path: "account.name" },
      ]);
    });
  });

  // ---------- SCOPE-01: Cycle detection ----------
  describe("SCOPE-01: Cycle detection", () => {
    it('handles self-referencing variable without recursion: "($x := $x.y; $x)"', () => {
      expect(extractPaths("($x := $x.y; $x)")).toEqual([]);
    });

    it('handles mutual variable reference without recursion: "($a := $b; $b := $a; $a)"', () => {
      expect(extractPaths("($a := $b; $b := $a; $a)")).toEqual([]);
    });
  });

  // ---------- SCOPE-02: Context variable binding (@$v) ----------
  describe("SCOPE-02: Context variable binding (@$v)", () => {
    it('extracts base path from context binding: "items@$v"', () => {
      expect(extractPaths("items@$v")).toEqual([{ path: "items" }]);
    });
  });

  // ---------- SCOPE-03: Positional variables (#$i) ----------
  describe("SCOPE-03: Positional variables (#$i)", () => {
    it('extracts base path, positional var produces no extra paths: "items#$i"', () => {
      expect(extractPaths("items#$i")).toEqual([{ path: "items" }]);
    });
  });

  // ---------- EXPR-05: Function argument extraction ----------
  describe("EXPR-05: Function argument extraction", () => {
    it('extracts argument path from $sum: "$sum(items.price)"', () => {
      expect(extractPaths("$sum(items.price)")).toEqual([
        { path: "items.price" },
      ]);
    });

    it('extracts argument path from $count: "$count(orders)"', () => {
      expect(extractPaths("$count(orders)")).toEqual([{ path: "orders" }]);
    });

    it('extracts path args, ignores literal args: "$substring(name, 0, 5)"', () => {
      expect(extractPaths("$substring(name, 0, 5)")).toEqual([
        { path: "name" },
      ]);
    });

    it('extracts argument paths from unknown function: "$unknownFunc(a.b)"', () => {
      expect(extractPaths("$unknownFunc(a.b)")).toEqual([{ path: "a.b" }]);
    });

    it('extracts arguments from multiple function calls: "$sum(items.price) + $count(orders)"', () => {
      expect(extractPaths("$sum(items.price) + $count(orders)")).toEqual([
        { path: "items.price" },
        { path: "orders" },
      ]);
    });
  });

  // ---------- Phase 2 Edge cases ----------
  describe("Phase 2 Edge cases", () => {
    it('produces no paths for root reference: "$"', () => {
      expect(extractPaths("$")).toEqual([]);
    });

    it('variable bound to literal produces no paths: "($x := 42; $x)"', () => {
      expect(extractPaths("($x := 42; $x)")).toEqual([]);
    });

    it('resolves variable bound to conditional RHS: "($x := a > 0 ? b.c : d.e; $x)"', () => {
      expect(extractPaths("($x := a > 0 ? b.c : d.e; $x)")).toEqual([
        { path: "a" },
        { path: "b.c" },
        { path: "d.e" },
      ]);
    });
  });

  // ============================================================
  // Phase 2 Plan 02: Lambda, Higher-Order, Apply, Custom Functions
  // ============================================================

  // ---------- SCOPE-04: $map -- element binding ----------
  describe("SCOPE-04: $map element binding", () => {
    it('resolves $map element: "$map(items, function($v) { $v.name })"', () => {
      expect(extractPaths("$map(items, function($v) { $v.name })")).toEqual([
        { path: "items" },
        { path: "items.name" },
      ]);
    });

    it('resolves $map element + index: "$map(orders.items, function($v, $i) { $v.price })"', () => {
      expect(
        extractPaths("$map(orders.items, function($v, $i) { $v.price })"),
      ).toEqual([
        { path: "orders.items" },
        { path: "orders.items.price" },
      ]);
    });

    it('resolves $map element + index + array: "$map(data, function($v, $i, $a) { $v.x + $a })"', () => {
      const result = extractPaths(
        "$map(data, function($v, $i, $a) { $v.x + $a })",
      );
      expect(result).toEqual(
        expect.arrayContaining([{ path: "data" }, { path: "data.x" }]),
      );
    });
  });

  // ---------- SCOPE-04: $filter -- element binding ----------
  describe("SCOPE-04: $filter element binding", () => {
    it('resolves $filter element: "$filter(orders, function($v) { $v.total > 100 })"', () => {
      expect(
        extractPaths("$filter(orders, function($v) { $v.total > 100 })"),
      ).toEqual([{ path: "orders" }, { path: "orders.total" }]);
    });
  });

  // ---------- SCOPE-04: $reduce -- accumulator + element ----------
  describe("SCOPE-04: $reduce accumulator + element", () => {
    it('resolves $reduce: "$reduce(values, function($prev, $curr) { $prev + $curr })"', () => {
      expect(
        extractPaths(
          "$reduce(values, function($prev, $curr) { $prev + $curr })",
        ),
      ).toEqual([{ path: "values" }]);
    });
  });

  // ---------- SCOPE-04: $each -- value/key ----------
  describe("SCOPE-04: $each value/key", () => {
    it('resolves $each value: "$each(data, function($v, $k) { $v })"', () => {
      expect(extractPaths("$each(data, function($v, $k) { $v })")).toEqual([
        { path: "data" },
      ]);
    });
  });

  // ---------- SCOPE-04: $sift -- value/key ----------
  describe("SCOPE-04: $sift value/key", () => {
    it('resolves $sift value: "$sift(record, function($v, $k) { $v > 10 })"', () => {
      expect(
        extractPaths("$sift(record, function($v, $k) { $v > 10 })"),
      ).toEqual([{ path: "record" }]);
    });
  });

  // ---------- SCOPE-04: Lambda closure capture ----------
  describe("SCOPE-04: Lambda closure capture", () => {
    it('captures enclosing scope variable: "($prefix := a.b; $map(items, function($v) { $prefix }))"', () => {
      expect(
        extractPaths(
          "($prefix := a.b; $map(items, function($v) { $prefix }))",
        ),
      ).toEqual([{ path: "a.b" }, { path: "items" }]);
    });
  });

  // ---------- SCOPE-04: Lambda parameter shadowing built-in ----------
  describe("SCOPE-04: Lambda parameter shadowing built-in", () => {
    it('lambda param $sum shadows built-in: "$map(items, function($sum) { $sum.x })"', () => {
      expect(
        extractPaths("$map(items, function($sum) { $sum.x })"),
      ).toEqual([{ path: "items" }, { path: "items.x" }]);
    });
  });

  // ---------- SCOPE-04: Apply operator (~>) ----------
  describe("SCOPE-04: Apply operator (~>)", () => {
    it('apply with $map: "items ~> $map(function($v) { $v.name })"', () => {
      expect(
        extractPaths("items ~> $map(function($v) { $v.name })"),
      ).toEqual([{ path: "items" }, { path: "items.name" }]);
    });

    it('apply with $filter: "data ~> $filter(function($v) { $v.active })"', () => {
      expect(
        extractPaths("data ~> $filter(function($v) { $v.active })"),
      ).toEqual([{ path: "data" }, { path: "data.active" }]);
    });

    it('apply with non-higher-order built-in: "items ~> $sum()"', () => {
      expect(extractPaths("items ~> $sum()")).toEqual([{ path: "items" }]);
    });
  });

  // ---------- SCOPE-05: Custom function calls ----------
  describe("SCOPE-05: Custom function calls", () => {
    it('traces custom function call: "($fn := function($x) { $x.name }; $fn(account))"', () => {
      expect(
        extractPaths("($fn := function($x) { $x.name }; $fn(account))"),
      ).toEqual([{ path: "account" }, { path: "account.name" }]);
    });

    it('traces multi-param custom function: "($fn := function($a, $b) { $a.x + $b.y }; $fn(data1, data2))"', () => {
      expect(
        extractPaths(
          "($fn := function($a, $b) { $a.x + $b.y }; $fn(data1, data2))",
        ),
      ).toEqual([
        { path: "data1" },
        { path: "data2" },
        { path: "data1.x" },
        { path: "data2.y" },
      ]);
    });

    it('unknown function passes through args: "$unknownFunc(a.b, c.d)"', () => {
      expect(extractPaths("$unknownFunc(a.b, c.d)")).toEqual([
        { path: "a.b" },
        { path: "c.d" },
      ]);
    });
  });

  // ---------- Edge cases: Nested higher-order ----------
  describe("Edge cases: Nested higher-order functions", () => {
    it('resolves nested $map: "$map(items, function($v) { $map($v.children, function($c) { $c.name }) })"', () => {
      expect(
        extractPaths(
          "$map(items, function($v) { $map($v.children, function($c) { $c.name }) })",
        ),
      ).toEqual([
        { path: "items" },
        { path: "items.children" },
        { path: "items.children.name" },
      ]);
    });
  });
});
