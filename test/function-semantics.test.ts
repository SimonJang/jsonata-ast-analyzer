import { describe, expect, it } from "vitest";
import { extractPaths } from "../src/index.js";
import { sortPaths } from "./integration/helpers.js";

describe("function semantics", () => {
  it("captures lambda scope at definition time", () => {
    expect(
      sortPaths(
        extractPaths(
          "($base := account; $fn := function() { $base.name }; $base := customer; $fn())",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "account", confidence: "static" },
        { path: "account.name", confidence: "static" },
        { path: "customer", confidence: "static" },
      ]),
    );
  });

  it("preserves bound and later read effects for partial applications", () => {
    expect(
      sortPaths(
        extractPaths(
          "($lookupCustomer := $lookup(customers, ?); $lookupCustomer(customerId).name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "customers", confidence: "static" },
        { path: "customers.name", confidence: "static" },
        { path: "customerId", confidence: "static" },
      ]),
    );
  });

  it("propagates higher-order callback reads", () => {
    expect(
      sortPaths(
        extractPaths(
          "$map(Account.Order.Product, function($p) { $p.Price * $p.Quantity })",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "Account.Order.Product", confidence: "static" },
        { path: "Account.Order.Product.Price", confidence: "static" },
        { path: "Account.Order.Product.Quantity", confidence: "static" },
      ]),
    );
  });

  it("threads apply-chain callbacks", () => {
    expect(extractPaths("items ~> $map(function($v) { $v.price }) ~> $sum()")).toEqual([
      { path: "items", confidence: "static" },
      { path: "items.price", confidence: "static" },
    ]);
  });

  it("does not suffix scalar function result properties onto input paths", () => {
    expect(extractPaths("$substring(customer.name, 0, 3).length")).toEqual([
      { path: "customer.name", confidence: "static" },
    ]);
  });

  it("does not suffix regex match result properties onto input paths", () => {
    expect(extractPaths("$match(description, /urgent/i).match")).toEqual([
      { path: "description", confidence: "static" },
    ]);
  });

  it("resolves variable-bound callbacks in higher-order functions", () => {
    expect(
      sortPaths(
        extractPaths("($project := function($v) { $v.name }; $map(items, $project))"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
  });

  it("resolves variable-bound callbacks in filtered path chains", () => {
    expect(
      sortPaths(
        extractPaths("($active := function($v) { $v.active }; $filter(items, $active).name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.active", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
  });

  it("resolves variable-bound callbacks in apply chains", () => {
    expect(
      sortPaths(
        extractPaths("($project := function($v) { $v.name }; items ~> $map($project))"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
  });

  it("does not suffix through variables bound to constructed objects", () => {
    expect(extractPaths('($o := {"x": account.name}; $o.x)')).toEqual([
      { path: "account.name", confidence: "static" },
    ]);
  });

  it("does not suffix through nested constructed object bindings", () => {
    expect(
      sortPaths(extractPaths('($o := {"nested": {"x": account.name}}; $o.nested.x)')),
    ).toEqual(sortPaths([{ path: "account.name", confidence: "static" }]));
  });

  it("binds lookup results without suffixing lookup keys", () => {
    expect(
      sortPaths(extractPaths("($p := $lookup(products, sku); $p.price)")),
    ).toEqual(
      sortPaths([
        { path: "products", confidence: "static" },
        { path: "products.price", confidence: "static" },
        { path: "sku", confidence: "static" },
      ]),
    );
  });

  it("binds filter results without suffixing predicate reads", () => {
    expect(
      sortPaths(
        extractPaths("($p := $filter(items, function($v) { $v.active }); $p.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.active", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
  });

  it("does not suffix variables bound to scalar function results", () => {
    expect(extractPaths("($s := $substring(customer.name, 0, 3); $s.length)")).toEqual([
      { path: "customer.name", confidence: "static" },
    ]);
  });

  it("does not suffix conditional test paths through bound result variables", () => {
    expect(sortPaths(extractPaths("($x := a > 0 ? b : c; $x.name)"))).toEqual(
      sortPaths([
        { path: "a", confidence: "static" },
        { path: "b", confidence: "static" },
        { path: "b.name", confidence: "static" },
        { path: "c", confidence: "static" },
        { path: "c.name", confidence: "static" },
      ]),
    );
  });

  it("binds apply-chain filter results as suffixable input aliases", () => {
    expect(
      sortPaths(
        extractPaths("($p := items ~> $filter(function($v) { $v.active }); $p.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.active", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
  });

  it("binds apply-chain sort results as suffixable input aliases", () => {
    expect(
      sortPaths(
        extractPaths("($p := items ~> $sort(function($l, $r) { $l.price < $r.price }); $p.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "items.price", confidence: "static" },
      ]),
    );
  });

  it("binds nested lookup results without suffixing helper reads", () => {
    expect(
      sortPaths(
        extractPaths("($p := $lookup($lookup(outer, key1).inner, key2); $p.value)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "key1", confidence: "static" },
        { path: "key2", confidence: "static" },
        { path: "outer", confidence: "static" },
        { path: "outer.inner", confidence: "static" },
        { path: "outer.inner.value", confidence: "static" },
      ]),
    );
  });
});
