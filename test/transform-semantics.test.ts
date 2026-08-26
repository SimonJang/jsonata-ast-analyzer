import { describe, expect, it } from "vitest";
import { extractPaths } from "../src/index.js";
import { parse } from "../src/parser.js";
import { sortPaths } from "./integration/helpers.js";

describe("transform semantics", () => {
  it("invokes callable fields produced by transform updates", () => {
    for (const [update, selector] of [
      ['{"apply":function($x){$x.children.name}}', "apply"],
      [
        '{"ops":{"apply":function($x){$x.children.name}}}',
        "ops.apply",
      ],
    ] as const) {
      expect(
        sortPaths(
          extractPaths(
            `($t := |node|${update}|; ($t(record).node.${selector})(detail))`,
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: "record", confidence: "static" },
          { path: "record.node", confidence: "static" },
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("captures transform match context in produced callable fields", () => {
    expect(
      sortPaths(
        extractPaths(
          "($t := |node|" +
            '{"apply":function($x){name & $x.children.name}}|; ' +
            "($t(record).node.apply)(detail))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.node", confidence: "static" },
        { path: "record.node.name", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("invokes builtin fields produced by transform updates", () => {
    expect(
      sortPaths(
        extractPaths(
          '($t := |node|{"apply":$clone}|; ' +
            "(($t(record).node.apply)(detail)).children.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.node", confidence: "static" },
        { path: "detail", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
      ]),
    );
  });

  it("invokes callable fields produced at wildcard and union transform locations", () => {
    for (const [pattern, update, resultSuffix, expectedLocations] of [
      [
        "record.*",
        '{"apply":function($x){$x.children.name}}',
        "",
        ["payload.record.*"],
      ],
      [
        "[record.first, record.second]",
        '{"apply":$clone}',
        ".children.name",
        ["payload.record.first", "payload.record.second"],
      ],
    ] as const) {
      expect(
        sortPaths(
          extractPaths(
            `($t := |${pattern}|${update}|; ` +
              `(($t(payload).record.first.apply)(detail))${resultSuffix})`,
          ),
        ),
      ).toEqual(
        sortPaths([
          { path: "payload", confidence: "static" },
          ...expectedLocations.map((path) => ({
            path,
            confidence: "static" as const,
          })),
          { path: "detail", confidence: "static" },
          { path: "detail.children.name", confidence: "static" },
        ]),
      );
    }
  });

  it("resolves data values bound later in the transform closure frame", () => {
    expect(
      sortPaths(
        extractPaths(
          "($transform := |children|{\"seen\":$later.name}|; " +
            "$later := detail; $transform(record).children.seen)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.name", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.children", confidence: "static" },
      ]),
    );

    expect(
      sortPaths(
        extractPaths(
          "($transform := |children|{\"seen\":$later.children}|; " +
            "$later := detail; " +
            "$transform(record).children.seen.name)",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "detail", confidence: "static" },
        { path: "detail.children", confidence: "static" },
        { path: "detail.children.name", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.children", confidence: "static" },
      ]),
    );
  });

  it("normalizes transform expressions", () => {
    expect(parse('| account | {"status": "active"} |')).toMatchObject({
      type: "transform",
    });
  });

  it("preserves inline transform procedures while normalizing calls and partials", () => {
    expect(parse('|first|{"seen": name}|(record)')).toMatchObject({
      type: "function",
      procedure: { type: "transform" },
    });
    expect(parse('|first|{"seen": name}|(?)')).toMatchObject({
      type: "partial",
      procedure: { type: "transform" },
    });
  });

  it("extracts piped transform input, location, and update reads", () => {
    expect(
      sortPaths(
        extractPaths('payload ~> |Account.Order.Product|{"Price": Price * 1.2}|'),
      ),
    ).toEqual(
      sortPaths([
        { path: "payload", confidence: "static" },
        { path: "payload.Account.Order.Product", confidence: "static" },
        { path: "payload.Account.Order.Product.Price", confidence: "static" },
      ]),
    );
  });

  it("preserves the whole document dependency when transforming the root", () => {
    expect(
      sortPaths(extractPaths('$ ~> |Account|{"name": name}|')),
    ).toEqual(
      sortPaths([
        { path: "**", confidence: "static" },
        { path: "Account", confidence: "static" },
        { path: "Account.name", confidence: "static" },
      ]),
    );
  });

  it("does not execute a transform when it is only bound as a value", () => {
    expect(extractPaths('($t := |first|{"seen": name}|; 1)')).toEqual([]);
  });

  it("executes a variable-bound transform against its call argument", () => {
    expect(
      sortPaths(
        extractPaths('($t := |first|{"seen": name}|; $t(record).first.seen)'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("preserves the whole document when a variable-bound transform receives root", () => {
    expect(
      sortPaths(extractPaths('($t := |record.first|{"seen": name}|; $t($))')),
    ).toEqual(
      sortPaths([
        { path: "**", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("rebases a variable-bound transform used as a path function step", () => {
    expect(
      sortPaths(extractPaths('($t := |first|{"seen": name}|; account.$t($))')),
    ).toEqual(
      sortPaths([
        { path: "account", confidence: "static" },
        { path: "account.first", confidence: "static" },
        { path: "account.first.name", confidence: "static" },
      ]),
    );
  });

  it("keeps reads of unchanged fields selected from a transform result", () => {
    expect(
      sortPaths(
        extractPaths('($t := |first|{"seen": name}|; $t(record).second.name)'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
        { path: "record.second.name", confidence: "static" },
      ]),
    );
  });

  it("keeps captured transform reads absolute at the call site", () => {
    expect(
      sortPaths(
        extractPaths(
          '($suffix := config.suffix; $t := |first|{"seen": $suffix}|; $t(record))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.suffix", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
      ]),
    );
  });

  it("maps a suffix on a written transform value back to its source", () => {
    expect(
      sortPaths(
        extractPaths(
          '($t := |first|{"seen": detail}|; $t(record).first.seen.rank)',
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

  it("maps a suffix through an object constructed by a transform update", () => {
    expect(
      sortPaths(
        extractPaths(
          '($t := |first|{"seen": {"rank": detail.rank}}|; $t(record).first.seen.rank)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
      ]),
    );
  });

  it("executes a variable-bound transform used as a map callback", () => {
    expect(
      sortPaths(
        extractPaths('($t := |first|{"seen": name}|; $map([record], $t))'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("traces a transform callback through a map result selection", () => {
    expect(
      sortPaths(
        extractPaths(
          '($t := |first|{"seen": name}|; $map([record], $t).first.seen)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("maps a deep map-transform result selection back to its update source", () => {
    expect(
      sortPaths(
        extractPaths(
          '($t := |first|{"seen": detail}|; $map([record], $t).first.seen.rank)',
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

  it("executes a transform callback in a piped map call", () => {
    expect(
      sortPaths(
        extractPaths('($t := |first|{"seen": name}|; [record] ~> $map($t))'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("executes inline and selected transform values as map callbacks", () => {
    for (const expression of [
      '$map([record], |first|{"seen": name}|).first.seen',
      '[record] ~> $map(|first|{"seen": name}|).first.seen',
      '($ts := [|first|{"seen": name}|]; $map([record], $ts[0]).first.seen)',
      '$map([record], $lookup({"apply": |first|{"seen": name}|}, "apply")).first.seen',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "record", confidence: "static" },
          { path: "record.first", confidence: "static" },
          { path: "record.first.name", confidence: "static" },
        ]),
      );
    }
  });

  it("traces all transform-only conditional map callback branches", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map([record], config.enabled ? |first|{"seen": name}| : |first|{"seen": detail}|).first.seen',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.enabled", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.detail", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("traces mixed transform and lambda map callback branches", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map([record], config.enabled ? |first|{"seen": name}| : function($x){$x.first.detail.rank})',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.enabled", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("maps deep inline transform callback results to their update sources", () => {
    expect(
      sortPaths(
        extractPaths(
          '$map([record], |first|{"seen": detail}|).first.seen.rank',
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

  it("executes inline and bound transform partials as map callbacks", () => {
    for (const expression of [
      '$map([record], |first|{"seen": name}|(?)).first.seen',
      '($p := |first|{"seen": name}|(?); $map([record], $p).first.seen)',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "record", confidence: "static" },
          { path: "record.first", confidence: "static" },
          { path: "record.first.name", confidence: "static" },
        ]),
      );
    }

    expect(
      sortPaths(
        extractPaths(
          '$map([record], |first|{"seen": detail}|(?)).first.seen.rank',
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

  it("executes an inline transform function", () => {
    expect(
      sortPaths(extractPaths('|first|{"seen": name}|(record)')),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("executes a parenthesized inline transform function", () => {
    expect(
      sortPaths(extractPaths('(|first|{"seen": name}|)(record)')),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("executes an inline transform through partial application", () => {
    expect(
      sortPaths(
        extractPaths('($p := |first|{"seen": name}|(?); $p(record))'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("maps a written result selected from an inline transform", () => {
    expect(
      sortPaths(
        extractPaths('|first|{"seen": name}|(record).first.seen'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("maps a written result selected from an inline transform partial", () => {
    expect(
      sortPaths(
        extractPaths(
          '($p := |first|{"seen": name}|(?); $p(record).first.seen)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("traces a transform selected by a conditional procedure", () => {
    expect(
      sortPaths(
        extractPaths(
          '(config.enabled ? |first|{"seen": name}| : function($x){$x})(record)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.enabled", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("maps output selections through every transform-only conditional branch", () => {
    expect(
      sortPaths(
        extractPaths(
          '(config.enabled ? |first|{"seen": detail}| : |first|{"seen": name}|)(record).first.seen.rank',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.enabled", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.detail", confidence: "static" },
        { path: "record.first.detail.rank", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
        { path: "record.first.name.rank", confidence: "static" },
      ]),
    );
  });

  it("traces a conditional transform through partial application", () => {
    expect(
      sortPaths(
        extractPaths(
          '($p := (config.enabled ? |first|{"seen": name}| : function($x){$x})(?); $p(record))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.enabled", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("reads a conditional procedure when creating an unused partial", () => {
    expect(
      extractPaths(
        '($p := (config.enabled ? |first|{"seen": name}| : function($x){$x})(?); 1)',
      ),
    ).toEqual([{ path: "config.enabled", confidence: "static" }]);
  });

  it("does not execute a transform merely returned by a function", () => {
    expect(
      extractPaths('($maker := function(){|first|{"seen": name}|}; $maker())'),
    ).toEqual([]);
  });

  it("executes a transform returned by a custom function", () => {
    expect(
      sortPaths(
        extractPaths(
          '($maker := function(){|first|{"seen": name}|}; $maker()(record))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("executes a transform returned by an inline function", () => {
    expect(
      sortPaths(
        extractPaths('(function(){|first|{"seen": name}|})()(record)'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("traces selection used to return a transform", () => {
    expect(
      sortPaths(
        extractPaths(
          '($maker := function($flag){$flag ? |first|{"seen": name}| : function($x){$x}}; $maker(config.enabled)(record))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.enabled", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("does not execute transforms stored in an unused array", () => {
    expect(
      extractPaths('($transforms := [|first|{"seen": name}|]; 1)'),
    ).toEqual([]);
  });

  it("does not execute transforms while constructing callable containers", () => {
    expect(extractPaths('[|first|{"seen": name}|]')).toEqual([]);
    expect(extractPaths('{"apply": |first|{"seen": name}|}')).toEqual([]);
  });

  it("does not execute callable branches when only selecting a function value", () => {
    expect(
      extractPaths(
        'config.enabled ? |first|{"seen": name}| : function($x){$x.first.name}',
      ),
    ).toEqual([{ path: "config.enabled", confidence: "static" }]);
  });

  it("executes a transform selected from a stored array", () => {
    expect(
      sortPaths(
        extractPaths(
          '($transforms := [|first|{"seen": name}|]; $transforms[0](record))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("reads a dynamic index used to select a stored transform", () => {
    expect(
      sortPaths(
        extractPaths(
          '($transforms := [|first|{"seen": name}|]; $transforms[config.index](record))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.index", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("executes a transform selected from an inline object", () => {
    expect(
      sortPaths(
        extractPaths('({"apply": |first|{"seen": name}|}.apply)(record)'),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("executes a transform selected from a stored object", () => {
    expect(
      sortPaths(
        extractPaths(
          '($operations := {"apply": |first|{"seen": name}|}; $operations.apply(record))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("executes a transform selected by static lookup", () => {
    expect(
      sortPaths(
        extractPaths(
          '$lookup({"apply": |first|{"seen": name}|}, "apply")(record)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("executes a stored transform selected by dynamic lookup", () => {
    expect(
      sortPaths(
        extractPaths(
          '($operations := {"apply": |first|{"seen": name}|}; $lookup($operations, config.operation)(record))',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.operation", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("maps stored-object transform output fields back to their update sources", () => {
    for (const expression of [
      '({"apply": |first|{"seen": name}|}.apply)(record).first.seen',
      '($operations := {"apply": |first|{"seen": name}|}; $operations.apply(record).first.seen)',
      '$lookup({"apply": |first|{"seen": name}|}, "apply")(record).first.seen',
    ]) {
      expect(sortPaths(extractPaths(expression))).toEqual(
        sortPaths([
          { path: "record", confidence: "static" },
          { path: "record.first", confidence: "static" },
          { path: "record.first.name", confidence: "static" },
        ]),
      );
    }
  });

  it("maps dynamically looked-up transform output fields back to their update sources", () => {
    expect(
      sortPaths(
        extractPaths(
          '($operations := {"apply": |first|{"seen": name}|}; $lookup($operations, config.operation)(record).first.seen)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "config.operation", confidence: "static" },
        { path: "record", confidence: "static" },
        { path: "record.first", confidence: "static" },
        { path: "record.first.name", confidence: "static" },
      ]),
    );
  });

  it("extracts dynamic delete expression reads", () => {
    expect(
      sortPaths(
        extractPaths(
          '| account | {"displayName": firstName & " " & lastName}, [oldFields.password] |',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "account", confidence: "static" },
        { path: "account.firstName", confidence: "static" },
        { path: "account.lastName", confidence: "static" },
        { path: "account.oldFields.password", confidence: "static" },
      ]),
    );
  });

  it("does not use transform predicate reads as update prefixes", () => {
    expect(
      sortPaths(
        extractPaths('| Account#$i[$i = 0 and active] | {"name": name} |'),
      ),
    ).toEqual(
      sortPaths([
        { path: "Account", confidence: "static" },
        { path: "Account.active", confidence: "static" },
        { path: "Account.name", confidence: "static" },
      ]),
    );
  });

  it("does not use piped transform predicate reads as update prefixes", () => {
    expect(
      sortPaths(
        extractPaths('payload ~> |Account[active]|{"name": name}|'),
      ),
    ).toEqual(
      sortPaths([
        { path: "payload", confidence: "static" },
        { path: "payload.Account", confidence: "static" },
        { path: "payload.Account.active", confidence: "static" },
        { path: "payload.Account.name", confidence: "static" },
      ]),
    );
  });

  it("does not use array transform predicate reads as update prefixes", () => {
    expect(
      sortPaths(extractPaths('| [Account]#$i[active] | {"name": name} |')),
    ).toEqual(
      sortPaths([
        { path: "Account", confidence: "static" },
        { path: "Account.active", confidence: "static" },
        { path: "Account.name", confidence: "static" },
      ]),
    );
  });

  it("does not use piped array transform predicate reads as update prefixes", () => {
    expect(
      sortPaths(
        extractPaths('payload ~> |[Account]#$i[active]|{"name": name}|'),
      ),
    ).toEqual(
      sortPaths([
        { path: "payload", confidence: "static" },
        { path: "payload.Account", confidence: "static" },
        { path: "payload.Account.active", confidence: "static" },
        { path: "payload.Account.name", confidence: "static" },
      ]),
    );
  });

  it("uses block projection transform patterns as update prefixes", () => {
    expect(
      sortPaths(
        extractPaths('payload ~> |orders.items.(price)|{"name": name}|'),
      ),
    ).toEqual(
      sortPaths([
        { path: "payload", confidence: "static" },
        { path: "payload.orders.items.price", confidence: "static" },
        { path: "payload.orders.items.price.name", confidence: "static" },
      ]),
    );
  });

  it("uses variable-bound projection transform patterns as update prefixes", () => {
    expect(
      sortPaths(
        extractPaths(
          '($p := orders.items.(price); payload ~> |$p|{"name": name}|)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "orders.items.price", confidence: "static" },
        { path: "payload", confidence: "static" },
        { path: "payload.orders.items.price", confidence: "static" },
        { path: "payload.orders.items.price.name", confidence: "static" },
      ]),
    );
  });

  it("uses variable-bound object projection transform patterns as update prefixes", () => {
    expect(
      sortPaths(
        extractPaths(
          '($p := orders.items.({"x": price}); payload ~> |$p.x|{"name": name}|)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "orders.items.price", confidence: "static" },
        { path: "payload", confidence: "static" },
        { path: "payload.orders.items.price", confidence: "static" },
        { path: "payload.orders.items.price.name", confidence: "static" },
      ]),
    );
  });

  it("uses variable-bound mixed object aliases as transform pattern context", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := flag ? {"x": primary} : fallback; $r ~> |x|{"name": name}|)',
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

  it("does not treat path-valued transform aliases as their own parent", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := flag ? {"x": primary} : fallback; $r ~> |x|{"parent": %.rank, "name": name}|)',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "fallback.rank", confidence: "static" },
        { path: "fallback.x", confidence: "static" },
        { path: "fallback.x.name", confidence: "static" },
        { path: "flag", confidence: "static" },
        { path: "primary", confidence: "static" },
        { path: "primary.name", confidence: "static" },
      ]),
    );
  });

  it("uses mixed alias projection transform patterns as update context", () => {
    expect(
      sortPaths(
        extractPaths(
          '($r := flag ? {"x": primary} : fallback; $r ~> |x.{"node": name}.node|{"copy": name}|)',
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

  it("prefixes root update reads with the transform pattern", () => {
    expect(
      sortPaths(extractPaths('payload ~> |Account|{"id": $.rootId}|')),
    ).toEqual(
      sortPaths([
        { path: "payload", confidence: "static" },
        { path: "payload.Account", confidence: "static" },
        { path: "payload.Account.rootId", confidence: "static" },
      ]),
    );
  });

  it("preserves bare root update reads as the transform pattern", () => {
    expect(sortPaths(extractPaths('payload ~> |Account|{"copy": $}|'))).toEqual(
      sortPaths([
        { path: "payload", confidence: "static" },
        { path: "payload.Account", confidence: "static" },
      ]),
    );
  });

  it("prefixes root delete reads with the transform pattern", () => {
    expect(
      sortPaths(extractPaths('payload ~> |Account|{}, [$.oldFields.password]|')),
    ).toEqual(
      sortPaths([
        { path: "payload", confidence: "static" },
        { path: "payload.Account", confidence: "static" },
        { path: "payload.Account.oldFields.password", confidence: "static" },
      ]),
    );
  });

  it("does not report literal delete targets as input reads", () => {
    expect(extractPaths('| account | {"status": "archived"}, ["password"] |')).toEqual([
      { path: "account", confidence: "static" },
    ]);
  });

  it("does not execute a nested transform stored by a piped update", () => {
    expect(
      sortPaths(
        extractPaths('payload ~> |Account|{"order": |Order|{"total": Price * Qty}|}|'),
      ),
    ).toEqual(
      sortPaths([
        { path: "payload", confidence: "static" },
        { path: "payload.Account", confidence: "static" },
      ]),
    );
  });

  it("prefixes transform update reads for every pattern path", () => {
    expect(
      sortPaths(extractPaths('| [Account, Contact] | {"display": name} |')),
    ).toEqual(
      sortPaths([
        { path: "Account", confidence: "static" },
        { path: "Account.name", confidence: "static" },
        { path: "Contact", confidence: "static" },
        { path: "Contact.name", confidence: "static" },
      ]),
    );
  });
});
