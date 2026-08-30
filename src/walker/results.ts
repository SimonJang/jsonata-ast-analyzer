import type { ArrayNode, AstNode, ApplyNode, BindNode, BlockNode, ConditionNode, FunctionNode, LambdaNode, NameNode, ObjectNode, PathNode, VariableNode, WildcardNode } from "../types.js";
import { buildPathString } from "../path-builder.js";
import { type ScopeTracker, childScope, bindVariable, resolveLambda, resolvePartial, resolveTransform, resolveVariable, resolveSuffixBasePaths, resolveObjectAlias, type DynamicObjectAlias, type LambdaBinding, type ObjectAlias } from "../scope.js";
import { BUILTIN_FUNCTIONS, HIGHER_ORDER_SEMANTICS } from "../builtins.js";
import { ROOT_PATH, PATH_PRESERVING_RESULT_FUNCTIONS } from "./constants.js";
import { appendPath, resolveParentPathSegments, filterToBasePaths } from "./path-utils.js";
import { externalFunctionContract, type ResultOperations, type WalkerOptions, type WalkerRuntime } from "./runtime.js";

const DEFAULT_OPTIONS: WalkerOptions = {
  opaqueFunctions: new Set(),
  externalFunctions: new Map(),
  recordExternalSubtreeAccesses: () => undefined,
};

export function createResultOperations(
  runtime: WalkerRuntime,
  options: WalkerOptions = DEFAULT_OPTIONS,
): ResultOperations {
  function getFunctionResultObjectAlias(
    node: FunctionNode,
    scope: ScopeTracker,
  ): ObjectAlias | null {
    if (node.procedure.type === "lambda") {
      return getCustomFunctionResultObjectAlias(
        { lambda: node.procedure, scope },
        node.arguments,
        scope,
      );
    }
    if (node.procedure.type === "transform") {
      return node.arguments[0]
        ? runtime.aliases.groupResultObjectAliasForNode(node.arguments[0], scope)
        : null;
    }
    if (node.procedure.type === "condition") {
      return runtime.aliases.mergeObjectAliases(
        runtime.functions.conditionalProcedureCalls(node).map((call) =>
          getFunctionResultObjectAlias(call, scope),
        ),
      );
    }
    if (node.procedure.type === "variable") {
      const partialBinding = resolvePartial(scope, node.procedure.value);
      if (partialBinding) {
        return getPartialFunctionResultObjectAlias(
          partialBinding,
          node.arguments,
          scope,
        );
      }
      const storedCallables = runtime.callables.resolveCallableValues(node.procedure, scope);
      if (storedCallables.length > 0) {
        return runtime.aliases.mergeObjectAliases(
          storedCallables.map((callable) => {
            if (callable.kind === "lambda") {
              return getCustomFunctionResultObjectAlias(
                callable.binding,
                node.arguments,
                scope,
              );
            }
            if (callable.kind === "transform") {
              return node.arguments[0]
                ? runtime.aliases.groupResultObjectAliasForNode(node.arguments[0], scope)
                : null;
            }
            return getPartialFunctionResultObjectAlias(
              callable.binding,
              node.arguments,
              scope,
            );
          }),
        );
      }
    }
    if (
      node.procedure.type === "function" ||
      node.procedure.type === "block" ||
      node.procedure.type === "path" ||
      node.procedure.type === "partial" ||
      runtime.callables.isFilteredCallableVariable(node.procedure)
    ) {
      return runtime.aliases.mergeObjectAliases(
        runtime.callables.resolveCallableValues(node.procedure, scope).map((callable) => {
          if (callable.kind === "lambda") {
            return getCustomFunctionResultObjectAlias(
              callable.binding,
              node.arguments,
              scope,
            );
          }
          if (callable.kind === "transform") {
            return node.arguments[0]
              ? runtime.aliases.groupResultObjectAliasForNode(node.arguments[0], scope)
              : null;
          }
          return getFunctionResultObjectAlias(
            {
              ...node,
              procedure: callable.binding.partial.procedure,
              arguments: runtime.higherOrder.applyPartialArguments(
                callable.binding.partial,
                node.arguments,
              ),
            },
            callable.binding.scope,
          );
        }),
      );
    }
  
    if (!BUILTIN_FUNCTIONS.has(node.procedure.value)) {
      const storedBuiltins = runtime.callables.resolveBuiltinCallableNames(node.procedure, scope);
      if (storedBuiltins.length > 0) {
        return runtime.aliases.mergeObjectAliases(
          storedBuiltins.map((name) =>
            getFunctionResultObjectAlias(
              {
                ...node,
                procedure: { type: "variable", value: name, position: node.position },
              },
              scope,
            ),
          ),
        );
      }
    }
  
    const partialBinding = resolvePartial(scope, node.procedure.value);
    let funcName = node.procedure.value;
    let args = node.arguments;
    let argScope = scope;
  
    if (partialBinding) {
      if (partialBinding.partial.procedure.type !== "variable") {
        return getFunctionResultObjectAlias(
          {
            ...node,
            procedure: partialBinding.partial.procedure,
            arguments: runtime.higherOrder.applyPartialArguments(partialBinding.partial, node.arguments),
          },
          partialBinding.scope,
        );
      }
      funcName = partialBinding.partial.procedure.value;
      args = runtime.higherOrder.applyPartialArguments(partialBinding.partial, node.arguments);
      argScope = partialBinding.scope;
    }
    args = runtime.functions.withImplicitRootFunctionArgument(funcName, args, node.position, argScope);
  
    const lambdaBinding = resolveLambda(argScope, funcName);
    if (lambdaBinding) {
      return getCustomFunctionResultObjectAlias(lambdaBinding, args, argScope);
    }
  
    if (resolveTransform(argScope, funcName)) {
      return args[0] ? runtime.aliases.groupResultObjectAliasForNode(args[0], argScope) : null;
    }

    if (externalFunctionContract(options, funcName)) return null;
  
    if (funcName === "eval") {
      return runtime.functions.getStaticEvalResultObjectAlias(args, argScope);
    }
  
    if (funcName === "map" || funcName === "each") {
      return getCallbackResultObjectAlias(funcName, args, argScope);
    }
    if (funcName === "reduce") {
      return getReduceResultObjectAlias(args, argScope);
    }
  
    if (funcName === "lookup") {
      return getLookupResultObjectAlias(args, argScope);
    }
  
    if (!PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName)) return null;
    if (funcName === "append" || funcName === "zip") {
      return runtime.aliases.mergeObjectAliases(
        args.map((arg) => runtime.aliases.groupResultObjectAliasForNode(arg, argScope)),
      );
    }
    return args.length > 0
      ? runtime.aliases.groupResultObjectAliasForNode(args[0], argScope)
      : null;
  }

  function getFunctionResultDynamicObjectAlias(
    node: FunctionNode,
    scope: ScopeTracker,
  ): DynamicObjectAlias | null {
    if (node.procedure.type === "lambda") {
      return getCustomFunctionResultDynamicObjectAlias(
        { lambda: node.procedure, scope },
        node.arguments,
        scope,
      );
    }
    if (node.procedure.type === "transform") {
      return node.arguments[0]
        ? runtime.aliases.groupResultDynamicObjectAliasForNode(node.arguments[0], scope)
        : null;
    }
    if (node.procedure.type === "condition") {
      return runtime.aliases.mergeDynamicObjectAliases(
        runtime.functions.conditionalProcedureCalls(node).map((call) =>
          getFunctionResultDynamicObjectAlias(call, scope),
        ),
      );
    }
    if (node.procedure.type === "variable") {
      const partialBinding = resolvePartial(scope, node.procedure.value);
      if (partialBinding) {
        return getPartialFunctionResultDynamicObjectAlias(
          partialBinding,
          node.arguments,
          scope,
        );
      }
      const storedCallables = runtime.callables.resolveCallableValues(node.procedure, scope);
      if (storedCallables.length > 0) {
        return runtime.aliases.mergeDynamicObjectAliases(
          storedCallables.map((callable) => {
            if (callable.kind === "lambda") {
              return getCustomFunctionResultDynamicObjectAlias(
                callable.binding,
                node.arguments,
                scope,
              );
            }
            if (callable.kind === "transform") {
              return node.arguments[0]
                ? runtime.aliases.groupResultDynamicObjectAliasForNode(node.arguments[0], scope)
                : null;
            }
            return getPartialFunctionResultDynamicObjectAlias(
              callable.binding,
              node.arguments,
              scope,
            );
          }),
        );
      }
    }
    if (
      node.procedure.type === "function" ||
      node.procedure.type === "block" ||
      node.procedure.type === "path" ||
      node.procedure.type === "partial" ||
      runtime.callables.isFilteredCallableVariable(node.procedure)
    ) {
      return runtime.aliases.mergeDynamicObjectAliases(
        runtime.callables.resolveCallableValues(node.procedure, scope).map((callable) => {
          if (callable.kind === "lambda") {
            return getCustomFunctionResultDynamicObjectAlias(
              callable.binding,
              node.arguments,
              scope,
            );
          }
          if (callable.kind === "transform") {
            return node.arguments[0]
              ? runtime.aliases.groupResultDynamicObjectAliasForNode(node.arguments[0], scope)
              : null;
          }
          return getFunctionResultDynamicObjectAlias(
            {
              ...node,
              procedure: callable.binding.partial.procedure,
              arguments: runtime.higherOrder.applyPartialArguments(
                callable.binding.partial,
                node.arguments,
              ),
            },
            callable.binding.scope,
          );
        }),
      );
    }
  
    if (!BUILTIN_FUNCTIONS.has(node.procedure.value)) {
      const storedBuiltins = runtime.callables.resolveBuiltinCallableNames(node.procedure, scope);
      if (storedBuiltins.length > 0) {
        return runtime.aliases.mergeDynamicObjectAliases(
          storedBuiltins.map((name) =>
            getFunctionResultDynamicObjectAlias(
              {
                ...node,
                procedure: { type: "variable", value: name, position: node.position },
              },
              scope,
            ),
          ),
        );
      }
    }
  
    const partialBinding = resolvePartial(scope, node.procedure.value);
    let funcName = node.procedure.value;
    let args = node.arguments;
    let argScope = scope;
  
    if (partialBinding) {
      if (partialBinding.partial.procedure.type !== "variable") {
        return getFunctionResultDynamicObjectAlias(
          {
            ...node,
            procedure: partialBinding.partial.procedure,
            arguments: runtime.higherOrder.applyPartialArguments(partialBinding.partial, node.arguments),
          },
          partialBinding.scope,
        );
      }
      funcName = partialBinding.partial.procedure.value;
      args = runtime.higherOrder.applyPartialArguments(partialBinding.partial, node.arguments);
      argScope = partialBinding.scope;
    }
    args = runtime.functions.withImplicitRootFunctionArgument(funcName, args, node.position, argScope);
  
    const lambdaBinding = resolveLambda(argScope, funcName);
    if (lambdaBinding) {
      return getCustomFunctionResultDynamicObjectAlias(lambdaBinding, args, argScope);
    }
  
    if (resolveTransform(argScope, funcName)) {
      return args[0]
        ? runtime.aliases.groupResultDynamicObjectAliasForNode(args[0], argScope)
        : null;
    }

    if (externalFunctionContract(options, funcName)) return null;
  
    if (funcName === "eval") {
      return runtime.functions.getStaticEvalResultDynamicObjectAlias(args, argScope);
    }
  
    if (funcName === "map" || funcName === "each") {
      return getCallbackResultDynamicObjectAlias(funcName, args, argScope);
    }
    if (funcName === "reduce") {
      return getReduceResultDynamicObjectAlias(args, argScope);
    }
  
    if (funcName === "lookup") {
      return getLookupResultDynamicObjectAlias(args, argScope);
    }
  
    if (!PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName)) return null;
    if (funcName === "append" || funcName === "zip") {
      return runtime.aliases.mergeDynamicObjectAliases(
        args.map((arg) => runtime.aliases.groupResultDynamicObjectAliasForNode(arg, argScope)),
      );
    }
    return args.length > 0
      ? runtime.aliases.groupResultDynamicObjectAliasForNode(args[0], argScope)
      : null;
  }

  function getPartialFunctionResultObjectAlias(
    binding: NonNullable<ReturnType<typeof resolvePartial>>,
    callArgs: AstNode[],
    callScope: ScopeTracker,
  ): ObjectAlias | null {
    const appliedArgs = runtime.higherOrder.applyPartialArguments(binding.partial, callArgs);
    const aliases = runtime.callables.resolveCallableValues(
      binding.partial.procedure,
      binding.scope,
    ).map((callable) => {
      if (callable.kind === "lambda") {
        return getCustomFunctionResultObjectAlias(
          callable.binding,
          appliedArgs,
          callScope,
        );
      }
      if (callable.kind === "transform") {
        return appliedArgs[0]
          ? runtime.aliases.groupResultObjectAliasForNode(appliedArgs[0], callScope)
          : null;
      }
      return getPartialFunctionResultObjectAlias(
        callable.binding,
        appliedArgs,
        callScope,
      );
    });
    for (const name of runtime.callables.resolveBuiltinCallableNames(
      binding.partial.procedure,
      binding.scope,
    )) {
      aliases.push(
        getFunctionResultObjectAlias(
          {
            type: "function",
            value: "(",
            position: binding.partial.position,
            procedure: {
              type: "variable",
              value: name,
              position: binding.partial.position,
            },
            arguments: appliedArgs,
          },
          callScope,
        ),
      );
    }
    return runtime.aliases.mergeObjectAliases(aliases);
  }

  function getPartialFunctionResultDynamicObjectAlias(
    binding: NonNullable<ReturnType<typeof resolvePartial>>,
    callArgs: AstNode[],
    callScope: ScopeTracker,
  ): DynamicObjectAlias | null {
    const appliedArgs = runtime.higherOrder.applyPartialArguments(binding.partial, callArgs);
    const aliases = runtime.callables.resolveCallableValues(
      binding.partial.procedure,
      binding.scope,
    ).map((callable) => {
      if (callable.kind === "lambda") {
        return getCustomFunctionResultDynamicObjectAlias(
          callable.binding,
          appliedArgs,
          callScope,
        );
      }
      if (callable.kind === "transform") {
        return appliedArgs[0]
          ? runtime.aliases.groupResultDynamicObjectAliasForNode(appliedArgs[0], callScope)
          : null;
      }
      return getPartialFunctionResultDynamicObjectAlias(
        callable.binding,
        appliedArgs,
        callScope,
      );
    });
    for (const name of runtime.callables.resolveBuiltinCallableNames(
      binding.partial.procedure,
      binding.scope,
    )) {
      aliases.push(
        getFunctionResultDynamicObjectAlias(
          {
            type: "function",
            value: "(",
            position: binding.partial.position,
            procedure: {
              type: "variable",
              value: name,
              position: binding.partial.position,
            },
            arguments: appliedArgs,
          },
          callScope,
        ),
      );
    }
    return runtime.aliases.mergeDynamicObjectAliases(aliases);
  }

  function getCustomFunctionResultObjectAlias(
    binding: LambdaBinding,
    callArgs: AstNode[],
    callScope: ScopeTracker,
    defaultsApplied = false,
  ): ObjectAlias | null {
    const { lambda, scope } = binding;
    if (!defaultsApplied) {
      const variants = runtime.higherOrder.lambdaContextDefaultArgumentVariants(lambda, callArgs);
      if (variants.length > 1 || variants[0] !== callArgs) {
        return runtime.aliases.mergeObjectAliases(
          variants.map((args) =>
            getCustomFunctionResultObjectAlias(binding, args, callScope, true),
          ),
        );
      }
    }
    let lambdaScope = childScope(scope);
  
    for (let i = 0; i < lambda.arguments.length; i++) {
      const param = lambda.arguments[i];
      const argPaths = i < callArgs.length ? runtime.higherOrder.extractBasePaths(callArgs[i], callScope) : [];
      lambdaScope =
        i < callArgs.length
          ? runtime.higherOrder.bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
          : bindVariable(lambdaScope, param.value, argPaths);
    }
    lambdaScope = runtime.callables.bindForwardReferences(
      lambdaScope,
      lambda,
      binding.forwardScope ?? callScope,
      binding.name,
    );
  
    const alias = runtime.aliases.groupResultObjectAliasForNode(lambda.body, lambdaScope);
    const firstArgPaths = callArgs[0] ? runtime.higherOrder.extractBasePaths(callArgs[0], callScope) : [];
    return alias ? runtime.higherOrder.resolveCallbackObjectAliasParentPaths(alias, firstArgPaths) : null;
  }

  function getCustomFunctionResultDynamicObjectAlias(
    binding: LambdaBinding,
    callArgs: AstNode[],
    callScope: ScopeTracker,
    defaultsApplied = false,
  ): DynamicObjectAlias | null {
    const { lambda, scope } = binding;
    if (!defaultsApplied) {
      const variants = runtime.higherOrder.lambdaContextDefaultArgumentVariants(lambda, callArgs);
      if (variants.length > 1 || variants[0] !== callArgs) {
        return runtime.aliases.mergeDynamicObjectAliases(
          variants.map((args) =>
            getCustomFunctionResultDynamicObjectAlias(
              binding,
              args,
              callScope,
              true,
            ),
          ),
        );
      }
    }
    let lambdaScope = childScope(scope);
  
    for (let i = 0; i < lambda.arguments.length; i++) {
      const param = lambda.arguments[i];
      const argPaths = i < callArgs.length ? runtime.higherOrder.extractBasePaths(callArgs[i], callScope) : [];
      lambdaScope =
        i < callArgs.length
          ? runtime.higherOrder.bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
          : bindVariable(lambdaScope, param.value, argPaths);
    }
    lambdaScope = runtime.callables.bindForwardReferences(
      lambdaScope,
      lambda,
      binding.forwardScope ?? callScope,
      binding.name,
    );
  
    const alias = runtime.aliases.groupResultDynamicObjectAliasForNode(lambda.body, lambdaScope);
    const firstArgPaths = callArgs[0] ? runtime.higherOrder.extractBasePaths(callArgs[0], callScope) : [];
    return alias
      ? runtime.higherOrder.resolveCallbackDynamicObjectAliasParentPaths(alias, firstArgPaths)
      : null;
  }

  function getCallbackResultObjectAlias(
    funcName: "map" | "each",
    args: AstNode[],
    scope: ScopeTracker,
  ): ObjectAlias | null {
    const callback = runtime.higherOrder.findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
    const builtinCallbacks = args[1]
      ? runtime.callables.resolveBuiltinCallableNames(args[1], scope)
      : [];
    const partialCallbackAliases = runtime.higherOrder.higherOrderPartialCalls(
      funcName,
      args,
      scope,
    ).map((call) =>
      getPartialFunctionResultObjectAlias(
        call.binding,
        call.arguments,
        scope,
      ),
    );
    if (
      !callback &&
      builtinCallbacks.length === 0 &&
      partialCallbackAliases.every((alias) => alias === null)
    ) {
      return null;
    }
  
    const dataArg = args[0];
    const dataArgPaths = runtime.higherOrder.higherOrderCallbackDataPaths(
      funcName,
      dataArg,
      scope,
    );
    return runtime.aliases.mergeObjectAliases(
      [
        ...partialCallbackAliases,
        ...(callback?.bindings ?? []).map((binding) => {
          const lambdaScope = runtime.higherOrder.bindHigherOrderLambdaCallbackScope(
            funcName,
            binding,
            dataArgPaths,
            dataArg,
            scope,
          );
          const alias = runtime.aliases.groupResultObjectAliasForNode(
            binding.lambda.body,
            lambdaScope,
          );
          return alias
            ? runtime.higherOrder.resolveCallbackObjectAliasParentPaths(alias, dataArgPaths)
            : null;
        }),
        ...(callback
          ? runtime.higherOrder.higherOrderPartialLambdaCalls(funcName, callback, dataArg, scope).map((call) =>
              getCustomFunctionResultObjectAlias(
                call.binding,
                call.arguments,
                scope,
              ),
            )
          : []),
        ...builtinCallbacks.flatMap((name) =>
          runtime.higherOrder.higherOrderCallbackDataNodes(funcName, dataArg, scope).map((callbackDataArg) =>
            getFunctionResultObjectAlias(
              {
                type: "function",
                value: "(",
                position: 0,
                procedure: { type: "variable", value: name, position: 0 },
                arguments: [callbackDataArg],
              },
              scope,
            ),
          ),
        ),
      ],
    );
  }

  function getCallbackResultDynamicObjectAlias(
    funcName: "map" | "each",
    args: AstNode[],
    scope: ScopeTracker,
  ): DynamicObjectAlias | null {
    const callback = runtime.higherOrder.findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
    const builtinCallbacks = args[1]
      ? runtime.callables.resolveBuiltinCallableNames(args[1], scope)
      : [];
    const partialCallbackAliases = runtime.higherOrder.higherOrderPartialCalls(
      funcName,
      args,
      scope,
    ).map((call) =>
      getPartialFunctionResultDynamicObjectAlias(
        call.binding,
        call.arguments,
        scope,
      ),
    );
    if (
      !callback &&
      builtinCallbacks.length === 0 &&
      partialCallbackAliases.every((alias) => alias === null)
    ) {
      return null;
    }
  
    const dataArg = args[0];
    const dataArgPaths = runtime.higherOrder.higherOrderCallbackDataPaths(
      funcName,
      dataArg,
      scope,
    );
    return runtime.aliases.mergeDynamicObjectAliases(
      [
        ...partialCallbackAliases,
        ...(callback?.bindings ?? []).map((binding) => {
          const lambdaScope = runtime.higherOrder.bindHigherOrderLambdaCallbackScope(
            funcName,
            binding,
            dataArgPaths,
            dataArg,
            scope,
          );
          const alias = runtime.aliases.groupResultDynamicObjectAliasForNode(
            binding.lambda.body,
            lambdaScope,
          );
          return alias
            ? runtime.higherOrder.resolveCallbackDynamicObjectAliasParentPaths(alias, dataArgPaths)
            : null;
        }),
        ...(callback
          ? runtime.higherOrder.higherOrderPartialLambdaCalls(funcName, callback, dataArg, scope).map((call) =>
              getCustomFunctionResultDynamicObjectAlias(
                call.binding,
                call.arguments,
                scope,
              ),
            )
          : []),
        ...builtinCallbacks.flatMap((name) =>
          runtime.higherOrder.higherOrderCallbackDataNodes(funcName, dataArg, scope).map((callbackDataArg) =>
            getFunctionResultDynamicObjectAlias(
              {
                type: "function",
                value: "(",
                position: 0,
                procedure: { type: "variable", value: name, position: 0 },
                arguments: [callbackDataArg],
              },
              scope,
            ),
          ),
        ),
      ],
    );
  }

  function getReduceResultObjectAlias(
    args: AstNode[],
    scope: ScopeTracker,
  ): ObjectAlias | null {
    const callback = runtime.higherOrder.findHigherOrderCallback(args, scope);
    const resolvedCallback = runtime.higherOrder.findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
    const builtinCallbacks = args[1]
      ? runtime.callables.resolveBuiltinCallableNames(args[1], scope)
      : [];
    const partialCallbackAliases = runtime.higherOrder.higherOrderPartialCalls(
      "reduce",
      args,
      scope,
    ).map((call) =>
      getPartialFunctionResultObjectAlias(
        call.binding,
        call.arguments,
        scope,
      ),
    );
    if (
      !callback &&
      !resolvedCallback?.partials.length &&
      builtinCallbacks.length === 0 &&
      partialCallbackAliases.every((alias) => alias === null)
    ) {
      return null;
    }
  
    const dataArg = args[0];
    const accumulatorArg = args[2] ?? dataArg;
    const dataArgPaths = dataArg ? runtime.higherOrder.extractBasePaths(dataArg, scope) : [];
    const accumulatorPaths = accumulatorArg
      ? runtime.higherOrder.extractBasePaths(accumulatorArg, scope)
      : dataArgPaths;
    let bodyAlias: ObjectAlias | null = null;
    if (callback) {
      let lambdaScope = childScope(callback.scope);
  
      for (let i = 0; i < callback.lambda.arguments.length; i++) {
        const param = callback.lambda.arguments[i];
        const role = HIGHER_ORDER_SEMANTICS.reduce[i];
  
        if (!role) continue;
        lambdaScope =
          role === "accumulator"
            ? runtime.higherOrder.bindHigherOrderParameter(
                lambdaScope,
                "reduce",
                param,
                role,
                accumulatorPaths,
                accumulatorArg,
                scope,
              )
            : runtime.higherOrder.bindHigherOrderParameter(
                lambdaScope,
                "reduce",
                param,
                role,
                dataArgPaths,
                dataArg,
                scope,
              );
      }
  
      bodyAlias = runtime.aliases.groupResultObjectAliasForNode(callback.lambda.body, lambdaScope);
    }
    return runtime.aliases.mergeObjectAliases([
      ...partialCallbackAliases,
      bodyAlias ? runtime.higherOrder.resolveCallbackObjectAliasParentPaths(bodyAlias, dataArgPaths) : null,
      ...(resolvedCallback && dataArg
        ? runtime.higherOrder.higherOrderPartialLambdaCalls(
            "reduce",
            resolvedCallback,
            dataArg,
            scope,
            args,
          ).map((call) =>
            getCustomFunctionResultObjectAlias(call.binding, call.arguments, scope),
          )
        : []),
      args[2] ? runtime.aliases.groupResultObjectAliasForNode(args[2], scope) : null,
      ...(dataArg && accumulatorArg
        ? builtinCallbacks.map((name) =>
            getFunctionResultObjectAlias(
              {
                type: "function",
                value: "(",
                position: 0,
                procedure: { type: "variable", value: name, position: 0 },
                arguments: [accumulatorArg, dataArg],
              },
              scope,
            ),
          )
        : []),
    ]);
  }

  function getReduceResultDynamicObjectAlias(
    args: AstNode[],
    scope: ScopeTracker,
  ): DynamicObjectAlias | null {
    const callback = runtime.higherOrder.findHigherOrderCallback(args, scope);
    const resolvedCallback = runtime.higherOrder.findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
    const builtinCallbacks = args[1]
      ? runtime.callables.resolveBuiltinCallableNames(args[1], scope)
      : [];
    const partialCallbackAliases = runtime.higherOrder.higherOrderPartialCalls(
      "reduce",
      args,
      scope,
    ).map((call) =>
      getPartialFunctionResultDynamicObjectAlias(
        call.binding,
        call.arguments,
        scope,
      ),
    );
    if (
      !callback &&
      !resolvedCallback?.partials.length &&
      builtinCallbacks.length === 0 &&
      partialCallbackAliases.every((alias) => alias === null)
    ) {
      return null;
    }
  
    const dataArg = args[0];
    const accumulatorArg = args[2] ?? dataArg;
    const dataArgPaths = dataArg ? runtime.higherOrder.extractBasePaths(dataArg, scope) : [];
    const accumulatorPaths = accumulatorArg
      ? runtime.higherOrder.extractBasePaths(accumulatorArg, scope)
      : dataArgPaths;
    let callbackAlias: DynamicObjectAlias | null = null;
    if (callback) {
      let lambdaScope = childScope(callback.scope);
  
      for (let i = 0; i < callback.lambda.arguments.length; i++) {
        const param = callback.lambda.arguments[i];
        const role = HIGHER_ORDER_SEMANTICS.reduce[i];
  
        if (!role) continue;
        lambdaScope =
          role === "accumulator"
            ? runtime.higherOrder.bindHigherOrderParameter(
                lambdaScope,
                "reduce",
                param,
                role,
                accumulatorPaths,
                accumulatorArg,
                scope,
              )
            : runtime.higherOrder.bindHigherOrderParameter(
                lambdaScope,
                "reduce",
                param,
                role,
                dataArgPaths,
                dataArg,
                scope,
              );
      }
  
      callbackAlias = runtime.aliases.groupResultDynamicObjectAliasForNode(
        callback.lambda.body,
        lambdaScope,
      );
    }
    return runtime.aliases.mergeDynamicObjectAliases([
      ...partialCallbackAliases,
      callbackAlias
        ? runtime.higherOrder.resolveCallbackDynamicObjectAliasParentPaths(callbackAlias, dataArgPaths)
        : null,
      ...(resolvedCallback && dataArg
        ? runtime.higherOrder.higherOrderPartialLambdaCalls(
            "reduce",
            resolvedCallback,
            dataArg,
            scope,
            args,
          ).map((call) =>
            getCustomFunctionResultDynamicObjectAlias(call.binding, call.arguments, scope),
          )
        : []),
      args[2] ? runtime.aliases.groupResultDynamicObjectAliasForNode(args[2], scope) : null,
      ...(dataArg && accumulatorArg
        ? builtinCallbacks.map((name) =>
            getFunctionResultDynamicObjectAlias(
              {
                type: "function",
                value: "(",
                position: 0,
                procedure: { type: "variable", value: name, position: 0 },
                arguments: [accumulatorArg, dataArg],
              },
              scope,
            ),
          )
        : []),
    ]);
  }

  function getFunctionResultBasePaths(
    node: FunctionNode,
    scope: ScopeTracker,
  ): string[] {
    if (node.procedure.type === "lambda") {
      return getCustomFunctionResultBasePaths(
        { lambda: node.procedure, scope },
        node.arguments,
        scope,
      );
    }
    if (node.procedure.type === "transform") {
      return node.arguments[0]
        ? getResultBasePathsFromArg(node.arguments[0], scope)
        : [];
    }
    if (node.procedure.type === "condition") {
      return runtime.functions.conditionalProcedureCalls(node).flatMap((call) =>
        getFunctionResultBasePaths(call, scope),
      );
    }
    if (node.procedure.type === "variable") {
      const partialBinding = resolvePartial(scope, node.procedure.value);
      if (partialBinding) {
        return getPartialFunctionResultBasePaths(
          partialBinding,
          node.arguments,
          scope,
        );
      }
      const storedCallables = runtime.callables.resolveCallableValues(node.procedure, scope);
      if (storedCallables.length > 0) {
        return storedCallables.flatMap((callable) => {
          if (callable.kind === "lambda") {
            return getCustomFunctionResultBasePaths(
              callable.binding,
              node.arguments,
              scope,
            );
          }
          if (callable.kind === "transform") {
            return node.arguments[0]
              ? getResultBasePathsFromArg(node.arguments[0], scope)
              : [];
          }
          return getPartialFunctionResultBasePaths(
            callable.binding,
            node.arguments,
            scope,
          );
        });
      }
    }
    if (
      node.procedure.type === "function" ||
      node.procedure.type === "block" ||
      node.procedure.type === "path" ||
      node.procedure.type === "partial" ||
      runtime.callables.isFilteredCallableVariable(node.procedure)
    ) {
      return [
        ...runtime.callables.resolveCallableValues(node.procedure, scope).flatMap((callable) => {
          if (callable.kind === "lambda") {
            return getCustomFunctionResultBasePaths(
              callable.binding,
              node.arguments,
              scope,
            );
          }
          if (callable.kind === "transform") {
            return node.arguments[0]
              ? getResultBasePathsFromArg(node.arguments[0], scope)
              : [];
          }
          return getPartialFunctionResultBasePaths(
            callable.binding,
            node.arguments,
            scope,
          );
        }),
        ...(runtime.callables.resolveCallableValues(node.procedure, scope).length === 0
          ? runtime.callables.resolveBuiltinCallableNames(node.procedure, scope).flatMap((name) =>
              getFunctionResultBasePaths(
                {
                  ...node,
                  procedure: {
                    type: "variable",
                    value: name,
                    position: node.position,
                  },
                },
                scope,
              ),
            )
          : []),
      ];
    }
  
    if (!BUILTIN_FUNCTIONS.has(node.procedure.value)) {
      const storedBuiltins = runtime.callables.resolveBuiltinCallableNames(node.procedure, scope);
      if (storedBuiltins.length > 0) {
        return storedBuiltins.flatMap((name) =>
          getFunctionResultBasePaths(
            {
              ...node,
              procedure: { type: "variable", value: name, position: node.position },
            },
            scope,
          ),
        );
      }
    }
  
    const partialBinding = resolvePartial(scope, node.procedure.value);
    let funcName = node.procedure.value;
    let args = node.arguments;
    let argScope = scope;
  
    if (partialBinding) {
      if (partialBinding.partial.procedure.type !== "variable") {
        return getFunctionResultBasePaths(
          {
            ...node,
            procedure: partialBinding.partial.procedure,
            arguments: runtime.higherOrder.applyPartialArguments(partialBinding.partial, node.arguments),
          },
          partialBinding.scope,
        );
      }
      funcName = partialBinding.partial.procedure.value;
      args = runtime.higherOrder.applyPartialArguments(partialBinding.partial, node.arguments);
      argScope = partialBinding.scope;
    }
    args = runtime.functions.withImplicitRootFunctionArgument(funcName, args, node.position, argScope);
  
    if (
      args.length === 0 &&
      PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName) &&
      runtime.functions.builtinUsesContextDefault(funcName, args)
    ) {
      return [...(resolveVariable(argScope, "") ?? [ROOT_PATH])];
    }
  
    const lambdaBinding = resolveLambda(argScope, funcName);
    if (lambdaBinding) {
      return getCustomFunctionResultBasePaths(lambdaBinding, args, argScope);
    }
  
    if (resolveTransform(argScope, funcName)) {
      return args[0] ? getResultBasePathsFromArg(args[0], argScope) : [];
    }

    if (externalFunctionContract(options, funcName)) return [];
  
    if (funcName === "eval") {
      return runtime.functions.getStaticEvalResultBasePaths(args, argScope);
    }
  
    if (funcName === "map" || funcName === "each") {
      return getCallbackResultBasePaths(funcName, args, argScope);
    }
    if (funcName === "reduce") {
      return getReduceResultBasePaths(args, argScope);
    }
  
    if (funcName === "lookup") {
      return getLookupResultBasePaths(args, argScope);
    }
  
    if (!PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName)) return [];
    if (funcName === "append" || funcName === "zip") {
      return args.flatMap((arg) => getResultBasePathsFromArg(arg, argScope));
    }
    if (funcName === "merge") {
      return args.length > 0 ? getMergeResultBasePaths(args[0], argScope) : [];
    }
    return args.length > 0
      ? [
          ...getResultBasePathsFromArg(args[0], argScope),
          ...getResultSuffixBasePaths(args[0], argScope),
        ]
      : [];
  }

  function getPartialFunctionResultBasePaths(
    binding: NonNullable<ReturnType<typeof resolvePartial>>,
    callArgs: AstNode[],
    callScope: ScopeTracker,
  ): string[] {
    const appliedArgs = runtime.higherOrder.applyPartialArguments(binding.partial, callArgs);
    const scopedCall = runtime.higherOrder.scopePartialArguments(
      appliedArgs,
      runtime.higherOrder.applyPartialArgumentScopes(
        binding.partial,
        callArgs,
        binding.scope,
        callScope,
      ),
      callScope,
    );
    const paths = runtime.callables.resolveCallableValues(
      binding.partial.procedure,
      binding.scope,
    ).flatMap((callable) => {
      if (callable.kind === "lambda") {
        return getCustomFunctionResultBasePaths(
          callable.binding,
          scopedCall.arguments,
          scopedCall.scope,
        );
      }
      if (callable.kind === "transform") {
        return scopedCall.arguments[0]
          ? getResultBasePathsFromArg(
              scopedCall.arguments[0],
              scopedCall.scope,
            )
          : [];
      }
      return getPartialFunctionResultBasePaths(
        callable.binding,
        scopedCall.arguments,
        scopedCall.scope,
      );
    });
    for (const name of runtime.callables.resolveBuiltinCallableNames(
      binding.partial.procedure,
      binding.scope,
    )) {
      paths.push(
        ...getFunctionResultBasePaths(
          {
            type: "function",
            value: "(",
            position: binding.partial.position,
            procedure: {
              type: "variable",
              value: name,
              position: binding.partial.position,
            },
            arguments: scopedCall.arguments,
          },
          scopedCall.scope,
        ),
      );
    }
    return paths;
  }

  function getCustomFunctionResultBasePaths(
    binding: LambdaBinding,
    callArgs: AstNode[],
    callScope: ScopeTracker,
    defaultsApplied = false,
  ): string[] {
    const { lambda, scope } = binding;
    if (!defaultsApplied) {
      const variants = runtime.higherOrder.lambdaContextDefaultArgumentVariants(lambda, callArgs);
      if (variants.length > 1 || variants[0] !== callArgs) {
        return [
          ...new Set(
            variants.flatMap((args) =>
              getCustomFunctionResultBasePaths(binding, args, callScope, true),
            ),
          ),
        ];
      }
    }
    let lambdaScope = childScope(scope);
  
    for (let i = 0; i < lambda.arguments.length; i++) {
      const param = lambda.arguments[i];
      const argPaths = i < callArgs.length ? runtime.higherOrder.extractBasePaths(callArgs[i], callScope) : [];
      lambdaScope =
        i < callArgs.length
          ? runtime.higherOrder.bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
          : bindVariable(lambdaScope, param.value, argPaths);
    }
    lambdaScope = runtime.callables.bindForwardReferences(
      lambdaScope,
      lambda,
      binding.forwardScope ?? callScope,
      binding.name,
    );
  
    const firstArgPaths = callArgs[0] ? runtime.higherOrder.extractBasePaths(callArgs[0], callScope) : [];
    return runtime.higherOrder.resolveCallbackParentPaths(
      runtime.aliases.bindingAliasPaths(lambda.body, lambdaScope),
      firstArgPaths,
    );
  }

  function getCallbackResultBasePaths(
    funcName: "map" | "each",
    args: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const callback = runtime.higherOrder.findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
    const builtinCallbacks = args[1]
      ? runtime.callables.resolveBuiltinCallableNames(args[1], scope)
      : [];
    const partialCallbackPaths = runtime.higherOrder.higherOrderPartialResultBasePaths(
      funcName,
      args,
      scope,
    );
    if (
      !callback &&
      builtinCallbacks.length === 0 &&
      partialCallbackPaths.length === 0
    ) {
      return [];
    }
  
    const dataArg = args[0];
    const dataArgPaths = runtime.higherOrder.higherOrderCallbackDataPaths(
      funcName,
      dataArg,
      scope,
    );
    return [
      ...partialCallbackPaths,
      ...(callback?.bindings ?? []).flatMap((binding) => {
        const lambdaScope = runtime.higherOrder.bindHigherOrderLambdaCallbackScope(
          funcName,
          binding,
          dataArgPaths,
          dataArg,
          scope,
        );
        return runtime.higherOrder.resolveCallbackParentPaths(
          runtime.aliases.bindingAliasPaths(binding.lambda.body, lambdaScope),
          dataArgPaths,
        );
      }),
      ...(callback
        ? runtime.higherOrder.higherOrderPartialLambdaCalls(funcName, callback, dataArg, scope).flatMap((call) =>
            getCustomFunctionResultBasePaths(
              call.binding,
              call.arguments,
              scope,
            ),
          )
        : []),
      ...(dataArg
        ? builtinCallbacks.flatMap((name) =>
            PATH_PRESERVING_RESULT_FUNCTIONS.has(name)
              ? dataArgPaths
              : getFunctionResultBasePaths(
                  {
                    type: "function",
                    value: "(",
                    position: 0,
                    procedure: {
                      type: "variable",
                      value: name,
                      position: 0,
                    },
                    arguments: [dataArg],
                  },
                  scope,
                ),
          )
        : []),
    ];
  }

  function getReduceResultBasePaths(args: AstNode[], scope: ScopeTracker): string[] {
    const callback = runtime.higherOrder.findHigherOrderCallback(args, scope);
    const resolvedCallback = runtime.higherOrder.findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
    const builtinCallbacks = args[1]
      ? runtime.callables.resolveBuiltinCallableNames(args[1], scope)
      : [];
    const builtinPartialPaths = runtime.higherOrder.higherOrderPartialCalls(
      "reduce",
      args,
      scope,
    ).flatMap((call) =>
      getPartialFunctionResultBasePaths(
        call.binding,
        call.arguments,
        scope,
      ),
    );
    if (
      !callback &&
      !resolvedCallback?.partials.length &&
      builtinCallbacks.length === 0 &&
      builtinPartialPaths.length === 0
    ) {
      return [];
    }
  
    const dataArg = args[0];
    const accumulatorArg = args[2] ?? dataArg;
    const dataArgPaths = dataArg ? runtime.higherOrder.extractBasePaths(dataArg, scope) : [];
    const accumulatorPaths = accumulatorArg
      ? runtime.higherOrder.extractBasePaths(accumulatorArg, scope)
      : dataArgPaths;
    const lambdaPaths = callback
      ? (() => {
          let lambdaScope = childScope(callback.scope);
  
          for (let i = 0; i < callback.lambda.arguments.length; i++) {
            const param = callback.lambda.arguments[i];
            const role = HIGHER_ORDER_SEMANTICS.reduce[i];
  
            if (!role) continue;
            lambdaScope =
              role === "accumulator"
                ? runtime.higherOrder.bindHigherOrderParameter(
                    lambdaScope,
                    "reduce",
                    param,
                    role,
                    accumulatorPaths,
                    accumulatorArg,
                    scope,
                  )
                : runtime.higherOrder.bindHigherOrderParameter(
                    lambdaScope,
                    "reduce",
                    param,
                    role,
                    dataArgPaths,
                    dataArg,
                    scope,
                  );
          }
  
          const callbackBody =
            callback.lambda.body.type === "lambda" &&
            (callback.lambda.body as LambdaNode).thunk
              ? (callback.lambda.body as LambdaNode).body
              : callback.lambda.body;
          return runtime.higherOrder.resolveCallbackParentPaths(
            [
              ...runtime.aliases.bindingAliasPaths(callbackBody, lambdaScope),
              ...runtime.aliases.groupResultSuffixBasePaths(callbackBody, lambdaScope),
              ...(dataArg &&
              callbackBody.type === "function" &&
              (callbackBody as FunctionNode).procedure.type === "variable" &&
              PATH_PRESERVING_RESULT_FUNCTIONS.has(
                ((callbackBody as FunctionNode).procedure as VariableNode).value,
              ) &&
              (callbackBody as FunctionNode).arguments.some(
                (argument) =>
                  argument.type === "variable" &&
                  (argument as VariableNode).value ===
                    callback.lambda.arguments[1]?.value,
              )
                ? getResultSuffixBasePaths(dataArg, scope)
                : []),
            ],
            dataArgPaths,
          );
        })()
      : [];
    const builtinPaths =
      dataArg && accumulatorArg
        ? builtinCallbacks.flatMap((name) =>
            PATH_PRESERVING_RESULT_FUNCTIONS.has(name)
              ? [...accumulatorPaths, ...dataArgPaths]
              : getFunctionResultBasePaths(
                  {
                    type: "function",
                    value: "(",
                    position: 0,
                    procedure: { type: "variable", value: name, position: 0 },
                    arguments: [accumulatorArg, dataArg],
                  },
                  scope,
                ),
          )
        : [];
    const partialPaths =
      resolvedCallback && dataArg
        ? runtime.higherOrder.higherOrderPartialLambdaCalls(
            "reduce",
            resolvedCallback,
            dataArg,
            scope,
            args,
          ).flatMap((call) =>
            getCustomFunctionResultBasePaths(call.binding, call.arguments, scope),
          )
        : [];
    return [
      ...lambdaPaths,
      ...partialPaths,
      ...builtinPartialPaths,
      ...builtinPaths,
    ];
  }

  function getFunctionResultSuffixBasePaths(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] {
    if (node.type !== "function") return [];
  
    const func = node as FunctionNode;
    if (func.procedure.type === "lambda") {
      return getCustomFunctionResultSuffixBasePaths(
        { lambda: func.procedure, scope },
        func.arguments,
        scope,
      );
    }
    if (func.procedure.type === "transform") {
      return func.arguments[0]
        ? getResultSuffixBasePaths(func.arguments[0], scope)
        : [];
    }
    if (func.procedure.type === "condition") {
      return runtime.functions.conditionalProcedureCalls(func).flatMap((call) =>
        getFunctionResultSuffixBasePaths(call, scope),
      );
    }
    if (
      func.procedure.type === "function" ||
      func.procedure.type === "block" ||
      func.procedure.type === "path" ||
      func.procedure.type === "partial" ||
      runtime.callables.isFilteredCallableVariable(func.procedure)
    ) {
      return runtime.callables.resolveCallableValues(func.procedure, scope).flatMap((callable) => {
        if (callable.kind === "lambda") {
          return getCustomFunctionResultSuffixBasePaths(
            callable.binding,
            func.arguments,
            scope,
          );
        }
        if (callable.kind === "transform") {
          return func.arguments[0]
            ? getResultSuffixBasePaths(func.arguments[0], scope)
            : [];
        }
        return getFunctionResultSuffixBasePaths(
          {
            ...func,
            procedure: callable.binding.partial.procedure,
            arguments: runtime.higherOrder.applyPartialArguments(callable.binding.partial, func.arguments),
          },
          callable.binding.scope,
        );
      });
    }
  
    if (!BUILTIN_FUNCTIONS.has(func.procedure.value)) {
      const storedBuiltins = runtime.callables.resolveBuiltinCallableNames(func.procedure, scope);
      if (storedBuiltins.length > 0) {
        return storedBuiltins.flatMap((name) =>
          getFunctionResultSuffixBasePaths(
            {
              ...func,
              procedure: { type: "variable", value: name, position: func.position },
            },
            scope,
          ),
        );
      }
    }
  
    const partialBinding = resolvePartial(scope, func.procedure.value);
    let funcName = func.procedure.value;
    let args = func.arguments;
    let argScope = scope;
  
    if (partialBinding) {
      const appliedArgs = runtime.higherOrder.applyPartialArguments(
        partialBinding.partial,
        func.arguments,
      );
      const scopedCall = runtime.higherOrder.scopePartialArguments(
        appliedArgs,
        runtime.higherOrder.applyPartialArgumentScopes(
          partialBinding.partial,
          func.arguments,
          partialBinding.scope,
          scope,
        ),
        scope,
      );
      if (partialBinding.partial.procedure.type !== "variable") {
        return getFunctionResultSuffixBasePaths(
          {
            ...func,
            procedure: partialBinding.partial.procedure,
            arguments: scopedCall.arguments,
          },
          scopedCall.scope,
        );
      }
      funcName = partialBinding.partial.procedure.value;
      args = scopedCall.arguments;
      argScope = scopedCall.scope;
    }
    args = runtime.functions.withImplicitRootFunctionArgument(funcName, args, func.position, argScope);
  
    const lambdaBinding = resolveLambda(argScope, funcName);
    if (lambdaBinding) {
      return getCustomFunctionResultSuffixBasePaths(lambdaBinding, args, argScope);
    }
  
    if (resolveTransform(argScope, funcName)) {
      return args[0] ? runtime.aliases.groupResultSuffixBasePaths(args[0], argScope) : [];
    }

    if (externalFunctionContract(options, funcName)) return [];
  
    if (funcName === "eval") {
      return runtime.functions.getStaticEvalResultBasePaths(args, argScope);
    }
  
    if (funcName === "map" || funcName === "each") {
      return getCallbackResultSuffixBasePaths(funcName, args, argScope);
    }
  
    if (funcName === "reduce") {
      return [
        ...getReduceInitialSuffixBasePaths(args, argScope),
        ...getReduceCallbackResultSuffixBasePaths(args, argScope),
      ];
    }
  
    if (funcName === "lookup") {
      return getLookupResultSuffixBasePaths(args, argScope);
    }
  
    if (!PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName)) {
      return [];
    }
  
    if (funcName === "append" || funcName === "zip") {
      return args.flatMap((arg) =>
        runtime.aliases.groupResultSuffixableBasePaths(arg, argScope),
      );
    }
  
    return args[0] ? runtime.aliases.groupResultSuffixBasePaths(args[0], argScope) : [];
  }

  function getResultSuffixBasePaths(node: AstNode, scope: ScopeTracker): string[] {
    if (node.type === "apply") {
      const func = runtime.functions.appliedFunctionFromApply(node as ApplyNode);
      return func ? getFunctionResultSuffixBasePaths(func, scope) : [];
    }
  
    if (node.type === "block") {
      return getBlockResultSuffixBasePaths(node as BlockNode, scope);
    }
  
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [
        ...runtime.aliases.groupResultSuffixableBasePaths(condition.then, scope),
        ...(condition.else
          ? runtime.aliases.groupResultSuffixableBasePaths(condition.else, scope)
          : []),
      ];
    }
  
    if (node.type === "path") {
      const pathNode = node as PathNode;
      if (pathNode.group) return [];
      const resultAliasStepIndex = pathNode.steps.findIndex(runtime.aliases.isResultAliasStep);
      if (
        resultAliasStepIndex < pathNode.steps.length - 1 &&
        runtime.aliases.hasVariableBeforeResultAlias(pathNode, resultAliasStepIndex)
      ) {
        return getResultBasePathsFromArg(pathNode, scope);
      }
      return runtime.aliases.pathResultAliasContextBasePaths(pathNode, scope);
    }
  
    if (node.type === "array") {
      return (node as ArrayNode).expressions.flatMap((expr) =>
        runtime.aliases.groupResultSuffixBasePaths(expr, scope),
      );
    }
  
    return getFunctionResultSuffixBasePaths(node, scope);
  }

  function getReduceInitialSuffixBasePaths(
    args: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const accumulatorArg = args[2] ?? args[0];
    if (!accumulatorArg) return [];
  
    return runtime.aliases.groupResultSuffixableBasePaths(accumulatorArg, scope);
  }

  function getReduceCallbackResultSuffixBasePaths(
    args: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const callback = runtime.higherOrder.findHigherOrderCallback(args, scope);
    const resolvedCallback = runtime.higherOrder.findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
    if (!callback && !resolvedCallback?.partials.length) return [];
  
    const dataArg = args[0];
    const accumulatorArg = args[2] ?? dataArg;
    const dataArgPaths = dataArg ? runtime.higherOrder.extractBasePaths(dataArg, scope) : [];
    const accumulatorPaths = accumulatorArg
      ? runtime.higherOrder.extractBasePaths(accumulatorArg, scope)
      : dataArgPaths;
    const partialPaths =
      resolvedCallback && dataArg
        ? runtime.higherOrder.higherOrderPartialLambdaCalls(
            "reduce",
            resolvedCallback,
            dataArg,
            scope,
            args,
          ).flatMap((call) =>
            getCustomFunctionResultSuffixBasePaths(call.binding, call.arguments, scope),
          )
        : [];
    if (!callback) return partialPaths;
  
    let lambdaScope = childScope(callback.scope);
  
    for (let i = 0; i < callback.lambda.arguments.length; i++) {
      const param = callback.lambda.arguments[i];
      const role = HIGHER_ORDER_SEMANTICS.reduce[i];
  
      if (!role) continue;
      lambdaScope =
        role === "accumulator"
          ? runtime.higherOrder.bindHigherOrderParameter(
              lambdaScope,
              "reduce",
              param,
              role,
              accumulatorPaths,
              accumulatorArg,
              scope,
            )
          : runtime.higherOrder.bindHigherOrderParameter(
              lambdaScope,
              "reduce",
              param,
              role,
              dataArgPaths,
              dataArg,
              scope,
            );
    }
  
    return [
      ...runtime.aliases.groupResultSuffixBasePaths(callback.lambda.body, lambdaScope),
      ...partialPaths,
    ];
  }

  function getCustomFunctionResultSuffixBasePaths(
    binding: LambdaBinding,
    callArgs: AstNode[],
    callScope: ScopeTracker,
    defaultsApplied = false,
  ): string[] {
    const { lambda, scope } = binding;
    if (!defaultsApplied) {
      const variants = runtime.higherOrder.lambdaContextDefaultArgumentVariants(lambda, callArgs);
      if (variants.length > 1 || variants[0] !== callArgs) {
        return [
          ...new Set(
            variants.flatMap((args) =>
              getCustomFunctionResultSuffixBasePaths(
                binding,
                args,
                callScope,
                true,
              ),
            ),
          ),
        ];
      }
    }
    let lambdaScope = childScope(scope);
  
    for (let i = 0; i < lambda.arguments.length; i++) {
      const param = lambda.arguments[i];
      const argPaths = i < callArgs.length ? runtime.higherOrder.extractBasePaths(callArgs[i], callScope) : [];
      lambdaScope =
        i < callArgs.length
          ? runtime.higherOrder.bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
          : bindVariable(lambdaScope, param.value, argPaths);
    }
    lambdaScope = runtime.callables.bindForwardReferences(
      lambdaScope,
      lambda,
      binding.forwardScope ?? callScope,
      binding.name,
    );
  
    return runtime.aliases.groupResultSuffixBasePaths(lambda.body, lambdaScope);
  }

  function getCallbackResultSuffixBasePaths(
    funcName: "map" | "each",
    args: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const callback = runtime.higherOrder.findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
    const builtinCallbacks = args[1]
      ? runtime.callables.resolveBuiltinCallableNames(args[1], scope)
      : [];
    if (!callback && builtinCallbacks.length === 0) return [];
  
    const dataArg = args[0];
    const dataArgPaths = runtime.higherOrder.higherOrderCallbackDataPaths(
      funcName,
      dataArg,
      scope,
    );
    return [
      ...(callback?.bindings ?? []).flatMap((binding) =>
        runtime.aliases.groupResultSuffixBasePaths(
          binding.lambda.body,
          runtime.higherOrder.bindHigherOrderLambdaCallbackScope(
            funcName,
            binding,
            dataArgPaths,
            dataArg,
            scope,
          ),
        ),
      ),
      ...(callback
        ? runtime.higherOrder.higherOrderPartialLambdaCalls(funcName, callback, dataArg, scope).flatMap((call) =>
            getCustomFunctionResultSuffixBasePaths(
              call.binding,
              call.arguments,
              scope,
            ),
          )
        : []),
      ...builtinCallbacks.flatMap((name) =>
        PATH_PRESERVING_RESULT_FUNCTIONS.has(name) &&
        !(dataArg && runtime.aliases.objectAliasForNode(dataArg, scope)) &&
        !(dataArg && runtime.aliases.dynamicObjectAliasForNode(dataArg, scope))
          ? dataArgPaths
          : runtime.higherOrder.higherOrderCallbackDataNodes(funcName, dataArg, scope).flatMap(
              (callbackDataArg) =>
                getFunctionResultSuffixBasePaths(
                  {
                    type: "function",
                    value: "(",
                    position: 0,
                    procedure: { type: "variable", value: name, position: 0 },
                    arguments: [callbackDataArg],
                  },
                  scope,
                ),
            ),
      ),
    ];
  }

  function getBlockResultSuffixBasePaths(
    node: BlockNode,
    scope: ScopeTracker,
  ): string[] {
    let currentScope = scope;
    let result: string[] = [];
  
    for (const expr of node.expressions) {
      if (expr.type === "bind") {
        const bindNode = expr as BindNode;
        const closureScope = currentScope;
        result = getResultSuffixBasePaths(bindNode.rhs, closureScope);
        currentScope = bindVariable(
          currentScope,
          bindNode.lhs.value,
          runtime.aliases.bindingAliasPaths(bindNode.rhs, currentScope),
        );
        currentScope = runtime.aliases.bindSuffixBasePathsIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = runtime.aliases.bindObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = runtime.aliases.bindDynamicObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
  
        currentScope = runtime.functions.bindCallableValue(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
      } else if (expr.type === "block") {
        result = getBlockResultSuffixBasePaths(expr as BlockNode, childScope(currentScope));
      } else if (expr.type === "variable") {
        const name = (expr as VariableNode).value;
        const suffixBasePaths = resolveSuffixBasePaths(currentScope, name) ?? [];
        const objectAlias = resolveObjectAlias(currentScope, name);
        const objectAliasBases = new Set(
          objectAlias ? [...objectAlias.values()].flatMap((paths) => [...paths]) : [],
        );
        result = suffixBasePaths.filter((path) => !objectAliasBases.has(path));
      } else {
        result = getResultSuffixBasePaths(expr, currentScope);
      }
    }
  
    return result;
  }

  function getSuffixableResultBasePaths(node: AstNode, scope: ScopeTracker): string[] {
    switch (node.type) {
      case "array":
        return (node as ArrayNode).expressions.flatMap((expr) =>
          getSuffixableResultBasePaths(expr, scope),
        );
      case "name":
      case "path":
      case "variable":
      case "function":
      case "apply":
      case "block":
      case "wildcard":
      case "descendant":
      case "parent":
        return getResultBasePathsFromArg(node, scope);
      default:
        return [];
    }
  }

  function lookupSelectorSteps(keyNode: AstNode | undefined): AstNode[] {
    const position =
      keyNode && "position" in keyNode && typeof keyNode.position === "number"
        ? keyNode.position
        : 0;
    if (keyNode?.type === "string") {
      return [
        {
          type: "name",
          value: (keyNode as { value: string }).value,
          position,
        } as NameNode,
      ];
    }
  
    return [
      {
        type: "wildcard",
        value: "*",
        position,
      } as WildcardNode,
    ];
  }

  function getLookupResultBasePaths(args: AstNode[], scope: ScopeTracker): string[] {
    const objectArg = args[0];
    if (!objectArg) return [];
  
    const selectorSteps = lookupSelectorSteps(args[1]);
    const staticSelector =
      args[1]?.type === "string" ? buildPathString(selectorSteps) : null;
    const pathValueAliasBases = lookupPathValueAliasBasePaths(args, scope);
    const paths: string[] = [];
  
    paths.push(...pathValueAliasBases);
  
    const objectAlias = runtime.aliases.groupResultObjectAliasForNode(objectArg, scope);
    const objectPaths =
      objectArg.type === "variable" && pathValueAliasBases.length === 0 && objectAlias
        ? runtime.aliases.selectObjectAliasPaths(objectAlias, selectorSteps)
        : null;
    if (objectPaths) paths.push(...objectPaths);
  
    const suffix = buildPathString(selectorSteps);
    const objectAliasBases = new Set(
      objectAlias ? [...objectAlias.values()].flatMap((basePaths) => [...basePaths]) : [],
    );
    const suffixBasePaths =
      objectArg.type === "variable"
        ? (resolveSuffixBasePaths(scope, (objectArg as VariableNode).value) ?? [])
        : runtime.aliases.groupResultSuffixBasePaths(objectArg, scope);
    if (objectArg.type !== "object" && suffixBasePaths.length > 0 && suffix) {
      paths.push(
        ...suffixBasePaths
          .filter((path) => !objectAliasBases.has(path))
          .map((path) =>
            staticSelector ? appendPath(path, staticSelector) : appendDynamicLookupMarker(path),
          ),
      );
    }
  
    const dynamicObjectAlias = runtime.aliases.groupResultDynamicObjectAliasForNode(
      objectArg,
      scope,
    );
    if (dynamicObjectAlias) {
      paths.push(...runtime.aliases.selectLookupDynamicObjectAliasPaths(dynamicObjectAlias, []));
    }
  
    if (!staticSelector && paths.length === 0 && !objectAlias && !dynamicObjectAlias) {
      const basePaths =
        runtime.functions.identityReferencePaths(objectArg, scope) ??
        getResultBasePathsFromArg(objectArg, scope);
      paths.push(...basePaths.map(appendDynamicLookupMarker));
    }
  
    if (paths.length > 0) return paths;
    if (objectArg.type === "object" && (objectAlias || dynamicObjectAlias)) return [];
  
    const basePaths =
      runtime.functions.identityReferencePaths(objectArg, scope) ??
      getResultBasePathsFromArg(objectArg, scope);
    return staticSelector
      ? basePaths.map((path) => appendPath(path, staticSelector))
      : basePaths;
  }

  function getLookupResultSuffixBasePaths(
    args: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const objectArg = args[0];
    if (!objectArg) return [];
  
    const selectorSteps = lookupSelectorSteps(args[1]);
    const staticSelector =
      args[1]?.type === "string" ? buildPathString(selectorSteps) : null;
    const pathValueAliasBases = lookupPathValueAliasBasePaths(args, scope);
    const objectAlias = runtime.aliases.groupResultObjectAliasForNode(objectArg, scope);
    const dynamicObjectAlias = runtime.aliases.groupResultDynamicObjectAliasForNode(
      objectArg,
      scope,
    );
    const objectAliasBases = new Set(
      objectAlias ? [...objectAlias.values()].flatMap((basePaths) => [...basePaths]) : [],
    );
    const suffixBasePaths =
      objectArg.type === "variable"
        ? (resolveSuffixBasePaths(scope, (objectArg as VariableNode).value) ?? [])
        : runtime.aliases.groupResultSuffixBasePaths(objectArg, scope);
    const pathLikeBases =
      objectArg.type === "object"
        ? []
        : suffixBasePaths.filter((path) => !objectAliasBases.has(path));
  
    if (pathValueAliasBases.length > 0 || pathLikeBases.length > 0) {
      const pathLikeLookupBases = staticSelector
        ? pathLikeBases.map((path) => appendPath(path, staticSelector))
        : pathLikeBases.map(appendDynamicLookupMarker);
      return [...new Set([...pathValueAliasBases, ...pathLikeLookupBases])];
    }
  
    return objectAlias || dynamicObjectAlias ? [] : getLookupResultBasePaths(args, scope);
  }

  function lookupPathValueAliasBasePaths(args: AstNode[], scope: ScopeTracker): string[] {
    const objectArg = args[0];
    if (!objectArg) return [];
  
    return [
      ...new Set(
        lookupPathValueAliasBasePathsFromNode(
          objectArg,
          lookupSelectorSteps(args[1]),
          scope,
        ),
      ),
    ];
  }

  function lookupPathValueAliasBasePathsFromNode(
    node: AstNode,
    selectorSteps: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [
        ...lookupPathValueAliasBasePathsFromNode(condition.then, selectorSteps, scope),
        ...(condition.else
          ? lookupPathValueAliasBasePathsFromNode(condition.else, selectorSteps, scope)
          : []),
      ];
    }
  
    if (node.type === "array") {
      return (node as ArrayNode).expressions.flatMap((expr) =>
        lookupPathValueAliasBasePathsFromNode(expr, selectorSteps, scope),
      );
    }
  
    if (node.type === "block") {
      let currentScope = scope;
      let result: string[] = [];
      const expressions = (node as BlockNode).expressions;
  
      for (const [index, expr] of expressions.entries()) {
        const isLast = index === expressions.length - 1;
        if (isLast) {
          result = lookupPathValueAliasBasePathsFromNode(
            expr,
            selectorSteps,
            currentScope,
          );
          break;
        }
  
        if (expr.type !== "bind") continue;
  
        const bindNode = expr as BindNode;
        const closureScope = currentScope;
        currentScope = bindVariable(
          currentScope,
          bindNode.lhs.value,
          runtime.aliases.bindingAliasPaths(bindNode.rhs, currentScope),
        );
        currentScope = runtime.aliases.bindSuffixBasePathsIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = runtime.aliases.bindObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = runtime.aliases.bindDynamicObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
  
        currentScope = runtime.functions.bindCallableValue(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
      }
  
      return result;
    }
  
    if (node.type !== "object") return [];
  
    return (node as ObjectNode).entries.flatMap(([keyNode, valueNode]) => {
      const key = runtime.aliases.staticObjectKey(keyNode);
      const selector = selectorSteps[0];
      const selectorMatches =
        !key || selector?.type !== "name" || key === (selector as NameNode).value;
      if (!selectorMatches) return [];
  
      if (
        valueNode.type === "object" ||
        runtime.aliases.objectAliasForNode(valueNode, scope) ||
        runtime.aliases.dynamicObjectAliasForNode(valueNode, scope)
      ) {
        return [];
      }
  
      return runtime.aliases.bindingAliasPaths(valueNode, scope);
    });
  }

  function appendDynamicLookupMarker(basePath: string): string {
    return basePath === ROOT_PATH ? appendPath(ROOT_PATH, "[*]") : `${basePath}[*]`;
  }

  function getLookupResultDynamicObjectAlias(
    args: AstNode[],
    scope: ScopeTracker,
  ): DynamicObjectAlias | null {
    const objectArg = args[0];
    if (!objectArg) return null;
  
    const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(objectArg, scope);
    return dynamicObjectAlias
      ? runtime.aliases.selectLookupDynamicObjectResultAlias(
          dynamicObjectAlias,
          lookupSelectorSteps(args[1]),
        )
      : null;
  }

  function getLookupResultObjectAlias(
    args: AstNode[],
    scope: ScopeTracker,
  ): ObjectAlias | null {
    const objectArg = args[0];
    if (!objectArg) return null;
  
    const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(objectArg, scope);
    return dynamicObjectAlias
      ? runtime.aliases.selectLookupDynamicObjectResultObjectAlias(
          dynamicObjectAlias,
          lookupSelectorSteps(args[1]),
        )
      : null;
  }

  function getMergeResultBasePaths(node: AstNode, scope: ScopeTracker): string[] {
    if (node.type === "array") {
      return (node as ArrayNode).expressions.flatMap((expr) =>
        getResultBasePathsFromArg(expr, scope),
      );
    }
    return getResultBasePathsFromArg(node, scope);
  }

  function getResultBasePathsFromArg(node: AstNode, scope: ScopeTracker): string[] {
    const identityPaths = runtime.functions.identityReferencePaths(node, scope);
    if (identityPaths) return identityPaths;
  
    if (node.type === "array") {
      return (node as ArrayNode).expressions.flatMap((expr) =>
        expr.type === "array"
          ? getResultBasePathsFromArg(expr, scope)
          : getSuffixableResultBasePaths(expr, scope),
      );
    }
  
    if (node.type === "variable") {
      const name = (node as VariableNode).value;
      const suffixBasePaths = resolveSuffixBasePaths(scope, name) ?? [];
      if (suffixBasePaths.length > 0) return [...suffixBasePaths];
      return filterToBasePaths([...(resolveVariable(scope, name) ?? [])]);
    }
  
    if (node.type === "function") {
      const paths = getFunctionResultBasePaths(node as FunctionNode, scope);
      return paths.length > 0 ? paths : runtime.core.walkNode(node, scope).slice(0, 1);
    }
  
    if (node.type === "block") {
      return getBlockResultSuffixBasePaths(node as BlockNode, scope);
    }
  
    if (node.type === "path") {
      const pathNode = node as PathNode;
      if (runtime.aliases.hasResultAliasObjectSuffixSelection(pathNode, scope)) {
        return runtime.aliases.pathResultAliasContextBasePaths(pathNode, scope).map(resolveParentPathSegments);
      }
      const funcStepIndex = pathNode.steps.findIndex((s) => s.type === "function");
      if (funcStepIndex >= 0) {
        const bases = getFunctionResultBasePaths(
          pathNode.steps[funcStepIndex] as FunctionNode,
          scope,
        );
        const suffix = buildPathString(pathNode.steps.slice(funcStepIndex + 1));
        return suffix ? bases.map((base) => appendPath(base, suffix)) : bases;
      }
      return runtime.higherOrder.extractBasePaths(node, scope);
    }
  
    if (node.type === "apply") {
      const func = runtime.functions.appliedFunctionFromApply(node as ApplyNode);
      if (func) return getFunctionResultBasePaths(func, scope);
    }
  
    return runtime.core.walkNode(node, scope).slice(0, 1);
  }

  return {
    getFunctionResultObjectAlias,
    getFunctionResultDynamicObjectAlias,
    getFunctionResultBasePaths,
    getPartialFunctionResultBasePaths,
    getFunctionResultSuffixBasePaths,
    getResultSuffixBasePaths,
    getBlockResultSuffixBasePaths,
    getSuffixableResultBasePaths,
    getLookupResultBasePaths,
    getResultBasePathsFromArg,
  };
}
