import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { extractPaths } from "../../src/index.js";
import type { PathResult } from "../../src/index.js";
import { assertFixture, sortPaths } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("Edge Cases", () => {
  describe("EDGE-01: Deep variable chains (3-4 hop resolution)", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "3-hop variable chain: resolves all intermediate hops to root data paths",
        expression: `($intermediate := root.data; $resolved := $intermediate.level1; $final := $resolved.level2; $final.value)`,
        expectedPaths: [
          { path: "root.data", confidence: "static" },
          { path: "root.data.level1", confidence: "static" },
          { path: "root.data.level1.level2", confidence: "static" },
          { path: "root.data.level1.level2.value", confidence: "static" },
        ],
      },
      {
        name: "4-hop variable chain: resolves all intermediate hops through config to result",
        expression: `($root := data.source; $intermediate := $root.config; $resolved := $intermediate.settings; $final := $resolved.value; $final.result)`,
        expectedPaths: [
          { path: "data.source", confidence: "static" },
          { path: "data.source.config", confidence: "static" },
          { path: "data.source.config.settings", confidence: "static" },
          { path: "data.source.config.settings.value", confidence: "static" },
          { path: "data.source.config.settings.value.result", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("EDGE-02: Nested HOF closure capture across $map levels", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "nested $map with closure: captures paths from both outer and inner scope",
        expression: `$map(orders, function($order) { $map($order.items, function($item) { $item.price * $order.discount }) })`,
        expectedPaths: [
          { path: "orders", confidence: "static" },
          { path: "orders.discount", confidence: "static" },
          { path: "orders.items", confidence: "static" },
          { path: "orders.items.price", confidence: "static" },
        ],
      },
      {
        name: "nested $map with outer scope variable: captures variable-resolved and HOF paths",
        expression: `($config := settings; $map(orders, function($o) { $map($o.items, function($i) { $i.price * $config.taxRate }) }))`,
        expectedPaths: [
          { path: "orders", confidence: "static" },
          { path: "orders.items", confidence: "static" },
          { path: "orders.items.price", confidence: "static" },
          { path: "settings", confidence: "static" },
          { path: "settings.taxRate", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("EDGE-03: Custom function multi-call interprocedural tracing", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "multi-call interprocedural: produces union of all call-site argument paths",
        expression: `($fn := function($x) { $x.name }; {"a": $fn(account), "b": $fn(customer)})`,
        expectedPaths: [
          { path: "account", confidence: "static" },
          { path: "account.name", confidence: "static" },
          { path: "customer", confidence: "static" },
          { path: "customer.name", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("EDGE-04: $sort with lambda callback", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "$sort lambda: extracts array and sort-key paths",
        expression: `$sort(employees, function($a, $b) { $a.salary > $b.salary })`,
        expectedPaths: [
          { path: "employees", confidence: "static" },
          { path: "employees.salary", confidence: "static" },
        ],
      },
      {
        name: "$sort with variable-resolved input: extracts resolved array and sort-key paths",
        expression: `($data := source.items; $sort($data, function($a, $b) { $a.priority > $b.priority }))`,
        expectedPaths: [
          { path: "source.items", confidence: "static" },
          { path: "source.items.priority", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("EDGE-05: $lookup HOF chaining (tech debt)", () => {
    it("lookup HOF chaining: extracts object, key, and chained field paths", () => {
      assertFixture({
        name: "lookup HOF chaining: extracts object, key, and chained field paths",
        expression: `$lookup(inventory, itemCode).quantity`,
        expectedPaths: [
          { path: "inventory", confidence: "static" },
          { path: "inventory.quantity", confidence: "static" },
          { path: "itemCode", confidence: "static" },
        ],
      });
    });
  });

  describe("EDGE-06: Standalone BindNode outside block expression", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "standalone bind: extracts RHS paths from variable assignment",
        expression: `$cache := account.preferences`,
        expectedPaths: [
          { path: "account.preferences", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }

    it("array constructor scope accumulation: propagates bind variable to subsequent array elements", () => {
      assertFixture({
        name: "array constructor scope accumulation: propagates bind variable to subsequent array elements",
        expression: `[$x := data.source, $x.field]`,
        expectedPaths: [
          { path: "data.source", confidence: "static" },
          { path: "data.source.field", confidence: "static" },
        ],
      });
    });
  });

  describe("EDGE-07: CLI round-trip verification", () => {
    it("CLI round-trip: simple dot-notation expression", () => {
      const expr = "orders.items.price";
      const cliOutput = execFileSync("node", ["dist/cli.js", expr], {
        encoding: "utf-8",
      }).trim();
      const cliResult: PathResult[] = JSON.parse(cliOutput);
      const apiResult = extractPaths(expr);
      expect(sortPaths(cliResult)).toEqual(sortPaths(apiResult));
    });

    it("CLI round-trip: complex multi-variable expression", () => {
      const expr =
        '($x := account.name; $y := account.email; {"name": $x, "email": $y})';
      const cliOutput = execFileSync("node", ["dist/cli.js", expr], {
        encoding: "utf-8",
      }).trim();
      const cliResult: PathResult[] = JSON.parse(cliOutput);
      const apiResult = extractPaths(expr);
      expect(sortPaths(cliResult)).toEqual(sortPaths(apiResult));
    });

    it("CLI round-trip: dynamic confidence with filter predicate", () => {
      const expr = "items[condition].name";
      const cliOutput = execFileSync("node", ["dist/cli.js", expr], {
        encoding: "utf-8",
      }).trim();
      const cliResult: PathResult[] = JSON.parse(cliOutput);
      const apiResult = extractPaths(expr);
      expect(sortPaths(cliResult)).toEqual(sortPaths(apiResult));
    });
  });

  describe("LOOK Regression: $lookup edge cases", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "lookup with deep chained property: extracts first-arg-prefixed deep chain",
        expression: `$lookup(inventory, code).details.weight`,
        expectedPaths: [
          { path: "code", confidence: "static" },
          { path: "inventory", confidence: "static" },
          { path: "inventory.details.weight", confidence: "static" },
        ],
      },
      {
        name: "lookup with computed key (binary expression): extracts both sides of key",
        expression: `$lookup(ref, a & b).result`,
        expectedPaths: [
          { path: "a", confidence: "static" },
          { path: "b", confidence: "static" },
          { path: "ref", confidence: "static" },
          { path: "ref.result", confidence: "static" },
        ],
      },
      {
        name: "nested lookup chaining: two-level $lookup produces all argument and chained paths",
        expression: `$lookup($lookup(outer, key1).inner, key2).value`,
        expectedPaths: [
          { path: "key1", confidence: "static" },
          { path: "key2", confidence: "static" },
          { path: "outer", confidence: "static" },
          { path: "outer.inner", confidence: "static" },
          { path: "outer.inner.value", confidence: "static" },
        ],
      },
      {
        name: "lookup chaining with deep first argument: nested first arg path used as prefix",
        expression: `$lookup(config.tables.data, key).status`,
        expectedPaths: [
          { path: "config.tables.data", confidence: "static" },
          { path: "config.tables.data.status", confidence: "static" },
          { path: "key", confidence: "static" },
        ],
      },
      {
        name: "lookup chaining with path key argument: both args extracted with chained property",
        expression: `$lookup(products, order.sku).description`,
        expectedPaths: [
          { path: "order.sku", confidence: "static" },
          { path: "products", confidence: "static" },
          { path: "products.description", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("ARRS Regression: array constructor scope", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "single bind followed by reference: basic scope accumulation",
        expression: `[$x := data.source, $x.field]`,
        expectedPaths: [
          { path: "data.source", confidence: "static" },
          { path: "data.source.field", confidence: "static" },
        ],
      },
      {
        name: "multi-bind chain: resolves through sequential variable bindings",
        expression: `[$a := source.x, $b := $a.y, $b.z]`,
        expectedPaths: [
          { path: "source.x", confidence: "static" },
          { path: "source.x.y", confidence: "static" },
          { path: "source.x.y.z", confidence: "static" },
        ],
      },
      {
        name: "bind with multi-segment path suffix: appends suffix to resolved variable",
        expression: `[$x := records, $x.items.name]`,
        expectedPaths: [
          { path: "records", confidence: "static" },
          { path: "records.items.name", confidence: "static" },
        ],
      },
      {
        name: "non-bind interleaved: non-bind elements unaffected by subsequent bindings",
        expression: `[first.path, $x := data, $x.field, other.path]`,
        expectedPaths: [
          { path: "data", confidence: "static" },
          { path: "data.field", confidence: "static" },
          { path: "first.path", confidence: "static" },
          { path: "other.path", confidence: "static" },
        ],
      },
      {
        name: "single bind with multiple references: all references resolve to same source",
        expression: `[$x := data, $x.a, $x.b, $x.c]`,
        expectedPaths: [
          { path: "data", confidence: "static" },
          { path: "data.a", confidence: "static" },
          { path: "data.b", confidence: "static" },
          { path: "data.c", confidence: "static" },
        ],
      },
      {
        name: "bind without subsequent reference: bind paths extracted, other unaffected",
        expression: `[$x := data.source, other.field]`,
        expectedPaths: [
          { path: "data.source", confidence: "static" },
          { path: "other.field", confidence: "static" },
        ],
      },
      {
        name: "nested array constructors: inner scope does not leak to outer",
        expression: `[[$x := inner, $x.a], outer.b]`,
        expectedPaths: [
          { path: "inner", confidence: "static" },
          { path: "inner.a", confidence: "static" },
          { path: "outer.b", confidence: "static" },
        ],
      },
      {
        name: "bind with function call RHS: function call walked normally as bind value",
        expression: `[$x := $count(items), other.path]`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "other.path", confidence: "static" },
        ],
      },
      {
        name: "bind with object constructor RHS: object constructor RHS walked for paths",
        expression: `[$x := {"a": data.field}]`,
        expectedPaths: [
          { path: "data.field", confidence: "static" },
        ],
      },
      {
        name: "empty array constructor: produces no paths (regression guard)",
        expression: `[]`,
        expectedPaths: [],
      },
      {
        name: "array constructor with all literals: produces no paths (regression guard)",
        expression: `[1, "text", true]`,
        expectedPaths: [],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("Composite: cross-pattern edge case", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "variable chain + nested HOF composite: resolves variable through $map with closure capture (EDGE-01 + EDGE-02)",
        expression: `($data := source.records; $map($data, function($item) { $item.value * $data.factor }))`,
        expectedPaths: [
          { path: "source.records", confidence: "static" },
          { path: "source.records.factor", confidence: "static" },
          { path: "source.records.value", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });
});
