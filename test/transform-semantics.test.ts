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
