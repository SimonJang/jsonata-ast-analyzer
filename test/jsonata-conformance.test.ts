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
      { path: "items.price", confidence: "static" },
      { path: "name", confidence: "static" },
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
    name: "root context reference path",
    expression: "$$.customer.name",
    expectedPaths: [{ path: "customer.name", confidence: "static" }],
  },
  {
    name: "root reference alias",
    expression: "($root := $; $root.customer.name)",
    expectedPaths: [{ path: "customer.name", confidence: "static" }],
  },
  {
    name: "current context reference inside relative filter",
    expression: "$.items[price > $.config.min].name",
    expectedPaths: [
      { path: "items.config.min", confidence: "static" },
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
  {
    name: "root reference with a position binding and filter",
    expression: "$#$pos[$pos < 3]",
    expectedPaths: [],
  },
  {
    name: "root reference with relative filter predicates",
    expression: "$[x = 6][y = 3].number",
    expectedPaths: [
      { path: "number", confidence: "static" },
      { path: "x", confidence: "static" },
      { path: "y", confidence: "static" },
    ],
  },
  {
    name: "context path consumed by a terminal function step",
    expression: "customer.name.$uppercase()",
    expectedPaths: [
      { path: "customer.name", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached directly to a wildcard",
    expression: '*[type = "home"]',
    expectedPaths: [
      { path: "*", confidence: "static" },
      { path: "*.type", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached directly to a string literal",
    expression: '"constant"[$$.stringFlag]',
    expectedPaths: [
      { path: "stringFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached directly to a number literal",
    expression: "1[$$.numberFlag]",
    expectedPaths: [
      { path: "numberFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached directly to a value literal",
    expression: "true[$$.valueFlag]",
    expectedPaths: [
      { path: "valueFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached directly to a regex literal",
    expression: "/x/[$$.regexFlag]",
    expectedPaths: [
      { path: "regexFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to an indexed number path step",
    expression: "1#$i[$i = 0 and $$.indexedNumberFlag]",
    expectedPaths: [
      { path: "indexedNumberFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to an indexed string path step",
    expression: '"constant"#$i[$i = 0 and $$.indexedStringFlag]',
    expectedPaths: [
      { path: "indexedStringFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to an indexed block path step",
    expression: '("constant")#$i[$i = 0 and $$.indexedBlockFlag]',
    expectedPaths: [
      { path: "indexedBlockFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to an indexed array path step",
    expression: '[1, 2]#$i[$i = 0 and $$.indexedArrayFlag]',
    expectedPaths: [
      { path: "indexedArrayFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to a source-less block result",
    expression: '("constant")[$$.blockFlag]',
    expectedPaths: [
      { path: "blockFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to a source-less array result",
    expression: "[1, 2][$$.arrayFlag]",
    expectedPaths: [
      { path: "arrayFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to a source-less function result",
    expression: '$string("constant")[$$.functionFlag]',
    expectedPaths: [
      { path: "functionFlag", confidence: "static" },
    ],
  },
  {
    name: "group-by attached directly to a source-less literal",
    expression: '"constant"{$$.literalKey: $$.literalValue}',
    expectedPaths: [
      { path: "literalKey", confidence: "static" },
      { path: "literalValue", confidence: "static" },
    ],
  },
  {
    name: "group-by attached directly to a value literal",
    expression: 'true{$$.valueKey: $$.valueResult}',
    expectedPaths: [
      { path: "valueKey", confidence: "static" },
      { path: "valueResult", confidence: "static" },
    ],
  },
  {
    name: "group-by attached directly to a regex literal",
    expression: '/x/{$$.regexKey: $$.regexResult}',
    expectedPaths: [
      { path: "regexKey", confidence: "static" },
      { path: "regexResult", confidence: "static" },
    ],
  },
  {
    name: "group-by attached directly to a wildcard",
    expression: '*{$$.wildcardKey: $$.wildcardValue}',
    expectedPaths: [
      { path: "*", confidence: "static" },
      { path: "wildcardKey", confidence: "static" },
      { path: "wildcardValue", confidence: "static" },
    ],
  },
  {
    name: "group-by attached directly to a descendant",
    expression: '**{$$.descendantKey: $$.descendantValue}',
    expectedPaths: [
      { path: "**", confidence: "static" },
      { path: "descendantKey", confidence: "static" },
      { path: "descendantValue", confidence: "static" },
    ],
  },
  {
    name: "group-by attached to a source-less block result",
    expression: '(1; 2){$$.blockKey: $$.blockValue}',
    expectedPaths: [
      { path: "blockKey", confidence: "static" },
      { path: "blockValue", confidence: "static" },
    ],
  },
  {
    name: "group-by attached to a source-less array result",
    expression: '[1, 2]{$$.arrayKey: $$.arrayValue}',
    expectedPaths: [
      { path: "arrayKey", confidence: "static" },
      { path: "arrayValue", confidence: "static" },
    ],
  },
  {
    name: "group-by attached to a source-less function result",
    expression: '$string("constant"){$$.functionKey: $$.functionValue}',
    expectedPaths: [
      { path: "functionKey", confidence: "static" },
      { path: "functionValue", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached directly to a partial application",
    expression: "$substring(?, 0, 1)[$$.partialFlag]",
    expectedPaths: [
      { path: "partialFlag", confidence: "static" },
    ],
  },
  {
    name: "group-by attached directly to a partial application",
    expression: "$substring(?, 0, 1){$$.partialKey: $$.partialValue}",
    expectedPaths: [
      { path: "partialKey", confidence: "static" },
      { path: "partialValue", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached directly to a lambda value",
    expression: "function($x){$x}[$$.lambdaFlag]",
    expectedPaths: [
      { path: "lambdaFlag", confidence: "static" },
    ],
  },
  {
    name: "group-by attached directly to a lambda value",
    expression: "function($x){$x}{$$.lambdaKey: $$.lambdaValue}",
    expectedPaths: [
      { path: "lambdaKey", confidence: "static" },
      { path: "lambdaValue", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to an indexed partial path step",
    expression: "$substring(?, 0, 1)#$i[$i = 0 and $$.indexedPartialFlag]",
    expectedPaths: [
      { path: "indexedPartialFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to an indexed lambda path step",
    expression: "function($x){$x}#$i[$i = 0 and $$.indexedLambdaFlag]",
    expectedPaths: [
      { path: "indexedLambdaFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached directly to a transform value",
    expression: '|Account|{"x": 1}|[$$.transformFlag]',
    expectedPaths: [
      { path: "Account", confidence: "static" },
      { path: "transformFlag", confidence: "static" },
    ],
  },
  {
    name: "group-by attached directly to a transform value",
    expression: '|Account|{"x": 1}|{$$.transformKey: $$.transformValue}',
    expectedPaths: [
      { path: "Account", confidence: "static" },
      { path: "transformKey", confidence: "static" },
      { path: "transformValue", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to an indexed transform path step",
    expression:
      '|Account|{"x": 1}|#$i[$i = 0 and $$.indexedTransformFlag]',
    expectedPaths: [
      { path: "Account", confidence: "static" },
      { path: "indexedTransformFlag", confidence: "static" },
    ],
  },
  {
    name: "filter predicate on a wildcard path step",
    expression: "accounts.*[active].name",
    expectedPaths: [
      { path: "accounts.*.active", confidence: "static" },
      { path: "accounts.*.name", confidence: "static" },
    ],
  },
  {
    name: "filter predicate on a parent path step",
    expression: 'orders.items.%[status = "open"].id',
    expectedPaths: [
      { path: "orders.items.%.id", confidence: "partial" },
      { path: "orders.items.%.status", confidence: "partial" },
    ],
  },
  {
    name: "filter predicate on a descendant path step",
    expression: '**[type = "home"].name',
    expectedPaths: [
      { path: "**.name", confidence: "static" },
      { path: "**.type", confidence: "static" },
    ],
  },
  {
    name: "filter predicate attached to a sort step",
    expression: "items^(age)[active].name",
    expectedPaths: [
      { path: "items.active", confidence: "static" },
      { path: "items.age", confidence: "static" },
      { path: "items.name", confidence: "static" },
    ],
  },
  {
    name: "position binding attached to a sort step",
    expression: "items^(age)#$i[$i].name",
    expectedPaths: [
      { path: "items.age", confidence: "static" },
      { path: "items.name", confidence: "static" },
    ],
  },
  {
    name: "filter predicate on a standalone root reference",
    expression: '$[type = "command"][]',
    expectedPaths: [
      { path: "type", confidence: "static" },
    ],
  },
  {
    name: "group-by attached to a standalone root context reference",
    expression: '$${id: {"label": label, "value": value}}',
    expectedPaths: [
      { path: "id", confidence: "static" },
      { path: "label", confidence: "static" },
      { path: "value", confidence: "static" },
    ],
  },
  {
    name: "root reference passed to a custom function",
    expression:
      "($project := function($arg) { $arg.Account.Order[0].OrderID }; $project($))",
    expectedPaths: [
      { path: "Account.Order.OrderID", confidence: "static" },
    ],
  },
  {
    name: "higher-order index predicate reading the element parameter",
    expression: "$map(items, function($v, $i) { $i[$v.active] })",
    expectedPaths: [
      { path: "items", confidence: "static" },
      { path: "items.active", confidence: "static" },
    ],
  },
  {
    name: "parenthesized root sort followed by a property read",
    expression: "($^(age)).name",
    expectedPaths: [
      { path: "age", confidence: "static" },
      { path: "name", confidence: "static" },
    ],
  },
  {
    name: "current-context identity step inside a path",
    expression: "library.books.$.title",
    expectedPaths: [
      { path: "library.books.title", confidence: "static" },
    ],
  },
  {
    name: "predicate on a current-context identity path step",
    expression: "library.books.$[featured].title",
    expectedPaths: [
      { path: "library.books.featured", confidence: "static" },
      { path: "library.books.title", confidence: "static" },
    ],
  },
  {
    name: "root-context reset inside a relative path",
    expression: "orders.items.$$.config.tax",
    expectedPaths: [
      { path: "config.tax", confidence: "static" },
      { path: "orders.items", confidence: "static" },
    ],
  },
  {
    name: "path block binding a parent before a suffix read",
    expression: "Account.Order.Product.($parent := %; $parent.OrderID)",
    expectedPaths: [
      { path: "Account.Order.Product.%", confidence: "partial" },
      { path: "Account.Order.Product.%.OrderID", confidence: "partial" },
    ],
  },
  {
    name: "empty path block preserves the traversed input prefix",
    expression: "Account.Order.().%",
    expectedPaths: [
      { path: "Account.Order", confidence: "static" },
    ],
  },
  {
    name: "root-only path block preserves the traversed input prefix",
    expression: 'items.("constant"[$$.config.enabled])',
    expectedPaths: [
      { path: "config.enabled", confidence: "static" },
      { path: "items", confidence: "static" },
    ],
  },
  {
    name: "root identity binding path block preserves the traversed input prefix",
    expression: "items.($root := $$; $root.config.enabled)",
    expectedPaths: [
      { path: "config.enabled", confidence: "static" },
      { path: "items", confidence: "static" },
    ],
  },
  {
    name: "root-only closure path block preserves the traversed input prefix",
    expression:
      "($f := function(){ $$.config.value }; items.($f()))",
    expectedPaths: [
      { path: "config.value", confidence: "static" },
      { path: "items", confidence: "static" },
    ],
  },
  {
    name: "sift callback with an implicit root data argument",
    expression: "$sift(function($v) { $v.profile.postcode })",
    expectedPaths: [
      { path: "*", confidence: "static" },
      { path: "*.profile.postcode", confidence: "static" },
    ],
  },
  {
    name: "each callback with an implicit root data argument and scalar reads",
    expression: "$each(function($v, $k) { $k[$v > 2] })",
    expectedPaths: [{ path: "*", confidence: "static" }],
  },
  {
    name: "sift callback with an implicit root data argument and key reads",
    expression: "$sift(function($v, $k) { $k ~> /^A/ })",
    expectedPaths: [{ path: "*", confidence: "static" }],
  },
  {
    name: "inline path lambda with a context-default first argument",
    expression: "Age.function($x, $y)<n-n:n>{ $x + $y }(6)",
    expectedPaths: [
      { path: "Age", confidence: "static" },
    ],
  },
  {
    name: "path-context closure reading its captured current context",
    expression: "Account.($f := function(){ $.name }; $f())",
    expectedPaths: [
      { path: "Account.name", confidence: "static" },
    ],
  },
  {
    name: "path-context identity variable alias",
    expression: "items.($x := $; $x.name)",
    expectedPaths: [{ path: "items.name", confidence: "static" }],
  },
  {
    name: "path-context identity custom function argument",
    expression: "items.(function($x){$x.name}($))",
    expectedPaths: [{ path: "items.name", confidence: "static" }],
  },
  {
    name: "document-root identity variable alias inside a path",
    expression: "items.($x := $$; $x.root)",
    expectedPaths: [
      { path: "items", confidence: "static" },
      { path: "root", confidence: "static" },
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
