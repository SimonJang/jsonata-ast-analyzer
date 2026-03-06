import { describe, it } from "vitest";
import { assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("Data Transforms", () => {
  describe("TRFM-01: Pipeline chains (filter -> sort -> map -> reshape)", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "filter-sort pipeline: extracts filter predicate, sort key, and selected field paths",
        expression: `items[status = "active"]^(price).name`,
        expectedPaths: [
          { path: "items.name", confidence: "static" },
          { path: "items.price", confidence: "static" },
          { path: "items.status", confidence: "static" },
        ],
      },
      {
        name: "map with object reshape: extracts base array and all lambda body field paths",
        expression: `$map(items, function($v) { {"n": $v.name, "t": $v.price * $v.qty} })`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.name", confidence: "static" },
          { path: "items.price", confidence: "static" },
          { path: "items.qty", confidence: "static" },
        ],
      },
      {
        name: "filter-then-select: extracts filter predicate and selected field without HOF",
        expression: `orders[total > 100].customer`,
        expectedPaths: [
          { path: "orders.customer", confidence: "static" },
          { path: "orders.total", confidence: "static" },
        ],
      },
      {
        name: "filter-sort-select composite: extracts all stage paths from direct pipeline",
        expression: `products[category = "electronics"]^(rating).name`,
        expectedPaths: [
          { path: "products.category", confidence: "static" },
          { path: "products.name", confidence: "static" },
          { path: "products.rating", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }

    // BUG(v1.2): filter predicate paths leak into HOF element bindings -- items[active] bound as element path to $v
    it.skip("filter-map pipeline: should not produce spurious predicate-prefixed element paths", () => {
      assertFixture({
        name: "filter-map pipeline: should not produce spurious predicate-prefixed element paths",
        expression: `$map(items[active], function($v) { $v.name })`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.active", confidence: "static" },
          { path: "items.name", confidence: "static" },
        ],
      });
    });

    // FIXED(v1.2): variable-resolved sort paths now extracted -- $x^(price) walks sort terms
    it("variable-resolved sort: should extract sort key paths through variable binding", () => {
      assertFixture({
        name: "variable-resolved sort: should extract sort key paths through variable binding",
        expression: `($x := items; $x^(price))`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.price", confidence: "static" },
        ],
      });
    });
  });

  describe("TRFM-02: Chained ~> apply operator pipelines with lambda threading", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "single apply with HOF: extracts base array and lambda body field path",
        expression: `items ~> $map(function($v) { $v.price })`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.price", confidence: "static" },
        ],
      },
      {
        name: "apply with variable-bound lambda: extracts data and resolved lambda field path",
        expression: `($fn := function($x) { $x.name }; data ~> $fn())`,
        expectedPaths: [
          { path: "data", confidence: "static" },
          { path: "data.name", confidence: "static" },
        ],
      },
      {
        name: "chained apply without filter: extracts base and all HOF body paths through chain",
        expression: `data ~> $map(function($v) { $v.value }) ~> $sum()`,
        expectedPaths: [
          { path: "data", confidence: "static" },
          { path: "data.value", confidence: "static" },
        ],
      },
      {
        name: "apply with $reduce: extracts base array and accumulator body field path",
        expression: `items ~> $reduce(function($prev, $curr) { $prev + $curr.total }, 0)`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.total", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }

    // BUG(v1.2): chained ~> HOF inherits filter predicate paths from prior stage
    it.skip("chained filter-then-map: should not leak filter predicate into map element binding", () => {
      assertFixture({
        name: "chained filter-then-map: should not leak filter predicate into map element binding",
        expression: `items ~> $filter(function($v) { $v.active }) ~> $map(function($v) { $v.name })`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.active", confidence: "static" },
          { path: "items.name", confidence: "static" },
        ],
      });
    });

    // FIXED(v1.2): inline lambda with ~> apply -- parameter now bound to piped data paths
    it("inline lambda with apply: should bind lambda parameter to piped data paths", () => {
      assertFixture({
        name: "inline lambda with apply: should bind lambda parameter to piped data paths",
        expression: `data ~> function($d) { $d.count }`,
        expectedPaths: [
          { path: "data", confidence: "static" },
          { path: "data.count", confidence: "static" },
        ],
      });
    });
  });

  describe("TRFM-03: Array dot-notation mapping with context-relative paths", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "simple dot-notation: extracts single leaf path through nested arrays",
        expression: `orders.items.price`,
        expectedPaths: [
          { path: "orders.items.price", confidence: "static" },
        ],
      },
      {
        name: "dot-notation with filter: extracts filter predicate and context-relative field",
        expression: `orders.items[active].price`,
        expectedPaths: [
          { path: "orders.items.active", confidence: "static" },
          { path: "orders.items.price", confidence: "static" },
        ],
      },
      {
        name: "multi-level dot-notation: extracts deeply nested leaf path through 3+ array levels",
        expression: `company.departments.employees.name`,
        expectedPaths: [
          { path: "company.departments.employees.name", confidence: "static" },
        ],
      },
      {
        name: "dot-notation with nested filter: extracts filter predicate and leaf through intermediate arrays",
        expression: `company.departments[active].employees.email`,
        expectedPaths: [
          { path: "company.departments.active", confidence: "static" },
          { path: "company.departments.employees.email", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("TRFM-04: String concatenation and formatting with path operands", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "simple concatenation: extracts both operand paths from & operator",
        expression: `firstName & " " & lastName`,
        expectedPaths: [
          { path: "firstName", confidence: "static" },
          { path: "lastName", confidence: "static" },
        ],
      },
      {
        name: "multi-field address formatting: extracts all nested paths from chained & operators",
        expression: `address.city & ", " & address.state & " " & address.zip`,
        expectedPaths: [
          { path: "address.city", confidence: "static" },
          { path: "address.state", confidence: "static" },
          { path: "address.zip", confidence: "static" },
        ],
      },
      {
        name: "$join with array constructor: extracts path arguments from mixed path/literal array",
        expression: `$join([firstName, " ", lastName])`,
        expectedPaths: [
          { path: "firstName", confidence: "static" },
          { path: "lastName", confidence: "static" },
        ],
      },
      {
        name: "map with string concat in lambda: extracts base array and both concatenated field paths",
        expression: `$map(contacts, function($c) { $c.first & " " & $c.last })`,
        expectedPaths: [
          { path: "contacts", confidence: "static" },
          { path: "contacts.first", confidence: "static" },
          { path: "contacts.last", confidence: "static" },
        ],
      },
      {
        name: "$string coercion in concatenation: extracts paths from both string and numeric operands",
        expression: `name & " (" & $string(age) & ")"`,
        expectedPaths: [
          { path: "age", confidence: "static" },
          { path: "name", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("TRFM-05: Multi-stage transforms with intermediate variable bindings", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "variable binding chain: resolves multi-hop variable paths through object constructor",
        expression: `($base := account; $name := $base.firstName & " " & $base.lastName; {"display": $name, "dept": $base.department.name, "id": $base.id})`,
        expectedPaths: [
          { path: "account", confidence: "static" },
          { path: "account.department.name", confidence: "static" },
          { path: "account.firstName", confidence: "static" },
          { path: "account.id", confidence: "static" },
          { path: "account.lastName", confidence: "static" },
        ],
      },
      {
        name: "multi-hop via $map then $sum: resolves variable through HOF and aggregation chain",
        expression: `($raw := source.data; $mapped := $map($raw, function($v) { $v.value }); $sum($mapped))`,
        expectedPaths: [
          { path: "source.data", confidence: "static" },
          { path: "source.data.value", confidence: "static" },
        ],
      },
      {
        name: "variable-bound $map with arithmetic: resolves variable through HOF with multiple field access",
        expression: `($items := order.lineItems; $total := $sum($map($items, function($v) { $v.price * $v.qty })); $total)`,
        expectedPaths: [
          { path: "order.lineItems", confidence: "static" },
          { path: "order.lineItems.price", confidence: "static" },
          { path: "order.lineItems.qty", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }

    // BUG(v1.2): filter predicate paths leak through variable-bound intermediate results
    it.skip("variable-bound filter then map: should not produce spurious predicate-prefixed paths", () => {
      assertFixture({
        name: "variable-bound filter then map: should not produce spurious predicate-prefixed paths",
        expression: `($data := items[active]; $map($data, function($v) { $v.name }))`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.active", confidence: "static" },
          { path: "items.name", confidence: "static" },
        ],
      });
    });
  });

  describe("Composite: cross-pattern data transform", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "dot-notation + string concat + variable binding: resolves all hops across TRFM-03/04/05 patterns",
        expression: `($addr := customer.address; $addr.city & ", " & $addr.state)`,
        expectedPaths: [
          { path: "customer.address", confidence: "static" },
          { path: "customer.address.city", confidence: "static" },
          { path: "customer.address.state", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("PIPE: Pipeline and apply operator regression tests", () => {
    describe("Apply/lambda regressions", () => {
      const fixtures: IntegrationFixture[] = [
        {
          name: "multi-arg inline lambda: only first param bound to piped data",
          expression: `data ~> function($a, $b) { $a.x }`,
          expectedPaths: [
            { path: "data", confidence: "static" },
            { path: "data.x", confidence: "static" },
          ],
        },
        {
          name: "inline lambda with binary expression body",
          expression: `data ~> function($d) { $d.a + $d.b }`,
          expectedPaths: [
            { path: "data", confidence: "static" },
            { path: "data.a", confidence: "static" },
            { path: "data.b", confidence: "static" },
          ],
        },
        {
          name: "inline lambda with object constructor body",
          expression: `data ~> function($d) { {"name": $d.x, "val": $d.y} }`,
          expectedPaths: [
            { path: "data", confidence: "static" },
            { path: "data.x", confidence: "static" },
            { path: "data.y", confidence: "static" },
          ],
        },
        {
          name: "inline lambda with no params (guard test)",
          expression: `data ~> function() { 42 }`,
          expectedPaths: [
            { path: "data", confidence: "static" },
          ],
        },
        {
          name: "apply with literal lhs produces no data paths",
          expression: `42 ~> function($x) { $x }`,
          expectedPaths: [],
        },
      ];

      for (const fixture of fixtures) {
        it(fixture.name, () => {
          assertFixture(fixture);
        });
      }
    });

    describe("Sort regressions", () => {
      const fixtures: IntegrationFixture[] = [
        {
          name: "multi-term variable-resolved sort",
          expression: `($x := items; $x^(>price, <date))`,
          expectedPaths: [
            { path: "items", confidence: "static" },
            { path: "items.date", confidence: "static" },
            { path: "items.price", confidence: "static" },
          ],
        },
        {
          name: "variable-resolved sort then property access",
          expression: `($x := items; $x^(price).name)`,
          expectedPaths: [
            { path: "items", confidence: "static" },
            { path: "items.name", confidence: "static" },
            { path: "items.price", confidence: "static" },
          ],
        },
        {
          name: "variable-resolved sort with deep path sort key",
          expression: `($x := records; $x^(details.score))`,
          expectedPaths: [
            { path: "records", confidence: "static" },
            { path: "records.details.score", confidence: "static" },
          ],
        },
        {
          name: "multi-hop variable with sort",
          expression: `($a := data.items; $b := $a; $b^(price))`,
          expectedPaths: [
            { path: "data.items", confidence: "static" },
            { path: "data.items.price", confidence: "static" },
          ],
        },
        {
          name: "variable-resolved descending sort",
          expression: `($x := items; $x^(>price))`,
          expectedPaths: [
            { path: "items", confidence: "static" },
            { path: "items.price", confidence: "static" },
          ],
        },
      ];

      for (const fixture of fixtures) {
        it(fixture.name, () => {
          assertFixture(fixture);
        });
      }
    });

    describe("Existing behavior verification", () => {
      const fixtures: IntegrationFixture[] = [
        {
          name: "apply with HOF preserves existing behavior",
          expression: `orders ~> $map(function($v) { $v.total })`,
          expectedPaths: [
            { path: "orders", confidence: "static" },
            { path: "orders.total", confidence: "static" },
          ],
        },
        {
          name: "non-variable sort preserves existing behavior",
          expression: `items^(price).name`,
          expectedPaths: [
            { path: "items.name", confidence: "static" },
            { path: "items.price", confidence: "static" },
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
});
