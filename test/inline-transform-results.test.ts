import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

describe("inline transform result dependencies", () => {
  const input = { other: { details: { amount: 10 } } };

  it.each([
    '({} ~> |$|{"copy":$$.other}|).copy.details.amount',
    '(({} ~> |$|{"copy":$$.other}|)).copy.details.amount',
    '($t:=|$|{"copy":$$.other}|;($t({})).copy.details.amount)',
    '({"node":{}} ~> |node|{"copy":$$.other}|).node.copy.details.amount',
  ])("traces selected fields added by a parenthesized transform: %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses.map(({ path }) => path))
      .toContain("other.details.amount");
  });
});
