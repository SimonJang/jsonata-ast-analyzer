import type { AstNode } from "../types.js";
import type { ExternalFunctionContract } from "../types.js";
import type { ScopeTracker } from "../scope.js";
import type { WalkerOptions, WalkerRuntime } from "./runtime.js";
import { createCoreOperations } from "./core.js";
import { createPathOperations } from "./paths.js";
import { createAliasOperations } from "./aliases.js";
import { createCallableOperations } from "./callables.js";
import { createFunctionOperations } from "./functions.js";
import { createHigherOrderOperations } from "./higher-order.js";
import { createTransformOperations } from "./transforms.js";
import { createResultOperations } from "./results.js";
import { createSelectionOperations } from "./selection.js";

export interface Walker {
  walkNode(node: AstNode, scope: ScopeTracker): string[];
  getSelectedResultPaths(node: AstNode, scope: ScopeTracker): string[];
  getExternalSubtreeAccessPaths(): readonly string[];
}

function createRuntime(options: WalkerOptions): WalkerRuntime {
  const runtime = {} as WalkerRuntime;
  runtime.core = createCoreOperations(runtime);
  runtime.paths = createPathOperations(runtime);
  runtime.aliases = createAliasOperations(runtime);
  runtime.callables = createCallableOperations(runtime);
  runtime.functions = createFunctionOperations(runtime, options);
  runtime.higherOrder = createHigherOrderOperations(runtime);
  runtime.transforms = createTransformOperations(runtime);
  runtime.results = createResultOperations(runtime, options);
  return runtime;
}

export function createWalker(
  opaqueFunctions: ReadonlySet<string> = new Set(),
  externalFunctions: ReadonlyMap<string, ExternalFunctionContract> = new Map(),
): Walker {
  const externalSubtreeAccessPaths: string[] = [];
  const runtime = createRuntime({
    opaqueFunctions,
    externalFunctions,
    recordExternalSubtreeAccesses: (paths) => {
      externalSubtreeAccessPaths.push(...paths);
    },
  });
  const selection = createSelectionOperations(runtime);
  return {
    walkNode: runtime.core.walkNode,
    getSelectedResultPaths: selection.getSelectedResultPaths,
    getExternalSubtreeAccessPaths: () => externalSubtreeAccessPaths,
  };
}

const defaultRuntime = {} as WalkerRuntime;
defaultRuntime.core = createCoreOperations(defaultRuntime);
defaultRuntime.paths = createPathOperations(defaultRuntime);
defaultRuntime.aliases = createAliasOperations(defaultRuntime);
defaultRuntime.callables = createCallableOperations(defaultRuntime);
const defaultOptions = {
  opaqueFunctions: new Set<string>(),
  externalFunctions: new Map<string, ExternalFunctionContract>(),
  recordExternalSubtreeAccesses: () => undefined,
};
defaultRuntime.functions = createFunctionOperations(defaultRuntime, defaultOptions);
defaultRuntime.higherOrder = createHigherOrderOperations(defaultRuntime);
defaultRuntime.transforms = createTransformOperations(defaultRuntime);
defaultRuntime.results = createResultOperations(defaultRuntime, defaultOptions);

export function walkNode(node: AstNode, scope: ScopeTracker): string[] {
  return defaultRuntime.core.walkNode(node, scope);
}
