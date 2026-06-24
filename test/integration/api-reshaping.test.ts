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
    it("focus variable cross-reference: extracts focus-resolved paths without double prefix", () => {
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
    it("variable cross-reference in filter: extracts variable source and filter paths without spurious prefixing", () => {
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

  describe("PRNT Regression: walkPath step handling", () => {
    const fixtures: IntegrationFixture[] = [
      {
        name: "PRNT-R01: single-field object constructor in path extracts base and inner field",
        expression: `data.item.{"label": name}`,
        expectedPaths: [
          { path: "data.item", confidence: "static" },
          { path: "data.item.name", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R02: multi-field object constructor extracts all inner fields prefixed",
        expression: `orders.line.{"qty": quantity, "cost": unitPrice}`,
        expectedPaths: [
          { path: "orders.line", confidence: "static" },
          { path: "orders.line.quantity", confidence: "static" },
          { path: "orders.line.unitPrice", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R03: deeply nested path before object constructor applies correct deep prefix",
        expression: `a.b.c.d.{"x": value}`,
        expectedPaths: [
          { path: "a.b.c.d", confidence: "static" },
          { path: "a.b.c.d.value", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R04: object constructor with binary expression in value extracts both operand paths",
        expression: `items.{"total": price * quantity}`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.price", confidence: "static" },
          { path: "items.quantity", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R05: object constructor with function call in value extracts argument path",
        expression: `records.{"avg": $average(scores)}`,
        expectedPaths: [
          { path: "records", confidence: "static" },
          { path: "records.scores", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R06: block step with single expression extracts prefixed field path",
        expression: `users.(name)`,
        expectedPaths: [
          { path: "users.name", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R07: block step with concatenation extracts both operand paths",
        expression: `items.(category & "-" & code)`,
        expectedPaths: [
          { path: "items.category", confidence: "static" },
          { path: "items.code", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R08: block step with parent operator extracts partial-confidence path",
        expression: `data.nested.(%.parentField)`,
        expectedPaths: [
          { path: "data.nested.%.parentField", confidence: "partial" },
        ],
      },
      {
        name: "PRNT-R09: path with filter then object constructor extracts filter and inner object paths",
        expression: `orders[status="active"].{"id": orderId, "val": amount}`,
        expectedPaths: [
          { path: "orders", confidence: "static" },
          { path: "orders.amount", confidence: "static" },
          { path: "orders.orderId", confidence: "static" },
          { path: "orders.status", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R10: object constructor with nested path in value extracts deep prefixed path",
        expression: `people.{"addr": address.city}`,
        expectedPaths: [
          { path: "people", confidence: "static" },
          { path: "people.address.city", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R11: block step with conditional extracts condition and then-branch paths",
        expression: `items.(active ? name : "N/A")`,
        expectedPaths: [
          { path: "items.active", confidence: "static" },
          { path: "items.name", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R12: object constructor with arithmetic and comparison in values",
        expression: `data.records.{"key": id, "label": meta.name, "active": status = "on"}`,
        expectedPaths: [
          { path: "data.records", confidence: "static" },
          { path: "data.records.id", confidence: "static" },
          { path: "data.records.meta.name", confidence: "static" },
          { path: "data.records.status", confidence: "static" },
        ],
      },
      {
        name: "PRNT-R13: object constructor with addition in value extracts both operand paths",
        expression: `items.{"total": price + tax}`,
        expectedPaths: [
          { path: "items", confidence: "static" },
          { path: "items.price", confidence: "static" },
          { path: "items.tax", confidence: "static" },
        ],
      },
    ];

    for (const fixture of fixtures) {
      it(fixture.name, () => {
        assertFixture(fixture);
      });
    }
  });

  describe("FOCV regression: focus variable prefix handling and variable-in-filter scope", () => {
    const fixtures: IntegrationFixture[] = [
      // Edge 1: Simple focus variable without filter -- baseline: focus var alone should not cause issues
      {
        name: "FOCV-R01: simple focus variable without filter produces path continuation only",
        expression: `orders@$o.id`,
        expectedPaths: [
          { path: "orders.id", confidence: "static" },
        ],
      },
      // Edge 2: Focus variable with compound predicate -- multiple focus-var references in AND predicate
      {
        name: "FOCV-R02: focus variable with compound AND predicate resolves both branches without double prefix",
        expression: `items@$i[$i.price > 50 and $i.active].name`,
        expectedPaths: [
          { path: "items.active", confidence: "static" },
          { path: "items.name", confidence: "static" },
          { path: "items.price", confidence: "static" },
        ],
      },
      // Edge 3: Nested focus variables -- each resolves to own context
      {
        name: "FOCV-R03: nested focus variables each resolve to their own context prefix",
        expression: `departments@$d.employees@$e[$e.salary > 50000].name`,
        expectedPaths: [
          { path: "departments.employees.name", confidence: "static" },
          { path: "departments.employees.salary", confidence: "static" },
        ],
      },
      // Edge 4: Focus variable with bare field in same filter -- mix of focus-var (no prefix) and bare (prefix)
      {
        name: "FOCV-R04: focus variable path and bare field name coexist in same filter predicate",
        expression: `items@$i[$i.category = type].name`,
        expectedPaths: [
          { path: "items.category", confidence: "static" },
          { path: "items.name", confidence: "static" },
          { path: "items.type", confidence: "static" },
        ],
      },
      // Edge 5: External variable cross-ref with focus -- external var not re-emitted from filter
      {
        name: "FOCV-R05: external variable cross-ref with focus variable in filter does not re-emit external path",
        expression: `($min := threshold; orders@$o[$o.total > $min].id)`,
        expectedPaths: [
          { path: "orders.id", confidence: "static" },
          { path: "orders.total", confidence: "static" },
          { path: "threshold", confidence: "static" },
        ],
      },
      // Edge 6: Variable-in-filter with no focus variable -- bare field prefixed, external var not re-emitted
      {
        name: "FOCV-R06: variable-in-filter without focus variable prefixes bare fields and suppresses variable paths",
        expression: `($x := limit; products[price > $x].name)`,
        expectedPaths: [
          { path: "limit", confidence: "static" },
          { path: "products.name", confidence: "static" },
          { path: "products.price", confidence: "static" },
        ],
      },
      // Edge 7: Multiple filter stages with variable -- variable cross-ref in sequential filters
      {
        name: "FOCV-R07: multiple sequential filter stages with variable cross-ref prefix correctly",
        expression: `($cfg := config; items[price > $cfg.min][price < $cfg.max].name)`,
        expectedPaths: [
          { path: "config", confidence: "static" },
          { path: "items.name", confidence: "static" },
          { path: "items.price", confidence: "static" },
        ],
      },
      // Edge 8: Focus variable used outside filter -- focus var in path continuation only
      {
        name: "FOCV-R08: focus variable in path continuation (no filter) resolves correctly",
        expression: `orders@$o.items.name`,
        expectedPaths: [
          { path: "orders.items.name", confidence: "static" },
        ],
      },
      // Edge 9: Cross-referenced focus variables in nested contexts
      {
        name: "FOCV-R09: cross-referenced focus variables in nested filter resolve inner focus correctly",
        expression: `library.loans@$l.books@$b[$l.isbn = $b.isbn].title`,
        expectedPaths: [
          { path: "library.loans.isbn", confidence: "static" },
          { path: "library.loans.books.isbn", confidence: "static" },
          { path: "library.loans.books.title", confidence: "static" },
        ],
      },
      // Edge 10: Chained apply with focus variable input -- combines focus filter with HOF
      {
        name: "FOCV-R10: chained apply with focus variable filter combines correctly with HOF",
        expression: `orders@$o[$o.active] ~> $map(function($v) { $v.total })`,
        expectedPaths: [
          { path: "orders", confidence: "static" },
          { path: "orders.active", confidence: "static" },
          { path: "orders.total", confidence: "static" },
        ],
      },
      // Edge 11: Focus variable with string comparison in filter -- string literal produces no paths
      {
        name: "FOCV-R11: focus variable with string literal comparison in filter handles literals correctly",
        expression: `users@$u[$u.role = "admin"].email`,
        expectedPaths: [
          { path: "users.email", confidence: "static" },
          { path: "users.role", confidence: "static" },
        ],
      },
      // Edge 12: Multiple external variables in filter without focus -- all suppressed from filter
      {
        name: "FOCV-R12: multiple external variables in filter all suppressed from filter output",
        expression: `($lo := bounds.low; $hi := bounds.high; data[value >= $lo and value <= $hi].label)`,
        expectedPaths: [
          { path: "bounds.low", confidence: "static" },
          { path: "bounds.high", confidence: "static" },
          { path: "data.label", confidence: "static" },
          { path: "data.value", confidence: "static" },
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
