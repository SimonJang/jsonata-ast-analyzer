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

  it("preserves predicates on mixed function result object aliases", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map(items, function($v){flag ? {"x": $v.detail} : fallback})[x.enabled].x.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
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

  it("walks block group entries for every result base", () => {
    expect(sortPaths(extractPaths("([primary, fallback]){enabled: name}"))).toEqual(
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

  it("preserves suffix paths after sorting object aliases", () => {
    expect(sortPaths(extractPaths("({key: primary})^(>x.enabled).x.name"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.enabled", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("resolves group entries after sorting object aliases", () => {
    expect(
      sortPaths(extractPaths("({key: primary})^(>x.enabled){x.rank: x.name}")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.enabled", confidence: "static" },
        { path: "primary.name", confidence: "static" },
        { path: "primary.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound mixed object alias suffixes in sort terms", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r^(>x.rank).x.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound mixed object alias suffixes in predicates", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r[x.enabled].x.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound mixed object alias suffixes in group-by expressions", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r{x.rank: x.name})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves focus-bound mixed object alias suffixes inside block projections", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r@$row.($row.x.enabled ? $row.x.name : missing))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "missing", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound mixed object alias suffix-stage predicates", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children[$r.x.enabled].name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
      ]),
    );
  });

  it("uses selected child context for mixed object alias suffix-stage predicates", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children[enabled].name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.enabled", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.enabled", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound mixed object alias suffix-stage sort terms", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children^(>$r.x.rank).name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("uses selected child context for mixed object alias suffix-stage sort terms", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children^(>amount).name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.amount", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.amount", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("resolves parent paths in mixed object alias suffix sort terms", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children^(>%.rank).name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("keeps bare reads child-relative in mixed object alias suffix sort terms with variables", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children^(>$r.x.enabled & name).other)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.children.other", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.children.other", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
      ]),
    );
  });

  it("preserves lookup results over variable-bound mixed object aliases", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $lookup($r, "x").children[enabled].name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.enabled", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.enabled", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves path-like mixed object alias branches in filter callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $filter($r.x.children, function($c){$c.enabled}).name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.enabled", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.enabled", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("resolves parent paths in mixed object alias higher-order callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $map($r.x.children, function($c){%.rank & $c.name}))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $filter($r.x.children, function($c){%.rank > $c.score}).name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.children.score", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.children.score", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $reduce($r.x.children, function($acc,$c){$acc + $c.amount + %.rank}, 0))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.amount", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.amount", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("resolves parent paths in mixed object alias callback result aliases", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $merge($map($r.x.children, function($c){{"n": $c.name, "p": %.rank}})).n)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("resolves parent paths in custom functions called with mixed object alias suffixes", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $fn := function($c){%.rank & $c.name}; $fn($r.x.children))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $fn := function($c){{"n": $c.name, "p": %.rank}}; $merge($fn($r.x.children)).n)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("resolves parent paths in dynamic object result aliases", () => {
    const expected = sortPaths([
      { path: "fallback", confidence: "static" },
      { path: "fallback.x.children", confidence: "static" },
      { path: "fallback.x.owner", confidence: "static" },
      { path: "fallback.x.owner.name", confidence: "static" },
      { path: "flag", confidence: "static" },
      { path: "items", confidence: "static" },
      { path: "items.detail", confidence: "static" },
      { path: "items.detail.children", confidence: "static" },
      { path: "items.detail.owner", confidence: "static" },
      { path: "items.detail.owner.name", confidence: "static" },
      { path: "key", confidence: "static" },
    ]);
    const expressions = [
      '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $fn := function($c){{(key): %.owner}}; $fn($r.x.children).x.name)',
      '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $map($r.x.children, function($c){{(key): %.owner}}).x.name)',
      '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $each($r.x.children, function($c){{(key): %.owner}}).x.name)',
      '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $reduce($r.x.children, function($acc,$c){{(key): %.owner}}, {}).x.name)',
    ];

    for (const expression of expressions) {
      expect(sortPaths(extractPaths(expression))).toEqual(expected);
    }
  });

  it("preserves nested dynamic object aliases", () => {
    const expected = sortPaths([
      { path: "customer", confidence: "static" },
      { path: "customer.name", confidence: "static" },
      { path: "inner", confidence: "static" },
      { path: "outer", confidence: "static" },
    ]);

    expect(sortPaths(extractPaths("{(outer): {(inner): customer}}.x.y.name"))).toEqual(
      expected,
    );
    expect(
      sortPaths(extractPaths("($o := {(outer): {(inner): customer}}; $o.x.y.name)")),
    ).toEqual(expected);
    expect(
      sortPaths(
        extractPaths(
          "($fn := function(){ {(outer): {(inner): customer}} }; $fn().x.y.name)",
        ),
      ),
    ).toEqual(expected);
    expect(
      sortPaths(extractPaths("$lookup({(outer): {(inner): customer}}, key).y.name")),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "inner", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "outer", confidence: "static" },
      ]),
    );
  });

  it("preserves dynamic aliases under static object fields", () => {
    const expected = sortPaths([
      { path: "customer", confidence: "static" },
      { path: "customer.name", confidence: "static" },
      { path: "inner", confidence: "static" },
    ]);

    expect(
      sortPaths(extractPaths('{"fixed": {(inner): customer}}.fixed.y.name')),
    ).toEqual(expected);
    expect(
      sortPaths(
        extractPaths('($o := {"fixed": {(inner): customer}}; $o.fixed.y.name)'),
      ),
    ).toEqual(expected);
    expect(
      sortPaths(
        extractPaths(
          '($fn := function(){ {"fixed": {(inner): customer}} }; $fn().fixed.y.name)',
        ),
      ),
    ).toEqual(expected);
    expect(
      sortPaths(
        extractPaths('$lookup({"fixed": {(inner): customer}}, "fixed").y.name'),
      ),
    ).toEqual(expected);
  });

  it("resolves wildcard selection through static dynamic-alias prefixes", () => {
    const expected = sortPaths([
      { path: "customer", confidence: "static" },
      { path: "customer.name", confidence: "static" },
      { path: "inner", confidence: "static" },
    ]);

    expect(sortPaths(extractPaths('{"a": {(inner): customer}}.*.y.name'))).toEqual(
      expected,
    );
    expect(
      sortPaths(extractPaths('($o := {"a": {(inner): customer}}; $o.*.y.name)')),
    ).toEqual(expected);
  });

  it("resolves suffix stages on direct dynamic-prefix result aliases", () => {
    expect(
      sortPaths(extractPaths('{"a": {(inner): customer}}.a.y[active].name')),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.active", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "inner", confidence: "static" },
      ]),
    );
    expect(
      sortPaths(extractPaths('{"a": {(inner): customer}}.a.y^(score).name')),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "customer.score", confidence: "static" },
        { path: "inner", confidence: "static" },
      ]),
    );
    expect(
      sortPaths(extractPaths('{"a": {(inner): customer}}.a.y.{"out": name}')),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "inner", confidence: "static" },
      ]),
    );
    expect(sortPaths(extractPaths('{"a": {(inner): customer}}.a.y{name: value}'))).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "customer.value", confidence: "static" },
        { path: "inner", confidence: "static" },
      ]),
    );
  });

  it("preserves path-like mixed object alias branches in transform patterns", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x ~> |children[enabled]|{"seen": true}|)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.enabled", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.enabled", confidence: "static" },
      ]),
    );
  });

  it("resolves parent paths in mixed object alias transform expressions", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x ~> |children|{"parentRank": %.rank, "child": name}|)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x ~> |children[%.rank > score]|{"seen": true}|)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.score", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.score", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x ~> |children|{}, [%.legacy]|)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.legacy", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.legacy", confidence: "static" },
      ]),
    );
  });

  it("keeps explicit alias reads absolute in mixed object alias transform updates", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x ~> |children|{"seen": $r.x.enabled, "child": name}|)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x ~> |children|{"seen": $r.x.enabled, "parentRank": %.rank}|)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("resolves parent predicates in mixed object alias suffix paths", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children[%.enabled].name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
      ]),
    );
  });

  it("resolves nested parent paths in mixed object alias suffix filters", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children[%.rank > score].name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.children.score", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.children.score", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children[$contains(%.tags, tag)].name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.children.tag", confidence: "static" },
        { path: "fallback.x.tags", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.children.tag", confidence: "static" },
        { path: "items.detail.tags", confidence: "static" },
      ]),
    );
  });

  it("walks projection expressions in mixed object alias suffix paths", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children.{"parentRank": %.rank, "name": name})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("resolves parent paths inside mixed object alias suffix block projections", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children.(%.rank & name))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("keeps bare reads child-relative in mixed object alias suffix projections with variables", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children.($r.x.enabled ? name : other))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.children.other", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.children.other", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound mixed object alias suffix-stage group entries", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children{type: $r.x.rank})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.type", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.type", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("resolves parent paths in mixed object alias suffix group entries", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children{%.rank: name})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children{type: %.rank})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.type", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.type", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("keeps bare reads child-relative in mixed object alias suffix group entries with variables", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.children{($r.x.enabled & type): name})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.children.type", confidence: "static" },
        { path: "fallback.x.enabled", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.children", confidence: "static" },
        { path: "items.detail.children.name", confidence: "static" },
        { path: "items.detail.children.type", confidence: "static" },
        { path: "items.detail.enabled", confidence: "static" },
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

  it("preserves mixed callback object aliases inside function result group-by expressions", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map(items, function($v){flag ? {"x": $v.detail} : fallback}){x.rank: x.name}',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });
});
