import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression } from "../src/index.js";

describe("inline transform result dependencies", () => {
  const input = { other: { details: { amount: 10 } } };

  it("keeps inserted values shallow when counting a result with known targets", async () => {
    const source = '$count(record ~> |a|{"copy":$$.other}|)';
    let reads = 0;
    expect(await jsonata(source).evaluate({ record: { a: {} }, other: { get amount() { reads++; return 10; } } })).toBe(1);
    expect(reads).toBe(0);
    expect(analyzeExpression(source).accesses).not.toContainEqual({
      path: "other.**", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    { pattern: '$eval("a")', record: { a: {} }, selected: "a" },
    { pattern: '$eval("a",$)', record: { a: {} }, selected: "a" },
    { pattern: '$eval("a",$.nodes)', record: { nodes: { a: {} } }, selected: "nodes.a" },
    { pattern: '$eval("picked",{"picked":$.a})', record: { a: {} }, selected: "a" },
    { pattern: '$eval("picked",[{"picked":$.a}])', record: { a: {} }, selected: "a" },
  ])("retains update sources through static eval target $pattern", async ({ pattern, record, selected }) => {
    const source = `($v:=record ~> |${pattern}|{"copy":$$.other}|;$v.${selected}.copy.details.amount)`;
    expect(await jsonata(source).evaluate({ ...input, record })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '$ ~> $lookup("a")',
    '$ ~> function($x){$x.a}',
    '$ ~> $lookup(?,"a")',
    '($ ~> function($x){$x}).a',
  ])("retains update sources through chained target selectors: %s", async (pattern) => {
    const source = `($v:=record ~> |(${pattern})|{"copy":$$.other}|;$v.a.copy.details.amount)`;
    expect(await jsonata(source).evaluate({ ...input, record: { a: {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '$lookup(?,"a")($)',
    '(function($x,$key){$lookup($x,$key)})(?,"a")($)',
    '($pick:=$lookup(?,"a");$pick($))',
    '($pick:=$lookup($,?);$pick("a"))',
    '($target:=$;$pick:=$lookup($target,?);$pick("a"))',
    '($first:=$lookup(?,?);$pick:=$first(?,"a");$pick($))',
    '$map([$],$lookup(?,"a"))',
  ])("retains update sources through partial target selectors: %s", async (pattern) => {
    const source = `($v:=record ~> |${pattern}|{"copy":$$.other}|;$v.a.copy.details.amount)`;
    expect(await jsonata(source).evaluate({ ...input, record: { a: {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '(function($x){$x.a})($)',
    '(function($x){$lookup($x,"a")})($)',
    '(function($x)<o-:o>{$x.a})()',
    '$map([$.a,$.b],function($x){$x})',
  ])("retains update sources through custom target selectors: %s", async (pattern) => {
    const source = `($v:=record ~> |${pattern}|{"copy":$$.other}|;$v.a.copy.details.amount)`;
    expect(await jsonata(source).evaluate({ ...input, record: { a: {}, b: {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("retains named custom selector bindings", async () => {
    const source = '($pick:=function($x){$x.a};$v:=record ~> |$pick($)|{"copy":$$.other}|;$v.a.copy.details.amount)';
    expect(await jsonata(source).evaluate({ ...input, record: { a: {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("retains callback return paths within selected target objects", async () => {
    const source = '($v:=record ~> |$map([$.left,$.right],function($x){$x.target})|{"copy":$$.other}|;$v.left.target.copy.details.amount)';
    expect(await jsonata(source).evaluate({ ...input, record: { left: { target: {} }, right: { target: {} } } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("terminates recursive selector tracing while preserving its base-case target", async () => {
    const source = '($pick:=function($x,$n){$n>0?$pick($x,$n-1):$x};$v:=record ~> |$pick($,3)|{"copy":$$.other}|;$v.copy.details.amount)';
    expect(await jsonata(source).evaluate({ ...input, record: {} })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '$filter([$.a,$.b],function($x){true})',
    '$single([$.a],function($x){true})',
    '$reverse([$.a,$.b])',
    '$distinct([$.a,$.b])',
    '$sort([$.a,$.b],function($a,$b){false})',
    '$shuffle([$.a,$.b])',
    '$append([$.a],[$.b])',
  ])("retains update sources when a builtin preserves target objects: %s", async (pattern) => {
    const source = `($v:=record ~> |${pattern}|{"copy":$$.other}|;$v.a.copy.details.amount)`;
    expect(await jsonata(source).evaluate({ ...input, record: { a: {}, b: {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '$lookup($,$$.selected)',
    '$lookup($,"a")',
    '$lookup($$.selected)',
  ])("retains inserted field sources when lookup selects transform targets: %s", async (pattern) => {
    const source = `($v:=record ~> |${pattern}|{"copy":$$.other}|;$v.a.copy.details.amount)`;
    expect(await jsonata(source).evaluate({ ...input, selected: "a", record: { a: {}, b: {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it.each([
    '($l:=$lookup;$l($,$$.selected))',
    '($target:=$lookup($,$$.selected);$target)',
    '($target:=$.a;$target)',
  ])("retains bindings local to a transform pattern block: %s", async (pattern) => {
    const source = `($v:=record ~> |${pattern}|{"copy":$$.other}|;$v.a.copy.details.amount)`;
    expect(await jsonata(source).evaluate({ ...input, selected: "a", record: { a: {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("resolves captured lookup aliases in transform patterns", async () => {
    const source = '($l:=$lookup;$t:=|$l($,$$.selected)|{"copy":$$.other}|;$v:=$t(record);$v.a.copy.details.amount)';
    expect(await jsonata(source).evaluate({ ...input, selected: "a", record: { a: {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("preserves literal field names in lookup-based transform targets", async () => {
    const source = '($v:=record ~> |$lookup($,"a.b")|{"copy":$$.other}|;$v.`a.b`.copy.details.amount)';
    expect(await jsonata(source).evaluate({ ...input, record: { "a.b": {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("tracks serialization after a computed transform target selection", async () => {
    const source = '$string(record ~> |$lookup($,$$.selected)|{"copy":$$.other}|)';
    const data = { ...input, selected: "a", record: { a: {}, b: {} } };
    expect(await jsonata(source).evaluate(data)).toBe(JSON.stringify({ a: { copy: input.other }, b: {} }));
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.**", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '($t:=|*|{"copy":$$.other}|;$v:=$t(record);$v.a.copy.details.amount)',
    '($v:=record ~> |*|{"copy":$$.other}|;$v.a.copy.details.amount)',
  ])("retains inserted field sources below wildcard transform targets: %s", async (source) => {
    expect(await jsonata(source).evaluate({ ...input, record: { a: {}, b: {} } })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("retains known ancestors around wildcard transform targets", async () => {
    const source = '($v:=record ~> |nodes.*|{"copy":$$.other}|;$lookup($v.nodes,"a").copy.details.amount)';
    const data = { ...input, record: { nodes: { a: {}, b: {} } } };
    expect(await jsonata(source).evaluate(data)).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
    });
  });

  it("keeps cached transform origins separate for distinct captured scopes", async () => {
    const source = '($make:=function($x){|$|{"copy":$x}|};$string($map([$make(record),$make(other)],function($t){$t({})})))';
    const data = { record: { amount: 10 }, other: { amount: 20 } };
    expect(await jsonata(source).evaluate(data)).toBe('[{"copy":{"amount":10}},{"copy":{"amount":20}}]');
    for (const path of ["record.**", "other.**"]) {
      expect(analyzeExpression(source).accesses).toContainEqual({ path, confidence: "static", coverage: "exact" });
    }
  });

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

  it("retains descendant reads through a dynamic transform update key", async () => {
    const source = '$string({} ~> |$|{($$.enabled?"copy":"alt"):$$.other}|)';
    expect(await jsonata(source).evaluate({ ...input, enabled: true })).toBe(JSON.stringify({ copy: input.other }));
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.**", confidence: "static", coverage: "exact",
    });
  });

  it.each([
    '({"node":{}} ~> |node|{($$.enabled?"copy":"alt"):$$.other}|).node.copy.details.amount',
    '($t:=|$|{($$.enabled?"copy":"alt"):$$.other}|;$v:=$t({});$v.copy.details.amount)',
  ])("retains selections from dynamic inserted fields: %s", async (source) => {
    expect(await jsonata(source).evaluate({ ...input, enabled: true })).toBe(10);
    expect(analyzeExpression(source).accesses).toContainEqual({
      path: "other.details.amount", confidence: "static", coverage: "subtree",
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
