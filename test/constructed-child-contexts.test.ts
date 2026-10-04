import jsonata from "jsonata";
import { describe, expect, it } from "vitest";
import { analyzeExpression } from "../src/index.js";

const input = { first: { nested: { total: 10 } }, second: { nested: { total: 20 } }, key: "child" };
const exact = (path: string) => ({ path, confidence: "static", coverage: "exact" });
const sorted = (expression: string) => analyzeExpression(expression).accesses.sort((a, b) => a.path.localeCompare(b.path));

const fixtures = [
  ['{"a":{"child":{"copy":first},"other":{"different":second}}}', "a.child", false],
  ['{(key):{"copy":first},"other":{"different":second}}', "*", true],
  ['{"a":{(key):{"copy":first},"other":{"different":second}}}', "a.*", true],
  ['{"a":{(key):{"copy":first},"other":{"different":second}}}', "a.child", true],
] as const;

describe("selected constructed child contexts", () => {
  it.each(fixtures)("traces %s selected by %s through later projections", async (object, selector, computed) => {
    for (const suffix of [".(copy.nested)", '.$lookup($,"copy").nested', '.{"out":copy.nested}']) {
      const expression = `($v:=${object};$v.${selector}${suffix})`;
      const result = JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)));
      const objectResult = selector.endsWith("*") ? [{ out: input.first.nested }, {}] : { out: input.first.nested };
      expect(result).toEqual(suffix.startsWith('.{"out"') ? objectResult : input.first.nested);
      expect(sorted(expression)).toEqual([
        exact("first"), { path: "first.nested", confidence: "static", coverage: "subtree" },
        ...(computed ? [exact("key")] : []), exact("second"),
      ]);
    }
  });

  it.each(fixtures)("traces predicates on %s selected by %s", async (object, selector, computed) => {
    for (const predicate of ["copy.nested.total>0", "$.copy.nested.total>0", '$lookup($,"copy").nested.total>0']) {
      const expression = `($v:=${object};$count($v.${selector}[${predicate}]))`;
      expect(await jsonata(expression).evaluate(input)).toBe(1);
      expect(sorted(expression)).toEqual([
        exact("first"), exact("first.nested.total"), ...(computed ? [exact("key")] : []), exact("second"),
      ]);
    }
  });

  it.each(fixtures.filter(([, selector]) => selector.endsWith("*")))
    ("traces sorting on %s selected by %s", async (object, selector) => {
      const expression = `($v:=${object};$count($v.${selector}^(copy.nested.total)))`;
      expect(await jsonata(expression).evaluate(input)).toBe(2);
      expect(sorted(expression)).toEqual([exact("first"), exact("first.nested.total"), exact("key"), exact("second")]);
    });
});
