import { describe, expect, it } from "vitest";
import { parse } from "../src/parser.js";

function collectTypes(value: unknown, types: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectTypes(item, types);
    return types;
  }
  if (!value || typeof value !== "object") return types;

  const record = value as Record<string, unknown>;
  if (typeof record.type === "string") types.push(record.type);
  for (const [key, child] of Object.entries(record)) {
    if (key !== "source") collectTypes(child, types);
  }
  return types;
}

function findNode(value: unknown, type: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNode(item, type);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  if (record.type === type) return record;
  for (const [key, child] of Object.entries(record)) {
    if (key === "source") continue;
    const found = findNode(child, type);
    if (found) return found;
  }
  return undefined;
}

describe("AST normalization", () => {
  const fixtures = [
    {
      expression: '[a, {"net": -price}]',
      expectedTypes: ["array", "object", "negate"],
    },
    {
      expression: "items@$item[$item.price > 10].name",
      expectedTypes: ["context-binding", "filter"],
    },
    {
      expression: "items#$i.name",
      expectedTypes: ["position-binding"],
    },
    {
      expression: "items^(>date){category: total}",
      expectedTypes: ["sort", "group"],
    },
    {
      expression: "orders.items.%.date",
      expectedTypes: ["parent"],
    },
    {
      expression: "**.price",
      expectedTypes: ["descendant"],
    },
    {
      expression: "$map(items,function($v){$v.name})",
      expectedTypes: ["lambda"],
    },
    {
      expression: "$match(description,/urgent/i)",
      expectedTypes: ["regex"],
    },
    {
      expression: "($first5 := $substring(?,0,5); $first5(customer.name))",
      expectedTypes: ["partial"],
    },
    {
      expression: '| account | {"displayName": firstName & lastName} |',
      expectedTypes: ["transform", "object"],
    },
  ];

  for (const fixture of fixtures) {
    it(`normalizes ${fixture.expression}`, () => {
      const ast = parse(fixture.expression);
      const types = collectTypes(ast);

      for (const type of fixture.expectedTypes) {
        expect(types).toContain(type);
      }
      expect(types).not.toContain("unary");
    });
  }

  it("preserves upstream source metadata for converted parser nodes", () => {
    const ast = parse('[{"net": -price}]');

    expect(findNode(ast, "array")?.source).toMatchObject({ type: "unary", value: "[" });
    expect(findNode(ast, "object")?.source).toMatchObject({ type: "unary", value: "{" });
    expect(findNode(ast, "negate")?.source).toMatchObject({ type: "unary", value: "-" });
  });
});
