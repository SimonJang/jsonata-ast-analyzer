import { describe, it } from "vitest";
import { assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("Data Export", () => {
  describe("DEXP-01: Structure-to-structure JSON format conversion", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "flat-to-flat with string concatenation: extracts all source leaf paths",
        expression: `{"name": source.firstName & " " & source.lastName, "email": source.contact.email}`,
        expectedPaths: [
          { path: "source.contact.email", confidence: "static" },
          { path: "source.firstName", confidence: "static" },
          { path: "source.lastName", confidence: "static" },
        ],
      },
      {
        name: "nested-to-flat extraction: extracts all deeply nested source leaf paths",
        expression: `{"city": order.shipping.address.city, "zip": order.shipping.address.zip, "total": order.summary.total}`,
        expectedPaths: [
          { path: "order.shipping.address.city", confidence: "static" },
          { path: "order.shipping.address.zip", confidence: "static" },
          { path: "order.summary.total", confidence: "static" },
        ],
      },
      {
        name: "nested-to-nested reshaping: extracts all source leaf paths across nested output structure",
        expression: `{"billing": {"amount": invoice.lineItems.price, "tax": invoice.tax.amount}, "shipping": {"address": invoice.delivery.address}}`,
        expectedPaths: [
          { path: "invoice.delivery.address", confidence: "static" },
          { path: "invoice.lineItems.price", confidence: "static" },
          { path: "invoice.tax.amount", confidence: "static" },
        ],
      },
      {
        name: "variable-bound reshaping: resolves variable and extracts all leaf paths through binding",
        expression: `($src := source.data; {"id": $src.record.id, "label": $src.meta.label, "tags": $src.meta.tags})`,
        expectedPaths: [
          { path: "source.data", confidence: "static" },
          { path: "source.data.meta.label", confidence: "static" },
          { path: "source.data.meta.tags", confidence: "static" },
          { path: "source.data.record.id", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("DEXP-02: Multi-field extraction into flat records", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "multi-field pick: extracts one path per source field",
        expression: `{"id": employee.id, "name": employee.name, "dept": employee.department, "salary": employee.compensation.salary}`,
        expectedPaths: [
          { path: "employee.compensation.salary", confidence: "static" },
          { path: "employee.department", confidence: "static" },
          { path: "employee.id", confidence: "static" },
          { path: "employee.name", confidence: "static" },
        ],
      },
      {
        name: "cherry-pick with index: extracts paths with numeric index stripped",
        expression: `{"orderId": order.id, "customerName": order.customer.name, "firstItem": order.items[0].name, "status": order.status}`,
        expectedPaths: [
          { path: "order.customer.name", confidence: "static" },
          { path: "order.id", confidence: "static" },
          { path: "order.items.name", confidence: "static" },
          { path: "order.status", confidence: "static" },
        ],
      },
      {
        name: "map to flat records: extracts base array and leaf paths from lambda",
        expression: `$map(employees, function($e) { {"name": $e.profile.name, "email": $e.contact.email, "dept": $e.department.name} })`,
        expectedPaths: [
          { path: "employees", confidence: "static" },
          { path: "employees.contact.email", confidence: "static" },
          { path: "employees.department.name", confidence: "static" },
          { path: "employees.profile.name", confidence: "static" },
        ],
      },
      {
        name: "multi-field with aggregation: extracts field paths and aggregation argument paths",
        expression: `{"customer": order.customer.name, "itemCount": $count(order.items), "total": $sum(order.items.price)}`,
        expectedPaths: [
          { path: "order.customer.name", confidence: "static" },
          { path: "order.items", confidence: "static" },
          { path: "order.items.price", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("DEXP-03: Transform operator with update + delete clauses", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "literal-only update: extracts only the pattern path",
        expression: `| account | {"status": "active"} |`,
        expectedPaths: [
          { path: "account", confidence: "static" },
        ],
      },
      {
        name: "update from source fields: extracts pattern and prefixed update paths",
        expression: `| account | {"displayName": firstName & " " & lastName} |`,
        expectedPaths: [
          { path: "account", confidence: "static" },
          { path: "account.firstName", confidence: "static" },
          { path: "account.lastName", confidence: "static" },
        ],
      },
      {
        name: "update + delete: delete clause produces no paths",
        expression: `| account | {"status": "archived"}, ["password", "ssn"] |`,
        expectedPaths: [
          { path: "account", confidence: "static" },
        ],
      },
      {
        name: "nested pattern: extracts nested pattern path and prefixed update paths",
        expression: `| order.customer | {"fullName": firstName & " " & lastName} |`,
        expectedPaths: [
          { path: "order.customer", confidence: "static" },
          { path: "order.customer.firstName", confidence: "static" },
          { path: "order.customer.lastName", confidence: "static" },
        ],
      },
      {
        name: "multi-field update with arithmetic: extracts pattern and all update expression paths",
        expression: `| record | {"total": price * quantity, "label": category.name} |`,
        expectedPaths: [
          { path: "record", confidence: "static" },
          { path: "record.category.name", confidence: "static" },
          { path: "record.price", confidence: "static" },
          { path: "record.quantity", confidence: "static" },
        ],
      },
      {
        name: "multi-field update + delete: extracts pattern and update paths while delete ignored",
        expression: `| employee | {"name": firstName & " " & lastName, "active": true}, ["password", "tempToken"] |`,
        expectedPaths: [
          { path: "employee", confidence: "static" },
          { path: "employee.firstName", confidence: "static" },
          { path: "employee.lastName", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("DEXP-04: Group-by with aggregation", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "simple group-by: extracts base array, group key, and aggregation value paths",
        expression: `orders{category: $sum(amount)}`,
        expectedPaths: [
          { path: "orders", confidence: "static" },
          { path: "orders.amount", confidence: "static" },
          { path: "orders.category", confidence: "static" },
        ],
      },
      {
        name: "multi-aggregate group-by: extracts group key and deduplicated aggregation paths",
        expression: `products{brand: {"count": $count(price), "avg": $average(price)}}`,
        expectedPaths: [
          { path: "products", confidence: "static" },
          { path: "products.brand", confidence: "static" },
          { path: "products.price", confidence: "static" },
        ],
      },
      {
        name: "nested path group-by: extracts nested base and prefixed key/value paths",
        expression: `sales.records{region: $sum(amount)}`,
        expectedPaths: [
          { path: "sales.records", confidence: "static" },
          { path: "sales.records.amount", confidence: "static" },
          { path: "sales.records.region", confidence: "static" },
        ],
      },
      {
        name: "nested key group-by: extracts dotted group key path and value path",
        expression: `items{category.name: $count(id)}`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.category.name", confidence: "static" },
          { path: "items.id", confidence: "static" },
        ],
      },
      {
        name: "filtered group-by: extracts filter predicate, group key, and aggregation paths",
        expression: `orders[status = "complete"]{category: $sum(amount)}`,
        expectedPaths: [
          { path: "orders", confidence: "static" },
          { path: "orders.amount", confidence: "static" },
          { path: "orders.category", confidence: "static" },
          { path: "orders.status", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }

    it("variable-resolved group-by: extracts group key and value paths through variable", () => {
      assertFixture({
        name: "variable-resolved group-by: extracts group key and value paths through variable",
        expression: `($r := data.records; $r{category: $sum(amount)})`,
        expectedPaths: [
          { path: "data.records", confidence: "static" },
          { path: "data.records.amount", confidence: "static" },
          { path: "data.records.category", confidence: "static" },
        ],
      });
    });
  });

  describe("Composite: cross-pattern data export", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "format conversion + flat extraction composite: combines DEXP-01 reshaping with DEXP-02 aggregation",
        expression: `{"export": {"name": customer.firstName & " " & customer.lastName, "email": customer.contact.email}, "summary": {"orderCount": $count(orders), "total": $sum(orders.amount)}}`,
        expectedPaths: [
          { path: "customer.contact.email", confidence: "static" },
          { path: "customer.firstName", confidence: "static" },
          { path: "customer.lastName", confidence: "static" },
          { path: "orders", confidence: "static" },
          { path: "orders.amount", confidence: "static" },
        ],
      },
      {
        name: "transform + group-by composite: combines DEXP-03 transform with DEXP-04 direct group-by",
        expression: `{"updated": | record | {"processed": true} |, "grouped": items{category: $sum(price)}}`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.category", confidence: "static" },
          { path: "items.price", confidence: "static" },
          { path: "record", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("WVAR Regression: walkVariable group-by handling", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "WVAR-R01: simple variable group-by extracts resolved group key and aggregation paths",
        expression: `($d := sales; $d{region: $sum(revenue)})`,
        expectedPaths: [
          { path: "sales", confidence: "static" },
          { path: "sales.region", confidence: "static" },
          { path: "sales.revenue", confidence: "static" },
        ],
      },
      {
        name: "WVAR-R02: variable group-by with nested key path extracts deep key path",
        expression: `($r := data; $r{category.sub: $count(items)})`,
        expectedPaths: [
          { path: "data", confidence: "static" },
          { path: "data.category.sub", confidence: "static" },
          { path: "data.items", confidence: "static" },
        ],
      },
      {
        name: "WVAR-R03: variable group-by after filter extracts filter predicate and group paths",
        expression: `($items := products[active]; $items{category: $sum(price)})`,
        expectedPaths: [
          { path: "products", confidence: "static" },
          { path: "products.active", confidence: "static" },
          { path: "products.category", confidence: "static" },
          { path: "products.price", confidence: "static" },
        ],
      },
      {
        name: "WVAR-R04: chained variable then group-by resolves multi-hop variable path",
        expression: `($a := source.data; $b := $a; $b{type: $count(id)})`,
        expectedPaths: [
          { path: "source.data", confidence: "static" },
          { path: "source.data.id", confidence: "static" },
          { path: "source.data.type", confidence: "static" },
        ],
      },
      {
        name: "WVAR-R05: variable group-by with string literal key extracts only value paths",
        expression: `($r := data; $r{"total": $sum(amount)})`,
        expectedPaths: [
          { path: "data", confidence: "static" },
          { path: "data.amount", confidence: "static" },
        ],
      },
      {
        name: "WVAR-R06: variable group-by with nested base path extracts prefixed group paths",
        expression: `($d := data.items; $d{type: $average(score)})`,
        expectedPaths: [
          { path: "data.items", confidence: "static" },
          { path: "data.items.score", confidence: "static" },
          { path: "data.items.type", confidence: "static" },
        ],
      },
      {
        name: "WVAR-R07: variable group-by with multiple aggregations in array value",
        expression: `($r := sales; $r{month: [$sum(revenue), $count(transactions)]})`,
        expectedPaths: [
          { path: "sales", confidence: "static" },
          { path: "sales.month", confidence: "static" },
          { path: "sales.revenue", confidence: "static" },
          { path: "sales.transactions", confidence: "static" },
        ],
      },
      {
        name: "WVAR-R08: variable group-by with simple name value (no aggregation function)",
        expression: `($r := data; $r{status: name})`,
        expectedPaths: [
          { path: "data", confidence: "static" },
          { path: "data.name", confidence: "static" },
          { path: "data.status", confidence: "static" },
        ],
      },
      {
        name: "WVAR-R09: variable group-by with $sum extracts dept and salary paths",
        expression: `($r := records; $r{dept: $sum(salary)})`,
        expectedPaths: [
          { path: "records", confidence: "static" },
          { path: "records.dept", confidence: "static" },
          { path: "records.salary", confidence: "static" },
        ],
      },
      {
        name: "WVAR-R10: variable group-by matches direct PathNode group-by behavior",
        expression: `($r := data.records; $r{category: $sum(amount)})`,
        expectedPaths: [
          { path: "data.records", confidence: "static" },
          { path: "data.records.amount", confidence: "static" },
          { path: "data.records.category", confidence: "static" },
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
