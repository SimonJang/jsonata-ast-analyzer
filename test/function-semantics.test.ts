import { describe, expect, it } from "vitest";
import { extractPaths } from "../src/index.js";
import { sortPaths } from "./integration/helpers.js";

describe("function semantics", () => {
  it("extracts paths from statically known $eval programs", () => {
    expect(
      extractPaths("$eval('Account.Order.Product.Quantity ~> $sum()')"),
    ).toEqual([
      { path: "Account.Order.Product.Quantity", confidence: "static" },
    ]);

    expect(
      sortPaths(extractPaths("Account.Order.Product.$eval('Price * Quantity')")),
    ).toEqual(
      sortPaths([
        { path: "Account.Order.Product.Price", confidence: "static" },
        { path: "Account.Order.Product.Quantity", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "Account.Order.Product.$eval('Width * Height * Depth', Description)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "Account.Order.Product.Description", confidence: "static" },
        { path: "Account.Order.Product.Description.Depth", confidence: "static" },
        { path: "Account.Order.Product.Description.Height", confidence: "static" },
        { path: "Account.Order.Product.Description.Width", confidence: "static" },
      ]),
    );

  });

  it("preserves result aliases from statically known $eval programs", () => {
    expect(sortPaths(extractPaths('$eval("detail").children.name'))).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths('$reverse($eval("[detail, fallback.x]")).children.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );

    expect(sortPaths(extractPaths('$eval("$", detail).children.name'))).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

  });

  it("preserves object aliases from statically known $eval programs", () => {
    expect(
      sortPaths(extractPaths('$eval("{\\\"x\\\": detail}").x.children.name')),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(extractPaths('$eval("{(key): detail}").x.children.name')),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(extractPaths('$eval("{\\\"x\\\": children}", detail).x.name')),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

  });

  it("preserves $each value aliases from static $eval objects", () => {
    const cases = [
      '($object := $eval("{\\\"a\\\": detail, \\\"b\\\": fallback.x}"); $each($object, function($value){$value.children.name}))',
      '$each($eval("({\\\"group\\\": {\\\"a\\\": detail, \\\"b\\\": fallback.x}}).group"), function($value){$value.children.name})',
    ];

    for (const expression of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
          { path: "fallback.x", confidence: "static" },
          { path: "fallback.x.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves contextual $eval object values in $each callbacks", () => {
    const cases = [
      '$each($eval("{\\\"a\\\": children}", detail), function($value){$value.name})',
      '($object := $eval("{\\\"a\\\": children}", detail); $each($object, function($value){$value.name}))',
    ];

    for (const expression of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves contextual dynamic object aliases from static $eval programs", () => {
    expect(
      sortPaths(
        extractPaths('$eval("{(key): children}", detail).x.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "detail.key", confidence: "static" },
      ]),
    );
  });

  it("invokes lambdas returned by statically known $eval programs", () => {
    for (const expression of [
      '$eval("function($x){$x.children.name}")(detail)',
      '($f := $eval("function($x){$x.children.name}"); $f(detail))',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }

    expect(
      sortPaths(
        extractPaths('$eval("function(){children.name}", detail)()'),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

  });

  it("invokes built-ins returned by statically known $eval programs", () => {
    expect(
      sortPaths(
        extractPaths(
          '$eval("$reverse")([detail, fallback]).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.children.name", confidence: "static" },
      ]),
    );

    for (const expression of [
      '$eval("$map")([detail], function($x){$x.children.name})',
      '($f := $eval("$map"); $f([detail], function($x){$x.children.name}))',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("invokes object fields returned by statically known $eval programs", () => {
    for (const expression of [
      '($eval("{\\"f\\": function($x){$x.children.name}}").f)(detail)',
      '$lookup($eval("{\\"f\\": function($x){$x.children.name}}"), "f")(detail)',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("invokes fields from variable-bound static $eval objects", () => {
    for (const expression of [
      '($o := $eval("{\\"f\\": function($x){$x.children.name}}"); ($o.f)(detail))',
      '($o := $eval("{\\"f\\": function($x){$x.children.name}}"); $lookup($o, "f")(detail))',
      '($o := $eval("{\\"f\\": $reverse}"); ($o.f)([detail]).children.name)',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("contextualizes partial captures from static $eval programs", () => {
    expect(
      sortPaths(
        extractPaths(
          '$eval("function($captured, $x){$x.children.name}(config.suffix, ?)", detail)(record)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.config.suffix", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '$eval("$append(items, ?)", detail)(fallback).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.items", confidence: "static" },
        { path: "detail.items.children.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '$eval("$lookup(config, ?)", detail)(key).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.config", confidence: "static" },
        { path: "detail.config[*]", confidence: "dynamic" },
        { path: "detail.config[*].children.name", confidence: "dynamic" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("marks data-dependent recursive function descent", () => {
    expect(
      sortPaths(
        extractPaths(
          "($walk := function($x){$x.children ? $walk($x.children) : $x.name}; $walk(tree))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "tree", confidence: "static" },
        { path: "tree.children", confidence: "static" },
        { path: "tree.children.**", confidence: "static" },
        { path: "tree.name", confidence: "static" },
      ]),
    );
  });

  it("marks data-dependent mutually recursive function descent", () => {
    expect(
      sortPaths(
        extractPaths(
          "($even := function($x){$x.children ? $odd($x.children) : $x.name}; " +
            "$odd := function($x){$x.children ? $even($x.children) : $x.name}; " +
            "$even(tree))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "tree", confidence: "static" },
        { path: "tree.children", confidence: "static" },
        { path: "tree.children.**", confidence: "static" },
        { path: "tree.name", confidence: "static" },
      ]),
    );
  });

  it("marks recursive descent through selected callable values", () => {
    for (const expression of [
      "($walk := function($x){$x.children ? ($ops[0])($x.children) : $x.name}; " +
        "$ops := [$walk]; $walk(tree))",
      '($walk := function($x){$x.children ? ($ops.go)($x.children) : $x.name}; ' +
        '$ops := {"go":$walk}; $walk(tree))',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "tree", confidence: "static" },
          { path: "tree.children", confidence: "static" },
          { path: "tree.children.**", confidence: "static" },
          { path: "tree.name", confidence: "static" },
        ]),
      );
    }
  });

  it("marks recursive descent through partial callables", () => {
    for (const expression of [
      "($walk := function($x){$x.children ? $walk(?)($x.children) : $x.name}; $walk(tree))",
      "($walk := function($x){$x.children ? ($p := $walk(?); $p($x.children)) : $x.name}; $walk(tree))",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "tree", confidence: "static" },
          { path: "tree.children", confidence: "static" },
          { path: "tree.children.**", confidence: "static" },
          { path: "tree.name", confidence: "static" },
        ]),
      );
    }
  });

  it("resolves callable values bound later in the same block", () => {
    for (const expression of [
      "($f := function($x){$helper($x)}; " +
        "$helper := function($x){$x.children.name}; $f(detail))",
      '($f := function($x){$ops.go($x)}; ' +
        '$ops := {"go":function($x){$x.children.name}}; $f(detail))',
      "($f := function($x){$helper($x)}; " +
        "$helper := $reverse; $f([detail]).children.name)",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("resolves later callable values inside higher-order callbacks", () => {
    for (const expression of [
      "($cb := function($x){$helper($x)}; " +
        "$helper := function($x){$x.children.name}; $map([detail], $cb))",
      "($cb := function($acc,$x){$helper($x)}; " +
        '$helper := function($x){$x.children.name}; $reduce([detail], $cb, ""))',
      "($cb := function($x){$helper($x)}; " +
        "$helper := $clone; $map([detail], $cb).children.name)",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("uses a higher-order callback rebound after a caller closure is created", () => {
    expect(
      sortPaths(
        extractPaths(
          "($cb := function($x){$x.old.name}; " +
            "$apply := function(){$map([detail], $cb)}; " +
            "$cb := function($x){$x.new.name}; $apply())",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.new.name", confidence: "static" },
      ]),
    );
  });

  it("resolves data values bound later in the same closure frame", () => {
    for (const expression of [
      "($f := function(){$later.children.name}; " +
        "$later := detail; $f())",
      "($f := function($x){$later.children.name & $x.name}; " +
        "$later := detail; $f(record.first))",
      "($callback := function($x){$later.children.name}; " +
        "$later := detail; $map([record.first],$callback))",
    ]) {
      const paths = sortPaths(extractPaths(expression));
      expect(paths).toContainEqual({
        path: "detail.children.name",
        confidence: "static",
      });
    }

    expect(
      sortPaths(
        extractPaths(
          "($f := function(){$later.selected.name}; " +
            '$later := {"selected":detail.children}; $f())',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($f := function(){$later.a.name}; " +
            "$later := {config.key:detail.children}; $f())",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.key", confidence: "static" },
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("invokes callables passed through custom function parameters", () => {
    for (const expression of [
      "($apply := function($fn,$x){$fn($x)}; " +
        "$project := function($x){$x.children.name}; $apply($project,detail))",
      "($project := function($x){$helper($x)}; " +
        "$helper := function($x){$x.children.name}; " +
        "$apply := function($fn,$x){$fn($x)}; $apply($project,detail))",
      "($apply := function($fn,$x){$fn($x)}; " +
        "$project := function($x){$helper($x)}; " +
        "$helper := function($x){$x.children.name}; $apply($project,detail))",
      "($apply := function($fn,$x){$fn($x)}; " +
        "$project := function($x){$x.children.name}(?); " +
        "$apply($project,detail))",
      "($apply := function($fn,$x){$fn($x)}; " +
        "$apply($clone,detail).children.name)",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves grouped result aliases across function boundaries", () => {
    for (const expression of [
      "(function($x){$x{key:value}})(items).x.name",
      "($f := function($x){$x{key:value}}; $f(items).x.name)",
      "$map([items], function($x){$x{key:value}}).x.name",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "items", confidence: "static" },
          { path: "items.key", confidence: "static" },
          { path: "items.value", confidence: "static" },
          { path: "items.value.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves grouped aliases through direct and builtin result channels", () => {
    for (const expression of [
      "(items{category: detail}).a.rank",
      '$lookup(items{category: detail}, "a").rank',
      "$filter(items{category: detail}, function($v){true}).a.rank",
      "$sort(items{category: detail}, function($l,$r){0}).a.rank",
      "$sift(items{category: detail}, function($v){true}).a.rank",
      "$spread(items{category: detail}).a.rank",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "items", confidence: "static" },
          { path: "items.category", confidence: "static" },
          { path: "items.detail", confidence: "static" },
          { path: "items.detail.rank", confidence: "static" },
        ]),
      );
    }

    expect(
      sortPaths(
        extractPaths(
          "$append(items{category: detail}, fallback).a.rank",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.a.rank", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.category", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("injects path context into built-ins with remaining explicit arguments", () => {
    for (const expression of [
      "record.first.name.$substring(1)",
      "record.first.name.$substring(1, 2)",
      'record.first.name.$substringBefore("d")',
      'record.first.name.$substringAfter("d")',
      'record.first.name.$contains("A")',
      'record.first.name.$replace("A", "O")',
      'record.first.name.$split("d")',
      "record.first.name.$pad(5)",
    ]) {
      expect(extractPaths(expression)).toEqual([
        { path: "record.first.name", confidence: "static" },
      ]);
    }
  });

  it("injects predicate context into built-ins with explicit arguments", () => {
    expect(
      extractPaths('record.first.name[$contains("A")]'),
    ).toEqual([{ path: "record.first.name", confidence: "static" }]);
  });

  it("binds object property values in explicit and path-context $each/$sift calls", () => {
    expect(
      sortPaths(extractPaths("$each(record, function($v) { $v.name })")),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*.name", confidence: "static" },
      ]),
    );
    expect(
      sortPaths(extractPaths("record.$each(function($v) { $v.name })")),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*", confidence: "static" },
        { path: "record.*.name", confidence: "static" },
      ]),
    );
    expect(
      sortPaths(extractPaths("$sift(record, function($v) { $v.active })")),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*.active", confidence: "static" },
      ]),
    );
    expect(
      sortPaths(extractPaths("record.$sift(function($v) { $v.active })")),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*", confidence: "static" },
        { path: "record.*.active", confidence: "static" },
      ]),
    );
  });

  it("traces conditional and looked-up lambda values used as map callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map([record], config.enabled ? function($x){$x.first.name} : function($x){$x.first.detail.rank})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.enabled", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
    expect(
      sortPaths(
        extractPaths(
          '$map([record], $lookup({"project": function($x){$x.first.name}}, "project"))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("traces inline and bound lambda partials used as map callbacks", () => {
    for (const expression of [
      '$map([record], function($x, $unused){$x.first.name}(?, 1))',
      '($p := function($x, $unused){$x.first.name}(?, 1); $map([record], $p))',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "record", confidence: "static" },
          { path: "record.first.name", confidence: "static" },
        ]),
      );
    }

    expect(
      sortPaths(
        extractPaths(
          '$map([record], function($prefix, $x){$x.first.name}(config.suffix, ?))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.suffix", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves result aliases from selected and conditional lambda callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map([record], $lookup({"project": function($x){{"out":$x.first.name}}}, "project")).out.length',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
        { path: "record.first.name.length", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '$map([record], config.enabled ? function($x){{"out":$x.first.name}} : function($x){{"out":$x.first.detail}}).out.rank',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.enabled", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first.detail", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
        { path: "record.first.name.rank", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($fs := [function($x){{"out":$x.first.detail}}]; $map([record], $fs[0]).out.rank)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.detail", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves result aliases from partial lambda callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map([record], function($prefix, $x){{"out":$x.first.detail}}(config.suffix, ?)).out.rank',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.suffix", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first.detail", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("over-approximates reads from dynamic $eval programs", () => {
    expect(sortPaths(extractPaths("$eval(config.program)"))).toEqual(
      sortPaths([
        { path: "config.program", confidence: "static" },
        { path: "**", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(extractPaths("$eval(config.program, record.first)")),
    ).toEqual(
      sortPaths([
        { path: "config.program", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "**", confidence: "static" },
      ]),
    );
  });

  it("over-approximates rebinding in a captured lambda frame", () => {
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
        { path: "customer.name", confidence: "static" },
      ]),
    );
  });

  it("uses a callable rebound after a caller closure is created", () => {
    expect(
      sortPaths(
        extractPaths(
          "($fn := function($x){$x.old.name}; " +
            "$apply := function(){$fn(detail)}; " +
            "$fn := function($x){$x.new.name}; $apply())",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.new.name", confidence: "static" },
      ]),
    );
  });

  it("keeps a callable shadowed in a nested closure frame", () => {
    expect(
      sortPaths(
        extractPaths(
          "($fn := function($x){$x.outer.name}; " +
            "$apply := ($fn := function($x){$x.inner.name}; " +
            "function(){$fn(detail)}); " +
            "$fn := function($x){$x.new.name}; $apply())",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.inner.name", confidence: "static" },
      ]),
    );
  });

  it("clears stale captured lambdas when rebound to another callable kind", () => {
    for (const [expression, expected] of [
      [
        "($fn := function($x){$x.old.name}; " +
          "$apply := function(){$fn(detail).new.name}; " +
          "$fn := $clone; $apply())",
        ["detail", "detail.new.name"],
      ],
      [
        "($fn := function($x){$x.old.name}; " +
          "$apply := function(){$fn(config.key).price}; " +
          "$fn := $lookup(catalog, ?); $apply())",
        ["catalog", "catalog[*]", "catalog[*].price", "config.key"],
      ],
      [
        "($fn := function($x){$x.old.name}; " +
          "$apply := function(){$fn(record).children.seen}; " +
          '$fn := |children|{"seen":name}|; $apply())',
        ["record", "record.children", "record.children.name"],
      ],
    ] as const) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths(
          expected.map((path) => ({
            path,
            confidence: path.includes("[*]")
              ? ("dynamic" as const)
              : ("static" as const),
          })),
        ),
      );
    }
  });

  it("uses data rebound over a callable in a captured frame", () => {
    for (const [initial, current] of [
      ["function($v){$v.old}", "detail"],
      ["$clone", "detail"],
      ["$lookup(detail, ?)", "fallback"],
      ['|children|{"seen":name}|', "detail"],
    ] as const) {
      const expression =
        `($x := ${initial}; $apply := function(){$x.children.name}; ` +
        `$x := ${current}; $apply())`;
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          ...(initial.startsWith("$lookup")
            ? [{ path: "detail", confidence: "static" as const }]
            : []),
          { path: current, confidence: "static" },
          { path: `${current}.children.name`, confidence: "static" },
        ]),
      );
    }
  });

  it("keeps a callable shadowed from a later outer data binding", () => {
    expect(
      sortPaths(
        extractPaths(
          "($x := detail; " +
            "$apply := ($x := function($v){$v.children.name}; " +
            "function(){$x(fallback)}); " +
            "$x := other; $apply())",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "other", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.children.name", confidence: "static" },
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
        { path: "customers[*]", confidence: "dynamic" },
        { path: "customers[*].name", confidence: "dynamic" },
        { path: "customerId", confidence: "static" },
      ]),
    );
  });

  it("preserves caller-local result aliases through partial applications", () => {
    for (const expression of [
      "($invoke := function($x){$helper($x).children.name}; " +
        "$helper := $clone(?); $invoke(detail))",
      "($invoke := function($x){$helper($x).children.name}; " +
        "$identity := function($v){$v}; $helper := $identity(?); " +
        "$invoke(detail))",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves caller-local object aliases through partial applications", () => {
    expect(
      sortPaths(
        extractPaths(
          "($invoke := function($x){$helper($x).selected.name}; " +
            '$builder := function($v){{"selected":$v.children}}; ' +
            "$helper := $builder(?); $invoke(detail))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($invoke := function($x){$helper($x).a.name}; " +
            "$builder := function($v){{$v.category:$v.children}}; " +
            "$helper := $builder(?); $invoke(item))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "item", confidence: "static" },
        { path: "item.category", confidence: "static" },
        { path: "item.children", confidence: "static" },
        { path: "item.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves partial result aliases through custom function parameters", () => {
    for (const [expression, includesChildrenBase] of [
      [
        "($apply := function($fn,$x){$fn($x).children.name}; " +
          "$builder := function($v){$v}; $partial := $builder(?); " +
          "$apply($partial,detail))",
        false,
      ],
      [
        "($apply := function($fn,$x){$fn($x).name}; " +
          "$builder := function($v){$v.children}; $partial := $builder(?); " +
          "$apply($partial,detail))",
        true,
      ],
    ] as const) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          ...(includesChildrenBase
            ? [{ path: "detail.children", confidence: "static" as const }]
            : []),
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }

    for (const [body, suffix] of [
      ['{"selected":$v.children}', ".selected.name"],
      ["{$v.category:$v.children}", ".a.name"],
    ]) {
      expect(
        sortPaths(
          extractPaths(
            `($apply := function($fn,$x){$fn($x)${suffix}}; ` +
              `$builder := function($v){${body}}; ` +
              "$partial := $builder(?); $apply($partial,detail))",
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          ...(body.startsWith("{$v")
            ? [{ path: "detail.category", confidence: "static" as const }]
            : []),
          { path: "detail.children", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves selected callable result aliases through parameters", () => {
    for (const expression of [
      "($apply := function($fn,$x){$fn($x).children.name}; " +
        "$ops := [function($v){$v}]; $apply($ops[0],detail))",
      "($apply := function($fn,$x){$fn($x).children.name}; " +
        '$ops := {"go":function($v){$v}}; $apply($ops.go,detail))',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }

    for (const [container, suffix, includesDynamicKey] of [
      [
        '[function($v){{"selected":$v.children}}]',
        ".selected.name",
        false,
      ],
      [
        '{"go":function($v){{$v.category:$v.children}}}',
        ".a.name",
        true,
      ],
    ] as const) {
      const selector = container.startsWith("[") ? "$ops[0]" : "$ops.go";
      expect(
        sortPaths(
          extractPaths(
            `($apply := function($fn,$x){$fn($x)${suffix}}; ` +
              `$ops := ${container}; $apply(${selector},detail))`,
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          ...(includesDynamicKey
            ? [{ path: "detail.category", confidence: "static" as const }]
            : []),
          { path: "detail.children", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("clears stale lambda bindings when rebound to partials", () => {
    expect(
      sortPaths(
        extractPaths(
          "($f := function($v){$v.name}; $f := $lookup(products, ?); $f(customerId).price)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "customerId", confidence: "static" },
        { path: "products", confidence: "static" },
        { path: "products[*]", confidence: "dynamic" },
        { path: "products[*].price", confidence: "dynamic" },
      ]),
    );
  });

  it("clears stale partial bindings when rebound to lambdas", () => {
    expect(
      sortPaths(
        extractPaths(
          "($f := $lookup(products, ?); $f := function($v){$v.name}; $f(customer).name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "customer.name.name", confidence: "static" },
        { path: "products", confidence: "static" },
      ]),
    );
  });

  it("respects nested partial bindings shadowing parent lambdas", () => {
    expect(
      sortPaths(
        extractPaths(
          "($f := function($v){$v.name}; ($f := $lookup(products, ?); $f(customerId).price))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "customerId", confidence: "static" },
        { path: "products", confidence: "static" },
        { path: "products[*]", confidence: "dynamic" },
        { path: "products[*].price", confidence: "dynamic" },
      ]),
    );
  });

  it("respects nested lambda bindings shadowing parent partials", () => {
    expect(
      sortPaths(
        extractPaths(
          "($f := $lookup(products, ?); ($f := function($v){$v.name}; $f(customer).name))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "customer.name.name", confidence: "static" },
        { path: "products", confidence: "static" },
      ]),
    );
  });

  it("respects nested path bindings shadowing parent object aliases", () => {
    expect(
      sortPaths(extractPaths('($o := {"x": account}; ($o := customer; $o.x.name))')),
    ).toEqual(
      sortPaths([
        { path: "account", confidence: "static" },
        { path: "customer", confidence: "static" },
        { path: "customer.x.name", confidence: "static" },
      ]),
    );
  });

  it("respects nested path bindings shadowing mixed parent object aliases", () => {
    expect(
      sortPaths(
        extractPaths(
          '($o := flag ? {"x": account} : fallback; ($o := customer; $o.x.name))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "account", confidence: "static" },
        { path: "customer", confidence: "static" },
        { path: "customer.x.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "flag", confidence: "static" },
      ]),
    );
  });

  it("respects nested path bindings shadowing parent dynamic object aliases", () => {
    expect(
      sortPaths(extractPaths("($o := {key: account}; ($o := customer; $o.x.name))")),
    ).toEqual(
      sortPaths([
        { path: "account", confidence: "static" },
        { path: "customer", confidence: "static" },
        { path: "customer.x.name", confidence: "static" },
        { path: "key", confidence: "static" },
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

  it("executes placeholder higher-order calls in apply chains", () => {
    expect(
      sortPaths(
        extractPaths(
          "items ~> $map(?, function($value){$value.children.name})",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "items ~> $each(?, function($value){$value.children.name})",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.*.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "[detail, fallback] ~> $each(?, function($value){$value.children.name})",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.*.children.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.*.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "items ~> $each(?, function($value, $key, $array){$array.children.name})",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.children.name", confidence: "static" },
      ]),
    );
  });

  it("invokes callable object values inside each and sift callbacks", () => {
    for (const functionName of ["each", "sift"]) {
      expect(
        sortPaths(
          extractPaths(
            `$${functionName}({"operation":function($x){` +
              "$x.children.name}}, function($operation){" +
              "$operation(detail)})",
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }

    expect(
      sortPaths(
        extractPaths(
          '$each({"operation":$lookup}, function($operation){' +
            '$operation(record, "first").children.name})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.children.name", confidence: "static" },
      ]),
    );
  });

  it("binds whole-object callback parameters for $each and $sift", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each({"a": detail, "b": fallback.x}, function($v, $k, $o){$o.*.children.name})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '$sift({"a": detail, "b": fallback.x}, function($v, $k, $o){$o.*.active}).*.children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.active", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.active", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("aligns higher-order callback roles after partially bound parameters", () => {
    const cases = [
      {
        expression:
          "($base := function($p,$v,$i,$a){$a.children.name & $p}; $f := $base(config.suffix, ?, ?, ?); $map(items,$f))",
        expected: ["config.suffix", "items", "items.children.name"],
      },
      {
        expression:
          "($base := function($p,$acc,$v,$i,$a){($p; $append($acc,$a.children.name))}; $f := $base(config.suffix, ?, ?, ?, ?); $reduce(items,$f,[]))",
        expected: ["config.suffix", "items", "items.children.name"],
      },
      {
        expression:
          "($base := function($p,$v,$k,$o){($p; $o.*.detail.rank)}; $f := $base(config.suffix, ?, ?, ?); $each(record,$f))",
        expected: ["config.suffix", "record", "record.*.detail.rank"],
      },
    ];

    for (const { expression, expected } of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths(expected.map((path) => ({ path, confidence: "static" as const }))),
      );
    }
  });

  it("binds object values to the remaining parameter of partial $each callbacks", () => {
    const cases = [
      '$each({"x": record.first}, function($captured, $value){$value.children.name}(detail, ?))',
      '($callback := function($captured, $value){$value.children.name}(detail, ?); $each({"x": record.first}, $callback))',
      '$sift({"x": record.first}, function($captured, $value){$value.children.name}(detail, ?))',
    ];

    for (const expression of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "record.first", confidence: "static" },
          { path: "record.first.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("binds wildcard object values to partial $each and $sift callbacks", () => {
    const cases = [
      "$each(record, function($captured, $value){$value.children.name}(detail, ?))",
      "$sift(record, function($value, $captured){$value.children.name}(?, detail))",
    ];

    for (const expression of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "record", confidence: "static" },
          { path: "record.*.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("binds wildcard values from path objects returned to $each", () => {
    const cases = [
      "($maker := function(){record}; $each($maker(), function($value){$value.children.name}))",
      "($maker := function(){record}; $object := $maker(); $each($object, function($value){$value.children.name}))",
    ];

    for (const expression of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "record", confidence: "static" },
          { path: "record.*.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("threads apply-chain callbacks", () => {
    expect(extractPaths("items ~> $map(function($v) { $v.price }) ~> $sum()")).toEqual([
      { path: "items", confidence: "static" },
      { path: "items.price", confidence: "static" },
    ]);
  });

  it("preserves result aliases through function composition", () => {
    expect(
      sortPaths(
        extractPaths(
          "($copy := $append(?, []) ~> $reverse(?); $copy([detail, fallback.x]).children.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($project := $map(?, function($v){$v.children}) ~> $reverse(?); $project([detail, fallback.x]).name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("composes callables selected from custom-function results", () => {
    expect(
      extractPaths(
        '($maker := function(){{"apply":function($x){$x.children.name}}}; ' +
          "(($maker().apply) ~> $count)(detail))",
      ),
    ).toEqual([
      { path: "detail", confidence: "static" },
      { path: "detail.children.name", confidence: "static" },
    ]);
  });

  it("recognizes all unary builtins used in function composition", () => {
    const cases = [
      {
        expression:
          "($choose := $abs ~> function($x){$x > 0 ? detail : fallback.x}; $choose(amount).children.name)",
        inputPath: "amount",
      },
      {
        expression:
          "($choose := $formatBase ~> function($x){$x ? detail : fallback.x}; $choose(radix).children.name)",
        inputPath: "radix",
      },
    ];

    for (const { expression, inputPath } of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
          { path: "fallback.x", confidence: "static" },
          { path: "fallback.x.children.name", confidence: "static" },
          { path: inputPath, confidence: "static" },
        ]),
      );
    }
  });

  it("does not suffix scalar function result properties onto input paths", () => {
    expect(extractPaths("$substring(customer.name, 0, 3).length")).toEqual([
      { path: "customer.name", confidence: "static" },
    ]);
  });

  it("contextualizes terminal function path step arguments", () => {
    expect(extractPaths("orders.items.$sum(price)")).toEqual([
      { path: "orders.items.price", confidence: "static" },
    ]);
  });

  it("contextualizes variable-bound terminal function path step arguments", () => {
    expect(sortPaths(extractPaths("($items := orders.items; $items.$sum(price))"))).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.price", confidence: "static" },
      ]),
    );
    expect(sortPaths(extractPaths("(orders.items).$sum(price)"))).toEqual(
      sortPaths([
        { path: "orders.items", confidence: "static" },
        { path: "orders.items.price", confidence: "static" },
      ]),
    );
  });

  it("contextualizes variable-bound mixed alias function path steps", () => {
    expect(
      sortPaths(extractPaths('($r := flag ? {"x": primary} : fallback; $r.x.$sum(amount))')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.amount", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.amount", confidence: "static" },
      ]),
    );
  });

  it("does not emit synthetic bases for terminal higher-order function path steps", () => {
    expect(
      sortPaths(extractPaths("orders.items.$map(tags, function($v){$v.name})")),
    ).toEqual(
      sortPaths([
        { path: "orders.items.tags", confidence: "static" },
        { path: "orders.items.tags.name", confidence: "static" },
      ]),
    );
  });

  it("contextualizes lookup object arguments in path steps", () => {
    expect(
      sortPaths(extractPaths('orders.items.$lookup({"x": price}, "x").name')),
    ).toEqual(
      sortPaths([
        { path: "orders.items.price", confidence: "static" },
        { path: "orders.items.price.name", confidence: "static" },
      ]),
    );
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

  it("traces inline lambda function calls", () => {
    expect(extractPaths("function($x){$x.name}(account)")).toEqual([
      { path: "account", confidence: "static" },
      { path: "account.name", confidence: "static" },
    ]);
  });

  it("traces an inline lambda through partial application", () => {
    expect(
      extractPaths(
        "($project := function($x, $unused){$x.first.name}(?, 1); $project(record))",
      ),
    ).toEqual([
      { path: "record", confidence: "static" },
      { path: "record.first.name", confidence: "static" },
    ]);
  });

  it("traces a lambda returned by a custom function", () => {
    expect(
      extractPaths(
        "($maker := function(){function($x){$x.first.name}}; $maker()(record))",
      ),
    ).toEqual([
      { path: "record", confidence: "static" },
      { path: "record.first.name", confidence: "static" },
    ]);
  });

  it("invokes callable fields in structured custom-function results", () => {
    for (const [body, selector, suffix, includesCondition] of [
      [
        '{"apply":function($x){$x.children.name}}',
        "apply",
        "",
        false,
      ],
      [
        '{"ops":{"apply":function($x){$x.children.name}}}',
        "ops.apply",
        "",
        false,
      ],
      ['{"apply":$clone}', "apply", ".children.name", false],
      [
        'config.flag ? {"apply":function($x){$x.children.name}} : {"apply":$clone}',
        "apply",
        "",
        true,
      ],
    ] as const) {
      expect(
        sortPaths(
          extractPaths(
            `($maker := function(){${body}}; ` +
              `(($maker().${selector})(detail))${suffix})`,
          ),
        ),
      ).toEqual(
        sortPaths([
          ...(includesCondition
            ? [{ path: "config.flag", confidence: "static" as const }]
            : []),
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("invokes structured custom-function callables through apply chains", () => {
    for (const callable of ["$maker().apply", "($maker().apply)"]) {
      expect(
        extractPaths(
          '($maker := function(){{"apply":function($x){$x.children.name}}}; ' +
            `detail ~> ${callable})`,
        ),
      ).toEqual([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]);
    }
  });

  it("invokes wildcard-selected callables from custom-function results", () => {
    expect(
      extractPaths(
        '($maker := function(){{"apply":function($x){$x.children.name}}}; ' +
          "($maker().*)(detail))",
      ),
    ).toEqual([
      { path: "detail", confidence: "static" },
      { path: "detail.children.name", confidence: "static" },
    ]);
  });

  it("invokes dynamically looked-up callables from custom-function results", () => {
    for (const body of [
      '{"apply":function($x){$x.children.name}}',
      '{config.operation:function($x){$x.children.name}}',
    ]) {
      expect(
        extractPaths(
          `($maker := function(){${body}}; ` +
            "$lookup($maker(), $$.config.operation)(detail))",
        ),
      ).toEqual([
        { path: "config.operation", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]);
    }
  });

  it("preserves dynamic lookup reads in selected callable partials", () => {
    expect(
      extractPaths(
        '($maker := function(){{"apply":function($x){$x.children.name}}}; ' +
          "$partial := $lookup($maker(), $$.config.operation)(?); " +
          "$partial(detail))",
      ),
    ).toEqual([
      { path: "config.operation", confidence: "static" },
      { path: "detail", confidence: "static" },
      { path: "detail.children.name", confidence: "static" },
    ]);
  });

  it("invokes dynamically looked-up callables from higher-order results", () => {
    for (const producer of [
      '$map([1], function($v){{"apply":function($x){$x.children.name}}})',
      '$each({"one":1}, function($v){{"apply":function($x){$x.children.name}}})',
      '$reduce([1], function($a,$v){{"apply":function($x){$x.children.name}}}, {})',
    ]) {
      expect(
        extractPaths(
          `$lookup(${producer}, $$.config.operation)(detail)`,
        ),
      ).toEqual([
        { path: "config.operation", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]);
    }
  });

  it("invokes dynamically looked-up callables from composed containers", () => {
    for (const [producer, expectedProducerPaths] of [
      [
        '$append({"apply":function($x){$x.children.name}}, {})',
        [],
      ],
      [
        '($ops := items[0]{"apply":function($x){$x.children.name}}; $ops)',
        [{ path: "items", confidence: "static" as const }],
      ],
    ] as const) {
      expect(
        extractPaths(
          `$lookup(${producer}, $$.config.operation)(detail)`,
        ),
      ).toEqual([
        ...expectedProducerPaths,
        { path: "config.operation", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]);
    }
  });

  it("invokes callable fields from path projection results", () => {
    for (const [source, expectedSourcePaths] of [
      ["items[0]", ["items", "items.name"]],
      [
        "items[active][0]",
        ["items", "items.active", "items.name"],
      ],
    ] as const) {
      expect(
        sortPaths(
          extractPaths(
            `($ops := ${source}.` +
              '{"apply":function($x){name & $x.children.name}}; ' +
              "($ops.apply)(detail))",
          ),
        ),
      ).toEqual(
        sortPaths([
          ...expectedSourcePaths.map((path) => ({
            path,
            confidence: "static" as const,
          })),
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("invokes dynamically selected callables from path projections", () => {
    for (const [projection, expectedSourcePaths] of [
      [
        '{"apply":function($x){name & $x.children.name}}',
        ["items", "items.name"],
      ],
      [
        '($captured := name; {"apply":function($x){$captured & $x.children.name}})',
        ["items.name"],
      ],
    ] as const) {
      expect(
        sortPaths(
          extractPaths(
            `($ops := items[0].${projection}; ` +
              "$lookup($ops, $$.config.operation)(detail))",
          ),
        ),
      ).toEqual(
        sortPaths([
          ...expectedSourcePaths.map((path) => ({
            path,
            confidence: "static" as const,
          })),
          { path: "config.operation", confidence: "static" },
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("invokes callable fields from grouped path results", () => {
    for (const invocation of [
      "($operations.apply)(detail)",
      "$lookup($operations, $$.config.operation)(detail)",
    ]) {
      expect(
        sortPaths(
          extractPaths(
            '($operations := items[0]{"apply":' +
              "function($x){name & $x.children.name}}; " +
              `${invocation})`,
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: "items", confidence: "static" },
          { path: "items.name", confidence: "static" },
          ...(invocation.startsWith("$lookup")
            ? [{ path: "config.operation", confidence: "static" as const }]
            : []),
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("invokes callable fields from sorted grouped results", () => {
    const cases = [
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": $}; ($operations.apply[0])(detail))',
      '($operations := {"one": function($x){$x.children.name}}.*^($$.config.rank){"apply": $}; ($operations.apply[0])(detail))',
      '($operations := [function($captured, $x){$x.children.name}(config.rank, ?)]^($$.config.rank){"apply": $}; ($operations.apply[0])(detail))',
    ];

    for (const expression of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "config.rank", confidence: "static" },
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }

    expect(
      sortPaths(
        extractPaths(
          '($operations := [$lookup]^($$.config.rank){"apply": $}; ($operations.apply[0])(record, "first").children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.rank", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves grouped callable sequences through value carriers", () => {
    const cases = [
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": $reverse($)}; ($operations.apply[0])(detail))',
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": [$]}; ($operations.apply[0][0])(detail))',
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": {"nested": $}}; ($operations.apply.nested[0])(detail))',
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": $map($, function($operation){$operation})}; ($operations.apply[0])(detail))',
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": $reduce($, $append, [])}; ($operations.apply[0])(detail))',
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": $reduce($, ($append), [])}; ($operations.apply[0])(detail))',
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": $reduce($, {"join": $append}.join, [])}; ($operations.apply[0])(detail))',
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": $reduce($, $lookup({"join": $append}, "join"), [])}; ($operations.apply[0])(detail))',
      '($operations := [function($x){$x.children.name}]^($$.config.rank){"apply": $reduce($, $append(?, ?), [])}; ($operations.apply[0])(detail))',
    ];

    for (const expression of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "config.rank", confidence: "static" },
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }

    expect(
      sortPaths(
        extractPaths(
          '($operations := [function($x){$x.children.name}]{"apply": $reverse($)}; ($operations.apply[0])(detail))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($operations := [$lookup]{"apply": $reverse($)}; ($operations.apply[0])(record, "first").children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($operations := [$lookup]{"apply": $reduce($, $append, [])}; ($operations.apply[0])(record, "first").children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($operations := [function($captured, $x){$x.children.name}(config.rank, ?)]{"apply": [$]}; ($operations.apply[0][0])(detail))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.rank", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves focus bindings captured by projected callables", () => {
    for (const [source, focusName, expectedSourcePaths] of [
      ["items", "item", ["items", "items.name"]],
      ["record.*", "entry", ["record.*", "record.*.name"]],
    ] as const) {
      for (const separator of [".", ""]) {
        for (const invocation of [
          "($operations.apply)(detail)",
          "$lookup($operations, $$.config.operation)(detail)",
        ]) {
          expect(
            sortPaths(
              extractPaths(
                `($operations := ${source}@$${focusName}[0]${separator}` +
                  `{"apply":function($x){$${focusName}.name & ` +
                  "$x.children.name}}; " +
                  `${invocation})`,
              ),
            ),
          ).toEqual(
            sortPaths([
              ...expectedSourcePaths.map((path) => ({
                path,
                confidence: "static" as const,
              })),
              ...(invocation.startsWith("$lookup")
                ? [{ path: "config.operation", confidence: "static" as const }]
                : []),
              { path: "detail", confidence: "static" },
              { path: "detail.children.name", confidence: "static" },
            ]),
          );
        }
      }
    }
  });

  it("invokes nested callable fields from dynamically grouped results", () => {
    expect(
      sortPaths(
        extractPaths(
          "($operations := items@$item{" +
            '$item.name:{"apply":function($x){' +
            "$item.children.name & $x.name}}}; " +
            '($lookup($operations, "a").apply)(detail))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "items.children.name", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($operations := items@$item{" +
            '$item.name:{"apply":$lookup}}; ' +
            '($lookup($operations, "a").apply)' +
            '(record, "first").children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.children.name", confidence: "static" },
      ]),
    );
  });

  it("invokes callable results produced by higher-order callbacks", () => {
    for (const [producer, source] of [
      [
        "$map(items, function($v){function($x){$x.children.name}})",
        "items",
      ],
      [
        "$each(record, function($v){function($x){$x.children.name}})",
        "record",
      ],
      ["$map(items, function($v){$clone})", "items"],
    ] as const) {
      const resultSuffix = producer.includes("$clone") ? ".children.name" : "";
      expect(
        sortPaths(
          extractPaths(
            `($callbacks := ${producer}; ` +
              `$callbacks[0](detail)${resultSuffix})`,
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: source, confidence: "static" },
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves captured arguments in partials produced by higher-order callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          "($callbacks := $map(items, function($value){" +
            "function($left, $right){$left.name & $right.children.name}" +
            "($value, ?)}); ($callbacks[0])(detail))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves captured arguments in builtin partials from higher-order callbacks", () => {
    for (const producer of [
      "$map(items, function($value){$lookup($value, ?)})[0]",
      "$reduce(items, function($accumulator, $value){$lookup($value, ?)})",
    ]) {
      expect(
        sortPaths(
          extractPaths(
            `($lookupChildren := ${producer}; ` +
              '$lookupChildren("children").name)',
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: "children", confidence: "static" },
          { path: "items", confidence: "static" },
          { path: "items.children", confidence: "static" },
          { path: "items.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("invokes callable fields in structured higher-order results", () => {
    for (const [producer, selector, suffix, source] of [
      [
        '$map(items, function($v){{"apply":function($x){$x.children.name}}})',
        "apply",
        "",
        "items",
      ],
      [
        '$map(items, function($v){{"ops":{"apply":function($x){$x.children.name}}}})',
        "ops.apply",
        "",
        "items",
      ],
      [
        '$each(record, function($v){{"apply":$clone}})',
        "apply",
        ".children.name",
        "record",
      ],
    ] as const) {
      expect(
        sortPaths(
          extractPaths(
            `($containers := ${producer}; ` +
              `(($containers[0].${selector})(detail))${suffix})`,
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: source, confidence: "static" },
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("invokes callable results produced by higher-order apply chains", () => {
    for (const [producer, invocation, source] of [
      [
        "items ~> $map(function($v){function($x){$x.children.name}})",
        "$callbacks[0](detail)",
        "items",
      ],
      [
        "record ~> $each(function($v){function($x){$x.children.name}})",
        "$callbacks[0](detail)",
        "record",
      ],
      [
        "items ~> $reduce(function($acc,$v){function($x){$x.children.name}})",
        "$callbacks(detail)",
        "items",
      ],
      [
        'items ~> $map(function($v){{"apply":function($x){$x.children.name}}})',
        "($callbacks[0].apply)(detail)",
        "items",
      ],
    ] as const) {
      expect(
        sortPaths(
          extractPaths(`($callbacks := ${producer}; ${invocation})`),
        ),
      ).toEqual(
        sortPaths([
          { path: source, confidence: "static" },
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("invokes every callable kind from mixed higher-order results", () => {
    expect(
      sortPaths(
        extractPaths(
          "($callbacks := $map(items, function($v){" +
            "$v.active ? function($x){$x.children.name} : $clone}); " +
            "$callbacks[0](detail))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.active", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("invokes callables preserved by collection functions", () => {
    for (const [producer, invocation, expectedPaths] of [
      [
        "$reverse([function($x){fallback.name & $x.children.name}])",
        "($callbacks[0])(detail)",
        ["fallback.name", "detail", "detail.children.name"],
      ],
      [
        "$sort([function($x){$x.children.name}," +
          "function($x){$x.children.rank}]," +
          "function(){ $$.config.enabled })",
        "($callbacks[0])(detail)",
        [
          "config.enabled",
          "detail",
          "detail.children.name",
          "detail.children.rank",
        ],
      ],
      [
        "$filter([function($x){$x.children.name}]," +
          "function(){ $$.config.enabled })",
        "($callbacks[0])(detail)",
        ["config.enabled", "detail", "detail.children.name"],
      ],
      [
        "$single([function($x){$x.children.name}]," +
          "function(){ $$.config.enabled })",
        "$callbacks(detail)",
        ["config.enabled", "detail", "detail.children.name"],
      ],
      [
        "$shuffle([function($x){$x.children.name}])",
        "($callbacks[0])(detail)",
        ["detail", "detail.children.name"],
      ],
      [
        "$distinct([function($x){$x.children.name}])",
        "($callbacks[0])(detail)",
        ["detail", "detail.children.name"],
      ],
      [
        "$zip([function($x){$x.children.name}], [$clone])",
        "($callbacks[0][0])(detail)",
        ["detail", "detail.children.name"],
      ],
      [
        "$reverse([$lookup])",
        '($callbacks[0])(record, "first").children.name',
        ["record", "record.first", "record.first.children.name"],
      ],
    ] as const) {
      expect(
        sortPaths(
          extractPaths(`($callbacks := ${producer}; ${invocation})`),
        ),
      ).toEqual(
        sortPaths(
          expectedPaths.map((path) => ({
            path,
            confidence: "static" as const,
          })),
        ),
      );
    }
  });

  it("invokes callable results produced by reduce callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          "($callback := $reduce(items, function($acc, $value){" +
            "function($x){$x.children.name}}); $callback(detail))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("traces a partial returned by a custom function", () => {
    expect(
      extractPaths(
        "($project := function($x){$x.first.name}; $maker := function(){$project(?)}; $maker()(record))",
      ),
    ).toEqual([
      { path: "record", confidence: "static" },
      { path: "record.first.name", confidence: "static" },
    ]);
  });

  it("traces a lambda selected from a stored array", () => {
    expect(
      extractPaths(
        "($functions := [function($x){$x.first.name}]; $functions[0](record))",
      ),
    ).toEqual([
      { path: "record", confidence: "static" },
      { path: "record.first.name", confidence: "static" },
    ]);
  });

  it("preserves dynamic selectors on stored callable arrays", () => {
    expect(
      sortPaths(
        extractPaths(
          "($functions := [" +
            "function($x){$x.children.name}," +
            "function($x){$x.children.rank}" +
            "][$$.config.index]; $functions(detail))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.index", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "detail.children.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves predicates attached to callable literals", () => {
    for (const [expression, invocationPaths] of [
      [
        "($op := (function($x){$x.children.name})" +
          "[$$.config.enabled]; $op(detail))",
        ["detail", "detail.children.name"],
      ],
      [
        '($op := {"apply":function($x){$x.children.name}}' +
          "[$$.config.enabled]; ($op.apply)(detail))",
        ["detail", "detail.children.name"],
      ],
      [
        '($op := (|children|{"seen":name}|)' +
          "[$$.config.enabled]; $op(detail).children.seen)",
        ["detail", "detail.children", "detail.children.name"],
      ],
    ] as const) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "config.enabled", confidence: "static" },
          ...invocationPaths.map((path) => ({
            path,
            confidence: "static" as const,
          })),
        ]),
      );
    }
  });

  it("preserves callable values through path sort stages", () => {
    const cases = [
      "(([function($x){$x.children.name}])^($$.config.rank)[0])(detail)",
      "($ops := [function($x){$x.children.name}]^($$.config.rank); ($ops[0])(detail))",
      '((({"apply": function($x){$x.children.name}}).*)^($$.config.rank)[0])(detail)',
      "(([function($captured, $x){$x.children.name}(config.rank, ?)])^($$.config.rank)[0])(detail)",
    ];

    for (const expression of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "config.rank", confidence: "static" },
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }

    expect(
      sortPaths(
        extractPaths(
          '(([$lookup])^($$.config.rank)[0])(record, "first").children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.rank", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '(([|children|{"seen": name}|])^($$.config.rank)[0])(detail).children.seen',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.rank", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves result aliases from filtered callable variables", () => {
    for (const expression of [
      "($functions := [function($x){$x}]; " +
        "$functions[0](detail).children.name)",
      "($f := function($x){$functions[0]($x).children.name}; " +
        "$functions := [function($x){$x}]; $f(detail))",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("traces a lambda selected from a stored object", () => {
    expect(
      extractPaths(
        '($functions := {"project": function($x){$x.first.name}}; $functions.project(record))',
      ),
    ).toEqual([
      { path: "record", confidence: "static" },
      { path: "record.first.name", confidence: "static" },
    ]);
  });

  it("traces callables selected from parenthesized inline objects", () => {
    for (const expression of [
      '({"go":function($x){$x.children.name}}).go(detail)',
      "($project := " +
        '({"go":function($x){$x}}).go; ' +
        "$project(detail).children.name)",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("traces callables selected from conditional object containers", () => {
    for (const expression of [
      "($project := (flag ? " +
        '{"go":function($x){$x}} : {"go":function($x){$x}}).go; ' +
        "$project(detail).children.name)",
      "$lookup(flag ? " +
        '{"go":function($x){$x}} : {"go":function($x){$x}}, ' +
        '"go")(detail).children.name',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "flag", confidence: "static" },
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("traces callable fields through collection container producers", () => {
    for (const producer of [
      '([{"go":function($x){$x}}][0]).go',
      '$merge([{"go":function($x){$x}}]).go',
      '$lookup($merge([{"go":function($x){$x}}]),"go")',
      '$append({}, {"go":function($x){$x}}).go',
    ]) {
      expect(
        sortPaths(
          extractPaths(
            `($project := ${producer}; $project(detail).children.name)`,
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
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

  it("keeps focus bindings on function result predicates", () => {
    expect(
      sortPaths(extractPaths("$filter(items, function($v){$v.active})@$r[$r.name]")),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.active", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
  });

  it("keeps focus bindings on function result group entries", () => {
    expect(
      sortPaths(extractPaths("$map(items, function($v){$v})@$r{$r.category: $r.total}")),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.category", confidence: "static" },
        { path: "items.total", confidence: "static" },
      ]),
    );
  });

  it("keeps focus bindings on sorted function result group entries", () => {
    expect(
      sortPaths(
        extractPaths("$map(items, function($v){$v})@$r^(<$r.rank){$r.category: $r.total}"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.category", confidence: "static" },
        { path: "items.rank", confidence: "static" },
        { path: "items.total", confidence: "static" },
      ]),
    );
  });

  it("keeps focus bindings on sorted apply-chain function result group entries", () => {
    expect(
      sortPaths(
        extractPaths(
          "items ~> $map(function($v){$v})@$r^(<$r.rank){$r.category: $r.total}",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.category", confidence: "static" },
        { path: "items.rank", confidence: "static" },
        { path: "items.total", confidence: "static" },
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
        { path: "products[*]", confidence: "dynamic" },
        { path: "products[*].price", confidence: "dynamic" },
        { path: "sku", confidence: "static" },
      ]),
    );
  });

  it("preserves static lookup keys in direct result paths", () => {
    expect(sortPaths(extractPaths('$lookup(inventory, "customer")'))).toEqual(
      sortPaths([
        { path: "inventory", confidence: "static" },
        { path: "inventory.customer", confidence: "static" },
      ]),
    );
    expect(sortPaths(extractPaths('$lookup($, "customer")'))).toEqual(
      sortPaths([{ path: "customer", confidence: "static" }]),
    );
  });

  it("preserves context-default root object reads", () => {
    for (const expression of ["$keys()", "$spread()", "$boolean()", "$not()"]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([{ path: "*", confidence: "static" }]),
      );
    }
    for (const expression of ["$clone()", "$string()"]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([{ path: "**", confidence: "static" }]),
      );
    }
  });

  it("preserves suffix reads from a context-default spread result", () => {
    expect(sortPaths(extractPaths("$spread().record.first.name"))).toEqual(
      sortPaths([
        { path: "*", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from a path-context spread result", () => {
    expect(sortPaths(extractPaths("record.$spread().first.name"))).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from a context-default sift result", () => {
    expect(
      sortPaths(
        extractPaths("$sift(function($value){true}).record.first.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "*", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from a path-context sift result", () => {
    expect(
      sortPaths(
        extractPaths("record.$sift(function($value){true}).first.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves group reads from a path-context sift result", () => {
    expect(
      sortPaths(
        extractPaths(
          "record.$sift(function($value){true}){first.name:first.detail.rank}",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves group reads from a path-context lookup result", () => {
    expect(
      sortPaths(extractPaths('record.$lookup("first"){name:detail.rank}')),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves sort reads from path-context preserving results", () => {
    const cases = [
      {
        expression: "record.$spread()^(first.detail.rank).first.name",
        broadPath: "record.*",
      },
      {
        expression: "record.$clone()^(first.detail.rank).first.name",
        broadPath: "record.**",
      },
      {
        expression:
          "record.$sift(function($value){true})^(first.detail.rank).first.name",
        broadPath: "record.*",
      },
    ];

    for (const { expression, broadPath } of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "record", confidence: "static" },
          { path: broadPath, confidence: "static" },
          { path: "record.first.name", confidence: "static" },
          { path: "record.first.detail.rank", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves suffix reads from a path-context conditional builtin", () => {
    expect(
      sortPaths(
        extractPaths(
          "record.(flag ? $spread : $clone)().first.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.flag", confidence: "static" },
        { path: "record.*", confidence: "static" },
        { path: "record.**", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves group reads from a path-context conditional builtin", () => {
    expect(
      sortPaths(
        extractPaths(
          "record.(flag ? $spread : $clone)(){first.name:first.detail.rank}",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.flag", confidence: "static" },
        { path: "record.*", confidence: "static" },
        { path: "record.**", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves sort reads from a path-context conditional builtin", () => {
    expect(
      sortPaths(
        extractPaths(
          "record.(flag ? $spread : $clone)()^(first.detail.rank).first.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.flag", confidence: "static" },
        { path: "record.*", confidence: "static" },
        { path: "record.**", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from a stored conditional builtin", () => {
    expect(
      sortPaths(
        extractPaths(
          "($fn := flag ? $spread : $clone; $fn(record).first.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "flag", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from a lookup-selected builtin", () => {
    expect(
      sortPaths(
        extractPaths(
          '($ops := {"go": $spread}; $lookup($ops, "go")(record).first.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from an object-selected builtin", () => {
    expect(
      sortPaths(
        extractPaths('({"go": $spread}.go)(record).first.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from a custom-function-returned builtin", () => {
    expect(
      sortPaths(
        extractPaths(
          "($factory := function(){$clone}; $factory()(record).first.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from a forwarded builtin argument", () => {
    expect(
      sortPaths(
        extractPaths(
          "($identity := function($fn){$fn}; $identity($clone)(record).first.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from a closure-forwarded builtin", () => {
    expect(
      sortPaths(
        extractPaths(
          "($forward := function($fn){function(){$fn}}; $forward($clone)()(record).first.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from an apply-forwarded builtin", () => {
    expect(
      sortPaths(
        extractPaths(
          "($clone ~> function($fn){$fn})(record).first.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from an immediately invoked builtin partial", () => {
    expect(sortPaths(extractPaths("$clone(?)(record).first.name"))).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from builtin partial map callbacks", () => {
    expect(sortPaths(extractPaths("$map(records, $clone(?)).first.name"))).toEqual(
      sortPaths([
        { path: "records", confidence: "static" },
        { path: "records.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves result aliases from builtin partial map callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          "($callback := $clone(?); $map([detail],$callback).children.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($callback := $clone(?); " +
            '$map([{"selected":detail}],$callback).selected.children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($callback := $clone(?); " +
            "$map([{key:detail}],$callback).a.children.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from builtin reduce callback results", () => {
    expect(
      sortPaths(extractPaths("$reduce(records, $append, []).first.name")),
    ).toEqual(
      sortPaths([
        { path: "records", confidence: "static" },
        { path: "records.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves result aliases from builtin partial reduce callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          "($callback := $append(?,?); " +
            "$reduce([detail],$callback,[]).children.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($callback := $append(?,?); " +
            '$reduce([{"selected":detail}],$callback,[])' +
            ".selected.children.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($callback := $append(?,?); " +
            "$reduce([{key:detail}],$callback,[]).a.children.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed suffix bases from builtin reduce callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          "$reduce([detail, fallback.x], $append, []).children.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed suffix bases from lambda reduce callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          "$reduce([detail, fallback.x], function($acc, $value){$append($acc, $value)}, []).children.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves result aliases from partially applied reduce callbacks", () => {
    const partialPrefix =
      "$base := function($p,$acc,$v,$i,$a){($p;$append($acc,$v))}; $f := $base(config.suffix,?,?,?,?)";
    expect(
      sortPaths(
        extractPaths(
          `(${partialPrefix}; $reduce([detail, fallback.x], $f, []).children.name)`,
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.suffix", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($base := function($p,$acc,$v){($p;{"x":$v})}; $f := $base(config.suffix,?,?,?); $reduce([detail, fallback.x], $f, {}).x.children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.suffix", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("binds $reduce callback index and array parameters by documented position", () => {
    expect(
      sortPaths(
        extractPaths(
          "$reduce([detail, fallback.x], function($acc, $v, $i, $all){$append($acc, $all.children.name)}, [])",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "$reduce([detail, fallback.x], function($acc, $v, $i){($i.children.name; $acc)}, [])",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
      ]),
    );
  });

  it("preserves object aliases from builtin reduce callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          '$reduce([{"x": detail}, fallback], $append, []).x.children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
      ]),
    );
  });

  it("preserves dynamic object aliases from builtin reduce callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          "$reduce([{(key): detail}, fallback], $append, []).x.children.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
      ]),
    );
  });

  it("preserves object aliases from lambda reduce callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          '$reduce([{"x": detail}, fallback], function($acc, $value){$append($acc, $value)}, []).x.children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from builtin map callback results", () => {
    expect(sortPaths(extractPaths("$map(records, $clone).first.name"))).toEqual(
      sortPaths([
        { path: "records", confidence: "static" },
        { path: "records.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves object aliases from builtin map callback results", () => {
    expect(
      sortPaths(
        extractPaths('$map([{"x": record}], $clone).x.first.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves dynamic object aliases from builtin map callback results", () => {
    expect(
      sortPaths(
        extractPaths('$map([{(key): record}], $clone).x.first.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed suffix bases from builtin map callback results", () => {
    expect(
      sortPaths(
        extractPaths("$map([detail, fallback.x], $clone).children.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed suffix bases from unary collection results", () => {
    for (const expression of [
      "$reverse([detail, fallback.x]).children.name",
      "$shuffle([detail, fallback.x]).children.name",
      "$distinct([detail, fallback.x]).children.name",
      "$filter([detail, fallback.x], function(){true}).children.name",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
          { path: "fallback.x", confidence: "static" },
          { path: "fallback.x.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves mixed suffix bases and predicate reads from $single results", () => {
    expect(
      sortPaths(
        extractPaths(
          "$single([detail, fallback.x], function($v){$v.active}).children.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.active", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.active", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffix reads from a path-context stored builtin", () => {
    expect(
      sortPaths(
        extractPaths(
          "record.($fn := flag ? $spread : $clone; $fn().first.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.flag", confidence: "static" },
        { path: "record.*", confidence: "static" },
        { path: "record.**", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves explicit root object reads", () => {
    for (const expression of [
      "$keys($)",
      "$spread($)",
      "$boolean($)",
      "$not($)",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([{ path: "*", confidence: "static" }]),
      );
    }
    for (const expression of ["$clone($)", "$string($)"]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([{ path: "**", confidence: "static" }]),
      );
    }

    expect(sortPaths(extractPaths("record.$clone($)"))).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.**", confidence: "static" },
      ]),
    );

    for (const expression of [
      "$each($, function($v, $k){$k})",
      "$sift($, function($v, $k){true})",
      "$merge([$])",
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([{ path: "*", confidence: "static" }]),
      );
    }
  });

  it("injects context defaults for user-defined functions", () => {
    for (const expression of [
      "($f := function($x)<o-:x>{$x.record.first.name}; $f())",
      "(function($x)<o-:x>{$x.record.first.name})()",
      "($f := function($x)<o-:o>{$x}; $f().record.first.name)",
      '(($f := function($prefix, $x)<so-:x>{$x.record.first.name}; $f("ignored")))',
      '(($f := function($x, $suffix)<o-s:x>{$x.record.first.name}; $f("ignored")))',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([{ path: "record.first.name", confidence: "static" }]),
      );
    }

    expect(
      sortPaths(
        extractPaths(
          "record.($f := function($x)<o-:x>{$x.first.name}; $f())",
        ),
      ),
    ).toEqual(
      sortPaths([{ path: "record.first.name", confidence: "static" }]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($f := function($x)<o-:x>{$x.first.name}; record.$f())",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("injects bound function context defaults in path stages", () => {
    expect(
      sortPaths(
        extractPaths(
          "($f := function($x)<o-:x>{$x.active}; items[$f()].name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items.active", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($f := function($x)<o-:x>{$x.rank}; items^(<$f()).name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items.name", confidence: "static" },
        { path: "items.rank", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '($f := function($x)<o-:x>{$x.category}; items{$f(): "x"})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.category", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($f := function($x)<o-:x>{$x.active}; items.($f()))",
        ),
      ),
    ).toEqual(
      sortPaths([{ path: "items.active", confidence: "static" }]),
    );
  });

  it("injects path context into looked-up function defaults", () => {
    for (const [key, keyPaths] of [
      ['"apply"', []],
      [
        "$$.config.operation",
        [{ path: "config.operation", confidence: "static" as const }],
      ],
    ] as const) {
      expect(
        sortPaths(
          extractPaths(
            "($operations := items[0].{" +
              '"apply":function($x)<o-:x>{$x.children.name & name}}; ' +
              `detail.$lookup($operations, ${key})())`,
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: "items", confidence: "static" },
          { path: "items.name", confidence: "static" },
          ...keyPaths,
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves static context-default lookup keys", () => {
    expect(sortPaths(extractPaths('$lookup("items")'))).toEqual(
      sortPaths([{ path: "items", confidence: "static" }]),
    );
    expect(sortPaths(extractPaths('$lookup("items").name'))).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
    expect(sortPaths(extractPaths('($x := $lookup("items"); $x.name)'))).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
    expect(sortPaths(extractPaths('record.$lookup("first").name'))).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves dynamic context-default lookup keys", () => {
    expect(sortPaths(extractPaths("$lookup(config.key).name"))).toEqual(
      sortPaths([
        { path: "config.key", confidence: "static" },
        { path: "[*]", confidence: "dynamic" },
        { path: "[*].name", confidence: "dynamic" },
      ]),
    );
    expect(
      sortPaths(extractPaths("($x := $lookup(config.key); $x.name)")),
    ).toEqual(
      sortPaths([
        { path: "config.key", confidence: "static" },
        { path: "[*]", confidence: "dynamic" },
        { path: "[*].name", confidence: "dynamic" },
      ]),
    );
  });

  it("marks dynamic lookup keys with wildcard result paths", () => {
    expect(sortPaths(extractPaths("$lookup(inventory, category).name"))).toEqual(
      sortPaths([
        { path: "category", confidence: "static" },
        { path: "inventory", confidence: "static" },
        { path: "inventory[*]", confidence: "dynamic" },
        { path: "inventory[*].name", confidence: "dynamic" },
      ]),
    );
    expect(sortPaths(extractPaths("$lookup($, category).name"))).toEqual(
      sortPaths([
        { path: "category", confidence: "static" },
        { path: "[*]", confidence: "dynamic" },
        { path: "[*].name", confidence: "dynamic" },
      ]),
    );
  });

  it("preserves static lookup keys in chained result paths", () => {
    expect(sortPaths(extractPaths('$lookup(inventory, "customer").name'))).toEqual(
      sortPaths([
        { path: "inventory", confidence: "static" },
        { path: "inventory.customer", confidence: "static" },
        { path: "inventory.customer.name", confidence: "static" },
      ]),
    );
    expect(sortPaths(extractPaths('$lookup($, "customer").name'))).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
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
        { path: "outer[*]", confidence: "dynamic" },
        { path: "outer[*].inner", confidence: "dynamic" },
        { path: "outer[*].inner[*]", confidence: "dynamic" },
        { path: "outer[*].inner[*].value", confidence: "dynamic" },
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

  it("preserves all apply-chain $append array element result aliases", () => {
    const expressions = [
      "([detail, fallback.x] ~> $append([])).children.name",
      "([] ~> $append([detail, fallback.x])).children.name",
      "([detail, fallback.x] ~> $append([]) ~> $reverse()).children.name",
    ];

    for (const expression of expressions) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
          { path: "fallback.x", confidence: "static" },
          { path: "fallback.x.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves parenthesized apply aliases through collection wrappers", () => {
    const source = "([detail, fallback.x] ~> $append([]))";
    const cases = [
      { expression: `$reverse(${source}).children.name` },
      {
        expression: `$filter(${source}, function($v){$v.active}).children.name`,
        callbackField: "active",
      },
      {
        expression: `$sort(${source}, function($l,$r){$l.rank > $r.rank}).children.name`,
        callbackField: "rank",
      },
      { expression: `$reduce(${source}, $append, []).children.name` },
      {
        expression: `($id := function($x){$x}; $id(${source}).children.name)`,
      },
    ];

    for (const { expression, callbackField } of cases) {
      const expected = [
        { path: "detail", confidence: "static" as const },
        { path: "detail.children.name", confidence: "static" as const },
        { path: "fallback.x", confidence: "static" as const },
        { path: "fallback.x.children.name", confidence: "static" as const },
      ];
      if (callbackField) {
        expected.push(
          { path: `detail.${callbackField}`, confidence: "static" },
          { path: `fallback.x.${callbackField}`, confidence: "static" },
        );
      }
      expect(sortPaths(extractPaths(expression))).toEqual(sortPaths(expected));
    }
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

  it("preserves mixed $append object aliases with path inputs", () => {
    expect(sortPaths(extractPaths('$append({"x": primary}, fallback).x.name'))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds mixed $append object aliases with path inputs", () => {
    expect(
      sortPaths(extractPaths('($all := $append({"x": primary}, fallback); $all.x.name)')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
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

  it("preserves $merge static object aliases in chained fields", () => {
    expect(sortPaths(extractPaths('$merge([{"x": primary}]).x.name'))).toEqual(
      sortPaths([
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $merge object aliases with path inputs", () => {
    expect(sortPaths(extractPaths('$merge([{"x": primary}, fallback]).x.name'))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
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

  it("preserves mixed $zip object aliases with path inputs", () => {
    expect(sortPaths(extractPaths('$zip({"x": primary}, fallback).x.name'))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
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

  it("preserves $spread static object aliases in wildcard chained fields", () => {
    expect(sortPaths(extractPaths('$spread({"x": primary}).*.name'))).toEqual(
      sortPaths([
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $clone static object aliases in chained fields", () => {
    expect(sortPaths(extractPaths('$clone({"x": primary}).x.name'))).toEqual(
      sortPaths([
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
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
        { path: "record.*", confidence: "static" },
        { path: "record.*.name", confidence: "static" },
      ]),
    );
  });

  it("preserves projected $each callback aliases in chained fields", () => {
    expect(
      sortPaths(extractPaths("$each(record, function($v) { $v.detail }).name")),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*.detail", confidence: "static" },
        { path: "record.*.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through constructed object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each({"a": detail, "b": fallback.x}, $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through bound object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '($o := {"a": detail, "b": fallback.x}; $each($o, $clone).children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through conditional object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each(flag ? {"a": detail} : {"b": fallback.x}, $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "flag", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through block object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each(($o := {"a": detail, "b": fallback.x}; $o), $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through returned object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '($maker := function(){{"a": detail, "b": fallback.x}}; $each($maker(), $clone).children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through cloned object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each($clone({"a": detail, "b": fallback.x}), $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through sifted object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each($sift({"a": detail, "b": fallback.x}, function($v){true}), $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through merged object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each($merge([{"a": detail}, {"b": fallback.x}]), $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through looked-up object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each($lookup({"group": {"a": detail, "b": fallback.x}}, "group"), $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through stored builtin results", () => {
    expect(
      sortPaths(
        extractPaths(
          '($fn := $clone; $each($fn({"a": detail, "b": fallback.x}), $clone).children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through partial builtin results", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each($clone(?)({"a": detail, "b": fallback.x}), $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through applied builtin results", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each({"a": detail, "b": fallback.x} ~> $clone(), $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $each callback suffixes through selected object values", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each({"group": {"a": detail, "b": fallback.x}}.group, $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $each value aliases through parenthesized object selections", () => {
    const cases = [
      '$each(({"group": {"a": detail, "b": fallback.x}}).group, function($value){$value.children.name})',
      '$each(({"group": {"a": detail, "b": fallback.x}}).group, function($captured, $value){$value.children.name}(config.suffix, ?))',
      '$sift(({"group": {"a": detail, "b": fallback.x}}).group, function($value){$value.children.name})',
      '$sift(({"group": {"a": detail, "b": fallback.x}}).group, function($captured, $value){$value.children.name}(config.suffix, ?))',
    ];

    for (const expression of cases) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
          { path: "fallback.x", confidence: "static" },
          { path: "fallback.x.children.name", confidence: "static" },
          ...(expression.includes("config.suffix")
            ? [{ path: "config.suffix", confidence: "static" as const }]
            : []),
        ]),
      );
    }
  });

  it("preserves builtin $each callback suffixes through selected array objects", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each([{"a": detail}, {"b": fallback.x}][0], $clone).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed suffixes from lambda $each callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each({"a": detail, "b": fallback.x}, function($v){$clone($v)}).children.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed suffixes from stored lambda $each callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          '($f := function($v){$clone($v)}; $each({"a": detail, "b": fallback.x}, $f).children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed suffixes from partial lambda $each callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          '($f := function($v, $unused){$clone($v)}(?, 1); $each({"a": detail, "b": fallback.x}, $f).children.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves suffixes from transform $each callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          '$each({"a": record}, |first|{"seen": detail}|).first.seen.rank',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.detail", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves suffixes from stored transform $each callback results", () => {
    expect(
      sortPaths(
        extractPaths(
          '($t := |first|{"seen": detail}|; $each({"a": record}, $t).first.seen.rank)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.detail", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $map callback suffixes through block array values", () => {
    expect(
      sortPaths(
        extractPaths(
          "$map(($x := [detail, fallback.x]; $x), $clone).children.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
      ]),
    );
  });

  it("preserves builtin $map callback suffixes through block-local producers", () => {
    const expressions = [
      "$map((($make := function(){[detail, fallback.x]}; $make())), $clone).children.name",
      "$map((($copy := $append(?,[]) ~> $reverse(?); $copy([detail, fallback.x]))), $clone).children.name",
    ];

    for (const expression of expressions) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
          { path: "fallback.x", confidence: "static" },
          { path: "fallback.x.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("preserves block collection result suffixes and callback reads", () => {
    const block = "($x := [detail, fallback.x]; $x)";
    const cases = [
      {
        expression: `$filter(${block}, function($v){$v.active}).children.name`,
        callbackField: "active",
      },
      {
        expression: `$single(${block}, function($v){$v.rank = 2}).children.name`,
        callbackField: "rank",
      },
      {
        expression: `$sort(${block}, function($l, $r){$l.rank > $r.rank}).children.name`,
        callbackField: "rank",
      },
      {
        expression: `$reverse(${block}).children.name`,
      },
      {
        expression: `$reduce(${block}, $append, []).children.name`,
      },
    ];

    for (const { expression, callbackField } of cases) {
      const expected = [
        { path: "detail", confidence: "static" as const },
        { path: "detail.children.name", confidence: "static" as const },
        { path: "fallback.x", confidence: "static" as const },
        { path: "fallback.x.children.name", confidence: "static" as const },
      ];
      if (callbackField) {
        expected.push(
          { path: `detail.${callbackField}`, confidence: "static" },
          { path: `fallback.x.${callbackField}`, confidence: "static" },
        );
      }
      expect(sortPaths(extractPaths(expression))).toEqual(sortPaths(expected));
    }
  });

  it("preserves $sift result aliases in wildcard chained fields", () => {
    expect(
      sortPaths(extractPaths("$sift(record, function($v) { $v.active }).*.name")),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*.name", confidence: "static" },
        { path: "record.*.active", confidence: "static" },
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
        { path: "record.*.active", confidence: "static" },
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

  it("preserves root aliases through path-preserving functions", () => {
    expect(sortPaths(extractPaths("$clone($).customer.name"))).toEqual(
      sortPaths([
        { path: "**", confidence: "static" },
        { path: "customer.name", confidence: "static" },
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

  it("uses path-preserving function results as projection context", () => {
    expect(sortPaths(extractPaths("$clone(record).{category: total}"))).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.category", confidence: "static" },
        { path: "record.total", confidence: "static" },
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

  it("binds root arguments in function callbacks", () => {
    expect(
      sortPaths(
        extractPaths("($project := function($v) { $v }; $project($).customer.name)"),
      ),
    ).toEqual(sortPaths([{ path: "customer.name", confidence: "static" }]));
    expect(sortPaths(extractPaths("$map($, function($v) { $v.customer.name })"))).toEqual(
      sortPaths([{ path: "customer.name", confidence: "static" }]),
    );
  });

  it("binds root arguments in inline apply lambdas", () => {
    expect(sortPaths(extractPaths("$ ~> function($v) { $v.customer.name }"))).toEqual(
      sortPaths([{ path: "customer.name", confidence: "static" }]),
    );
  });

  it("preserves mixed object alias suffix bases in inline apply lambdas", () => {
    expect(
      sortPaths(
        extractPaths(
          '(flag ? {"x": detail} : fallback) ~> function($v){$v.x.children.name}',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "flag", confidence: "static" },
      ]),
    );
  });

  it("resolves parent paths in inline apply lambdas", () => {
    expect(
      sortPaths(extractPaths("items.children ~> function($v){%.rank & $v.name}")),
    ).toEqual(
      sortPaths([
        { path: "items.children", confidence: "static" },
        { path: "items.children.name", confidence: "static" },
        { path: "items.rank", confidence: "static" },
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

  it("preserves mixed object alias suffix bases through custom function parameters", () => {
    expect(
      sortPaths(
        extractPaths(
          '($project := function($v) { $v.x.children.name }; $project(flag ? {"x": detail} : fallback))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "flag", confidence: "static" },
      ]),
    );
  });

  it("preserves block-local suffix bases in direct chained fields", () => {
    expect(
      sortPaths(extractPaths('(($f := fallback; flag ? {"x": primary} : $f)).x.name')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves block-local dynamic suffix bases in direct chained fields", () => {
    expect(
      sortPaths(extractPaths("(($f := fallback; flag ? {key: primary} : $f)).x.name")),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds block-local suffix bases as variables", () => {
    expect(
      sortPaths(
        extractPaths('($o := ($f := fallback; flag ? {"x": primary} : $f); $o.x.name)'),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
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

  it("binds explicit $reduce initial base aliases as suffixable variables", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $reduce(items, function($acc, $v){{"x": $v.detail}}, seed); $r.x.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.x.name", confidence: "static" },
      ]),
    );
  });

  it("binds implicit $reduce initial item aliases as suffixable variables", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $reduce(items, function($acc, $v){{"x": $v.detail}}); $r.x.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "items.x.name", confidence: "static" },
      ]),
    );
  });

  it("binds $reduce accumulator callbacks to the accumulator source", () => {
    expect(
      sortPaths(
        extractPaths(
          '$reduce(items, function($acc, $v){{"x": $append($acc.x, $v.detail)}}, {"x": seed}).x.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.name", confidence: "static" },
      ]),
    );
  });

  it("preserves implicit $reduce initial item aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths('$reduce(items, function($acc, $v){{"x": $v.detail}}).x.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "items.x.name", confidence: "static" },
      ]),
    );
  });

  it("preserves explicit $reduce initial object aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths(
          '$reduce(items, function($acc, $v){{"x": $v.detail}}, {"x": seed}).x.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.name", confidence: "static" },
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

  it("preserves dynamic object-key value aliases in direct chained fields", () => {
    expect(sortPaths(extractPaths("({foo: primary}).x.name"))).toEqual(
      sortPaths([
        { path: "foo", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves dynamic object-key value aliases in wildcard chained fields", () => {
    expect(sortPaths(extractPaths("({foo: primary}).*.name"))).toEqual(
      sortPaths([
        { path: "foo", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves nested static aliases below dynamic object keys", () => {
    expect(sortPaths(extractPaths('({foo: {"x": primary}}).x.x.name'))).toEqual(
      sortPaths([
        { path: "foo", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves block-scoped dynamic object-key value aliases", () => {
    expect(sortPaths(extractPaths("($k := key; {($k): primary}).x.name"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves block-scoped dynamic object-key wildcard aliases", () => {
    expect(sortPaths(extractPaths("($k := key; {($k): primary}).*.name"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves block-local value aliases below dynamic object keys", () => {
    expect(
      sortPaths(extractPaths("($k := key; $v := primary; {($k): $v}).x.name")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds dynamic object-key aliases as suffixable variables", () => {
    expect(sortPaths(extractPaths("($o := {key: primary}; $o.x.name)"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds block dynamic object-key aliases as suffixable variables", () => {
    expect(
      sortPaths(extractPaths("($o := ($k := key; {($k): primary}); $o.x.name)")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds block-local dynamic object values as suffixable variables", () => {
    expect(
      sortPaths(
        extractPaths("($o := ($k := key; $v := primary; {($k): $v}); $o.x.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves custom function dynamic object-key result aliases", () => {
    expect(
      sortPaths(
        extractPaths(
          "($make := function(){($k := key; {($k): primary})}; $make().x.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves custom function argument dynamic object-key result aliases", () => {
    expect(
      sortPaths(
        extractPaths("($clone := function($v){$v}; $clone({(key): primary}).x.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves custom function argument dynamic object-key reads", () => {
    expect(
      sortPaths(
        extractPaths("($read := function($v){$v.x.name}; $read({(key): primary}))"),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $map callback argument dynamic object-key reads", () => {
    expect(
      sortPaths(extractPaths("$map([{key: primary}], function($v){$v.x.name})")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $sort callback argument dynamic object-key reads", () => {
    expect(
      sortPaths(
        extractPaths(
          "$sort([{key: primary}], function($l,$r){$l.x.name < $r.x.name}).x.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $map callback argument dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("$map([{key: primary}], function($v){$v}).x.name")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $map callback dynamic object-key reads inside projected result aliases", () => {
    expect(
      sortPaths(
        extractPaths('$map([{key: primary}], function($v){{"out": $v.x.name}}).out'),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $map callback dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("$map(items, function($v){{key: $v}}).x.name")),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $map callback dynamic object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths("$map(items, function($v){flag ? {key: $v.detail} : fallback}).x.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("preserves block $map callback dynamic object-key result aliases", () => {
    expect(
      sortPaths(
        extractPaths("$map(items, function($v){($k := key; {($k): $v})}).*.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("preserves $each callback dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("$each(obj, function($v, $k){{key: $v}}).x.name")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "obj", confidence: "static" },
        { path: "obj.*", confidence: "static" },
        { path: "obj.*.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $each callback dynamic object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths("$each(obj, function($v){flag ? {key: $v.detail} : fallback}).x.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "obj", confidence: "static" },
        { path: "obj.*.detail", confidence: "static" },
        { path: "obj.*.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $reduce callback dynamic object-key result aliases", () => {
    expect(
      sortPaths(
        extractPaths("$reduce(items, function($acc, $v){{key: $v}}, {}).x.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("preserves explicit $reduce initial dynamic object-key base aliases", () => {
    expect(
      sortPaths(
        extractPaths("$reduce(items, function($acc, $v){{key: $v.detail}}, seed).x.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.x.name", confidence: "static" },
      ]),
    );
  });

  it("preserves implicit $reduce initial dynamic object-key base aliases", () => {
    expect(
      sortPaths(
        extractPaths("$reduce(items, function($acc, $v){{key: $v.detail}}).x.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "items.x.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("binds explicit $reduce initial dynamic object-key base aliases as variables", () => {
    expect(
      sortPaths(
        extractPaths(
          "($r := $reduce(items, function($acc, $v){{key: $v.detail}}, seed); $r.x.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.x.name", confidence: "static" },
      ]),
    );
  });

  it("binds implicit $reduce initial dynamic object-key base aliases as variables", () => {
    expect(
      sortPaths(
        extractPaths(
          "($r := $reduce(items, function($acc, $v){{key: $v.detail}}); $r.x.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "items.x.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("preserves explicit $reduce initial dynamic object-key aliases", () => {
    expect(
      sortPaths(
        extractPaths("$reduce(items, function($acc, $v){{key: $v.detail}}, {key: seed}).x.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.name", confidence: "static" },
      ]),
    );
  });

  it("preserves conditional dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("(flag ? {key: primary} : {key: fallback}).x.name")),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed dynamic conditional object aliases with path branches", () => {
    expect(sortPaths(extractPaths("(flag ? {key: primary} : fallback).x.name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds mixed dynamic conditional object aliases with path branches", () => {
    expect(
      sortPaths(extractPaths("($o := flag ? {key: primary} : fallback; $o.x.name)")),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed static and dynamic conditional object aliases", () => {
    expect(
      sortPaths(extractPaths('(flag ? {key: primary} : {"x": fallback}).x.name')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves Elvis dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("({key: primary} ?: {key: fallback}).x.name")),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves array dynamic object-key result aliases", () => {
    expect(sortPaths(extractPaths("([{key: primary}, {key: fallback}]).x.name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed array dynamic object aliases with path elements", () => {
    expect(sortPaths(extractPaths("([{key: primary}, fallback]).x.name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds mixed array dynamic object aliases with path elements", () => {
    expect(
      sortPaths(extractPaths("($o := [{key: primary}, fallback]; $o.x.name)")),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves wildcard conditional dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("((flag ? {key: primary} : {key: fallback})).*.name")),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $clone dynamic object-key result aliases", () => {
    expect(sortPaths(extractPaths("$clone({key: primary}).x.name"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $append dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("$append([{key: primary}], [{key: fallback}]).x.name")),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $append dynamic object aliases with path inputs", () => {
    expect(sortPaths(extractPaths("$append({key: primary}, fallback).x.name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $filter dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("$filter([{key: primary}], function($v){true}).x.name")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $filter dynamic object aliases with path inputs", () => {
    expect(
      sortPaths(
        extractPaths("$filter([{key: primary}, fallback], function($v){true}).x.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves direct mixed object alias filter result bases", () => {
    expect(
      sortPaths(
        extractPaths(
          '$filter(((flag ? {"x": primary} : fallback).x), function($v){$v.active}).name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.active", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.active", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $single dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("$single([{key: primary}], function($v){true}).x.name")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $sort dynamic object-key result aliases", () => {
    expect(
      sortPaths(
        extractPaths("$sort([{key: primary}], function($l, $r){0}).x.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $merge dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("$merge([{key: primary}, {key: fallback}]).x.name")),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $merge dynamic object aliases with path inputs", () => {
    expect(sortPaths(extractPaths("$merge([{key: primary}, fallback]).x.name"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $spread dynamic object-key result aliases", () => {
    expect(sortPaths(extractPaths("$spread({key: primary}).*.name"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $sift dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths("$sift({key: primary}, function($v){$v.name}).x.name")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $lookup dynamic object-key result aliases", () => {
    expect(sortPaths(extractPaths('$lookup({key: primary}, "x").name'))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves nested $lookup dynamic object-key result aliases", () => {
    expect(
      sortPaths(extractPaths('$lookup({key: {"fixed": customer}}, "x").fixed.name')),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("does not suffix static $lookup object branches with the lookup key", () => {
    expect(
      sortPaths(extractPaths('$lookup({"x": {"fixed": customer}}, "x").fixed.name')),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed lookup path branches through result suffixes", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := flag ? {"x": {"fixed": customer}} : fallback; $lookup($r, "x").fixed.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.fixed.name", confidence: "static" },
        { path: "flag", confidence: "static" },
      ]),
    );
  });

  it("preserves block-local mixed lookup path branches", () => {
    const expected = sortPaths([
      { path: "fallback", confidence: "static" },
      { path: "fallback.x", confidence: "static" },
      { path: "fallback.x.name", confidence: "static" },
      { path: "flag", confidence: "static" },
      { path: "primary", confidence: "static" },
      { path: "primary.name", confidence: "static" },
    ]);

    expect(
      sortPaths(
        extractPaths(
          '$lookup(($f := fallback; flag ? {"x": primary} : $f), "x").name',
        ),
      ),
    ).toEqual(expected);
    expect(
      sortPaths(
        extractPaths(
          '($p := $lookup(($f := fallback; flag ? {"x": primary} : $f), "x"); $p.name)',
        ),
      ),
    ).toEqual(expected);
  });

  it("marks mixed lookup dynamic path branches with wildcard result paths", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := flag ? {"x": {"fixed": customer}} : fallback; $r ~> $lookup(key).fixed.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback[*]", confidence: "dynamic" },
        { path: "fallback[*].fixed.name", confidence: "dynamic" },
        { path: "flag", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("preserves direct mixed lookup path branch bases", () => {
    expect(
      sortPaths(
        extractPaths(
          '(flag ? {"x": {"fixed": customer}} : fallback) ~> $lookup("x").fixed.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.fixed.name", confidence: "static" },
        { path: "flag", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          '(flag ? {"x": {"fixed": customer}} : fallback) ~> $lookup(key).fixed.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "customer", confidence: "static" },
        { path: "customer.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback[*]", confidence: "dynamic" },
        { path: "fallback[*].fixed.name", confidence: "dynamic" },
        { path: "flag", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("preserves $lookup dynamic object aliases with dynamic lookup keys", () => {
    expect(sortPaths(extractPaths("$lookup({key: primary}, lookupKey).name"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "lookupKey", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed static and dynamic $lookup object aliases", () => {
    expect(
      sortPaths(extractPaths('$lookup({key: primary, "fixed": fallback}, "fixed").name')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds $lookup dynamic object-key result aliases as variables", () => {
    expect(
      sortPaths(extractPaths('($p := $lookup({key: primary}, "x"); $p.name)')),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds mixed $lookup path branches as suffixable variables", () => {
    expect(
      sortPaths(
        extractPaths(
          '($p := $lookup(flag ? {"x": primary} : fallback, "x"); $p.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves thunked custom function $clone dynamic object aliases", () => {
    expect(
      sortPaths(extractPaths("($f := function(){$clone({key: primary})}; $f().x.name)")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves thunked custom function $merge dynamic object aliases", () => {
    expect(
      sortPaths(
        extractPaths(
          "($f := function(){$merge([{key: primary}, {key: fallback}])}; $f().x.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves thunked custom function $map dynamic object aliases", () => {
    expect(
      sortPaths(
        extractPaths("($f := function(){$map(items, function($v){{key: $v}})}; $f().x.name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("preserves constructed object aliases in sort terms", () => {
    expect(sortPaths(extractPaths("([{key: primary}])^(>x.name).x.name"))).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound constructed object aliases in sort terms", () => {
    expect(
      sortPaths(extractPaths("($o := [{key: primary}]; $o^(>x.name).x.name)")),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves constructed object aliases inside function sort terms", () => {
    expect(
      sortPaths(
        extractPaths("([{key: primary}])^(>$substring(x.name, 0, 1)).x.name"),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable-bound constructed object aliases inside function sort terms", () => {
    expect(
      sortPaths(
        extractPaths(
          "($o := [{key: primary}]; $o^(>$substring(x.name, 0, 1)).x.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves conditional object aliases in direct chained fields", () => {
    expect(
      sortPaths(extractPaths('(flag ? {"x": primary} : {"x": fallback}).x.name')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed conditional object aliases with path branches", () => {
    expect(sortPaths(extractPaths('(flag ? {"x": primary} : fallback).x.name'))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves Elvis object aliases in direct chained fields", () => {
    expect(
      sortPaths(extractPaths('(({"x": primary}) ?: ({"x": fallback})).x.name')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves coalescing object aliases in direct chained fields", () => {
    expect(
      sortPaths(extractPaths('(({"x": primary}) ?? ({"x": fallback})).x.name')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves array object aliases in direct chained fields", () => {
    expect(
      sortPaths(extractPaths('([{"x": primary}, {"x": fallback}]).x.name')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed array object aliases with path elements", () => {
    expect(sortPaths(extractPaths('([{"x": primary}, fallback]).x.name'))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds mixed array object aliases with path elements", () => {
    expect(
      sortPaths(extractPaths('($o := [{"x": primary}, fallback]; $o.x.name)')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds conditional object aliases as suffixable variables", () => {
    expect(
      sortPaths(
        extractPaths('($o := flag ? {"x": primary} : {"x": fallback}; $o.x.name)'),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("binds mixed conditional object aliases with path branches", () => {
    expect(
      sortPaths(extractPaths('($o := flag ? {"x": primary} : fallback; $o.x.name)')),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $map callback object aliases in chained fields", () => {
    expect(
      sortPaths(extractPaths('$map(items, function($v) { {"x": $v.detail} }).x.name')),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $map callback object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths('$map(items, function($v){flag ? {"x": $v.detail} : fallback}).x.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("uses variable-bound mixed projection results as higher-order input bases", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := flag ? {"x": primary} : fallback; $map(($r.x.{"node": name}.node), function($v){$v.name}))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "fallback.x.node", confidence: "static" },
        { path: "fallback.x.node.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
        { path: "primary.node", confidence: "static" },
        { path: "primary.node.name", confidence: "static" },
      ]),
    );
  });

  it("preserves unmatched mixed $map callback suffix bases", () => {
    expect(
      sortPaths(
        extractPaths('$map(items, function($v){flag ? {"x": $v.detail} : fallback}).y.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.y.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed array element suffix bases in $map callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map([flag ? {"x": detail} : fallback], function($v){$v.x.children.name})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "flag", confidence: "static" },
      ]),
    );
  });

  it("uses direct mixed result alias suffixes as $map callback input bases", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map((flag ? {"x": detail} : fallback).x.children, function($v){%.rank & $v.name})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "detail.rank", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
      ]),
    );
  });

  it("uses direct mixed result alias suffixes as custom function parent bases", () => {
    expect(
      sortPaths(
        extractPaths(
          '($fn := function($v){%.rank & $v.name}; $fn((flag ? {"x": detail} : fallback).x.children))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "detail.rank", confidence: "static" },
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.children", confidence: "static" },
        { path: "fallback.x.children.name", confidence: "static" },
        { path: "fallback.x.rank", confidence: "static" },
        { path: "flag", confidence: "static" },
      ]),
    );
  });

  it("binds mixed $map callback object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $map(items, function($v){flag ? {"x": $v.detail} : fallback}); $r.x.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves apply-chain $map callback object aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths('(items ~> $map(function($v) { {"x": $v.detail} })).x.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $each callback object aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths('$each(record, function($v) { {"x": $v.detail} }).x.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.*.detail", confidence: "static" },
        { path: "record.*.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves custom function object aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths('($project := function($v) { {"x": $v.detail} }; $project(item).x.name)'),
      ),
    ).toEqual(
      sortPaths([
        { path: "item", confidence: "static" },
        { path: "item.detail", confidence: "static" },
        { path: "item.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed custom function object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths(
          '($fn := function($v){flag ? {"x": $v.detail} : fallback}; $fn(item).x.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "item", confidence: "static" },
        { path: "item.detail", confidence: "static" },
        { path: "item.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed inline function object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths('function($v){flag ? {"x": $v.detail} : fallback}(item).x.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "item", confidence: "static" },
        { path: "item.detail", confidence: "static" },
        { path: "item.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed custom function dynamic object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths(
          "($fn := function($v){flag ? {key: $v.detail} : fallback}; $fn(item).x.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "item", confidence: "static" },
        { path: "item.detail", confidence: "static" },
        { path: "item.detail.name", confidence: "static" },
        { path: "key", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $each callback object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths('$each(record, function($v) { flag ? {"x": $v.detail} : fallback }).x.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.*.detail", confidence: "static" },
        { path: "record.*.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves custom function dynamic object-key reads inside projected result aliases", () => {
    expect(
      sortPaths(
        extractPaths(
          '($fn := function($v){{"out": $v.x.name}}; $fn({(key): primary}).out)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves custom function path projection object aliases", () => {
    expect(
      sortPaths(
        extractPaths(
          '($fn := function($v){$v.{"out": x.name}}; $fn({(key): primary}).out)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "key", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("preserves $reduce callback object aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths('$reduce(items, function($acc, $v) { {"x": $v.detail} }, seed).x.name'),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.x.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $reduce callback object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths(
          '$reduce(items, function($acc, $v) { flag ? {"x": $v.detail} : fallback }, seed).x.name',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.x.name", confidence: "static" },
      ]),
    );
  });

  it("binds mixed $reduce callback object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := $reduce(items, function($acc, $v) { flag ? {"x": $v.detail} : fallback }, seed); $r.x.name)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.x.name", confidence: "static" },
      ]),
    );
  });

  it("preserves mixed $reduce callback dynamic object aliases with path results", () => {
    expect(
      sortPaths(
        extractPaths(
          "$reduce(items, function($acc, $v) { flag ? {key: $v.detail} : fallback }, seed).x.name",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
        { path: "key", confidence: "static" },
        { path: "seed", confidence: "static" },
        { path: "seed.x.name", confidence: "static" },
      ]),
    );
  });

  it("invokes variable-bound functions on bare apply RHS", () => {
    expect(
      sortPaths(extractPaths("($project := function($x) { $x.name }; items ~> $project)")),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable apply result aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths("($project := function($x) { $x.detail }; (items ~> $project).name)"),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("preserves variable apply object aliases in chained fields", () => {
    expect(
      sortPaths(
        extractPaths('($project := function($x) { {"k": $x.detail} }; (items ~> $project).k.name)'),
      ),
    ).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.detail", confidence: "static" },
        { path: "items.detail.name", confidence: "static" },
      ]),
    );
  });

  it("invokes variable-bound partials on bare apply RHS", () => {
    expect(
      sortPaths(extractPaths("($f := $lookup(products, ?); (sku ~> $f).name)")),
    ).toEqual(
      sortPaths([
        { path: "products", confidence: "static" },
        { path: "products[*]", confidence: "dynamic" },
        { path: "products[*].name", confidence: "dynamic" },
        { path: "sku", confidence: "static" },
      ]),
    );
  });
});
