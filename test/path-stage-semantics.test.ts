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
