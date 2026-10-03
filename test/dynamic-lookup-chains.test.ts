import { describe, expect, it } from "vitest";
import jsonata from "jsonata";
import { analyzeExpression, extractPaths } from "../src/index.js";

const data = {
  dict: {
    a: { details: { amount: 10, rank: 2, active: true, nested: { amount: 1 } } },
    b: { details: { amount: 20, rank: 1, active: false, nested: { amount: 2 } } },
  },
  items: [
    { active: true, details: { amount: 10, nested: { amount: 1 } } },
    { active: false, details: { amount: 20, nested: { amount: 2 } } },
  ],
  keyList: "a,b",
  selected: "a",
};

describe("dynamic lookup chains", () => {
  it.each([
    '$map($keys($d), function($k) { $lookup($d, $k).details })',
    '$keys($d).($lookup($d, $).details)',
    '$keys($d).$lookup($d, $).details',
    '$keys($d).[$lookup($d, $).details]',
  ])("preserves selected dictionary values through %s", async (projection) => {
    const expression = `($d := dict; ${projection})`;
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(data))))
      .toEqual(projection.startsWith('$keys($d).[')
        ? [[data.dict.a.details], [data.dict.b.details]]
        : [data.dict.a.details, data.dict.b.details]);
    expect(analyzeExpression(expression)).toEqual({ accesses: [
      { path: "dict", confidence: "static", coverage: "exact" },
      { path: "dict[*]", confidence: "dynamic", coverage: "exact" },
      { path: "dict[*].details", confidence: "dynamic", coverage: "subtree" },
    ] });
    expect(extractPaths(expression)).toEqual([
      { path: "dict", confidence: "static" },
      { path: "dict[*]", confidence: "dynamic" },
      { path: "dict[*].details", confidence: "dynamic" },
    ]);
  });

  it.each([
    ["root lookup", '$keys(dict).$lookup($$.dict, $).details', "dict[*].details"],
    ["string-derived keys", '$split(keyList, ",").$lookup($$.dict, $).details', "dict[*].details"],
    ["reverse then lookup", '$reverse(items).$lookup($, "details").amount', "items.details.amount"],
    ["reverse then block", '$reverse(items).($lookup($, "details").amount)', "items.details.amount"],
    ["implicit context", '$reverse(items).$lookup("details").amount', "items.details.amount"],
    ["multiple lookups", '$reverse(items).$lookup($, "details").$lookup($, "nested").amount', "items.details.nested.amount"],
    ["callback results", '$map(items, function($v) { $v.details }).$lookup($, "nested").amount', "items.details.nested.amount"],
    ["result binding", '($d := dict; $r := $keys($d).$lookup($d, $).details; $r.amount)', "dict[*].details.amount"],
    ["key focus binding", '($d := dict; $keys($d)@$k.$lookup($d, $k).details)', "dict[*].details"],
    ["lookup filter", '($d := dict; $keys($d).$lookup($d, $).details[active].amount)', "dict[*].details.amount"],
    ["lookup sort", '($d := dict; $keys($d).$lookup($d, $).details^(rank).amount)', "dict[*].details.amount"],
    ["variable lookup", '($d := dict; $v := items; $v.$lookup($d, "a").details)', "dict.a.details"],
    ["variable current context", '($d := dict; $d.$lookup($, "a").details)', "dict.a.details"],
    ["named current context", 'items.$lookup($, "details").amount', "items.details.amount"],
    ["literal key sequence", '["a", "b"].$lookup($$.dict, $).details', "dict[*].details"],
    ["dynamic lookup sequence", '$lookup(dict, selected).$lookup($, "details").amount', "dict[*].details.amount"],
  ])("carries the selected source through %s", async (_name, expression, path) => {
    const value = await jsonata(expression).evaluate(data);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({
      path,
      confidence: path.includes("[*]") ? "dynamic" : "static",
      coverage: "subtree",
    });
    expect(extractPaths(expression)).toEqual(accesses.map(({ coverage, ...result }) => result));
    if (_name === "lookup filter") {
      expect(value).toBe(10);
      expect(accesses).toContainEqual({ path: "dict[*].details.active", confidence: "dynamic", coverage: "exact" });
    }
    if (_name === "lookup sort") {
      expect(JSON.parse(JSON.stringify(value))).toEqual([20, 10]);
      expect(accesses).toContainEqual({ path: "dict[*].details.rank", confidence: "dynamic", coverage: "exact" });
    }
  });

  it("resolves chained lookup results from a constructed dictionary", () => {
    const accesses = analyzeExpression(
      '($d := {"a": dict.a, "b": dict.b}; $keys($d).$lookup($d, $).details)',
    ).accesses;
    for (const path of ["dict.a.details", "dict.b.details"]) {
      expect(accesses).toContainEqual({ path, confidence: "static", coverage: "subtree" });
    }
  });

  it("selects from a directly constructed dictionary using the current context", () => {
    const accesses = analyzeExpression(
      '{"a": dict.a, "b": dict.b}.$lookup($, $$.selected).details',
    ).accesses;
    for (const path of ["dict.a.details", "dict.b.details"]) {
      expect(accesses).toContainEqual({ path, confidence: "static", coverage: "subtree" });
    }
  });

  it("does not forward the subtree when a scalar function consumes the chain", () => {
    const accesses = analyzeExpression(
      '($d := dict; $count($keys($d).$lookup($d, $).details))',
    ).accesses;
    expect(accesses).toContainEqual({ path: "dict[*].details", confidence: "dynamic", coverage: "exact" });
    expect(accesses.every(({ coverage }) => coverage === "exact")).toBe(true);
  });

  it("retains predicates attached to a single field before lookup", async () => {
    const expression = 'items[active].$lookup($, "details").amount';
    expect(await jsonata(expression).evaluate(data)).toBe(10);
    expect(analyzeExpression(expression).accesses)
      .toContainEqual({ path: "items.active", confidence: "static", coverage: "exact" });
    expect(analyzeExpression(expression).accesses)
      .toContainEqual({ path: "items.details.amount", confidence: "static", coverage: "subtree" });
  });

  it("binds a named field's focus before lookup", async () => {
    const expression = 'items@$it.$lookup($it, "details").amount';
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(data)))).toEqual([10, 20]);
    expect(analyzeExpression(expression).accesses)
      .toContainEqual({ path: "items.details.amount", confidence: "static", coverage: "subtree" });
  });

  it.each([
    'items@$it.$it.$lookup($, "details").amount',
    'items@$it.$it.details.$lookup($, "amount")',
  ])("restores focus as the current value before lookup in %s", async (expression) => {
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(data)))).toEqual([10, 20]);
    expect(analyzeExpression(expression).accesses)
      .toContainEqual({ path: "items.details.amount", confidence: "static", coverage: "subtree" });
  });

  it.each(['items@$it', '$reverse(items)@$it', '$reverse(items)@$it.x'])
    ("preserves the outer context after focus in %s", async (prefix) => {
      const expression = prefix.endsWith('.x')
        ? `${prefix}.$lookup($, "amount")`
        : `${prefix}.$lookup($, "x").amount`;
      const input = { ...data, x: { amount: 99 } };
      expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(input)))).toEqual([99, 99]);
      const accesses = analyzeExpression(expression).accesses;
      expect(accesses).toContainEqual({ path: "x.amount", confidence: "static", coverage: "subtree" });
      expect(accesses.some(({ path }) => path.startsWith('items.x'))).toBe(false);
    });

  it("keeps the root context through consecutive focused fields", async () => {
    const expression = 'items@$a.details@$b.$lookup($, "x").amount';
    expect(await jsonata(expression).evaluate({ items: [{}], details: {}, x: { amount: 1 } })).toBe(1);
    expect(analyzeExpression(expression).accesses)
      .toContainEqual({ path: "x.amount", confidence: "static", coverage: "subtree" });
  });

  it.each([
    ['items@$it.$keys($)', '*'],
    ['root.items@$it.$keys($)', 'root.*'],
  ])("preserves focused context for key enumeration in %s", (expression, path) => {
    expect(analyzeExpression(expression).accesses)
      .toContainEqual({ path, confidence: "static", coverage: "exact" });
  });

  it("keeps a scalar-producing function at exact coverage inside a chain", () => {
    const accesses = analyzeExpression('$reverse(items).$count($)').accesses;
    expect(accesses).toContainEqual({ path: "items", confidence: "static", coverage: "exact" });
    expect(accesses.every(({ coverage }) => coverage === "exact")).toBe(true);
  });

  it.each(['[$count($)]', '{"n": $count($)}'])
    ("does not select consumed input inside a chained constructor %s", (projection) => {
      const accesses = analyzeExpression(`$reverse(items).${projection}`).accesses;
      expect(accesses).toContainEqual({ path: "items", confidence: "static", coverage: "exact" });
      expect(accesses.every(({ coverage }) => coverage === "exact")).toBe(true);
    });

  it("follows an object constructed after a dynamic lookup into a bound result", () => {
    const expression = '($o := $lookup(dict, selected).{"v": $lookup($, "details")}; $o.v.amount)';
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "dict[*].details.amount", confidence: "dynamic", coverage: "subtree" });
    expect(accesses.some(({ path }) => path === 'details.amount' || path.includes('.v.amount'))).toBe(false);
  });

  it("selects the input value placed in an object after a dynamic lookup", () => {
    expect(analyzeExpression('$lookup(dict, selected).{"v": $lookup($, "details")}').accesses)
      .toContainEqual({ path: "dict[*].details", confidence: "dynamic", coverage: "subtree" });
  });

  it("follows computed object keys constructed after a lookup", async () => {
    const expression = '($o := $lookup(dict, selected).{$$.selected: $lookup($, "details")}; $lookup($o, "a").amount)';
    expect(await jsonata(expression).evaluate(data)).toBe(10);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "dict[*].details.amount", confidence: "dynamic", coverage: "subtree" });
    expect(accesses.some(({ path }) => path === 'details.amount')).toBe(false);
  });

  it("retains the selected source through a long lookup chain", async () => {
    const expression = '$reverse(items)' + '.$lookup($, "child")'.repeat(32) + '.amount';
    let value: unknown = { amount: 42 };
    for (let index = 0; index < 32; index++) value = { child: value };
    expect(await jsonata(expression).evaluate({ items: [value] })).toBe(42);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: 'items' + '.child'.repeat(32) + '.amount', confidence: "static", coverage: "subtree",
    });
  });

  it("keeps a chained position binding separate from input dependencies", async () => {
    const expression = '($index := dict; items#$index.$lookup($index, "details").amount)';
    expect(await jsonata(expression).evaluate(data)).toBeUndefined();
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "dict", confidence: "static", coverage: "exact" },
      { path: "items", confidence: "static", coverage: "exact" },
    ]);
  });

  it.each([
    ['$reverse(items).details{kind: amount}', 'items.details.kind', 'items.details.amount'],
    ['$reverse(items){kind: details.amount}', 'items.kind', 'items.details.amount'],
  ])("preserves grouping reads and selected values in %s", async (expression, keyPath, valuePath) => {
    const input = { items: [
      { kind: "a", details: { kind: "x", amount: 10 } },
      { kind: "b", details: { kind: "y", amount: 20 } },
    ] };
    expect(await jsonata(expression).evaluate(input)).toEqual(expression.includes('.details{')
      ? { x: 10, y: 20 } : { a: 10, b: 20 });
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: keyPath, confidence: "static", coverage: "exact" });
    expect(accesses).toContainEqual({ path: valuePath, confidence: "static", coverage: "subtree" });
  });

  it.each(['', '.amount', '{"amount": amount}'])
    ("respects a local lookup function with suffix %s", async (suffix) => {
      const expression = `($lookup := function($key) { $$.dict.a.details }; items.$lookup("ignored")${suffix})`;
      const value = await jsonata(expression).evaluate(data);
      expect(JSON.parse(JSON.stringify(value))).toEqual(suffix === '.amount'
        ? [10, 10] : suffix === ''
          ? [data.dict.a.details, data.dict.a.details] : { amount: [10, 10] });
      const accesses = analyzeExpression(expression).accesses;
      expect(accesses).toContainEqual({ path: `dict.a.details${suffix === '' ? '' : '.amount'}`, confidence: "static", coverage: "subtree" });
      expect(accesses.some(({ path }) => path.includes('ignored'))).toBe(false);
    });

  it("preserves source reads in an array projected from a parenthesized function", async () => {
    const expression = '($reverse(items)).[details.amount]';
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(data)))).toEqual([[20], [10]]);
    expect(extractPaths(expression)).toEqual([
      { path: "items", confidence: "static" },
      { path: "items.details.amount", confidence: "static" },
    ]);
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "items", confidence: "static", coverage: "exact" },
      { path: "items.details.amount", confidence: "static", coverage: "subtree" },
    ]);
  });

  it("groups a block projection relative to a parenthesized function result", async () => {
    const expression = '($reverse(items)).(details){kind: amount}';
    const input = { items: [
      { details: { kind: "x", amount: 10 } },
      { details: { kind: "y", amount: 20 } },
    ] };
    expect(await jsonata(expression).evaluate(input)).toEqual({ y: 20, x: 10 });
    expect(analyzeExpression(expression).accesses).toEqual([
      { path: "items", confidence: "static", coverage: "exact" },
      { path: "items.details", confidence: "static", coverage: "exact" },
      { path: "items.details.kind", confidence: "static", coverage: "exact" },
      { path: "items.details.amount", confidence: "static", coverage: "subtree" },
    ]);
  });

  it.each(['($reverse(items))', '(items)'])
    ("records consumed array projection values used in a grouped scalar after %s", async (prefix) => {
      const expression = `${prefix}.[details.amount]{"total": $sum($)}`;
      expect(await jsonata(expression).evaluate(data)).toEqual({ total: 30 });
      expect(analyzeExpression(expression).accesses).toEqual([
        { path: "items", confidence: "static", coverage: "exact" },
        { path: "items.details.amount", confidence: "static", coverage: "exact" },
      ]);
    });

  it.each([
    '(($reverse(items))).[details.amount]',
    '($source := items; $reverse($source)).[details.amount]',
    '($reverse(items).details).[amount]',
  ])("keeps the selected leaf through parenthesized producer %s", async (expression) => {
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(data)))).toEqual([[20], [10]]);
    expect(analyzeExpression(expression).accesses).toContainEqual({
      path: "items.details.amount", confidence: "static", coverage: "subtree",
    });
    expect(analyzeExpression(expression).accesses.find(({ path }) => path === "items")?.coverage)
      .toBe("exact");
  });

  it("retains the outer current context of a focused parenthesized function", async () => {
    const expression = '($reverse(items))@$it.x.$lookup($, "amount")';
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate({ ...data, x: { amount: 99 } }))))
      .toEqual([99, 99]);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "x.amount", confidence: "static", coverage: "subtree" });
    expect(accesses.some(({ path }) => path.startsWith("items.x"))).toBe(false);
  });

  it("reads a predicate on a parenthesized producer without selecting the predicate", async () => {
    const expression = '($reverse(items))[active].[details.amount]';
    expect(JSON.parse(JSON.stringify(await jsonata(expression).evaluate(data)))).toEqual([10]);
    const accesses = analyzeExpression(expression).accesses;
    expect(accesses).toContainEqual({ path: "items.active", confidence: "static", coverage: "exact" });
    expect(accesses).toContainEqual({ path: "items.details.amount", confidence: "static", coverage: "subtree" });
  });

  it.each([
    '$merge([{ "go": function($x) { $x.children.name } }])',
    '($merge([{ "go": function($x) { $x.children.name } }]))',
  ])("resolves a callable stored in a function-produced object via %s", async (producer) => {
    const expression = `${producer}.go($$.detail)`;
    expect(await jsonata(expression).evaluate({ detail: { children: { name: "n" } } })).toBe("n");
    expect(extractPaths(expression)).toEqual([
      { path: "detail", confidence: "static" },
      { path: "detail.children.name", confidence: "static" },
    ]);
  });
});
