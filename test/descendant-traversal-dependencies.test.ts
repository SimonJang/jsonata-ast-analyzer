import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = {
  record: { details: { amount: 10 }, name: { label: "One" } },
  key: "a",
};
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const accesses = (expression: string) => analyzeExpression(expression).accesses
  .sort((a, b) => a.path.localeCompare(b.path));

describe("descendant traversal dependencies", () => {
  it.each([
    '($v:={"wrap":{(key):{"copy":record}}};$count($v.**))',
    '($v:={"wrap":{(key):{"copy":record}}};$count($v.wrap.**))',
    '($v:={"wrap":{(key):{"copy":record}}};$count($v.**.copy))',
    '($v:={"wrap":{(key):{"copy":record}}};$count($v.wrap.**.details))',
    '($v:={"wrap":{(key):{"copy":record}}};$v.**.amount)',
    '($v:={"wrap":{(key):{"copy":record}}};$v.**[details].details)',
  ])("traces every visited input child through a computed constructor in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBeDefined();
    expect(accesses(expression)).toEqual([exact("key"), exact("record"), exact("record.**")]);
  });

  it.each([
    '({"copy":record}).**.amount',
    '(function(){{"copy":record}})().**.amount',
    '($v:={"copy":record};$count($reverse($v).**.amount))',
  ])("retains constructed source descendants in %s", async (expression) => {
    expect(await jsonata(expression).evaluate(input)).toBeDefined();
    expect(accesses(expression)).toEqual([exact("record"), exact("record.**")]);
  });

  it.each([
    ['$count({"copy":record}.(copy.**))', 5],
    ['$count({"wrap":{"copy":record}}.(wrap.**))', 6],
    ['$map({"copy":record},function($x){$x.$.**.amount})', 10],
    ['$map({"wrap":{"copy":record}},function($x){$x.$.**.amount})', 10],
  ] as const)("resolves constructed current contexts in %s", async (expression, value) => {
    expect(await jsonata(expression).evaluate(input)).toBe(value);
    expect(accesses(expression)).toEqual([exact("record"), exact("record.**")]);
  });

  it("records traversal independently of the selected field", async () => {
    expect(await jsonata("record.**.amount").evaluate(input)).toBe(10);
    expect(accesses("record.**.amount")).toEqual([
      exact("record.**"),
      { path: "record.**.amount", confidence: "static", coverage: "subtree" },
    ]);
  });

  it("keeps derived scalar sources exact", async () => {
    const expression = '$count(({"copy":record.details.amount+1}).**)';
    expect(await jsonata(expression).evaluate(input)).toBe(2);
    expect(accesses(expression)).toEqual([exact("record.details.amount")]);
  });

  it("does not execute function-valued descendants", async () => {
    const expression = '$count(({"method":function(){record}}).**)';
    expect(await jsonata(expression).evaluate(input)).toBe(2);
    expect(accesses(expression)).toEqual([]);
  });
});
