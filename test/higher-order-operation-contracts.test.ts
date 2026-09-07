import { describe, expect, it } from "vitest";
import { createScope, resolveVariable, type DynamicObjectAlias } from "../src/scope.js";
import type { AstNode, LambdaNode, VariableNode } from "../src/types.js";
import { walkerRuntime } from "./support/walker-runtime.js";

const name = (value: string): AstNode => ({ type: "name", value, position: 0 });
const param: VariableNode = { type: "variable", value: "value", position: 0 };
const lambda = (definition: string): LambdaNode => ({ type: "lambda", position: 0, arguments: [param], body: param, signature: { definition } });

describe("higher-order parameter contracts", () => {
  it.each([
    { signature: "<(sn)-:s>", expected: 0 },
    { signature: "<a<n>s-:n>", expected: 1 },
    { signature: "<f<a<n>:n>s-:n>", expected: 1 },
    { signature: "<a<n>:n>", expected: -1 },
    { signature: "<s:n>", expected: -1 },
  ])("locates the implicit-context parameter in $signature", ({ signature, expected }) => {
    expect(walkerRuntime().higherOrder.contextDefaultParameterIndex(lambda(signature))).toBe(expected);
  });

  it("uses the collection as the default reduce accumulator and preserves callback argument order", () => {
    const value = name("item");
    const collection = name("items");
    expect(walkerRuntime().higherOrder.higherOrderCallbackCallArguments("reduce", value, collection, [], 12)).toEqual([
      collection, value, { type: "number", value: 0, position: 12 }, collection,
    ]);
  });

  it("does not invent callback parameters for a function with no registered semantics", () => {
    expect(walkerRuntime().higherOrder.higherOrderCallbackCallArguments("custom", name("item"), name("items"), [], 0)).toEqual([]);
  });

  it("leaves the scope intact for an unknown parameter role", () => {
    const scope = createScope();
    const result = walkerRuntime().higherOrder.bindHigherOrderParameter(scope, "map", param, "unknown-role", ["items"], name("items"), scope);
    expect(resolveVariable(result, "value")).toBeNull();
    expect(result).toBe(scope);
  });

  it("binds a recognized data role even if there is no data AST available", () => {
    const scope = createScope();
    const result = walkerRuntime().higherOrder.bindHigherOrderParameter(scope, "map", param, "element", ["items"], undefined, scope);
    expect(resolveVariable(result, "value")).toEqual(["items"]);
  });

  it("does not prefix dynamic aliases when no context has been supplied", () => {
    const alias: DynamicObjectAlias = { variants: [{ scope: createScope(), node: { type: "object", position: 0, entries: [[name("key"), name("value")]] } }] };
    const higherOrder = walkerRuntime().higherOrder;
    expect(higherOrder.prefixDynamicObjectAlias(alias, [])).toEqual(alias);
    expect(higherOrder.resolveCallbackDynamicObjectAliasParentPaths(alias, [])).toEqual(alias);
  });

  it("composes existing and new contexts for dynamic aliases", () => {
    const variant = { scope: createScope(), node: { type: "object" as const, position: 0, entries: [] }, contextBasePaths: ["items"] };
    expect(walkerRuntime().higherOrder.prefixDynamicObjectAlias({ variants: [variant] }, ["orders", "returns"])).toEqual({
      variants: [{ ...variant, contextBasePaths: ["orders.items", "returns.items"] }],
    });
  });

  it("resolves parent-relative static aliases before applying a variant context", () => {
    const variant = { scope: createScope(), node: { type: "object" as const, position: 0, entries: [] }, parentDataArgPaths: ["orders.items"], contextBasePaths: ["root"] };
    expect(walkerRuntime().higherOrder.resolveDynamicVariantObjectAlias(new Map([["copy", ["%.total"]]]), variant)).toEqual(new Map([["copy", ["root.orders.total"]]]));
  });

  it("preserves static aliases without a parent or context override", () => {
    const variant = { scope: createScope(), node: { type: "object" as const, position: 0, entries: [] } };
    const alias = new Map([["copy", ["source"]]]);
    expect(walkerRuntime().higherOrder.resolveDynamicVariantObjectAlias(alias, variant)).toEqual(alias);
  });

  it("propagates both parent and context bindings into nested dynamic aliases", () => {
    const variant = { scope: createScope(), node: { type: "object" as const, position: 0, entries: [] }, parentDataArgPaths: ["orders.items"], contextBasePaths: ["root"] };
    const child = { scope: createScope(), node: { type: "object" as const, position: 0, entries: [] } };
    expect(walkerRuntime().higherOrder.resolveDynamicVariantDynamicObjectAlias({ variants: [child] }, variant)).toEqual({
      variants: [{ ...child, parentDataArgPaths: ["orders.items"], contextBasePaths: ["root"] }],
    });
  });

  it("resolves a parent reference to the collection parent itself", () => {
    expect(walkerRuntime().higherOrder.resolveCallbackParentPaths(["%", "%.total"], ["orders.items"])).toEqual(["orders", "orders.total"]);
  });
});
