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
});
