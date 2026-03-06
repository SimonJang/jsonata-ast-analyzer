import { describe, it } from "vitest";
import { assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("Business Rules", () => {
  describe("BIZR-01: Conditional field selection (ternary, elvis ?:, coalescing ??)", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "simple ternary: extracts condition and both branch paths",
        expression: `status = "active" ? order.total : order.estimate`,
        expectedPaths: [
          { path: "order.estimate", confidence: "static" },
          { path: "order.total", confidence: "static" },
          { path: "status", confidence: "static" },
        ],
      },
      {
        name: "nested ternary: extracts condition paths and all branch paths",
        expression: `type = "A" ? price.retail : type = "B" ? price.wholesale : price.default`,
        expectedPaths: [
          { path: "price.default", confidence: "static" },
          { path: "price.retail", confidence: "static" },
          { path: "price.wholesale", confidence: "static" },
          { path: "type", confidence: "static" },
        ],
      },
      {
        name: "null coalescing: extracts both fallback paths",
        expression: `nickname ?? firstName`,
        expectedPaths: [
          { path: "firstName", confidence: "static" },
          { path: "nickname", confidence: "static" },
        ],
      },
      {
        name: "elvis operator: extracts source and fallback paths",
        expression: `customer.email ?: customer.phone`,
        expectedPaths: [
          { path: "customer.email", confidence: "static" },
          { path: "customer.phone", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("BIZR-02: Compound boolean filter predicates (and/or)", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "AND filter predicate: extracts all field paths from compound condition",
        expression: `orders[status = "active" and total > 100].id`,
        expectedPaths: [
          { path: "orders.id", confidence: "static" },
          { path: "orders.status", confidence: "static" },
          { path: "orders.total", confidence: "static" },
        ],
      },
      {
        name: "AND-OR compound predicate: extracts all referenced fields",
        expression: `products[(active and inStock) or featured].title`,
        expectedPaths: [
          { path: "products.active", confidence: "static" },
          { path: "products.featured", confidence: "static" },
          { path: "products.inStock", confidence: "static" },
          { path: "products.title", confidence: "static" },
        ],
      },
      {
        name: "multi-field OR predicate: extracts both compared fields and selected field",
        expression: `items[price > 50 or rating >= 4].name`,
        expectedPaths: [
          { path: "items.name", confidence: "static" },
          { path: "items.price", confidence: "static" },
          { path: "items.rating", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("BIZR-03: Aggregation over nested arrays ($sum, $count, $average)", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "sum over nested array: extracts nested path to aggregated field",
        expression: `$sum(orders.items.price)`,
        expectedPaths: [
          { path: "orders.items.price", confidence: "static" },
        ],
      },
      {
        name: "sum with map lambda: extracts base array and all lambda body field paths",
        expression: `$sum($map(orders.items, function($v) { $v.price * $v.qty }))`,
        expectedPaths: [
          { path: "orders.items", confidence: "static" },
          { path: "orders.items.price", confidence: "static" },
          { path: "orders.items.qty", confidence: "static" },
        ],
      },
      {
        name: "count with filtered array: extracts base array path and filter predicate path",
        expression: `$count(orders[status = "active"])`,
        expectedPaths: [
          { path: "orders", confidence: "static" },
          { path: "orders.status", confidence: "static" },
        ],
      },
      {
        name: "average over nested path: extracts nested path to averaged field",
        expression: `$average(reviews.score)`,
        expectedPaths: [
          { path: "reviews.score", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("BIZR-04: Lookup and cross-reference patterns", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "direct lookup: extracts both object and key paths",
        expression: `$lookup(products, orders.productId)`,
        expectedPaths: [
          { path: "orders.productId", confidence: "static" },
          { path: "products", confidence: "static" },
        ],
      },
      {
        name: "variable cross-reference: extracts config and calculation paths",
        expression: `($config := settings; order.amount * $config.taxRate)`,
        expectedPaths: [
          { path: "order.amount", confidence: "static" },
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

    it("lookup result chaining: extracts object, key, and chained field paths", () => {
      assertFixture({
        name: "lookup result chaining: extracts object, key, and chained field paths",
        expression: `$lookup(products, sku).price`,
        expectedPaths: [
          { path: "products", confidence: "static" },
          { path: "products.price", confidence: "static" },
          { path: "sku", confidence: "static" },
        ],
      });
    });

    // BUG(v1.2): variable-resolved paths in filter predicates get spuriously context-prefixed (filter predicate path leak)
    it.skip("variable-in-filter cross-reference: extracts variable source and filter paths without spurious prefixing", () => {
      assertFixture({
        name: "variable-in-filter cross-reference: extracts variable source and filter paths without spurious prefixing",
        expression: `($min := minPrice; products[price >= $min].name)`,
        expectedPaths: [
          { path: "minPrice", confidence: "static" },
          { path: "products.name", confidence: "static" },
          { path: "products.price", confidence: "static" },
        ],
      });
    });
  });

  describe("BIZR-05: Variable-driven object construction", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "variable-driven object: resolves all variable references back to source paths",
        expression: `($order := order; {"id": $order.id, "total": $order.total, "customer": $order.customer.name})`,
        expectedPaths: [
          { path: "order", confidence: "static" },
          { path: "order.customer.name", confidence: "static" },
          { path: "order.id", confidence: "static" },
          { path: "order.total", confidence: "static" },
        ],
      },
      {
        name: "multi-variable object: resolves two-hop variable chain into object fields",
        expression: `($cust := customer; $addr := $cust.address; {"name": $cust.name, "city": $addr.city, "zip": $addr.zip})`,
        expectedPaths: [
          { path: "customer", confidence: "static" },
          { path: "customer.address", confidence: "static" },
          { path: "customer.address.city", confidence: "static" },
          { path: "customer.address.zip", confidence: "static" },
          { path: "customer.name", confidence: "static" },
        ],
      },
      {
        name: "multi-source object: resolves variables from two independent root sources",
        expression: `($o := order; $c := customer; {"orderId": $o.id, "customerName": $c.name, "amount": $o.total})`,
        expectedPaths: [
          { path: "customer", confidence: "static" },
          { path: "customer.name", confidence: "static" },
          { path: "order", confidence: "static" },
          { path: "order.id", confidence: "static" },
          { path: "order.total", confidence: "static" },
        ],
      },
      {
        name: "variable with aggregation in object: resolves variable through aggregation functions",
        expression: `($items := order.lineItems; {"count": $count($items), "total": $sum($map($items, function($v) { $v.price }))})`,
        expectedPaths: [
          { path: "order.lineItems", confidence: "static" },
          { path: "order.lineItems.price", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("LOOK Regression: $lookup chaining patterns", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "lookup with variable key: extracts variable source, lookup table, and chained property",
        expression: `($k := order.productId; $lookup(catalog, $k).name)`,
        expectedPaths: [
          { path: "catalog", confidence: "static" },
          { path: "catalog.name", confidence: "static" },
          { path: "order.productId", confidence: "static" },
        ],
      },
      {
        name: "lookup in object constructor value: extracts lookup paths within object constructor",
        expression: `{"price": $lookup(products, sku).price}`,
        expectedPaths: [
          { path: "products", confidence: "static" },
          { path: "products.price", confidence: "static" },
          { path: "sku", confidence: "static" },
        ],
      },
      {
        name: "multiple lookups with concat: both lookups extract all paths correctly",
        expression: `$lookup(tableA, key1).fieldA & $lookup(tableB, key2).fieldB`,
        expectedPaths: [
          { path: "key1", confidence: "static" },
          { path: "key2", confidence: "static" },
          { path: "tableA", confidence: "static" },
          { path: "tableA.fieldA", confidence: "static" },
          { path: "tableB", confidence: "static" },
          { path: "tableB.fieldB", confidence: "static" },
        ],
      },
      {
        name: "lookup with nested first argument: deep first argument path used for chaining prefix",
        expression: `$lookup(db.inventory, code).available`,
        expectedPaths: [
          { path: "code", confidence: "static" },
          { path: "db.inventory", confidence: "static" },
          { path: "db.inventory.available", confidence: "static" },
        ],
      },
      {
        name: "standalone lookup (regression guard): no chaining, existing behavior preserved",
        expression: `$lookup(products, orders.productId)`,
        expectedPaths: [
          { path: "orders.productId", confidence: "static" },
          { path: "products", confidence: "static" },
        ],
      },
      {
        name: "lookup chaining in conditional then-branch: extracts lookup paths in ternary context",
        expression: `status = "found" ? $lookup(cache, id).value : default`,
        expectedPaths: [
          { path: "cache", confidence: "static" },
          { path: "cache.value", confidence: "static" },
          { path: "default", confidence: "static" },
          { path: "id", confidence: "static" },
          { path: "status", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("Composite: cross-pattern business rule", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "combined conditional + aggregation + variable: resolves all paths across BIZR-01/03/05 patterns",
        expression: `($order := order; {"label": $order.status = "rush" ? "URGENT" : "standard", "total": $sum($map($order.items, function($v) { $v.price * $v.qty })), "customer": $order.customer.name})`,
        expectedPaths: [
          { path: "order", confidence: "static" },
          { path: "order.customer.name", confidence: "static" },
          { path: "order.items", confidence: "static" },
          { path: "order.items.price", confidence: "static" },
          { path: "order.items.qty", confidence: "static" },
          { path: "order.status", confidence: "static" },
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
