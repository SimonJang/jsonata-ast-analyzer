import { describe, expect, it } from "vitest";
import { extractPaths } from "../src/index.js";
import { sortPaths } from "./integration/helpers.js";

describe("constructor and fallback precision", () => {
  it("deduplicates null coalescing when the fallback is literal", () => {
    expect(extractPaths("foo.bar ?? 42")).toEqual([
      { path: "foo.bar", confidence: "static" },
    ]);
  });

  it("deduplicates Elvis when the fallback is literal", () => {
    expect(extractPaths("foo.bar ?: 'default'")).toEqual([
      { path: "foo.bar", confidence: "static" },
    ]);
  });

  it("preserves predicate reads on fallback expressions", () => {
    expect(sortPaths(extractPaths("items[active].price ?: fallback"))).toEqual(
      sortPaths([
        { path: "fallback", confidence: "static" },
        { path: "items.active", confidence: "static" },
        { path: "items.price", confidence: "static" },
      ]),
    );
  });

  it("walks array constructors used as path steps", () => {
    expect(sortPaths(extractPaths("Email.[address]"))).toEqual(
      sortPaths([
        { path: "Email", confidence: "static" },
        { path: "Email.address", confidence: "static" },
      ]),
    );
  });

  it("extracts computed object constructor keys", () => {
    expect(sortPaths(extractPaths("{customer.id: customer.name}"))).toEqual(
      sortPaths([
        { path: "customer.id", confidence: "static" },
        { path: "customer.name", confidence: "static" },
      ]),
    );
  });

  it("extracts computed object projection keys with context", () => {
    expect(sortPaths(extractPaths("items.{category: price}"))).toEqual(
      sortPaths([
        { path: "items", confidence: "static" },
        { path: "items.category", confidence: "static" },
        { path: "items.price", confidence: "static" },
      ]),
    );
  });

  it("preserves grouping key and keep-array value reads", () => {
    expect(sortPaths(extractPaths("Phone{type:number[]}"))).toEqual(
      sortPaths([
        { path: "Phone", confidence: "static" },
        { path: "Phone.number", confidence: "static" },
        { path: "Phone.type", confidence: "static" },
      ]),
    );
  });
});
