import { describe, it, expect } from "vitest";
import { extractPaths } from "../src/index.js";

describe("extractPaths", () => {
  // ---------- PATH-01: Simple dot-path references ----------
  describe("PATH-01: Simple dot-path references", () => {
    it('extracts single field name: "name"', () => {
      expect(extractPaths("name")).toEqual([{ path: "name", confidence: "static" }]);
    });

    it('extracts two-step dot-path: "account.name"', () => {
      expect(extractPaths("account.name")).toEqual([{ path: "account.name", confidence: "static" }]);
    });
  });

  // ---------- PATH-02: Nested multi-step paths ----------
  describe("PATH-02: Nested multi-step paths", () => {
    it('extracts three-step path: "order.items.price"', () => {
      expect(extractPaths("order.items.price")).toEqual([
        { path: "order.items.price", confidence: "static" },
      ]);
    });

    it('extracts five-step path: "a.b.c.d.e"', () => {
      expect(extractPaths("a.b.c.d.e")).toEqual([{ path: "a.b.c.d.e", confidence: "static" }]);
    });
  });

  // ---------- PATH-03: Wildcard operator ----------
  describe("PATH-03: Wildcard operator", () => {
    it('extracts wildcard in path: "order.*"', () => {
      expect(extractPaths("order.*")).toEqual([{ path: "order.*", confidence: "static" }]);
    });

    it('extracts standalone wildcard: "*"', () => {
      expect(extractPaths("*")).toEqual([{ path: "*", confidence: "static" }]);
    });

    it('extracts wildcard in middle of path: "a.*.b"', () => {
      expect(extractPaths("a.*.b")).toEqual([{ path: "a.*.b", confidence: "static" }]);
    });
  });

  // ---------- PATH-04: Descendant operator ----------
  describe("PATH-04: Descendant operator", () => {
    it('extracts descendant operator: "**.price"', () => {
      expect(extractPaths("**.price")).toEqual([{ path: "**.price", confidence: "static" }]);
    });

    it('extracts descendant in middle of path: "account.**.price"', () => {
      expect(extractPaths("account.**.price")).toEqual([
        { path: "account.**.price", confidence: "static" },
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
        { path: "price", confidence: "static" },
        { path: "quantity", confidence: "static" },
      ]);
    });

    it('extracts both operands: "a + b"', () => {
      expect(extractPaths("a + b")).toEqual([
        { path: "a", confidence: "static" },
        { path: "b", confidence: "static" },
      ]);
    });

    it('extracts only path operand when other is literal: "a > 1"', () => {
      expect(extractPaths("a > 1")).toEqual([{ path: "a", confidence: "static" }]);
    });

    it('extracts only path operand when other is string literal: name & " suffix"', () => {
      expect(extractPaths('name & " suffix"')).toEqual([{ path: "name", confidence: "static" }]);
    });

    it('extracts paths from nested binary: "a + b * c"', () => {
      const result = extractPaths("a + b * c");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "a", confidence: "static" },
          { path: "b", confidence: "static" },
          { path: "c", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(3);
    });
  });

  // ---------- EXPR-02: Conditional expression paths ----------
  describe("EXPR-02: Conditional expression paths", () => {
    it('extracts all three branches: "a ? b : c"', () => {
      expect(extractPaths("a ? b : c")).toEqual([
        { path: "a", confidence: "static" },
        { path: "b", confidence: "static" },
        { path: "c", confidence: "static" },
      ]);
    });

    it('extracts condition and then without else: "condition ? thenBranch"', () => {
      expect(extractPaths("condition ? thenBranch")).toEqual([
        { path: "condition", confidence: "static" },
        { path: "thenBranch", confidence: "static" },
      ]);
    });

    it('extracts dot-paths from all branches: "x.y ? a.b : c.d"', () => {
      expect(extractPaths("x.y ? a.b : c.d")).toEqual([
        { path: "x.y", confidence: "static" },
        { path: "a.b", confidence: "static" },
        { path: "c.d", confidence: "static" },
      ]);
    });
  });

  // ---------- EXPR-04: Block expression paths ----------
  describe("EXPR-04: Block expression paths", () => {
    it('extracts paths from all block sub-expressions: "(a; b; c)"', () => {
      expect(extractPaths("(a; b; c)")).toEqual([
        { path: "a", confidence: "static" },
        { path: "b", confidence: "static" },
        { path: "c", confidence: "static" },
      ]);
    });

    it('extracts paths from block with dot-paths: "(x.y; z)"', () => {
      expect(extractPaths("(x.y; z)")).toEqual([
        { path: "x.y", confidence: "static" },
        { path: "z", confidence: "static" },
      ]);
    });
  });

  // ---------- Deduplication ----------
  describe("Deduplication", () => {
    it('deduplicates identical paths: "a + a"', () => {
      expect(extractPaths("a + a")).toEqual([{ path: "a", confidence: "static" }]);
    });

    it('deduplicates within block: "(x; x; y)"', () => {
      expect(extractPaths("(x; x; y)")).toEqual([
        { path: "x", confidence: "static" },
        { path: "y", confidence: "static" },
      ]);
    });
  });

  // ---------- Edge cases ----------
  describe("Edge cases", () => {
    it('produces no paths for variable reference: "$x"', () => {
      expect(extractPaths("$x")).toEqual([]);
    });

    it('extracts path from unary negation: "-price"', () => {
      expect(extractPaths("-price")).toEqual([{ path: "price", confidence: "static" }]);
    });

    it('extracts paths from array constructor: "[a, b, c]"', () => {
      expect(extractPaths("[a, b, c]")).toEqual([
        { path: "a", confidence: "static" },
        { path: "b", confidence: "static" },
        { path: "c", confidence: "static" },
      ]);
    });

    it('extracts value path from object constructor: {"key": value}', () => {
      expect(extractPaths('{"key": value}')).toEqual([{ path: "value", confidence: "static" }]);
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
        { path: "account.name", confidence: "static" },
      ]);
    });

    it('extracts RHS paths even when reassigned: "($x := a; $x := b; $x)"', () => {
      expect(extractPaths("($x := a; $x := b; $x)")).toEqual([
        { path: "a", confidence: "static" },
        { path: "b", confidence: "static" },
      ]);
    });

    it('resolves multi-hop variable chain: "($a := x.y; $b := $a.z; $b)"', () => {
      expect(extractPaths("($a := x.y; $b := $a.z; $b)")).toEqual([
        { path: "x.y", confidence: "static" },
        { path: "x.y.z", confidence: "static" },
      ]);
    });

    it('inner block does not leak scope: "($x := a; ($x := b; $x); $x)"', () => {
      expect(extractPaths("($x := a; ($x := b; $x); $x)")).toEqual([
        { path: "a", confidence: "static" },
        { path: "b", confidence: "static" },
      ]);
    });

    it('resolves variable in path context: "($x := account; $x.name)"', () => {
      expect(extractPaths("($x := account; $x.name)")).toEqual([
        { path: "account", confidence: "static" },
        { path: "account.name", confidence: "static" },
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
      expect(extractPaths("items@$v")).toEqual([{ path: "items", confidence: "static" }]);
    });
  });

  // ---------- SCOPE-03: Positional variables (#$i) ----------
  describe("SCOPE-03: Positional variables (#$i)", () => {
    it('extracts base path, positional var produces no extra paths: "items#$i"', () => {
      expect(extractPaths("items#$i")).toEqual([{ path: "items", confidence: "static" }]);
    });
  });

  // ---------- EXPR-05: Function argument extraction ----------
  describe("EXPR-05: Function argument extraction", () => {
    it('extracts argument path from $sum: "$sum(items.price)"', () => {
      expect(extractPaths("$sum(items.price)")).toEqual([
        { path: "items.price", confidence: "static" },
      ]);
    });

    it('extracts argument path from $count: "$count(orders)"', () => {
      expect(extractPaths("$count(orders)")).toEqual([{ path: "orders", confidence: "static" }]);
    });

    it('extracts path args, ignores literal args: "$substring(name, 0, 5)"', () => {
      expect(extractPaths("$substring(name, 0, 5)")).toEqual([
        { path: "name", confidence: "static" },
      ]);
    });

    it('extracts argument paths from unknown function: "$unknownFunc(a.b)"', () => {
      expect(extractPaths("$unknownFunc(a.b)")).toEqual([{ path: "a.b", confidence: "static" }]);
    });

    it('extracts arguments from multiple function calls: "$sum(items.price) + $count(orders)"', () => {
      expect(extractPaths("$sum(items.price) + $count(orders)")).toEqual([
        { path: "items.price", confidence: "static" },
        { path: "orders", confidence: "static" },
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
        { path: "a", confidence: "static" },
        { path: "b.c", confidence: "static" },
        { path: "d.e", confidence: "static" },
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
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]);
    });

    it('resolves $map element + index: "$map(orders.items, function($v, $i) { $v.price })"', () => {
      expect(
        extractPaths("$map(orders.items, function($v, $i) { $v.price })"),
      ).toEqual([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.price", confidence: "static" },
      ]);
    });

    it('resolves $map element + index + array: "$map(data, function($v, $i, $a) { $v.x + $a })"', () => {
      const result = extractPaths(
        "$map(data, function($v, $i, $a) { $v.x + $a })",
      );
      expect(result).toEqual(
        expect.arrayContaining([{ path: "data", confidence: "static" }, { path: "data.x", confidence: "static" }]),
      );
    });
  });

  // ---------- SCOPE-04: $filter -- element binding ----------
  describe("SCOPE-04: $filter element binding", () => {
    it('resolves $filter element: "$filter(orders, function($v) { $v.total > 100 })"', () => {
      expect(
        extractPaths("$filter(orders, function($v) { $v.total > 100 })"),
      ).toEqual([{ path: "orders", confidence: "static" }, { path: "orders.total", confidence: "static" }]);
    });
  });

  // ---------- SCOPE-04: $reduce -- accumulator + element ----------
  describe("SCOPE-04: $reduce accumulator + element", () => {
    it('resolves $reduce: "$reduce(values, function($prev, $curr) { $prev + $curr })"', () => {
      expect(
        extractPaths(
          "$reduce(values, function($prev, $curr) { $prev + $curr })",
        ),
      ).toEqual([{ path: "values", confidence: "static" }]);
    });
  });

  // ---------- SCOPE-04: $each -- value/key ----------
  describe("SCOPE-04: $each value/key", () => {
    it('resolves $each value: "$each(data, function($v, $k) { $v })"', () => {
      expect(extractPaths("$each(data, function($v, $k) { $v })")).toEqual([
        { path: "data", confidence: "static" },
      ]);
    });
  });

  // ---------- SCOPE-04: $sift -- value/key ----------
  describe("SCOPE-04: $sift value/key", () => {
    it('resolves $sift value: "$sift(record, function($v, $k) { $v > 10 })"', () => {
      expect(
        extractPaths("$sift(record, function($v, $k) { $v > 10 })"),
      ).toEqual([{ path: "record", confidence: "static" }]);
    });
  });

  // ---------- SCOPE-04: Lambda closure capture ----------
  describe("SCOPE-04: Lambda closure capture", () => {
    it('captures enclosing scope variable: "($prefix := a.b; $map(items, function($v) { $prefix }))"', () => {
      expect(
        extractPaths(
          "($prefix := a.b; $map(items, function($v) { $prefix }))",
        ),
      ).toEqual([{ path: "a.b", confidence: "static" }, { path: "items", confidence: "static" }]);
    });
  });

  // ---------- SCOPE-04: Lambda parameter shadowing built-in ----------
  describe("SCOPE-04: Lambda parameter shadowing built-in", () => {
    it('lambda param $sum shadows built-in: "$map(items, function($sum) { $sum.x })"', () => {
      expect(
        extractPaths("$map(items, function($sum) { $sum.x })"),
      ).toEqual([{ path: "items", confidence: "static" }, { path: "items.x", confidence: "static" }]);
    });
  });

  // ---------- SCOPE-04: Apply operator (~>) ----------
  describe("SCOPE-04: Apply operator (~>)", () => {
    it('apply with $map: "items ~> $map(function($v) { $v.name })"', () => {
      expect(
        extractPaths("items ~> $map(function($v) { $v.name })"),
      ).toEqual([{ path: "items", confidence: "static" }, { path: "items.name", confidence: "static" }]);
    });

    it('apply with $filter: "data ~> $filter(function($v) { $v.active })"', () => {
      expect(
        extractPaths("data ~> $filter(function($v) { $v.active })"),
      ).toEqual([{ path: "data", confidence: "static" }, { path: "data.active", confidence: "static" }]);
    });

    it('apply with non-higher-order built-in: "items ~> $sum()"', () => {
      expect(extractPaths("items ~> $sum()")).toEqual([{ path: "items", confidence: "static" }]);
    });
  });

  // ---------- SCOPE-05: Custom function calls ----------
  describe("SCOPE-05: Custom function calls", () => {
    it('traces custom function call: "($fn := function($x) { $x.name }; $fn(account))"', () => {
      expect(
        extractPaths("($fn := function($x) { $x.name }; $fn(account))"),
      ).toEqual([{ path: "account", confidence: "static" }, { path: "account.name", confidence: "static" }]);
    });

    it('traces multi-param custom function: "($fn := function($a, $b) { $a.x + $b.y }; $fn(data1, data2))"', () => {
      expect(
        extractPaths(
          "($fn := function($a, $b) { $a.x + $b.y }; $fn(data1, data2))",
        ),
      ).toEqual([
        { path: "data1", confidence: "static" },
        { path: "data2", confidence: "static" },
        { path: "data1.x", confidence: "static" },
        { path: "data2.y", confidence: "static" },
      ]);
    });

    it('unknown function passes through args: "$unknownFunc(a.b, c.d)"', () => {
      expect(extractPaths("$unknownFunc(a.b, c.d)")).toEqual([
        { path: "a.b", confidence: "static" },
        { path: "c.d", confidence: "static" },
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
        { path: "items", confidence: "static" },
        { path: "items.children", confidence: "static" },
        { path: "items.children.name", confidence: "static" },
      ]);
    });
  });

  // ============================================================
  // Phase 3 Plan 01: Filter Predicates and Array Index Distinction
  // ============================================================

  // ---------- EXPR-03: Filter predicate path extraction ----------
  describe("EXPR-03: Filter predicate path extraction", () => {
    it('extracts filter predicate paths: "items[price > 10]"', () => {
      expect(extractPaths("items[price > 10]")).toEqual([
        { path: "items", confidence: "static" },
        { path: "items.price", confidence: "static" },
      ]);
    });

    it('filter with literal comparison does not produce path for literal: "items[price > 10]"', () => {
      const result = extractPaths("items[price > 10]");
      expect(result).toContainEqual({ path: "items.price", confidence: "static" });
      // Should NOT contain a path for the literal 10
      expect(result).not.toContainEqual({ path: "items.10", confidence: "static" });
    });

    it('extracts filter in middle of multi-step path: "account.orders[total > 100].items"', () => {
      const result = extractPaths("account.orders[total > 100].items");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "account.orders.items", confidence: "static" },
          { path: "account.orders.total", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('extracts boolean coercion filter (bare name): "items[active]"', () => {
      expect(extractPaths("items[active]")).toEqual([
        { path: "items", confidence: "static" },
        { path: "items.active", confidence: "static" },
      ]);
    });

    it('extracts nested filter paths: "orders[items[price > 10]]"', () => {
      const result = extractPaths("orders[items[price > 10]]");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "orders", confidence: "static" },
          { path: "orders.items", confidence: "static" },
          { path: "orders.items.price", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(3);
    });

    it('filter with external variable -- no leakage: "($threshold := 50; items[price > $threshold])"', () => {
      const result = extractPaths(
        "($threshold := 50; items[price > $threshold])",
      );
      expect(result).toContainEqual({ path: "items", confidence: "static" });
      expect(result).toContainEqual({ path: "items.price", confidence: "static" });
      // $threshold resolves to [] (literal 50) -- no spurious paths
      expect(result).not.toContainEqual({ path: "items.50", confidence: "static" });
    });

    it('focus variable binding: "items@$v[type = \\"A\\"]"', () => {
      const result = extractPaths('items@$v[type = "A"]');
      expect(result).toContainEqual({ path: "items", confidence: "static" });
      expect(result).toContainEqual({ path: "items.type", confidence: "static" });
    });
  });

  // ---------- EXPR-06: Array index vs filter distinction ----------
  describe("EXPR-06: Array index vs filter distinction", () => {
    it('numeric index (positive) produces no filter path: "items[0]"', () => {
      expect(extractPaths("items[0]")).toEqual([{ path: "items", confidence: "static" }]);
    });

    it('numeric index (negative) produces no filter path: "items[-1]"', () => {
      expect(extractPaths("items[-1]")).toEqual([{ path: "items", confidence: "static" }]);
    });

    it('variable as index (over-approximate as filter): "($i := 0; items[$i])"', () => {
      const result = extractPaths("($i := 0; items[$i])");
      expect(result).toContainEqual({ path: "items", confidence: "static" });
      // $i resolves to [] (literal 0), so no additional paths beyond "items"
    });

    it('multiple stages on one step: "items[price > 10][0]"', () => {
      const result = extractPaths("items[price > 10][0]");
      expect(result).toContainEqual({ path: "items", confidence: "static" });
      expect(result).toContainEqual({ path: "items.price", confidence: "static" });
    });
  });

  // ============================================================
  // Phase 3 Plan 02: Sort, Group-By, and Transform Operators
  // ============================================================

  // ---------- EXPR-07: Sort expression extraction ----------
  describe("EXPR-07: Sort expression extraction", () => {
    it('extracts sort key path: "items^(price)"', () => {
      expect(extractPaths("items^(price)")).toEqual([
        { path: "items", confidence: "static" },
        { path: "items.price", confidence: "static" },
      ]);
    });

    it('extracts multi-key sort paths: "items^(>price, <date)"', () => {
      const result = extractPaths("items^(>price, <date)");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "items", confidence: "static" },
          { path: "items.price", confidence: "static" },
          { path: "items.date", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(3);
    });

    it('extracts sort with path continuation: "items^(price).name"', () => {
      const result = extractPaths("items^(price).name");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "items.name", confidence: "static" },
          { path: "items.price", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('extracts multi-step path with sort: "account.items^(price)"', () => {
      const result = extractPaths("account.items^(price)");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "account.items", confidence: "static" },
          { path: "account.items.price", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('extracts sort with complex sort key expression: "items^(price * quantity)"', () => {
      const result = extractPaths("items^(price * quantity)");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "items", confidence: "static" },
          { path: "items.price", confidence: "static" },
          { path: "items.quantity", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(3);
    });
  });

  // ---------- EXPR-08: Transform operator ----------
  describe("EXPR-08: Transform operator", () => {
    it('extracts transform pattern and update paths: | Account | {"name": FirstName} |', () => {
      const result = extractPaths('| Account | {"name": FirstName} |');
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "Account", confidence: "static" },
          { path: "Account.FirstName", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('transform with delete clause -- no paths from delete: | Account | {"name": FirstName}, ["oldField"] |', () => {
      const result = extractPaths(
        '| Account | {"name": FirstName}, ["oldField"] |',
      );
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "Account", confidence: "static" },
          { path: "Account.FirstName", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(2);
      // "oldField" is a string literal in delete clause, NOT a path
      expect(result).not.toContainEqual({ path: "oldField", confidence: "static" });
      expect(result).not.toContainEqual({ path: "Account.oldField", confidence: "static" });
    });

    it('transform with multi-step pattern: | data.Account | {"name": FirstName} |', () => {
      const result = extractPaths('| data.Account | {"name": FirstName} |');
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "data.Account", confidence: "static" },
          { path: "data.Account.FirstName", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('transform with multiple update values: | Account | {"first": FirstName, "last": LastName} |', () => {
      const result = extractPaths(
        '| Account | {"first": FirstName, "last": LastName} |',
      );
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "Account", confidence: "static" },
          { path: "Account.FirstName", confidence: "static" },
          { path: "Account.LastName", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(3);
    });
  });

  // ---------- Group-by (supplementary to EXPR-07) ----------
  describe("Group-by: context-relative key/value extraction", () => {
    it('extracts group-by key and value paths: "items{category: price}"', () => {
      const result = extractPaths("items{category: price}");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "items", confidence: "static" },
          { path: "items.category", confidence: "static" },
          { path: "items.price", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(3);
    });

    it('extracts group-by with multi-step path: "account.items{category: price}"', () => {
      const result = extractPaths("account.items{category: price}");
      expect(result).toEqual(
        expect.arrayContaining([
          { path: "account.items", confidence: "static" },
          { path: "account.items.category", confidence: "static" },
          { path: "account.items.price", confidence: "static" },
        ]),
      );
      expect(result).toHaveLength(3);
    });
  });

  // ============================================================
  // Phase 4 Plan 01: Parent Operator and Dynamic Bracket Wildcard
  // ============================================================

  // ---------- ADV-01: Parent operator ----------
  // Note: standalone "%" and "%.name" are parse errors in JSONata (S0217).
  // The parent operator is only valid within a multi-step path or filter context.
  describe("ADV-01: Parent operator", () => {
    it('parent mid-path: "items.%.name" -> includes "items.%.name"', () => {
      expect(extractPaths("items.%.name")).toContainEqual({ path: "items.%.name", confidence: "partial" });
    });

    it('parent at end of path: "items.%" -> includes "items.%"', () => {
      expect(extractPaths("items.%")).toContainEqual({ path: "items.%", confidence: "partial" });
    });

    it('parent in filter predicate: "products[%]"', () => {
      const result = extractPaths("products[%]");
      expect(result).toContainEqual({ path: "products.%", confidence: "partial" });
    });
  });

  // ---------- ADV-02: Dynamic bracket wildcard ----------
  describe("ADV-02: Dynamic bracket wildcard", () => {
    it('unbound variable in bracket: "item[$field]" -> item[*]', () => {
      const result = extractPaths("item[$field]");
      expect(result).toContainEqual({ path: "item[*]", confidence: "dynamic" });
      expect(result).toContainEqual({ path: "item", confidence: "static" });
    });

    it('unbound variable with suffix: "item[$field].name" -> item.name + item[*]', () => {
      const result = extractPaths("item[$field].name");
      expect(result).toContainEqual({ path: "item.name", confidence: "static" });
      expect(result).toContainEqual({ path: "item[*]", confidence: "dynamic" });
    });

    it('bare name in filter is NOT dynamic: "item[fieldName]" has no [*]', () => {
      const result = extractPaths("item[fieldName]");
      expect(result.some(r => r.path.includes("[*]"))).toBe(false);
      expect(result).toContainEqual({ path: "item.fieldName", confidence: "static" });
    });

    it('variable bound to literal is known non-path: "($f := \\"price\\"; item[$f])"', () => {
      const result = extractPaths('($f := "price"; item[$f])');
      expect(result).toEqual([{ path: "item", confidence: "static" }]);
    });

    it('resolved variable with unbound filter: "($data := orders; $data[$field].price)" emits dynamic wildcard', () => {
      const result = extractPaths("($data := orders; $data[$field].price)");
      expect(result).toContainEqual({ path: "orders[*]", confidence: "dynamic" });
      expect(result).toContainEqual({ path: "orders.price", confidence: "static" });
    });
  });

  // ---------- ADV-03: Confidence annotation ----------
  describe("ADV-03: Confidence annotation", () => {
    it('plain path has static confidence: "account.name"', () => {
      expect(extractPaths("account.name")).toEqual([
        { path: "account.name", confidence: "static" },
      ]);
    });

    it('explicit dot-wildcard has static confidence: "item.*"', () => {
      expect(extractPaths("item.*")).toEqual([
        { path: "item.*", confidence: "static" },
      ]);
    });

    it('descendant wildcard has static confidence: "**.price"', () => {
      expect(extractPaths("**.price")).toEqual([
        { path: "**.price", confidence: "static" },
      ]);
    });

    it('parent segment has partial confidence: "items.%.name"', () => {
      const result = extractPaths("items.%.name");
      expect(result).toContainEqual({ path: "items.%.name", confidence: "partial" });
    });

    it('standalone parent "%" is a JSONata parse error (S0217) -- only valid in multi-step path', () => {
      // JSONata rejects "%" as a standalone expression; it is only valid inside a path or filter
      expect(() => extractPaths("%")).toThrow();
    });

    it('bracket wildcard has dynamic confidence: "item[$field]" -> item[*]', () => {
      const result = extractPaths("item[$field]");
      const dynPath = result.find(r => r.path === "item[*]");
      expect(dynPath).toBeDefined();
      expect(dynPath!.confidence).toBe("dynamic");
    });

    it('static base path alongside dynamic bracket: "item[$field]" -> item is static', () => {
      const result = extractPaths("item[$field]");
      const basePath = result.find(r => r.path === "item");
      expect(basePath).toBeDefined();
      expect(basePath!.confidence).toBe("static");
    });

  });

  // ============================================================
  // Phase 7: Integration Polish
  // ============================================================

  // ---------- Phase 7: walkVariable standalone predicate ----------
  describe("Phase 7: walkVariable standalone predicate", () => {
    it('resolves filter predicate on standalone VariableNode: "$map($data[status], fn)" extracts orders.status', () => {
      const result = extractPaths(
        "($data := orders; $map($data[status], function($v) { $v.name }))",
      );
      expect(result).toContainEqual({ path: "orders.status", confidence: "static" });
    });

    it('emits dynamic wildcard for unresolvable predicate on standalone VariableNode: "$map($data[$field], fn)"', () => {
      const result = extractPaths(
        "($data := orders; $map($data[$field], function($v) { $v.name }))",
      );
      expect(result).toContainEqual({ path: "orders[*]", confidence: "dynamic" });
    });
  });

  // ---------- Phase 7: CLI error formatting ----------
  describe("Phase 7: CLI error formatting", () => {
    it('CLI displays actual error message for jsonata parse errors, not [object Object]', () => {
      const { execFileSync } = require("node:child_process");
      try {
        execFileSync("node", ["dist/cli.js", "}{invalid"], {
          encoding: "utf8",
          cwd: process.cwd(),
        });
        // Should not reach here -- parse error expected
        expect.unreachable("CLI should have exited with error");
      } catch (e: any) {
        const stderr = e.stderr as string;
        expect(stderr).toContain("Error:");
        expect(stderr).not.toContain("[object Object]");
      }
    });
  });
});
