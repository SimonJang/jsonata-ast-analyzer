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

  it("resolves $single predicates and chained item fields", () => {
    expect(
      sortPaths(extractPaths("$single(items, function($v) { $v.id = target }).name")),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.id", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "target", confidence: "static" },
      ]),
    );
  });

  it("binds $single results as suffixable item aliases", () => {
    expect(
      sortPaths(
        extractPaths("($one := $single(items, function($v) { $v.id = target }); $one.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.id", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "target", confidence: "static" },
      ]),
    );
  });

  it("preserves all $append result aliases in chained fields", () => {
    expect(
      sortPaths(extractPaths("$append(primary.items, secondary.items).name")),
    ).toEqual(
      sortPaths([
        { path: "primary.items", confidence: "static" },
        { path: "primary.items.name", confidence: "static" },
        { path: "secondary.items", confidence: "static" },
        { path: "secondary.items.name", confidence: "static" },
      ]),
    );
  });

  it("binds $append results as suffixable aliases", () => {
    expect(
      sortPaths(
        extractPaths("($all := $append(primary.items, secondary.items); $all.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "primary.items", confidence: "static" },
        { path: "primary.items.name", confidence: "static" },
        { path: "secondary.items", confidence: "static" },
        { path: "secondary.items.name", confidence: "static" },
      ]),
    );
  });

  it("preserves apply-chain $single result aliases with path suffixes", () => {
    expect(
      sortPaths(
        extractPaths("items ~> $single(function($v) { $v.id = target }).name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.id", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "target", confidence: "static" },
      ]),
    );
  });

  it("preserves nested $append result aliases", () => {
    expect(
      sortPaths(extractPaths("$append($append(a.items, b.items), c.items).name")),
    ).toEqual(
      sortPaths([
        { path: "a.items", confidence: "static" },
        { path: "a.items.name", confidence: "static" },
        { path: "b.items", confidence: "static" },
        { path: "b.items.name", confidence: "static" },
        { path: "c.items", confidence: "static" },
        { path: "c.items.name", confidence: "static" },
      ]),
    );
  });

  it("preserves nested path-preserving aliases through wrappers", () => {
    expect(
      sortPaths(
        extractPaths("($all := $reverse($append(a.items, b.items)); $all.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "a.items", confidence: "static" },
        { path: "a.items.name", confidence: "static" },
        { path: "b.items", confidence: "static" },
        { path: "b.items.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $merge input aliases in chained object fields", () => {
    expect(sortPaths(extractPaths("$merge([defaults, overrides]).name"))).toEqual(
      sortPaths([
        { path: "defaults", confidence: "static" },
        { path: "defaults.name", confidence: "static" },
        { path: "overrides", confidence: "static" },
        { path: "overrides.name", confidence: "static" },
      ]),
    );
  });

  it("binds $merge results as suffixable object aliases", () => {
    expect(
      sortPaths(extractPaths("($m := $merge([defaults, overrides]); $m.name)")),
    ).toEqual(
      sortPaths([
        { path: "defaults", confidence: "static" },
        { path: "defaults.name", confidence: "static" },
        { path: "overrides", confidence: "static" },
        { path: "overrides.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $zip input aliases in chained fields", () => {
    expect(sortPaths(extractPaths("$zip(a.items, b.items).name"))).toEqual(
      sortPaths([
        { path: "a.items", confidence: "static" },
        { path: "a.items.name", confidence: "static" },
        { path: "b.items", confidence: "static" },
        { path: "b.items.name", confidence: "static" },
      ]),
    );
  });

  it("binds $zip results as suffixable aliases", () => {
    expect(sortPaths(extractPaths("($z := $zip(a.items, b.items); $z.name)"))).toEqual(
      sortPaths([
        { path: "a.items", confidence: "static" },
        { path: "a.items.name", confidence: "static" },
        { path: "b.items", confidence: "static" },
        { path: "b.items.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $spread wildcard result aliases", () => {
    expect(sortPaths(extractPaths("$spread(record).*.name"))).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*.name", confidence: "static" },
      ]),
    );
  });

  it("binds $spread results as suffixable aliases", () => {
    expect(sortPaths(extractPaths("($s := $spread(record); $s.*.name)"))).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*.name", confidence: "static" },
      ]),
    );
  });

  it("preserves identity $map callback aliases in chained fields", () => {
    expect(sortPaths(extractPaths("$map(items, function($v) { $v }).name"))).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
  });

  it("preserves projected $map callback aliases in chained fields", () => {
    expect(
      sortPaths(extractPaths("$map(items, function($v) { $v.detail }).name")),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("binds $map callback result aliases as suffixable variables", () => {
    expect(
      sortPaths(
        extractPaths("($m := $map(items, function($v) { $v.detail }); $m.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("does not suffix constructed $map callback results onto input paths", () => {
    expect(
      sortPaths(extractPaths('$map(items, function($v) { {"name": $v.label} }).name')),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.label", confidence: "static" },
      ]),
    );
  });

  it("preserves identity $each callback aliases in chained fields", () => {
    expect(
      sortPaths(extractPaths("$each(record, function($v) { $v }).name")),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.name", confidence: "static" },
      ]),
    );
  });

  it("preserves projected $each callback aliases in chained fields", () => {
    expect(
      sortPaths(extractPaths("$each(record, function($v) { $v.detail }).name")),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.detail", confidence: "static" },
        { path: "record.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $sift result aliases in wildcard chained fields", () => {
    expect(
      sortPaths(extractPaths("$sift(record, function($v) { $v.active }).*.name")),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*.name", confidence: "static" },
        { path: "record.active", confidence: "static" },
      ]),
    );
  });

  it("binds $sift results as suffixable object aliases", () => {
    expect(
      sortPaths(
        extractPaths("($s := $sift(record, function($v) { $v.active }); $s.*.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*.name", confidence: "static" },
        { path: "record.active", confidence: "static" },
      ]),
    );
  });

  it("preserves $clone result aliases in chained fields", () => {
    expect(sortPaths(extractPaths("$clone(record).name"))).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.name", confidence: "static" },
      ]),
    );
  });

  it("binds $clone results as suffixable aliases", () => {
    expect(sortPaths(extractPaths("($c := $clone(record); $c.detail.name)"))).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves identity custom function result aliases in chained fields", () => {
    expect(
      sortPaths(extractPaths("($project := function($v) { $v }; $project(item).name)")),
    ).toEqual(
      sortPaths([
        { path: "item", confidence: "static" },
        { path: "item.name", confidence: "static" },
      ]),
    );
  });

  it("preserves projected custom function result aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths("($project := function($v) { $v.detail }; $project(item).name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "item", confidence: "static" },
        { path: "item.detail", confidence: "static" },
        { path: "item.detail.name", confidence: "static" },
      ]),
    );
  });

  it("does not suffix constructed custom function results onto input paths", () => {
    expect(
      sortPaths(
        extractPaths(
          '($project := function($v) { {"name": $v.label} }; $project(item).name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "item", confidence: "static" },
        { path: "item.label", confidence: "static" },
      ]),
    );
  });

  it("preserves block-local $map result aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths("$map(items, function($v) { ($d := $v.detail; $d) }).name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves block-local custom function result aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths(
          "($project := function($v) { ($d := $v.detail; $d) }; $project(item).name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "item", confidence: "static" },
        { path: "item.detail", confidence: "static" },
        { path: "item.detail.name", confidence: "static" },
      ]),
    );
  });

  it("does not suffix constructed block-local function results onto input paths", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map(items, function($v) { ($o := {"name": $v.label}; $o) }).name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.label", confidence: "static" },
      ]),
    );
  });

  it("preserves identity $reduce result aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths("$reduce(items, function($acc, $v) { $append($acc, $v) }, []).name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
  });

  it("preserves projected $reduce result aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths("$reduce(items, function($acc, $v) { $append($acc, $v.detail) }, []).name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("binds $reduce callback result aliases as suffixable variables", () => {
    expect(
      sortPaths(
        extractPaths(
          "($r := $reduce(items, function($acc, $v) { $append($acc, $v.detail) }, []); $r.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("does not suffix scalar $reduce results onto input paths", () => {
    expect(
      sortPaths(
        extractPaths("$reduce(items, function($acc, $v) { $acc + $v.price }, 0).name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.price", confidence: "static" },
      ]),
    );
  });

  it("preserves conditional branch aliases in direct chained fields", () => {
    expect(sortPaths(extractPaths("(flag ? primary : fallback).name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves projected conditional branch aliases in direct chained fields", () => {
    expect(
      sortPaths(extractPaths("(flag ? primary.detail : fallback.detail).name")),
    ).toEqual(
      sortPaths([
        { path: "fallback.detail", confidence: "static" },
        { path: "fallback.detail.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary.detail", confidence: "static" },
        { path: "primary.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves Elvis result aliases in direct chained fields", () => {
    expect(sortPaths(extractPaths("(primary ?: fallback).name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves coalescing result aliases in direct chained fields", () => {
    expect(sortPaths(extractPaths("(primary ?? fallback).name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves array constructor element aliases in direct chained fields", () => {
    expect(sortPaths(extractPaths("([primary, fallback]).name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves projected array constructor aliases in direct chained fields", () => {
    expect(
      sortPaths(extractPaths("([primary.detail, fallback.detail]).name")),
    ).toEqual(
      sortPaths([
        { path: "fallback.detail", confidence: "static" },
        { path: "fallback.detail.name", confidence: "static" },
        { path: "primary.detail", confidence: "static" },
        { path: "primary.detail.name", confidence: "static" },
      ]),
    );
  });

  it("binds array constructor aliases as suffixable variables", () => {
    expect(sortPaths(extractPaths("($a := [primary, fallback]; $a.name)"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("does not suffix constructed array elements onto input paths", () => {
    expect(
      sortPaths(extractPaths('([{"name": primary.label}]).name')),
    ).toEqual(sortPaths([{ path: "primary.label", confidence: "static" }]));
  });

  it("preserves object constructor key aliases in direct chained fields", () => {
    expect(sortPaths(extractPaths('({"x": primary}).x.name'))).toEqual(
      sortPaths([
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("selects the matching object constructor key alias in direct chained fields", () => {
    expect(sortPaths(extractPaths('({"x": primary, "y": fallback}).y.name'))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
      ]),
    );
  });

  it("preserves object constructor wildcard aliases in direct chained fields", () => {
    expect(sortPaths(extractPaths('({"x": primary, "y": fallback}).*.name'))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds object constructor key aliases as suffixable variables", () => {
    expect(
      sortPaths(extractPaths('($o := {"x": primary, "y": fallback}; $o.y.name)')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
      ]),
    );
  });

  it("does not suffix constructed object values onto input paths", () => {
    expect(
      sortPaths(extractPaths('({"x": {"name": primary.label}}).x.name')),
    ).toEqual(sortPaths([{ path: "primary.label", confidence: "static" }]));
  });

  it("preserves nested object constructor key aliases in direct chained fields", () => {
    expect(sortPaths(extractPaths('({"outer": {"x": primary}}).outer.x.name'))).toEqual(
      sortPaths([
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves nested object constructor wildcard aliases in direct chained fields", () => {
    expect(
      sortPaths(extractPaths('({"outer": {"x": primary, "y": fallback}}).outer.*.name')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds nested object constructor key aliases as suffixable variables", () => {
    expect(
      sortPaths(extractPaths('($o := {"outer": {"x": primary}}; $o.outer.x.name)')),
    ).toEqual(
      sortPaths([
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("does not suffix constructed nested object leaf values onto input paths", () => {
    expect(
      sortPaths(extractPaths('({"outer": {"x": {"name": primary.label}}}).outer.x.name')),
    ).toEqual(sortPaths([{ path: "primary.label", confidence: "static" }]));
  });
});
