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
});
