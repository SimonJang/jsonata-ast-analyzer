import { describe, expect, it } from "vitest";
import { extractPaths } from "../src/index.js";
import { sortPaths } from "./integration/helpers.js";

describe("path-stage semantics", () => {
  it("extracts both sides of nested @ join bindings", () => {
    expect(
      sortPaths(
        extractPaths(
          'library.loans@$l.books@$b[$l.isbn=$b.isbn].{"title":$b.title,"customer":$l.customer}',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "library.loans.books", confidence: "static" },
        { path: "library.loans.books.isbn", confidence: "static" },
        { path: "library.loans.books.title", confidence: "static" },
        { path: "library.loans.customer", confidence: "static" },
        { path: "library.loans.isbn", confidence: "static" },
      ]),
    );
  });

  it("keeps # position bindings out of input paths", () => {
    expect(extractPaths("items#$i[$i > 0].name")).toEqual([
      { path: "items.name", confidence: "static" },
    ]);
  });

  it("does not mark variables bound to numeric indexes as dynamic selectors", () => {
    expect(extractPaths("($i := 0; items[$i].name)")).toEqual([
      { path: "items.name", confidence: "static" },
    ]);
  });

  it("does not mark variables bound to scalar predicates as dynamic selectors", () => {
    expect(extractPaths("($flag := true; items[$flag].name)")).toEqual([
      { path: "items.name", confidence: "static" },
    ]);
  });

  it("does not mark variables bound to scalar function results as dynamic selectors", () => {
    expect(extractPaths("($idx := $random(); items[$idx].name)")).toEqual([
      { path: "items.name", confidence: "static" },
    ]);
  });

  it("preserves parent reads inside object projection", () => {
    expect(
      sortPaths(
        extractPaths('orders.items.{"itemName": name, "orderDate": %.date}'),
      ),
    ).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.name", confidence: "static" },
        { path: "orders.items.%.date", confidence: "partial" },
      ]),
    );
  });

  it("preserves block projection aliases before chained fields", () => {
    expect(sortPaths(extractPaths("items.(tags).name"))).toEqual(
      sortPaths([
        { path: "items.tags", confidence: "static" },
        { path: "items.tags.name", confidence: "static" },
      ]),
    );
  });

  it("preserves array projection aliases before chained fields", () => {
    expect(sortPaths(extractPaths("items.([primary, fallback]).name"))).toEqual(
      sortPaths([
        { path: "items.fallback", confidence: "static" },
        { path: "items.fallback.name", confidence: "static" },
        { path: "items.primary", confidence: "static" },
        { path: "items.primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves conditional projection aliases before chained fields", () => {
    expect(
      sortPaths(extractPaths("items.(flag ? primary : fallback).name")),
    ).toEqual(
      sortPaths([
        { path: "items.fallback", confidence: "static" },
        { path: "items.fallback.name", confidence: "static" },
        { path: "items.flag", confidence: "static" },
        { path: "items.primary", confidence: "static" },
        { path: "items.primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves static object projection aliases before chained fields", () => {
    expect(sortPaths(extractPaths('items.{"k": tags}.k.name'))).toEqual(
      sortPaths([
        { path: "items.tags", confidence: "static" },
        { path: "items.tags.name", confidence: "static" },
      ]),
    );
  });

  it("keeps root-relative object projection aliases root-relative", () => {
    expect(sortPaths(extractPaths('items.{"x": $.root}.x.name'))).toEqual(
      sortPaths([
        { path: "root", confidence: "static" },
        { path: "root.name", confidence: "static" },
      ]),
    );
  });

  it("preserves constructed dynamic object aliases inside object projection steps", () => {
    expect(
      sortPaths(extractPaths('([{key: primary}]).{"out": x.name}')),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves chained fields after constructed dynamic object projection steps", () => {
    expect(
      sortPaths(extractPaths('([{key: primary}]).{"out": x.name}.out')),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves chained fields after constructed static object projection steps", () => {
    expect(
      sortPaths(extractPaths('([{"x": primary}]).{"out": x.name}.out')),
    ).toEqual(
      sortPaths([
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound dynamic object aliases inside block projection steps", () => {
    expect(sortPaths(extractPaths("($o := [{key: primary}]; $o.(x.name))"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves focus-bound block projection aliases before chained fields", () => {
    expect(sortPaths(extractPaths("items@$v.($v.tags).name"))).toEqual(
      sortPaths([
        { path: "items.tags", confidence: "static" },
        { path: "items.tags.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable focus-bound block projection reads", () => {
    expect(
      sortPaths(extractPaths("($items := orders.items; $items@$v.($v.category))")),
    ).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.category", confidence: "static" },
      ]),
    );
  });

  it("preserves variable focus-bound block projection aliases before chained fields", () => {
    expect(
      sortPaths(extractPaths("($items := orders.items; $items@$v.($v.tags).name)")),
    ).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.tags", confidence: "static" },
        { path: "orders.items.tags.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable focus-bound conditional projection condition reads", () => {
    expect(
      sortPaths(
        extractPaths(
          "($items := orders.items; $items@$v.($v.flag ? $v.primary : $v.fallback).name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.fallback", confidence: "static" },
        { path: "orders.items.fallback.name", confidence: "static" },
        { path: "orders.items.flag", confidence: "static" },
        { path: "orders.items.primary", confidence: "static" },
        { path: "orders.items.primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable focus-bound suffix filter predicate reads", () => {
    expect(
      sortPaths(
        extractPaths(
          "($items := orders.items; $items@$v.($v.children[$v.active]).name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.active", confidence: "static" },
        { path: "orders.items.children", confidence: "static" },
        { path: "orders.items.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable focus-bound child suffix filter predicate reads", () => {
    expect(
      sortPaths(
        extractPaths("($items := orders.items; $items@$v.($v.children[enabled]).name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.children", confidence: "static" },
        { path: "orders.items.children.enabled", confidence: "static" },
        { path: "orders.items.children.name", confidence: "static" },
      ]),
    );
  });

  it("uses suffix context for variable focus-bound sort terms", () => {
    expect(
      sortPaths(
        extractPaths(
          "($items := orders.items; $items@$v.($v.children^(>rank)).name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.children", confidence: "static" },
        { path: "orders.items.children.name", confidence: "static" },
        { path: "orders.items.children.rank", confidence: "static" },
      ]),
    );
  });

  it("uses suffix context for variable focus-bound group entries", () => {
    expect(
      sortPaths(
        extractPaths(
          "($items := orders.items; $items@$v.($v.children{type: $sum(amount)}))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.children", confidence: "static" },
        { path: "orders.items.children.amount", confidence: "static" },
        { path: "orders.items.children.type", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix filters after variable focus-bound conditional aliases", () => {
    expect(
      sortPaths(
        extractPaths(
          "($items := orders.items; $items@$v.(($v.flag ? $v.primary : $v.fallback)[enabled]).name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.fallback", confidence: "static" },
        { path: "orders.items.fallback.enabled", confidence: "static" },
        { path: "orders.items.fallback.name", confidence: "static" },
        { path: "orders.items.flag", confidence: "static" },
        { path: "orders.items.primary", confidence: "static" },
        { path: "orders.items.primary.enabled", confidence: "static" },
        { path: "orders.items.primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves predicates on array result aliases", () => {
    expect(sortPaths(extractPaths("([primary, fallback][enabled]).name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.enabled", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.enabled", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves predicates on function result aliases", () => {
    expect(
      sortPaths(
        extractPaths("$map(items, function($v){$v.children})[enabled].name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.children", confidence: "static" },
        { path: "items.children.enabled", confidence: "static" },
        { path: "items.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves predicates on object result aliases", () => {
    expect(sortPaths(extractPaths("({key: primary}[x.enabled]).x.name"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.enabled", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("unwraps parenthesized inline lambda call procedures", () => {
    expect(
      sortPaths(
        extractPaths("(function($v){$v.children})(item)[enabled].name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "item", confidence: "static" },
        { path: "item.children", confidence: "static" },
        { path: "item.children.enabled", confidence: "static" },
        { path: "item.children.name", confidence: "static" },
      ]),
    );
  });

  it("resolves function result predicates through object aliases", () => {
    expect(
      sortPaths(extractPaths("$clone({key: primary})[x.enabled].x.name")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.enabled", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves focus-bound conditional projection aliases before chained fields", () => {
    expect(
      sortPaths(extractPaths("items@$v.($v.flag ? $v.primary : $v.fallback).name")),
    ).toEqual(
      sortPaths([
        { path: "items.fallback", confidence: "static" },
        { path: "items.fallback.name", confidence: "static" },
        { path: "items.flag", confidence: "static" },
        { path: "items.primary", confidence: "static" },
        { path: "items.primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves focus-bound object projection aliases before chained fields", () => {
    expect(sortPaths(extractPaths('items@$v.({"k": $v.tags}).k.name'))).toEqual(
      sortPaths([
        { path: "items.tags", confidence: "static" },
        { path: "items.tags.name", confidence: "static" },
      ]),
    );
  });

  it("preserves focus-bound array projection aliases before chained fields", () => {
    expect(
      sortPaths(extractPaths("items@$v.([$v.primary, $v.fallback]).name")),
    ).toEqual(
      sortPaths([
        { path: "items.fallback", confidence: "static" },
        { path: "items.fallback.name", confidence: "static" },
        { path: "items.primary", confidence: "static" },
        { path: "items.primary.name", confidence: "static" },
      ]),
    );
  });

  it("keeps bare focus projection paths root-relative", () => {
    expect(sortPaths(extractPaths("items@$v.(price & $v.type)"))).toEqual(
      sortPaths([
        { path: "items.type", confidence: "static" },
        { path: "price", confidence: "static" },
      ]),
    );
  });

  it("keeps bare-only focus projection paths root-relative", () => {
    expect(extractPaths("items@$v.(price)")).toEqual([
      { path: "price", confidence: "static" },
    ]);
  });

  it("keeps bare lookup inputs root-relative in focus projections", () => {
    expect(sortPaths(extractPaths("ids@$id.($lookup(products, $id)).name"))).toEqual(
      sortPaths([
        { path: "ids", confidence: "static" },
        { path: "products", confidence: "static" },
        { path: "products.name", confidence: "static" },
      ]),
    );
  });

  it("keeps projected bare lookup results root-relative in focus projections", () => {
    expect(
      sortPaths(extractPaths("ids@$id.($lookup(products, $id).detail).name")),
    ).toEqual(
      sortPaths([
        { path: "ids", confidence: "static" },
        { path: "products", confidence: "static" },
        { path: "products.detail", confidence: "static" },
        { path: "products.detail.name", confidence: "static" },
      ]),
    );
  });

  it("summarizes descendant reads without expanding them", () => {
    expect(extractPaths("account.**.price")).toEqual([
      { path: "account.**.price", confidence: "static" },
    ]);
  });

  it("preserves ordering and grouping dependencies", () => {
    expect(sortPaths(extractPaths("items^(>date){category: $sum(total)}"))).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.category", confidence: "static" },
        { path: "items.date", confidence: "static" },
        { path: "items.total", confidence: "static" },
      ]),
    );
  });

  it("preserves constructed dynamic object aliases inside group-by expressions", () => {
    expect(sortPaths(extractPaths("([{key: primary}]){x.name: x.name}"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound dynamic object aliases inside group-by expressions", () => {
    expect(
      sortPaths(extractPaths("($o := [{key: primary}]; $o{x.name: x.name})")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves callback object aliases inside function result group-by expressions", () => {
    expect(
      sortPaths(
        extractPaths('$map(items, function($v){{"x": $v.detail}}){x.name: x.name}'),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });
});
