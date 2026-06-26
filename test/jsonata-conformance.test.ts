import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { extractPaths } from "../src/index.js";
import type { PathResult } from "../src/index.js";
import { sortPaths } from "./integration/helpers.js";

interface ConformanceFixture {
  name: string;
  expression: string;
  expectedPaths: PathResult[];
}

const fixtures: ConformanceFixture[] = [
  {
    name: "context variable binding with @",
    expression: "items@$i[$i.price > 50 and $i.active].name",
    expectedPaths: [
      { path: "items.active", confidence: "static" },
      { path: "items.name", confidence: "static" },
      { path: "items.price", confidence: "static" },
    ],
  },
  {
    name: "positional variable binding with #",
    expression: "items#$i.name",
    expectedPaths: [{ path: "items.name", confidence: "static" }],
  },
  {
    name: "parent operator with %",
    expression: "orders.items.%.date",
    expectedPaths: [{ path: "orders.items.%.date", confidence: "partial" }],
  },
  {
    name: "descendant wildcard with **",
    expression: "**.price",
    expectedPaths: [{ path: "**.price", confidence: "static" }],
  },
  {
    name: "order-by stage with ^()",
    expression: "items^(>price, <date).name",
    expectedPaths: [
      { path: "items.date", confidence: "static" },
      { path: "items.name", confidence: "static" },
      { path: "items.price", confidence: "static" },
    ],
  },
  {
    name: "group-by reduce stage with {}",
    expression: "items{category: price}",
    expectedPaths: [
      { path: "items", confidence: "static" },
      { path: "items.category", confidence: "static" },
      { path: "items.price", confidence: "static" },
    ],
  },
  {
    name: "partial application placeholder",
    expression: "($first5 := $substring(?, 0, 5); $first5(customer.name))",
    expectedPaths: [{ path: "customer.name", confidence: "static" }],
  },
  {
    name: "lambda function",
    expression: "$map(items, function($v) { $v.name })",
    expectedPaths: [
      { path: "items", confidence: "static" },
      { path: "items.name", confidence: "static" },
    ],
  },
  {
    name: "regex literal",
    expression: "$match(description, /urgent/i)",
    expectedPaths: [{ path: "description", confidence: "static" }],
  },
  {
    name: "transform expression",
    expression: '| account | {"displayName": firstName & " " & lastName} |',
    expectedPaths: [
      { path: "account", confidence: "static" },
      { path: "account.firstName", confidence: "static" },
      { path: "account.lastName", confidence: "static" },
    ],
  },
  {
    name: "elvis operator",
    expression: "customer.email ?: customer.phone",
    expectedPaths: [
      { path: "customer.email", confidence: "static" },
      { path: "customer.phone", confidence: "static" },
    ],
  },
  {
    name: "null coalescing operator",
    expression: "nickname ?? firstName",
    expectedPaths: [
      { path: "firstName", confidence: "static" },
      { path: "nickname", confidence: "static" },
    ],
  },
  {
    name: "root reference path",
    expression: "$.customer.name",
    expectedPaths: [{ path: "customer.name", confidence: "static" }],
  },
  {
    name: "root reference alias",
    expression: "($root := $; $root.customer.name)",
    expectedPaths: [{ path: "customer.name", confidence: "static" }],
  },
  {
    name: "root reference inside relative filter",
    expression: "$.items[price > $.config.min].name",
    expectedPaths: [
      { path: "config.min", confidence: "static" },
      { path: "items.name", confidence: "static" },
      { path: "items.price", confidence: "static" },
    ],
  },
  {
    name: "root reference as higher-order input",
    expression: "$map($.items, function($v) { $v.name })",
    expectedPaths: [
      { path: "items", confidence: "static" },
      { path: "items.name", confidence: "static" },
    ],
  },
];

describe("JSONata baseline conformance", () => {
  describe("parser acceptance", () => {
    for (const fixture of fixtures) {
      it(fixture.name, () => {
        expect(() => jsonata(fixture.expression).ast()).not.toThrow();
      });
    }
  });

  describe("path extraction baseline", () => {
    for (const fixture of fixtures) {
      it(fixture.name, () => {
        expect(sortPaths(extractPaths(fixture.expression))).toEqual(
          sortPaths(fixture.expectedPaths),
        );
      });
    }
  });
});
