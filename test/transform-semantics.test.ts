import { describe, expect, it } from "vitest";
import { extractPaths } from "../src/index.js";
import { parse } from "../src/parser.js";
import { sortPaths } from "./integration/helpers.js";

describe("transform semantics", () => {
  it("normalizes transform expressions", () => {
    expect(parse('| account | {"status": "active"} |')).toMatchObject({
      type: "transform",
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

  it("extracts nested transform reads under the piped input", () => {
    expect(
      sortPaths(
        extractPaths('payload ~> |Account|{"order": |Order|{"total": Price * Qty}|}|'),
      ),
    ).toEqual(
      sortPaths([
        { path: "payload", confidence: "static" },
        { path: "payload.Account", confidence: "static" },
        { path: "payload.Account.Order", confidence: "static" },
        { path: "payload.Account.Order.Price", confidence: "static" },
        { path: "payload.Account.Order.Qty", confidence: "static" },
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
