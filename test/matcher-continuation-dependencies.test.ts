import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

describe("custom matcher continuations", () => {
  it.each([
    ["$match(text,$matcher)", { match: "x", index: 0, groups: [] }],
    ['$replace(text,$matcher,"z")', "z"],
    ["$split(text,$matcher)", ["", ""]],
    ["($find := $match; $find(text,$matcher))", { match: "x", index: 0, groups: [] }],
  ])("includes captured reads made by the continuation in %s", async (call, expected) => {
    const expression = `($matcher := function($text){{"match":"x","start":0,"end":1,"groups":[],"next":function(){($$.config.stop; $nothing)}}}; ${call})`;
    const reads: string[] = [];
    const input = { text: "x", config: { get stop() { reads.push("config.stop"); return true; } } };
    expect(await jsonata(expression).evaluate(input)).toEqual(expected);
    expect(reads).toEqual(["config.stop"]);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "config.stop", confidence: "static", coverage: "exact",
    });
  });

  it("does not invoke a continuation for contains", async () => {
    const expression = '($matcher := function($text){{"match":"x","start":0,"end":1,"groups":[],"next":function(){($$.config.stop; $nothing)}}}; $contains(text,$matcher))';
    let reads = 0;
    expect(await jsonata(expression).evaluate({ text: "x", config: { get stop() { reads++; return true; } } })).toBe(true);
    expect(reads).toBe(0);
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "text", confidence: "static", coverage: "exact" },
    ]);
  });

  it("follows continuations returned by another continuation", async () => {
    const expression = '($matcher := function($text){{"match":"x","start":0,"end":1,"groups":[],"next":function(){{"match":"x","start":1,"end":2,"groups":[],"next":function(){($$.config.stop; $nothing)}}}}}; $match(text,$matcher))';
    const reads: string[] = [];
    const result = await jsonata(expression).evaluate({ text: "xx", config: { get stop() { reads.push("config.stop"); return true; } } });
    expect(JSON.parse(JSON.stringify(result))).toEqual([
      { match: "x", index: 0, groups: [] },
      { match: "x", index: 1, groups: [] },
    ]);
    expect(reads).toEqual(["config.stop"]);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "config.stop", confidence: "static", coverage: "exact",
    });
  });

  it("terminates analysis for a recursive continuation", async () => {
    const expression = '($next := function(){$$.config.stop ? $nothing : {"match":"x","start":0,"end":1,"groups":[],"next":$next}}; $matcher := function($text){{"match":"x","start":0,"end":1,"groups":[],"next":$next}}; $match(text,$matcher))';
    expect(await jsonata(expression).evaluate({ text: "x", config: { stop: true } })).toEqual({
      match: "x", index: 0, groups: [],
    });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "config.stop", confidence: "static", coverage: "exact",
    });
  });
});
