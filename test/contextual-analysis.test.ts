import { describe, expect, it } from "vitest";

import {
  analyzeExpression,
  analyzeExpressionWithContext,
} from "../src/index.js";

describe("contextual analysis", () => {
  it("retains root, current, and parent origins without synthetic path segments", () => {
    expect(
      analyzeExpressionWithContext(
        "[$$.account.id, $.line.description, $parent.currency]",
        {
          context: {
            currentPath: "order.lines",
            parentPath: "order",
            parentVariable: "$parent",
          },
        },
      ),
    ).toEqual({
      diagnostics: [],
      accesses: [
        {
          path: "account.id",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "subtree",
        },
        {
          path: "order.lines.line.description",
          origin: "current",
          kind: "path",
          confidence: "static",
          coverage: "subtree",
        },
        {
          path: "order.currency",
          origin: "parent",
          kind: "path",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("keeps explicit wildcards distinct from dynamic and unresolved accesses", () => {
    expect(
      analyzeExpressionWithContext(
        "[$$.orders.*, $lookup(item, key), $eval(program)]",
      ),
    ).toEqual({
      diagnostics: [],
      accesses: [
        {
          path: "orders.*",
          origin: "root",
          kind: "wildcard",
          confidence: "static",
          coverage: "subtree",
        },
        {
          path: "item",
          origin: "current",
          kind: "path",
          confidence: "static",
          coverage: "exact",
        },
        {
          path: "key",
          origin: "current",
          kind: "path",
          confidence: "static",
          coverage: "exact",
        },
        {
          path: "item[*]",
          origin: "current",
          kind: "dynamic",
          confidence: "dynamic",
          coverage: "subtree",
        },
        {
          path: "program",
          origin: "current",
          kind: "path",
          confidence: "static",
          coverage: "exact",
        },
        {
          path: "",
          origin: "root",
          kind: "unresolved",
          confidence: "static",
          coverage: "exact",
        },
      ],
    });
  });

  it("applies external-function argument contracts independently", () => {
    expect(
      analyzeExpression("$host(payload, settings)", {
        externalFunctions: {
          host: { arguments: ["value", "subtree"] },
        },
      }),
    ).toEqual({
      accesses: [
        {
          path: "payload",
          confidence: "static",
          coverage: "exact",
        },
        {
          path: "settings",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("does not widen reads used only to compute a subtree argument", () => {
    expect(
      analyzeExpression("$host($count(items))", {
        externalFunctions: { host: { arguments: "subtree" } },
      }),
    ).toEqual({
      accesses: [
        {
          path: "items",
          confidence: "static",
          coverage: "exact",
        },
      ],
    });
  });

  it("widens both possible values of a conditional subtree argument", () => {
    expect(
      analyzeExpression("$host(flag ? primary : fallback)", {
        externalFunctions: { host: { arguments: "subtree" } },
      }),
    ).toEqual({
      accesses: [
        { path: "flag", confidence: "static", coverage: "exact" },
        { path: "primary", confidence: "static", coverage: "subtree" },
        { path: "fallback", confidence: "static", coverage: "subtree" },
      ],
    });
  });

  it("defaults omitted external argument modes to value", () => {
    expect(
      analyzeExpression("$host(payload, settings)", {
        externalFunctions: { host: { arguments: ["subtree"] } },
      }),
    ).toEqual({
      accesses: [
        { path: "payload", confidence: "static", coverage: "subtree" },
        { path: "settings", confidence: "static", coverage: "exact" },
      ],
    });
  });

  it("widens input values embedded in a constructed subtree argument", () => {
    expect(
      analyzeExpression('$host({"payload": payload, "count": $count(items)})', {
        externalFunctions: { host: { arguments: "subtree" } },
      }),
    ).toEqual({
      accesses: [
        { path: "payload", confidence: "static", coverage: "subtree" },
        { path: "items", confidence: "static", coverage: "exact" },
      ],
    });
  });

  it("lets JSONata-local callables shadow external contracts", () => {
    expect(
      analyzeExpression(
        "($host := function($value) { $value.id }; $host(payload))",
        {
          externalFunctions: {
            host: { arguments: "subtree" },
          },
        },
      ),
    ).toEqual({
      accesses: [
        {
          path: "payload",
          confidence: "static",
          coverage: "exact",
        },
        {
          path: "payload.id",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });
});

describe("production-shaped projection regressions", () => {
  it("retains root origin for selected values inside root projections", () => {
    expect(
      analyzeExpressionWithContext(
        '$$.orders[0].{"result": $.details}',
      ),
    ).toEqual({
      diagnostics: [],
      accesses: [
        {
          path: "orders",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "exact",
        },
        {
          path: "orders.details",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("preserves mixed conditional merge aliases as projection contexts", () => {
    expect(
      analyzeExpressionWithContext(
        "($base := $$.orders[0].items[0].details; " +
          "$extra := $$.orders[0].extra; " +
          '$combined := $extra ? $merge([$base, {"extra": $extra}]) : $base; ' +
          '$combined.{"code": $.code})',
      ),
    ).toEqual({
      diagnostics: [],
      accesses: [
        {
          path: "orders.items.details",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "exact",
        },
        {
          path: "orders.extra",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "exact",
        },
        {
          path: "orders.items.details.code",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("keeps explicit root and current reads with the same suffix distinct", () => {
    expect(
      analyzeExpressionWithContext(
        '($base := $$.orders[0].details; ' +
          '$base.{"local": $.code, "root": $$.code})',
      ),
    ).toEqual({
      diagnostics: [],
      accesses: [
        {
          path: "orders.details",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "exact",
        },
        {
          path: "orders.details.code",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "subtree",
        },
        {
          path: "code",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("retains deep leaves for conditional variable projection contexts", () => {
    expect(
      analyzeExpression(
        "($target := flag ? $$.primary.stop : $$.fallback.stop; " +
          '$target.{"location": $.location.{"city": $.city}})',
      ),
    ).toEqual({
      accesses: [
        { path: "flag", confidence: "static", coverage: "exact" },
        { path: "primary.stop", confidence: "static", coverage: "exact" },
        { path: "fallback.stop", confidence: "static", coverage: "exact" },
        {
          path: "primary.stop.location",
          confidence: "static",
          coverage: "subtree",
        },
        {
          path: "primary.stop.location.city",
          confidence: "static",
          coverage: "subtree",
        },
        {
          path: "fallback.stop.location",
          confidence: "static",
          coverage: "subtree",
        },
        {
          path: "fallback.stop.location.city",
          confidence: "static",
          coverage: "subtree",
        },
      ],
    });
  });

  it("keeps coverage separate when root and current resolve to the same path", () => {
    expect(
      analyzeExpressionWithContext("[$$.order.foo, $count($.foo)]", {
        context: { currentPath: "order" },
      }),
    ).toEqual({
      diagnostics: [],
      accesses: [
        {
          path: "order.foo",
          origin: "root",
          kind: "path",
          confidence: "static",
          coverage: "subtree",
        },
        {
          path: "order.foo",
          origin: "current",
          kind: "path",
          confidence: "static",
          coverage: "exact",
        },
      ],
    });
  });

  it("returns parse diagnostics without inventing accesses", () => {
    const result = analyzeExpressionWithContext("$.foo[");

    expect(result.accesses).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ kind: "parse", message: expect.any(String) }),
    ]);
  });
});
