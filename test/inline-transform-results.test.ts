import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

describe("inline transform result dependencies", () => {
  const input = { other: { details: { amount: 10 } } };

  it.each([
    '({} ~> |$|{"run":function($r){$r.details}}|)@$v.($f:=$v.run;$f($$.other).amount)',
    '({"node":{}} ~> |$.node|{"run":function($r){$r.details}}|)@$v.($f:=$v.node.run;$f($$.other).amount)',
  ])("retains methods inserted by an explicitly rooted transform: %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("retains builtin methods on a focused transform result", async () => {
    const source = '({} ~> |$|{"run":$eval}|)@$v.($f:=$v.run;$f("$$.other.details.amount"))';
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("preserves the constructed match context captured by an inserted method", async () => {
    const source = '({"source":other} ~> |$|{"run":function(){$.source.details}}|)@$v.($f:=$v.run;$f().amount)';
    expect(await jsonata(source).evaluate(input)).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("retains custom-function alternatives when a factory may also be a transform", async () => {
    const source = '($make:=enabled ? |$|{"run":function($r){$r.details}}| : function($x){{"run":function($r){$r.other}}};$make({})@$v.($f:=$v.run;$f($$.record).amount))';
    const data = { enabled: false, record: { details: { amount: 10 }, other: { amount: 20 } } };
    expect(await jsonata(source).evaluate(data)).toBe(20);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "record.other.amount", confidence: "static", coverage: "subtree",
    });
  });

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

  it.each([
    '$string({} ~> |$|{"copy":$$.other}|)',
    '($t:=|$|{"copy":$$.other}|;$string($t({})))',
    '($o:=other;$t:=|$|{"copy":$o}|;$string($t({})))',
  ])("tracks serialization of data inserted by a transform: %s", async (source) => {
    expect(await jsonata(source).evaluate(input)).toBe(JSON.stringify({ copy: input.other }));
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.**", confidence: "static", coverage: "exact",
    });
  });

  it("marks inserted input objects as returned values", async () => {
    const source = '{} ~> |$|{"copy":$$.other}|';
    let reads = 0;
    const result = await jsonata(source).evaluate({ other: { get amount() { reads++; return 10; } } });
    expect(JSON.stringify(result)).toBe('{"copy":{"amount":10}}');
    expect(reads).toBeGreaterThan(0);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other", confidence: "static", coverage: "subtree",
    });
  });

  it("tracks inserted descendants below a nested transform target", async () => {
    const source = '$string({"node":{}} ~> |node|{"copy":$$.other}|)';
    expect(await jsonata(source).evaluate(input)).toBe(JSON.stringify({ node: { copy: input.other } }));
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.**", confidence: "static", coverage: "exact",
    });
  });
});
