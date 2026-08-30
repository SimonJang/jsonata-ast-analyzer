import { describe, expect, it } from "vitest";
import { analyzeExpression, extractPaths } from "../src/index.js";
import { corpusFixtures } from "./corpus/corpus-fixtures.js";

describe("analyzeExpression", () => {
  it("distinguishes selected values from values consumed by scalar functions", () => {
    expect(analyzeExpression("customer")).toEqual({
      accesses: [
        { path: "customer", confidence: "static", coverage: "subtree" },
      ],
    });
    expect(analyzeExpression("$count(items)")).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "exact" },
      ],
    });
  });

  it("tracks collection selection separately from callback reads", () => {
    expect(
      analyzeExpression(
        "$filter(items, function($item) { $item.active })",
      ),
    ).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "subtree" },
        { path: "items.active", confidence: "static", coverage: "exact" },
      ],
    });
    expect(
      analyzeExpression("$map(items, function($item) { $item.name })"),
    ).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "exact" },
        { path: "items.name", confidence: "static", coverage: "subtree" },
      ],
    });
  });

  it("treats configured built-ins as opaque host functions", () => {
    expect(
      analyzeExpression("$eval(payload).x", {
        opaqueFunctions: ["$eval"],
      }),
    ).toEqual({
      accesses: [
        { path: "payload", confidence: "static", coverage: "exact" },
      ],
    });
  });

  it("preserves selected source identity through aliases and collection functions", () => {
    expect(
      analyzeExpression('($record := {"name": customer.name}; $record.name)'),
    ).toEqual({
      accesses: [
        {
          path: "customer.name",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
    expect(analyzeExpression("$reverse(items)")).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "subtree" },
      ],
    });
  });

  it("preserves explicit aliases inside projections from the same alias", () => {
    expect(
      analyzeExpression(
        '($record := $$.records[0]; $record.{"id": $record.identifier})',
      ),
    ).toEqual({
      accesses: [
        { path: "records", confidence: "static", coverage: "exact" },
        {
          path: "records.identifier",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("analyzes independent root reads inside projections from opaque values", () => {
    expect(
      analyzeExpression(
        '($value := $parse($$.source[0].date, "x"); ' +
          '$value := $value != "" ? $format($value, "x"); ' +
          '$value.{"result": $$.records[0].`field one`})',
        {
          externalFunctions: {
            parse: { arguments: "value" },
            format: { arguments: "value" },
          },
        },
      ),
    ).toEqual({
      accesses: [
        { path: "source.date", confidence: "static", coverage: "exact" },
        {
          path: "records.field one",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("resolves a final rebinding against the preceding scope", () => {
    expect(
      analyzeExpression("($value := customer; $value := $value.name)"),
    ).toEqual({
      accesses: [
        { path: "customer", confidence: "static", coverage: "exact" },
        {
          path: "customer.name",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("marks the source cloned by an applied transform as selected", () => {
    expect(
      analyzeExpression('payload ~> |Account|{"name": name}|'),
    ).toEqual({
      accesses: [
        { path: "payload", confidence: "static", coverage: "subtree" },
        { path: "payload.Account", confidence: "static", coverage: "exact" },
        {
          path: "payload.Account.name",
          confidence: "static",
          coverage: "exact",
        },
      ],
    });
  });

  it("lets a local callable shadow an opaque host-function name", () => {
    expect(
      analyzeExpression(
        "($eval := function($value) { $value.name }; $eval(customer))",
        { opaqueFunctions: ["eval"] },
      ),
    ).toEqual({
      accesses: [
        { path: "customer", confidence: "static", coverage: "exact" },
        {
          path: "customer.name",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("resolves local callables before opaque higher-order built-ins", () => {
    expect(
      analyzeExpression(
        "($filter := function($value) { $value.name }; $filter(customer))",
        { opaqueFunctions: ["filter"] },
      ),
    ).toEqual({
      accesses: [
        { path: "customer", confidence: "static", coverage: "exact" },
        {
          path: "customer.name",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("normalizes and isolates opaque names across call forms", () => {
    const opaqueFunctions = Object.freeze(["$eval", "eval"]);
    const expressions = [
      "$eval(payload).x",
      "payload ~> $eval()",
      "($evaluate := $eval(?); $evaluate(payload).x)",
      "($evaluate := $eval; $evaluate(payload).x)",
    ];

    for (const expression of expressions) {
      expect(analyzeExpression(expression, { opaqueFunctions })).toEqual({
        accesses: [
          { path: "payload", confidence: "static", coverage: "exact" },
        ],
      });
    }
    expect(opaqueFunctions).toEqual(["$eval", "eval"]);

    expect(
      analyzeExpression("$eval(payload).x").accesses.some(
        ({ path }) => path === "**",
      ),
    ).toBe(true);
    expect(
      analyzeExpression("$eval(payload).x", {
        opaqueFunctions: ["eval"],
      }).accesses.some(({ path }) => path === "**"),
    ).toBe(false);
    expect(
      analyzeExpression("$eval(payload).x").accesses.some(
        ({ path }) => path === "**",
      ),
    ).toBe(true);
  });

  it("overrides recognized higher-order semantics when configured", () => {
    expect(
      analyzeExpression(
        "$filter(items, function($item) { $item.active })",
        { opaqueFunctions: ["filter"] },
      ),
    ).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "exact" },
      ],
    });
  });

  it.each([
    {
      expression: "items.price * taxRate",
      accesses: [
        { path: "items.price", confidence: "static", coverage: "exact" },
        { path: "taxRate", confidence: "static", coverage: "exact" },
      ],
    },
    {
      expression: "condition ? customer : fallback",
      accesses: [
        { path: "condition", confidence: "static", coverage: "exact" },
        { path: "customer", confidence: "static", coverage: "subtree" },
        { path: "fallback", confidence: "static", coverage: "subtree" },
      ],
    },
    {
      expression: '{"name": customer.name}',
      accesses: [
        {
          path: "customer.name",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    },
    {
      expression: "items[active].name",
      accesses: [
        { path: "items.name", confidence: "static", coverage: "subtree" },
        { path: "items.active", confidence: "static", coverage: "exact" },
      ],
    },
    {
      expression: "(discarded; selected)",
      accesses: [
        { path: "discarded", confidence: "static", coverage: "exact" },
        { path: "selected", confidence: "static", coverage: "subtree" },
      ],
    },
  ])("classifies $expression", ({ expression, accesses }) => {
    expect(analyzeExpression(expression)).toEqual({ accesses });
  });

  it("promotes duplicate exact and selected reads to subtree in first-seen order", () => {
    expect(analyzeExpression("[customer, $count(customer), other]")).toEqual({
      accesses: [
        { path: "customer", confidence: "static", coverage: "subtree" },
        { path: "other", confidence: "static", coverage: "subtree" },
      ],
    });
  });

  it("selects projection and group values without selecting their source collection", () => {
    expect(analyzeExpression('items.{"name": name}')).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "exact" },
        { path: "items.name", confidence: "static", coverage: "subtree" },
      ],
    });
    expect(analyzeExpression("items{category: price}")).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "exact" },
        { path: "items.category", confidence: "static", coverage: "exact" },
        { path: "items.price", confidence: "static", coverage: "subtree" },
      ],
    });
    expect(analyzeExpression("items{category: $count(children)}")).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "exact" },
        { path: "items.category", confidence: "static", coverage: "exact" },
        { path: "items.children", confidence: "static", coverage: "exact" },
      ],
    });
    expect(
      analyzeExpression("($records := items; $records{category: price})"),
    ).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "exact" },
        { path: "items.category", confidence: "static", coverage: "exact" },
        { path: "items.price", confidence: "static", coverage: "subtree" },
      ],
    });
    expect(
      analyzeExpression(
        "$filter(items, function($item) { $item.active }){category: price}",
      ),
    ).toEqual({
      accesses: [
        { path: "items", confidence: "static", coverage: "exact" },
        { path: "items.active", confidence: "static", coverage: "exact" },
        { path: "items.category", confidence: "static", coverage: "exact" },
        { path: "items.price", confidence: "static", coverage: "subtree" },
      ],
    });
  });

  it.each([
    {
      expression: "items^(price)",
      accesses: [
        { path: "items", confidence: "static", coverage: "subtree" },
        { path: "items.price", confidence: "static", coverage: "exact" },
      ],
    },
    {
      expression: "$sift(record, function($value) { $value > 10 })",
      accesses: [
        { path: "record", confidence: "static", coverage: "subtree" },
        { path: "record.*", confidence: "static", coverage: "exact" },
      ],
    },
    {
      expression:
        "$reduce(items, function($acc, $value) { $append($acc, $value.name) }, [])",
      accesses: [
        { path: "items", confidence: "static", coverage: "exact" },
        { path: "items.name", confidence: "static", coverage: "subtree" },
      ],
    },
    {
      expression: "($reverseItems := $reverse(?); $reverseItems(items))",
      accesses: [
        { path: "items", confidence: "static", coverage: "subtree" },
      ],
    },
    {
      expression: "item[$field].name",
      accesses: [
        { path: "item.name", confidence: "static", coverage: "subtree" },
        { path: "item[*]", confidence: "dynamic", coverage: "exact" },
      ],
    },
    {
      expression: "items.%.name",
      accesses: [
        {
          path: "items.%.name",
          confidence: "partial",
          coverage: "subtree",
        },
      ],
    },
  ])("handles composed result semantics for $expression", ({ expression, accesses }) => {
    expect(analyzeExpression(expression)).toEqual({ accesses });
  });

  it("preserves every legacy path, confidence, and position across the corpus", () => {
    for (const { expression } of corpusFixtures) {
      const projected = analyzeExpression(expression).accesses.map(
        ({ coverage: _coverage, ...pathResult }) => pathResult,
      );
      expect(projected, expression).toEqual(extractPaths(expression));
    }
  });

  it("propagates parser failures unchanged", () => {
    let legacyFailure: unknown;
    let analysisFailure: unknown;
    try {
      extractPaths("");
    } catch (error) {
      legacyFailure = error;
    }
    try {
      analyzeExpression("");
    } catch (error) {
      analysisFailure = error;
    }
    const withoutStack = (failure: unknown) => {
      if (!failure || typeof failure !== "object") return failure;
      const { stack: _stack, ...details } = failure as Record<string, unknown>;
      return details;
    };
    expect(withoutStack(analysisFailure)).toEqual(withoutStack(legacyFailure));
  });
});
