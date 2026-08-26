import type { AstNode } from "../types.js";
import type { ScopeTracker } from "../scope.js";
import type { WalkerRuntime } from "./runtime.js";
import { createCoreOperations } from "./core.js";
import { createPathOperations } from "./paths.js";
import { createAliasOperations } from "./aliases.js";
import { createCallableOperations } from "./callables.js";
import { createFunctionOperations } from "./functions.js";
import { createHigherOrderOperations } from "./higher-order.js";
import { createTransformOperations } from "./transforms.js";
import { createResultOperations } from "./results.js";

const runtime = {} as WalkerRuntime;
runtime.core = createCoreOperations(runtime);
runtime.paths = createPathOperations(runtime);
runtime.aliases = createAliasOperations(runtime);
runtime.callables = createCallableOperations(runtime);
runtime.functions = createFunctionOperations(runtime);
runtime.higherOrder = createHigherOrderOperations(runtime);
runtime.transforms = createTransformOperations(runtime);
runtime.results = createResultOperations(runtime);

export function walkNode(node: AstNode, scope: ScopeTracker): string[] {
  return runtime.core.walkNode(node, scope);
}
