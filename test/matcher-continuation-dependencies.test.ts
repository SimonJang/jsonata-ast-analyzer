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

  it.each([
    "$match(text,$matcher).groups.label",
    "($matches := $match(text,$matcher); $matches.groups.label)",
    "($find := $match; $find(text,$matcher).groups.label)",
    "($find := $match(?, $matcher); $find(text).groups.label)",
    '$lookup($match(text,$matcher),"groups").label',
  ])("traces fields selected from custom match groups through %s", async (selection) => {
    const expression = `($matcher := function($text){{"match":"x","start":0,"end":1,"groups":config.groups,"next":function(){$nothing}}}; ${selection})`;
    const reads: string[] = [];
    expect(await jsonata(expression).evaluate({
      text: "x", config: { groups: [{ get label() { reads.push("config.groups.label"); return "chosen"; } }] },
    })).toBe("chosen");
    expect(reads).toEqual(["config.groups.label"]);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "config.groups.label", confidence: "static", coverage: "subtree",
    });
  });

  it("selects complete groups in the returned match object", async () => {
    const expression = '($matcher := function($text){{"match":"x","start":0,"end":1,"groups":config.groups,"next":function(){$nothing}}}; $match(text,$matcher))';
    const groups = [{ label: "chosen" }];
    expect(await jsonata(expression).evaluate({ text: "x", config: { groups } })).toEqual({
      match: "x", index: 0, groups,
    });
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "config.groups", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    "function($m){$m.groups.label}",
    "($f := function($m){$m.groups.label}; $f)",
    "(function($m){$m.groups.label})(?)",
  ])("traces custom matcher groups passed into a replacement callback: %s", async (callback) => {
    const expression = `($matcher := function($text){{"match":"x","start":0,"end":1,"groups":config.groups,"next":function(){$nothing}}}; $replace(text,$matcher,${callback}))`;
    const reads: string[] = [];
    expect(await jsonata(expression).evaluate({
      text: "x", config: { groups: [{ get label() { reads.push("config.groups.label"); return "chosen"; } }] },
    })).toBe("chosen");
    expect(reads).toEqual(["config.groups.label"]);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "config.groups.label", confidence: "static", coverage: "exact",
    });
  });

  it("passes continuation match groups into later replacement calls", async () => {
    const expression = '($matcher := function($text){{"match":"x","start":0,"end":1,"groups":config.first,"next":function(){{"match":"x","start":1,"end":2,"groups":config.second,"next":function(){$nothing}}}}}; $replace(text,$matcher,function($m){$m.groups.label}))';
    expect(await jsonata(expression).evaluate({
      text: "xx", config: { first: [{ label: "a" }], second: [{ label: "b" }] },
    })).toBe("ab");
    for (const path of ["config.first.label", "config.second.label"]) {
      expect(analyzeExpression(expression).accesses).toContainEqual({
        path, confidence: "static", coverage: "exact",
      });
    }
  });

  it("preserves local values captured by produced continuations", async () => {
    const expression = '($make := function($groups){function(){{"match":"x","start":1,"end":2,"groups":$groups,"next":function(){$nothing}}}}; $matcher := function($text){{"match":"x","start":0,"end":1,"groups":config.first,"next":enabled ? $make(config.second) : $make(config.other)}}; $replace(text,$matcher,function($m){$m.groups.label}))';
    for (const enabled of [true, false]) {
      expect(await jsonata(expression).evaluate({
        enabled, text: "xx", config: { first: [{ label: "a" }], second: [{ label: "b" }], other: [{ label: "c" }] },
      })).toBe(enabled ? "ab" : "ac");
    }
    const accesses = analyzeExpression(expression).accesses;
    for (const path of ["config.first.label", "config.second.label", "config.other.label"]) {
      expect(accesses).toContainEqual({ path, confidence: "static", coverage: "exact" });
    }
  });

  it("covers custom match data consumed by a registered replacement function", async () => {
    const source = '($matcher := function($text){{"match":"x","start":0,"end":1,"groups":config.groups,"next":function(){$nothing}}}; $replace(text,$matcher,$render))';
    const expression = jsonata(source);
    expression.registerFunction("render", (match: { groups: { label: string }[] }) => match.groups[0].label, "<o:s>");
    expect(await expression.evaluate({ text: "x", config: { groups: [{ label: "chosen" }] } })).toBe("chosen");
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "config.groups.**", confidence: "static", coverage: "exact",
    });
  });

  it.each(["$string", "($s := $string; $s)", '{"run":$string}.run'])("follows a builtin used as a replacement callback: %s", async (callback) => {
    const source = `($matcher := function($text){{"match":"x","start":0,"end":1,"groups":config.groups,"next":function(){$nothing}}}; $replace(text,$matcher,${callback}))`;
    const result = await jsonata(source).evaluate({ text: "x", config: { groups: [{ label: "chosen" }] } });
    expect(JSON.parse(result)).toEqual({ match: "x", start: 0, end: 1, groups: [{ label: "chosen" }], next: "" });
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "config.groups.**", confidence: "static", coverage: "exact",
    });
  });

  it("records dynamic eval dependencies when eval is used as a matcher", async () => {
    const source = "$match(program,$eval).groups.label";
    const input = {
      program: '{"match":"x","start":0,"end":1,"groups":$$.config.groups,"next":function(){$nothing}}',
      config: { groups: [{ label: "chosen" }] },
    };
    expect(await jsonata(source).evaluate(input)).toBe("chosen");
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "**", confidence: "static", coverage: "exact",
    });
  });
});
