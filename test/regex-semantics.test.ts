import { describe, expect, it } from "vitest";
import { extractPaths } from "../src/index.js";
import { parse } from "../src/parser.js";
import { sortPaths } from "./integration/helpers.js";

describe("regex semantics", () => {
  it("normalizes regex literals without producing input paths", () => {
    expect(parse("/urgent/i")).toMatchObject({ type: "regex" });
    expect(extractPaths("/urgent/i")).toEqual([]);
  });

  it("extracts matched string paths in regex predicates", () => {
    expect(
      sortPaths(extractPaths("Account.Order.Product[`Product Name` ~> /hat/i]")),
    ).toEqual(
      sortPaths([
        { path: "Account.Order.Product", confidence: "static" },
        { path: "Account.Order.Product.Product Name", confidence: "static" },
      ]),
    );
  });

  it("extracts string argument paths from regex helper built-ins", () => {
    expect(
      sortPaths(
        extractPaths(
          '$contains(Customer.Email, /@example\\.com$/) and $match(description, /urgent/i) and $replace(notes, /\\s+/, " ")',
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "Customer.Email", confidence: "static" },
        { path: "description", confidence: "static" },
        { path: "notes", confidence: "static" },
      ]),
    );
  });

  it("threads regex-as-function apply chains", () => {
    expect(extractPaths("description ~> /urgent/i")).toEqual([
      { path: "description", confidence: "static" },
    ]);
  });
});
