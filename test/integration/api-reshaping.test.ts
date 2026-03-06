import { describe, it } from "vitest";
import { assertFixture } from "./helpers.js";
import type { IntegrationFixture } from "./helpers.js";

describe("API Reshaping", () => {
  describe("APIR-01: Nested API payload extraction with flattening", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "nested API payload extraction: extracts all leaf paths from deep source structure",
        expression: `{"name": response.data.user.name, "email": response.data.user.contact.email, "zip": response.data.user.address.zip}`,
        expectedPaths: [
          { path: "response.data.user.address.zip", confidence: "static" },
          { path: "response.data.user.contact.email", confidence: "static" },
          { path: "response.data.user.name", confidence: "static" },
        ],
      },
      {
        name: "variable-bound API extraction: resolves variable through nested source paths",
        expression: `($user := response.data.user; {"fullName": $user.profile.firstName & " " & $user.profile.lastName, "email": $user.contact.email})`,
        expectedPaths: [
          { path: "response.data.user", confidence: "static" },
          { path: "response.data.user.contact.email", confidence: "static" },
          { path: "response.data.user.profile.firstName", confidence: "static" },
          { path: "response.data.user.profile.lastName", confidence: "static" },
        ],
      },
      {
        name: "map over nested API records: extracts base array and deep leaf paths from lambda",
        expression: `$map(response.data.records, function($r) { {"id": $r.id, "value": $r.attributes.metadata.value} })`,
        expectedPaths: [
          { path: "response.data.records", confidence: "static" },
          { path: "response.data.records.attributes.metadata.value", confidence: "static" },
          { path: "response.data.records.id", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("APIR-02: Mixed sources with multiple root paths", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "mixed source object: extracts paths under each distinct root",
        expression: `{"userName": account.profile.name, "orderCount": $count(orders), "balance": billing.currentBalance}`,
        expectedPaths: [
          { path: "account.profile.name", confidence: "static" },
          { path: "billing.currentBalance", confidence: "static" },
          { path: "orders", confidence: "static" },
        ],
      },
      {
        name: "multi-variable mixed sources: resolves variables from independent roots into single output",
        expression: `($acct := account; $ship := shipping; {"name": $acct.name, "addr": $ship.address.city, "trackingId": $ship.tracking.id})`,
        expectedPaths: [
          { path: "account", confidence: "static" },
          { path: "account.name", confidence: "static" },
          { path: "shipping", confidence: "static" },
          { path: "shipping.address.city", confidence: "static" },
          { path: "shipping.tracking.id", confidence: "static" },
        ],
      },
      {
        name: "array index with mixed roots: extracts paths from multiple roots with index access",
        expression: `{"user": account.name, "order": orders[0].id, "total": billing.amount}`,
        expectedPaths: [
          { path: "account.name", confidence: "static" },
          { path: "billing.amount", confidence: "static" },
          { path: "orders.id", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("APIR-03: Deep path traversal with array flattening", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "deep path traversal: extracts single leaf path through 6-level nesting",
        expression: `api.response.data.records.fields.value`,
        expectedPaths: [
          { path: "api.response.data.records.fields.value", confidence: "static" },
        ],
      },
      {
        name: "deep traversal with filter: extracts leaf path and filter predicate through nested arrays",
        expression: `response.data.items[active].attributes.dimensions.height`,
        expectedPaths: [
          { path: "response.data.items.active", confidence: "static" },
          { path: "response.data.items.attributes.dimensions.height", confidence: "static" },
        ],
      },
      {
        name: "map over deep nested structure: extracts base array and deep leaf path from lambda",
        expression: `$map(response.data.items, function($item) { $item.nested.deep.leaf })`,
        expectedPaths: [
          { path: "response.data.items", confidence: "static" },
          { path: "response.data.items.nested.deep.leaf", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("APIR-04: Context variable binding with cross-reference", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "variable-bound API payload: resolves variable through nested API response paths",
        expression: `($payload := event.data; {"type": $payload.eventType, "userId": $payload.actor.id, "target": $payload.resource.name})`,
        expectedPaths: [
          { path: "event.data", confidence: "static" },
          { path: "event.data.actor.id", confidence: "static" },
          { path: "event.data.eventType", confidence: "static" },
          { path: "event.data.resource.name", confidence: "static" },
        ],
      },
      {
        name: "variable cross-reference in calculation: resolves bound variable in arithmetic context",
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

    // BUG(v1.2): focus variable @$o double-prefixes -- $o resolves to ["orders"],
    // then filter context re-prefixes to "orders.orders.total"
    it.skip("focus variable cross-reference: extracts focus-resolved paths without double prefix", () => {
      assertFixture({
        name: "focus variable cross-reference: extracts focus-resolved paths without double prefix",
        expression: `orders@$o[$o.total > 100].id`,
        expectedPaths: [
          { path: "orders.id", confidence: "static" },
          { path: "orders.total", confidence: "static" },
        ],
      });
    });

    // BUG(v1.2): variable-resolved paths in filter predicates get spuriously context-prefixed
    it.skip("variable cross-reference in filter: extracts variable source and filter paths without spurious prefixing", () => {
      assertFixture({
        name: "variable cross-reference in filter: extracts variable source and filter paths without spurious prefixing",
        expression: `($cfg := config; items[$cfg.minPrice < price].name)`,
        expectedPaths: [
          { path: "config", confidence: "static" },
          { path: "items.name", confidence: "static" },
          { path: "items.price", confidence: "static" },
        ],
      });
    });
  });

  describe("APIR-05: Parent operator in nested mapped contexts", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "parent operator in flat path: produces partial-confidence path with % segment",
        expression: `orders.items.%.orderRef`,
        expectedPaths: [
          { path: "orders.items.%.orderRef", confidence: "partial" },
        ],
      },
      {
        name: "two-level parent operator: produces path with double % segments",
        expression: `company.departments.employees.%.%.companyName`,
        expectedPaths: [
          { path: "company.departments.employees.%.%.companyName", confidence: "partial" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }

    it("parent in object constructor: extracts both local and parent-scoped paths", () => {
      assertFixture({
        name: "parent in object constructor: extracts both local and parent-scoped paths",
        expression: `orders.items.{"itemName": name, "orderDate": %.date}`,
        expectedPaths: [
          { path: "orders.items", confidence: "static" },
          { path: "orders.items.%.date", confidence: "partial" },
          { path: "orders.items.name", confidence: "static" },
        ],
      });
    });

    it("parent in block path step: extracts expression paths from block within path", () => {
      assertFixture({
        name: "parent in block path step: extracts expression paths from block within path",
        expression: `orders.items.(%.orderRef & ": " & name)`,
        expectedPaths: [
          { path: "orders.items.%.orderRef", confidence: "partial" },
          { path: "orders.items.name", confidence: "static" },
        ],
      });
    });
  });

  describe("Composite: cross-pattern API reshaping", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "combined patterns: resolves all paths across APIR-01/02/03",
        expression: `($resp := api.response;
 $items := $resp.data.items;
 {
   "user": $resp.meta.requestedBy,
   "count": $count($items),
   "topItem": $map($items, function($v) {
     {"name": $v.title, "category": $v.attributes.category}
   }),
   "source": config.apiVersion
 })`,
        expectedPaths: [
          { path: "api.response", confidence: "static" },
          { path: "api.response.data.items", confidence: "static" },
          { path: "api.response.data.items.attributes.category", confidence: "static" },
          { path: "api.response.data.items.title", confidence: "static" },
          { path: "api.response.meta.requestedBy", confidence: "static" },
          { path: "config.apiVersion", confidence: "static" },
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
