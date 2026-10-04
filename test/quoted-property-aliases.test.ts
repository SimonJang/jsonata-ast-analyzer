import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, second: { nested: { total: 20 } } };
const sorted = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));
const expected = (source: "first" | "second") => [
  { path: "first", confidence: "static", coverage: "exact" },
  { path: "second", confidence: "static", coverage: "exact" },
  { path: `${source}.nested`, confidence: "static", coverage: "subtree" },
].sort((a, b) => a.path.localeCompare(b.path));

describe("quoted property alias segments", () => {
  it.each([
    ['($v:={"a.b":first,"a":{"b":second}};$v.`a.b`.nested)', "first"],
    ['($v:={"a.b":first,"a":{"b":second}};$v.a.b.nested)', "second"],
    ['($v:={"a":{"b":second},"a.b":first};$v.a.b.nested)', "second"],
    ['($v:={"a":{"b":second},"a.b":first};$v.`a.b`.nested)', "first"],
    ['($v:={"a.b":first,"a":{"b":second}};$lookup($v,"a.b").nested)', "first"],
    ['($v:={"a.b":first,"a":{"b":second}};$v.(`a.b`.nested))', "first"],
    ['($v:={"a.b":first,"a":{"b":second}};$v.(a.b.nested))', "second"],
    ['($v:={"a.b":first,"a":{"b":second}};$v.a.*.nested)', "second"],
    ['($v:={"":{"b":first},".b":second};$v.``.b.nested)', "first"],
    ['($v:={"":{"b":first},".b":second};$v.`.b`.nested)', "second"],
    ['($v:={"a.b":first,"a%2Eb":second};$v.`a.b`.nested)', "first"],
    ['($v:={"a.b":first,"a%2Eb":second};$v.`a%2Eb`.nested)', "second"],
    ['($f:=function(){{"a.b":first,"a":{"b":second}}};$f().`a.b`.nested)', "first"],
    ['(function($v){$v.`a.b`.nested})({"a.b":first,"a":{"b":second}})', "first"],
    ['$map([{"a.b":first,"a":{"b":second}}],function($v){$v.`a.b`.nested})', "first"],
    ['$reduce([{"a.b":first,"a":{"b":second}}],function($a,$v){$v.`a.b`.nested},0)', "first"],
  ] as const)("keeps literal and structural segments distinct in %s", async (expression, source) => {
    expect(await jsonata(expression).evaluate(input)).toEqual(input[source].nested);
    expect(sorted(expression)).toEqual(expected(source));
  });

  it.each(["a.b", "a%2Eb", "*", "**", "%", "[*]", ""])
    ("selects literal %s names inside block and object projections", async (key) => {
      const field = JSON.stringify(key);
      const selector = `\`${key}\``;
      const block = `($v:={${field}:first,"other":second};$v.(${selector}.nested))`;
      const object = `($v:={${field}:first,"other":second};$v.{"copy":${selector}.nested})`;
      expect(await jsonata(block).evaluate(input)).toEqual(input.first.nested);
      expect(await jsonata(object).evaluate(input)).toEqual({ copy: input.first.nested });
      expect(sorted(block)).toEqual(expected("first"));
      expect(sorted(object)).toEqual(expected("first"));
    });

  it.each(["a..b", "a[*]", "**", "%", "*", ""])("keeps missing quoted %s fields absent", async (key) => {
    const expression = `($v:={"copy":first,"other":second};$v.(\`${key}\`))`;
    expect(await jsonata(expression).evaluate(input)).toBeUndefined();
    expect(sorted(expression)).toEqual([
      { path: "first", confidence: "static", coverage: "exact" },
      { path: "second", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each([
    ['$v.`a.b`.pick.nested', "first"],
    ['$v.a.b.pick.nested', "second"],
    ['$v.(`a.b`.pick.nested)', "first"],
  ] as const)("retains computed aliases beneath literal and nested prefixes in %s", async (selector, source) => {
    const expression = `($v:={"a.b":{(key):first},"a":{"b":{(key):second}}};${selector})`;
    expect(await jsonata(expression).evaluate({ ...input, key: "pick" })).toEqual(input[source].nested);
    expect(sorted(expression)).toEqual([
      ...expected(source),
      { path: "key", confidence: "static", coverage: "exact" },
    ].sort((a, b) => a.path.localeCompare(b.path)));
  });

  it.each([
    ['record.{"a.b":first,"a":{"b":second}}.`a.b`.nested', false],
    ['record.{"a.b":first,"a":{"b":second}}.(`a.b`.nested)', true],
    ['($v:=record{"a.b":first,"a":{"b":second}};$v.`a.b`.nested)', true],
    ['($v:=record{"a.b":first,"a":{"b":second}};$v.(`a.b`.nested))', true],
  ] as const)("preserves quoted selections in constructed path results for %s", async (expression, readsParent) => {
    expect(await jsonata(expression).evaluate({ record: input })).toEqual(input.first.nested);
    expect(sorted(expression)).toEqual([
      ...(readsParent ? [{ path: "record", confidence: "static", coverage: "exact" }] : []),
      { path: "record.first", confidence: "static", coverage: "exact" },
      { path: "record.first.nested", confidence: "static", coverage: "subtree" },
      { path: "record.second", confidence: "static", coverage: "exact" },
    ]);
  });
});
