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

  it("extracts captured reads from variable-bound replacement callbacks", () => {
    expect(
      sortPaths(
        extractPaths(
          "($replacer := function($match){$match.match & config.suffix}; " +
            "$replace(text, /x/, $replacer))",
        ),
      ),
    ).toEqual(
      sortPaths([
        { path: "text", confidence: "static" },
        { path: "config.suffix", confidence: "static" },
      ]),
    );
  });

  it("extracts captured reads from variable-bound matcher callbacks", () => {
    const matcher =
      "$matcher := function($str){config.needle ? /x/($str) : /z/($str)}; ";
    for (const [call, expected] of [
      ["$contains(text, $matcher)", ["text", "config.needle"]],
      [
        "$match(text, $matcher, options.limit)",
        ["text", "config.needle", "options.limit"],
      ],
      [
        "$split(text, $matcher, options.limit)",
        ["text", "config.needle", "options.limit"],
      ],
      ["$replace(text, $matcher, \"_\")", ["text", "config.needle"]],
    ] as const) {
      expect(
        sortPaths(extractPaths(`(${matcher}${call})`)),
      ).toEqual(
        sortPaths(
          expected.map((path) => ({
            path,
            confidence: "static" as const,
          })),
        ),
      );
    }
  });
});
