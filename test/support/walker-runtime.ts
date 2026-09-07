import { createAliasOperations } from "../../src/walker/aliases.js";
import { createCallableOperations } from "../../src/walker/callables.js";
import { createCoreOperations } from "../../src/walker/core.js";
import { createFunctionOperations } from "../../src/walker/functions.js";
import { createHigherOrderOperations } from "../../src/walker/higher-order.js";
import { createPathOperations } from "../../src/walker/paths.js";
import { createResultOperations } from "../../src/walker/results.js";
import { createTransformOperations } from "../../src/walker/transforms.js";
import type { WalkerRuntime } from "../../src/walker/runtime.js";

/** Real collaborating operations, for contracts below the parser boundary. */
export function walkerRuntime(opaqueFunctions: string[] = []): WalkerRuntime {
  const runtime = {} as WalkerRuntime;
  const options = { opaqueFunctions: new Set(opaqueFunctions) };
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
