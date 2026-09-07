import { describe, expect, it } from "vitest";
import { bindLambdaReference, bindVariable, createScope, resolveLambda } from "../src/scope.js";
import type { LambdaNode } from "../src/types.js";

describe("anonymous lambda references", () => {
  it("assigns the referenced binding name while preserving closure and forward scopes", () => {
    const closure = bindVariable(createScope(), "captured", ["source.value"]);
    const forward = bindVariable(closure, "later", ["source.next"]);
    const lambda: LambdaNode = { type: "lambda", position: 0, arguments: [], body: { type: "variable", value: "captured", position: 0 } };
    const result = bindLambdaReference(createScope(), "callback", { lambda, scope: closure }, forward);
    expect(resolveLambda(result, "callback")).toEqual({ lambda, scope: closure, name: "callback", forwardScope: forward });
    expect(resolveLambda(closure, "callback")).toBeNull();
  });
});
