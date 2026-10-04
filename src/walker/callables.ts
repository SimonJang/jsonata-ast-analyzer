import type { ArrayNode, AstNode, ApplyNode, BindNode, BlockNode, ConditionNode, FilterStage, FunctionNode, GroupByNode, LambdaNode, NameNode, ObjectNode, PartialNode, PathNode, TransformNode, VariableNode, WildcardNode } from "../types.js";
import { type ScopeTracker, childScope, bindVariable, bindSuffixBasePaths, bindObjectAlias, bindDynamicObjectAlias, resolveLambda, resolvePartial, resolveTransform, resolveValue, resolveValueFrame, resolveVariable, resolveSuffixBasePaths, resolveObjectAlias, resolveDynamicObjectAlias, type LambdaBinding, type PartialBinding } from "../scope.js";
import { BUILTIN_FUNCTIONS } from "../builtins.js";
import { PATH_PRESERVING_RESULT_FUNCTIONS } from "./constants.js";
import { markAbsolute, collectVariableNames, buildProjectionContextPath } from "./path-utils.js";
import type { CallableOperations, WalkerRuntime, ResolvedCallable } from "./runtime.js";

export function createCallableOperations(runtime: WalkerRuntime): CallableOperations {
  function resolveStoredMethodPath(node: PathNode, scope: ScopeTracker) {
    const procedurePath = (procedure: FunctionNode["procedure"]): PathNode | null =>
      procedure.type === "path" ? procedure
        : procedure.type === "function" ? procedurePath(procedure.procedure) : null;
    const index = node.steps.findIndex((step, index) =>
      index > 0 && step.type === "function" &&
      procedurePath((step as FunctionNode).procedure) !== null,
    );
    if (index < 0) return null;
    const method = node.steps[index] as FunctionNode;
    const prefixSteps = node.steps.slice(0, index);
    const relativeProcedure = procedurePath(method.procedure)!;
    const procedure: PathNode = {
      ...relativeProcedure,
      steps: [...prefixSteps, ...relativeProcedure.steps],
    };
    if (resolveCallableValues(procedure, scope).length === 0 &&
        resolveBuiltinCallableNames(procedure, scope).length === 0) return null;

    const prefix: AstNode = prefixSteps.length === 1 && prefixSteps[0].type !== "name"
      ? prefixSteps[0] : { ...node, steps: prefixSteps, group: undefined };
    const procedureName = `\0method-procedure-${method.position}`;
    const contextName = `\0method-context-${method.position}`;
    // Resolve the callable in its producer scope, while evaluating arguments
    // against the object that contains the method.
    let methodScope = runtime.functions.bindCallableValue(
      childScope(scope), procedureName, procedure, scope,
    );
    const contextPaths = runtime.aliases.bindingAliasPaths(prefix, scope);
    for (const name of ["", contextName]) {
      methodScope = runtime.higherOrder.bindArgumentParameter(
        methodScope, { type: "variable", value: name, position: method.position },
        contextPaths, prefix, scope,
      );
    }
    const rewriteProcedure = (procedure: FunctionNode["procedure"]): FunctionNode["procedure"] =>
      procedure.type === "function" ? { type: "path", steps: [{
        ...procedure,
        procedure: rewriteProcedure(procedure.procedure),
        arguments: procedure.arguments.map((argument) =>
          runtime.functions.explicitContextExpression(argument, contextName),
        ),
      }] } : { type: "variable", value: procedureName, position: method.position };
    return {
      node: {
        ...node,
        steps: [{
          ...method,
          procedure: rewriteProcedure(method.procedure),
          arguments: method.arguments.map((argument) =>
            runtime.functions.explicitContextExpression(argument, contextName),
          ),
        } as FunctionNode, ...node.steps.slice(index + 1)],
      },
      scope: methodScope,
      procedure,
    };
  }

  const definitelyDataCache = new WeakMap<
    AstNode,
    WeakMap<ScopeTracker, boolean>
  >();

  function isDefinitelyDataValue(node: AstNode, scope: ScopeTracker): boolean {
    let scopeCache = definitelyDataCache.get(node);
    if (!scopeCache) {
      scopeCache = new WeakMap();
      definitelyDataCache.set(node, scopeCache);
    }
    const cached = scopeCache.get(scope);
    if (cached !== undefined) return cached;

    // A false placeholder safely terminates recursive value bindings.
    scopeCache.set(scope, false);
    let result = false;
    if (node.type === "name") {
      result = true;
    } else if (node.type === "variable") {
      const variable = node as VariableNode;
      const name = variable.value;
      if (variable.group || variable.predicate?.length) {
        result = false;
      } else if (name === "$") {
        result = true;
      } else if (name === "") {
        const value = resolveValue(scope, name);
        result = value ? isDefinitelyDataValue(value.node, value.scope) : true;
      } else if (
        !resolveLambda(scope, name) &&
        !resolvePartial(scope, name) &&
        !resolveTransform(scope, name)
      ) {
        const value = resolveValue(scope, name);
        result = value
          ? isDefinitelyDataValue(value.node, value.scope)
          : resolveVariable(scope, name) !== null;
      }
    } else if (node.type === "path") {
      const path = node as PathNode;
      const [first, ...suffix] = path.steps;
      result =
        !path.group &&
        Boolean(first) &&
        suffix.every(
          (step) =>
            step.type === "name" &&
            !(step as NameNode).stages?.length &&
            !(step as NameNode).focusBinding &&
            !(step as NameNode).indexBinding,
        ) &&
        isDefinitelyDataValue(first, scope);
    }

    scopeCache.set(scope, result);
    return result;
  }

  function isFunctionProcedureNode(
    node: AstNode,
  ): node is FunctionNode["procedure"] {
    return [
      "variable",
      "lambda",
      "transform",
      "condition",
      "function",
      "block",
      "path",
      "partial",
    ].includes(node.type);
  }

  function isFilteredCallableVariable(node: AstNode): boolean {
    return (
      node.type === "variable" &&
      ((node as VariableNode).predicate?.length ?? 0) > 0
    );
  }

  function resolvedCallableNames(
    callable: ResolvedCallable,
    depth = 0,
  ): string[] {
    if (callable.kind === "lambda") {
      return callable.binding.name ? [callable.binding.name] : [];
    }
    if (callable.kind !== "partial" || depth >= 8) return [];
  
    const procedure = callable.binding.partial.procedure;
    if (procedure.type === "variable") {
      return [(procedure as VariableNode).value];
    }
    return resolveCallableValues(procedure, callable.binding.scope).flatMap(
      (resolved) => resolvedCallableNames(resolved, depth + 1),
    );
  }

  function bindCallableBlockValue(
    scope: ScopeTracker,
    bindNode: BindNode,
  ): ScopeTracker {
    const closureScope = scope;
    let nextScope = bindVariable(
      scope,
      bindNode.lhs.value,
      runtime.aliases.bindingAliasPaths(bindNode.rhs, scope),
    );
    nextScope = runtime.aliases.bindSuffixBasePathsIfPresent(
      nextScope,
      bindNode.lhs.value,
      bindNode.rhs,
      closureScope,
    );
    nextScope = runtime.aliases.bindObjectAliasIfPresent(
      nextScope,
      bindNode.lhs.value,
      bindNode.rhs,
      closureScope,
    );
    nextScope = runtime.aliases.bindDynamicObjectAliasIfPresent(
      nextScope,
      bindNode.lhs.value,
      bindNode.rhs,
      closureScope,
    );
    return runtime.functions.bindCallableValue(
      nextScope,
      bindNode.lhs.value,
      bindNode.rhs,
      closureScope,
    );
  }

  function callableProcedureVariableNames(
    node: AstNode,
    names = new Set<string>(),
  ): Set<string> {
    if (node.type === "function") {
      for (const name of collectVariableNames((node as FunctionNode).procedure)) {
        names.add(name);
      }
    }
    if (
      node.type === "path" &&
      (node as PathNode).steps.some((step) => step.type === "function")
    ) {
      for (const step of (node as PathNode).steps) {
        if (step.type === "variable") {
          names.add((step as VariableNode).value);
        }
        if (step.type === "function") break;
      }
    }
  
    for (const [key, value] of Object.entries(node)) {
      if (key === "source") continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object") {
            callableProcedureVariableNames(item as AstNode, names);
          }
        }
      } else if (value && typeof value === "object") {
        callableProcedureVariableNames(value as AstNode, names);
      }
    }
    return names;
  }

  function bindForwardDataReferences(
    scope: ScopeTracker,
    lambda: LambdaNode,
    callScope: ScopeTracker,
  ): ScopeTracker {
    const parameterNames = new Set(lambda.arguments.map((arg) => arg.value));
    let resultScope = scope;
    for (const name of collectVariableNames(lambda.body)) {
      if (name === "" || parameterNames.has(name)) {
        continue;
      }
      const referenceNode: VariableNode = {
        type: "variable",
        value: name,
        position: lambda.position,
      };
      const capturedFrame = resolveValueFrame(resultScope, name);
      const currentFrame = resolveValueFrame(callScope, name);
      if (
        (capturedFrame !== null && capturedFrame !== currentFrame) ||
        resolveCallableValues(referenceNode, callScope).length > 0 ||
        resolveBuiltinCallableNames(referenceNode, callScope).length > 0
      ) {
        continue;
      }
  
      const capturedPaths = resolveVariable(resultScope, name);
      const currentPaths = resolveVariable(callScope, name);
      if (currentPaths === null) continue;
      const capturedSuffixBasePaths = resolveSuffixBasePaths(resultScope, name);
      const currentSuffixBasePaths = resolveSuffixBasePaths(callScope, name);
      const capturedObjectAlias = resolveObjectAlias(resultScope, name);
      const currentObjectAlias = resolveObjectAlias(callScope, name);
      const capturedDynamicObjectAlias = resolveDynamicObjectAlias(
        resultScope,
        name,
      );
      const currentDynamicObjectAlias = resolveDynamicObjectAlias(callScope, name);
  
      resultScope = bindVariable(
        resultScope,
        name,
        [...new Set([...(capturedPaths ?? []), ...currentPaths])],
      );
  
      const suffixBasePaths = [
        ...new Set([
          ...(capturedSuffixBasePaths ?? []),
          ...(currentSuffixBasePaths ?? []),
        ]),
      ];
      if (suffixBasePaths.length > 0) {
        resultScope = bindSuffixBasePaths(
          resultScope,
          name,
          suffixBasePaths,
        );
      }
      const objectAlias = runtime.aliases.mergeObjectAliases([
        capturedObjectAlias,
        currentObjectAlias,
      ]);
      if (objectAlias) {
        resultScope = bindObjectAlias(resultScope, name, objectAlias);
      }
      const dynamicObjectAlias = runtime.aliases.mergeDynamicObjectAliases([
        capturedDynamicObjectAlias,
        currentDynamicObjectAlias,
      ]);
      if (dynamicObjectAlias) {
        resultScope = bindDynamicObjectAlias(
          resultScope,
          name,
          dynamicObjectAlias,
        );
      }
    }
    return resultScope;
  }

  function bindForwardCallableReferences(
    scope: ScopeTracker,
    lambda: LambdaNode,
    callScope: ScopeTracker,
    currentFunctionName?: string,
  ): ScopeTracker {
    const parameterNames = new Set(lambda.arguments.map((arg) => arg.value));
    let resultScope = scope;
    const referencedNames = new Set([
      ...callableProcedureVariableNames(lambda.body),
      ...collectVariableNames(lambda.body),
    ]);
    for (const name of referencedNames) {
      const referenceNode: VariableNode = {
        type: "variable",
        value: name,
        position: lambda.position,
      };
      const isCallableReference =
        resolveCallableValues(referenceNode, resultScope).length > 0 ||
        resolveCallableValues(referenceNode, callScope).length > 0 ||
        resolveBuiltinCallableNames(referenceNode, resultScope).length > 0 ||
        resolveBuiltinCallableNames(referenceNode, callScope).length > 0;
      if (!isCallableReference) continue;
  
      const value = resolveValue(callScope, name);
      const capturedValue = resolveValue(resultScope, name);
      const capturedFrame = resolveValueFrame(resultScope, name);
      const currentFrame = resolveValueFrame(callScope, name);
      const entersCurrentCycle =
        currentFunctionName !== undefined &&
        value != null &&
        resolveCallableValues(value.node, value.scope)
          .flatMap((callable) => resolvedCallableNames(callable))
          .some(
            (calledName) =>
              calledName === currentFunctionName ||
              runtime.higherOrder.lambdaCallGraphReaches(
                calledName,
                currentFunctionName,
                callScope,
                new Set([currentFunctionName]),
              ),
          );
      if (
        parameterNames.has(name) ||
        name === currentFunctionName ||
        (currentFunctionName !== undefined &&
          runtime.higherOrder.lambdaCallGraphReaches(
            name,
            currentFunctionName,
            callScope,
            new Set([currentFunctionName]),
          )) ||
        entersCurrentCycle ||
        (capturedValue !== null && capturedFrame !== currentFrame)
      ) {
        continue;
      }
      if (value) {
        // A callable container can also carry data aliases needed by its consumer.
        resultScope = bindVariable(
          resultScope,
          name,
          resolveVariable(resultScope, name) ?? [],
        );
        resultScope = runtime.aliases.bindSuffixBasePathsIfPresent(
          resultScope, name, value.node, value.scope,
        );
        resultScope = runtime.aliases.bindObjectAliasIfPresent(
          resultScope, name, value.node, value.scope,
        );
        resultScope = runtime.aliases.bindDynamicObjectAliasIfPresent(
          resultScope, name, value.node, value.scope,
        );
        resultScope = runtime.functions.bindCallableValue(
          resultScope,
          name,
          value.node,
          value.scope,
        );
      }
    }
    return resultScope;
  }

  function bindForwardReferences(
    scope: ScopeTracker,
    lambda: LambdaNode,
    callScope: ScopeTracker,
    currentFunctionName?: string,
  ): ScopeTracker {
    return bindForwardCallableReferences(
      bindForwardDataReferences(scope, lambda, callScope),
      lambda,
      callScope,
      currentFunctionName,
    );
  }

  function lambdaCallScope(
    binding: LambdaBinding,
    callArgs: AstNode[],
    callScope: ScopeTracker,
  ): ScopeTracker {
    let resultScope = childScope(binding.scope);
    for (let index = 0; index < binding.lambda.arguments.length; index++) {
      const parameter = binding.lambda.arguments[index];
      const arg = callArgs[index];
      const argPaths = arg ? runtime.higherOrder.functionArgumentResultPaths(arg, callScope) : [];
      resultScope = arg
        ? runtime.higherOrder.bindArgumentParameter(resultScope, parameter, argPaths, arg, callScope)
        : bindVariable(resultScope, parameter.value, argPaths);
      if (arg) {
        resultScope = runtime.functions.bindCallableValue(
          resultScope,
          parameter.value,
          arg,
          callScope,
        );
      }
    }
    return bindForwardReferences(
      resultScope,
      binding.lambda,
      binding.forwardScope ?? callScope,
      binding.name,
    );
  }

  function terminalFocusResultNode(node: AstNode): AstNode | null {
    if (node.type !== "path" || (node as PathNode).group) return null;
    const steps = (node as PathNode).steps;
    let finalIndex = steps.length - 1;
    while (finalIndex >= 0 && steps[finalIndex].type === "sort") finalIndex--;
    if (!(steps[finalIndex] as NameNode | undefined)?.focusBinding) return null;
    // A terminal focus stores the selected child but returns its input context.
    const prefix = steps.slice(0, finalIndex);
    return prefix.length ? { type: "path", steps: prefix } as PathNode
      : { type: "variable", value: "", position: 0 };
  }

  function unwrapCallableContainerNode(
    node: AstNode,
    scope: ScopeTracker,
    depth = 0,
  ): { readonly node: AstNode; readonly scope: ScopeTracker } {
    if (depth >= 16) return { node, scope };
    if (node.type === "lambda" && (node as LambdaNode).thunk) {
      return unwrapCallableContainerNode((node as LambdaNode).body, scope, depth + 1);
    }
    const focusResult = terminalFocusResultNode(node);
    if (focusResult) return unwrapCallableContainerNode(focusResult, scope, depth + 1);
    if (node.type === "variable") {
      const value = resolveValue(scope, (node as VariableNode).value);
      if (value) {
        return unwrapCallableContainerNode(value.node, value.scope, depth + 1);
      }
    }
    if (node.type === "block") {
      const block = node as BlockNode;
      let blockScope = childScope(scope);
      for (const [index, expression] of block.expressions.entries()) {
        const expressionScope = blockScope;
        if (index === block.expressions.length - 1) {
          return unwrapCallableContainerNode(
            expression,
            blockScope,
            depth + 1,
          );
        }
        if (expression.type === "bind") {
          blockScope = bindCallableBlockValue(
            blockScope,
            expression as BindNode,
          );
        }
        blockScope = runtime.core.bindArrayAssignmentEffects(expression, blockScope, expressionScope);
      }
    }
    if (
      node.type === "function" &&
      resolveBuiltinCallableNames((node as FunctionNode).procedure, scope).includes("eval") &&
      resolveCallableValues((node as FunctionNode).procedure, scope).length === 0
    ) {
      const functionNode = node as FunctionNode;
      const expression = runtime.functions.getStaticEvalExpression(functionNode.arguments, scope);
      if (expression) {
        return unwrapCallableContainerNode(
          expression,
          runtime.functions.getStaticEvalScope(functionNode.arguments, scope),
          depth + 1,
        );
      }
    }
    return { node, scope };
  }

  function partialResultTargets(
    node: FunctionNode,
    scope: ScopeTracker,
  ): Array<{ callables: ResolvedCallable[]; builtins: string[]; arguments: AstNode[]; scope: ScopeTracker }> {
    const expand = (
      binding: PartialBinding,
      callArgs: AstNode[],
      callScope: ScopeTracker,
      visited: ReadonlySet<PartialBinding>,
    ): Array<{ callables: ResolvedCallable[]; builtins: string[]; arguments: AstNode[]; scope: ScopeTracker }> => {
      if (visited.has(binding)) return [];
      const nextVisited = new Set([...visited, binding]);
      const args = runtime.higherOrder.applyPartialArguments(binding.partial, callArgs);
      const argumentScopes = runtime.higherOrder.applyPartialArgumentScopes(
        binding.partial, callArgs, binding.scope, callScope,
      );
      const scoped = runtime.higherOrder.scopePartialArguments(args, argumentScopes, callScope);
      const scopedArgs = scoped.arguments;
      const callables = resolveCallableValues(binding.partial.procedure, binding.scope);
      return [
        {
          callables: callables.filter((callable) => callable.kind !== "partial"),
          builtins: resolveBuiltinCallableNames(binding.partial.procedure, binding.scope),
          arguments: scopedArgs,
          scope: scoped.scope,
        },
        ...callables.flatMap((callable) =>
          callable.kind === "partial" ? expand(callable.binding, scopedArgs, scoped.scope, nextVisited) : [],
        ),
      ];
    };
    return resolveCallableValues(node.procedure, scope).flatMap((callable) =>
      callable.kind === "partial" ? expand(callable.binding, node.arguments, scope, new Set()) : [],
    );
  }

  function partialBuiltinResultCalls(
    node: FunctionNode,
    scope: ScopeTracker,
  ): Array<{ node: FunctionNode; scope: ScopeTracker }> {
    return partialResultTargets(node, scope).flatMap((target) => target.builtins.map((name) => ({
      node: {
        ...node,
        procedure: { type: "variable", value: name, position: node.position, resolvedBuiltin: true },
        arguments: target.arguments,
      } as FunctionNode,
      scope: target.scope,
    })));
  }

  function callableContainerProducerInputs(
    node: FunctionNode,
    scope: ScopeTracker,
  ): AstNode[] {
    return resolveBuiltinCallableNames(node.procedure, scope).flatMap((funcName) => {
      const args = runtime.functions.withImplicitRootFunctionArgument(
        funcName, node.arguments, node.position, scope,
      );
      if (
        funcName === "reduce" &&
        args[1] &&
        (resolveBuiltinCallableNames(args[1], scope).includes("append") ||
          resolveCallableValues(args[1], scope).some(
            (callable) => callable.kind === "partial" &&
              resolveBuiltinCallableNames(
                callable.binding.partial.procedure,
                callable.binding.scope,
              ).includes("append"),
          ))
      ) {
        return [args[0], args[2]].filter(
          (input): input is AstNode => Boolean(input),
        );
      }
      if (funcName === "append" || funcName === "zip") return args;
      if (funcName !== "lookup" && PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName)) {
        return args[0] ? [args[0]] : [];
      }
      return [];
    });
  }

  function callableArrayEntries(node: ArrayNode): AstNode[] {
    const numericFilter = (node.predicate ?? []).find(
      (stage) =>
        stage.type === "filter" &&
        (stage as unknown as FilterStage).expr.type === "number",
    ) as unknown as FilterStage | undefined;
    if (!numericFilter) return node.expressions;
  
    const index = Number(
      ((numericFilter as unknown as FilterStage).expr as { value: number }).value,
    );
    return node.expressions[index] ? [node.expressions[index]] : [];
  }

  function dynamicCallableLookupSelection(
    node: AstNode,
    position: number,
  ): PathNode {
    const wildcard: WildcardNode = {
      type: "wildcard",
      value: "*",
      position,
    };
    if (node.type === "path") {
      const path = node as PathNode;
      return {
        ...path,
        steps: [...path.steps, wildcard],
        group: undefined,
      };
    }
    return { type: "path", steps: [node, wildcard] };
  }

  function compositionProcedure(
    node: AstNode,
    scope: ScopeTracker,
  ): FunctionNode["procedure"] | null {
    if (node.type === "apply") {
      return compositionLambda(node as ApplyNode, scope);
    }
    return resolveCallableValues(node, scope).length > 0 ||
      resolveBuiltinCallableNames(node, scope).length > 0
      ? (node as FunctionNode["procedure"])
      : null;
  }

  function compositionLambda(node: ApplyNode, scope: ScopeTracker): LambdaNode | null {
    const left = compositionProcedure(node.lhs, scope);
    const right = compositionProcedure(node.rhs, scope);
    if (!left || !right) return null;
  
    const parameter: VariableNode = {
      type: "variable",
      value: `__composition_input_${node.position}`,
      position: node.position,
    };
    const leftCall: FunctionNode = {
      type: "function",
      value: "(",
      position: node.position,
      procedure: left,
      arguments: [parameter],
    };
    return {
      type: "lambda",
      position: node.position,
      arguments: [parameter],
      body: {
        type: "function",
        value: "(",
        position: node.position,
        procedure: right,
        arguments: [leftCall],
      },
    };
  }

  function higherOrderCallableResultBodies(
    node: FunctionNode,
    scope: ScopeTracker,
  ): Array<{ node: AstNode; scope: ScopeTracker }> {
    const funcNames = resolveBuiltinCallableNames(node.procedure, scope).filter(
      (name): name is "map" | "each" | "reduce" =>
        name === "map" || name === "each" || name === "reduce",
    );
    const dataArg = node.arguments[0];
    const callbackArg = node.arguments[1];
    if (funcNames.length === 0 || !dataArg || !callbackArg) return [];
  
    const callbackCallables = resolveCallableValues(callbackArg, scope);
    const bindings = callbackCallables.flatMap((callable) =>
      callable.kind === "lambda" ? [callable.binding] : [],
    );
    const partials = callbackCallables.flatMap((callable) =>
      callable.kind === "partial" && runtime.higherOrder.partialCanInvokeLambda(callable.binding)
        ? [callable.binding]
        : [],
    );
  
    return funcNames.flatMap((funcName) => {
      const dataArgPaths = runtime.higherOrder.higherOrderCallbackDataPaths(
        funcName,
        dataArg,
        scope,
      );
      const directBodies = bindings.map((binding) => ({
        node: binding.lambda.body,
        scope:
          funcName === "reduce"
            ? lambdaCallScope(
                binding,
                runtime.higherOrder.higherOrderCallbackCallArguments(
                  funcName,
                  dataArg,
                  dataArg,
                  node.arguments,
                  node.position,
                ),
                scope,
              )
            : runtime.higherOrder.bindHigherOrderLambdaCallbackScope(
                funcName,
                binding,
                dataArgPaths,
                dataArg,
                scope,
              ),
      }));
      const partialBodies = runtime.higherOrder.higherOrderPartialLambdaCalls(
        funcName,
        { index: 1, bindings: [], partials, builtins: [] },
        dataArg,
        scope,
        node.arguments,
      ).map((call) => ({
        node: call.binding.lambda.body,
        scope: lambdaCallScope(call.binding, call.arguments, scope),
      }));
      return [...directBodies, ...partialBodies];
    });
  }

  function customFunctionResultBodies(
    node: FunctionNode,
    scope: ScopeTracker,
  ): Array<{ node: AstNode; scope: ScopeTracker }> {
    return [
      ...resolveCallableValues(node.procedure, scope).flatMap((callable) =>
        callable.kind === "lambda" ? [{
          node: callable.binding.lambda.body,
          scope: lambdaCallScope(callable.binding, node.arguments, scope),
        }] : [],
      ),
      ...partialResultTargets(node, scope).flatMap((target) => target.callables.flatMap((callable) =>
        callable.kind === "lambda" ? [{
          node: callable.binding.lambda.body,
          scope: lambdaCallScope(callable.binding, target.arguments, target.scope),
        }] : [],
      )),
    ];
  }

  function customFunctionResultCallableValues(
    node: FunctionNode,
    scope: ScopeTracker,
    suffixSteps: AstNode[] = [],
  ): ResolvedCallable[] {
    return customFunctionResultBodies(node, scope).flatMap((body) =>
      resolveCallableValues(
        suffixSteps.length > 0
          ? ({ type: "path", steps: [body.node, ...suffixSteps] } as PathNode)
          : body.node,
        body.scope,
      ),
    );
  }

  function customFunctionResultBuiltinCallableNames(
    node: FunctionNode,
    scope: ScopeTracker,
    suffixSteps: AstNode[] = [],
  ): string[] {
    return customFunctionResultBodies(node, scope).flatMap((body) =>
      resolveBuiltinCallableNames(
        suffixSteps.length > 0
          ? ({ type: "path", steps: [body.node, ...suffixSteps] } as PathNode)
          : body.node,
        body.scope,
      ),
    );
  }

  function higherOrderResultCallableValues(
    node: FunctionNode,
    scope: ScopeTracker,
    suffixSteps: AstNode[] = [],
  ): ResolvedCallable[] {
    return higherOrderCallableResultBodies(node, scope).flatMap((body) =>
      resolveCallableValues(
        suffixSteps.length > 0
          ? ({ type: "path", steps: [body.node, ...suffixSteps] } as PathNode)
          : body.node,
        body.scope,
      ),
    );
  }

  function higherOrderResultBuiltinCallableNames(
    node: FunctionNode,
    scope: ScopeTracker,
    suffixSteps: AstNode[] = [],
  ): string[] {
    return higherOrderCallableResultBodies(node, scope).flatMap((body) =>
      resolveBuiltinCallableNames(
        suffixSteps.length > 0
          ? ({ type: "path", steps: [body.node, ...suffixSteps] } as PathNode)
          : body.node,
        body.scope,
      ),
    );
  }

  function pathProjectionCallableScope(
    path: PathNode,
    projectionIndex: number,
    scope: ScopeTracker,
  ): ScopeTracker {
    const prefixSteps = path.steps.slice(0, projectionIndex);
    const contextPrefix = buildProjectionContextPath(prefixSteps);
    const contextPaths = contextPrefix
      ? [contextPrefix]
      : runtime.higherOrder.extractBasePaths(
          { type: "path", steps: prefixSteps } as PathNode,
          scope,
        );
    let projectionScope = childScope(scope);
    for (const [index, step] of prefixSteps.entries()) {
      const bindingStep = step as AstNode & {
        focusBinding?: { name: string };
        indexBinding?: { name: string };
      };
      const bindingPrefix = buildProjectionContextPath(
        prefixSteps.slice(0, index + 1),
      );
      if (bindingStep.focusBinding && bindingPrefix) {
        projectionScope = bindVariable(
          projectionScope,
          bindingStep.focusBinding.name,
          markAbsolute([bindingPrefix]),
        );
      }
      if (bindingStep.indexBinding) {
        projectionScope = bindVariable(
          projectionScope,
          bindingStep.indexBinding.name,
          [],
        );
      }
    }
    return contextPaths.length > 0
      ? bindVariable(projectionScope, "", contextPaths)
      : projectionScope;
  }

  function pathProjectionCallableValues(
    path: PathNode,
    scope: ScopeTracker,
  ): ResolvedCallable[] {
    const projectionIndex = path.steps.findIndex(
      (step, index) =>
        index > 0 && ["object", "array", "block", "condition"].includes(step.type),
    );
    if (projectionIndex < 0) return [];
    return resolveCallableValues(
      {
        type: "path",
        steps: path.steps.slice(projectionIndex),
      } as PathNode,
      pathProjectionCallableScope(path, projectionIndex, scope),
    );
  }

  function pathProjectionBuiltinCallableNames(
    path: PathNode,
    scope: ScopeTracker,
  ): string[] {
    const projectionIndex = path.steps.findIndex(
      (step, index) =>
        index > 0 && ["object", "array", "block", "condition"].includes(step.type),
    );
    if (projectionIndex < 0) return [];
    return resolveBuiltinCallableNames(
      {
        type: "path",
        steps: path.steps.slice(projectionIndex),
      } as PathNode,
      pathProjectionCallableScope(path, projectionIndex, scope),
    );
  }

  function groupedPathCallableScope(
    path: PathNode,
    scope: ScopeTracker,
  ): ScopeTracker {
    return pathProjectionCallableScope(path, path.steps.length, scope);
  }

  function callableGroup(node: AstNode): GroupByNode | undefined {
    return (node as AstNode & { group?: GroupByNode }).group;
  }

  function groupedNodeCallableScope(
    node: AstNode,
    scope: ScopeTracker,
  ): ScopeTracker {
    return node.type === "path"
      ? groupedPathCallableScope(node as PathNode, scope)
      : scope;
  }

  function groupedNodeCallableValues(
    node: AstNode,
    scope: ScopeTracker,
    suffixSteps: AstNode[] = [],
  ): ResolvedCallable[] {
    const group = callableGroup(node);
    if (!group) return [];
    const [selector, ...rest] = suffixSteps;
    const groupInput = { ...node, group: undefined } as AstNode;
    const groupScope = runtime.functions.bindCallableValue(
      groupedNodeCallableScope(node, scope),
      "",
      groupInput,
      scope,
    );
    return group.entries.flatMap(([key, value]) => {
      const staticKey = runtime.aliases.staticObjectKey(key);
      const selected =
        !selector ||
        selector.type === "wildcard" ||
        (selector.type === "name" &&
          (staticKey === null || staticKey === (selector as NameNode).value));
      if (!selected) return [];
      return resolveCallableValues(
        rest.length > 0
          ? ({ type: "path", steps: [value, ...rest] } as PathNode)
          : value,
        groupScope,
      );
    });
  }

  function groupedPathCallableValues(
    path: PathNode,
    scope: ScopeTracker,
    suffixSteps: AstNode[] = [],
  ): ResolvedCallable[] {
    return groupedNodeCallableValues(path, scope, suffixSteps);
  }

  function groupedPathBuiltinCallableNames(
    path: PathNode,
    scope: ScopeTracker,
    suffixSteps: AstNode[] = [],
  ): string[] {
    return groupedNodeBuiltinCallableNames(path, scope, suffixSteps);
  }

  function groupedNodeBuiltinCallableNames(
    node: AstNode,
    scope: ScopeTracker,
    suffixSteps: AstNode[] = [],
  ): string[] {
    const group = callableGroup(node);
    if (!group) return [];
    const [selector, ...rest] = suffixSteps;
    const groupInput = { ...node, group: undefined } as AstNode;
    const groupScope = runtime.functions.bindCallableValue(
      groupedNodeCallableScope(node, scope),
      "",
      groupInput,
      scope,
    );
    return group.entries.flatMap(([key, value]) => {
      const staticKey = runtime.aliases.staticObjectKey(key);
      const selected =
        !selector ||
        selector.type === "wildcard" ||
        (selector.type === "name" &&
          (staticKey === null || staticKey === (selector as NameNode).value));
      if (!selected) return [];
      return resolveBuiltinCallableNames(
        rest.length > 0
          ? ({ type: "path", steps: [value, ...rest] } as PathNode)
          : value,
        groupScope,
      );
    });
  }

  function resolveCallableValues(
    node: AstNode,
    scope: ScopeTracker,
  ): ResolvedCallable[] {
    const focusResult = terminalFocusResultNode(node);
    if (focusResult) return resolveCallableValues(focusResult, scope);
    if ((node.type === "name" || node.type === "path" &&
         (node as PathNode).steps[0]?.type === "name") && resolveValue(scope, "")) {
      return resolveCallableValues(runtime.functions.explicitContextExpression(node, ""), scope);
    }
    if (node.type === "bind") return resolveCallableValues((node as BindNode).rhs, scope);
    if (node.type === "variable" && (node as VariableNode).resolvedBuiltin) return [];
    if (node.type === "path" && (node as PathNode).steps.some((step, index) => index > 0 &&
        step.type === "function" && runtime.functions.resultUsesContextDefault(step, scope))) {
      const chained = runtime.aliases.chainedPathContext(node as PathNode, scope);
      if (chained) return resolveCallableValues(chained.tail, chained.scope);
    }
    if (node.type === "path" && isDefinitelyDataValue(node, scope)) return [];
    if (node.type !== "path" && callableGroup(node)) {
      return groupedNodeCallableValues(node, scope);
    }
    if (node.type === "lambda") {
      const lambda = node as LambdaNode;
      return lambda.thunk
        ? resolveCallableValues(lambda.body, scope)
        : [{ kind: "lambda", binding: { lambda, scope } }];
    }
    if (node.type === "transform") {
      return [
        { kind: "transform", binding: { transform: node as TransformNode, scope } },
      ];
    }
    if (node.type === "partial") {
      return [
        {
          kind: "partial",
          binding: { partial: node as PartialNode, scope },
        },
      ];
    }
    if (node.type === "variable") {
      const variable = node as VariableNode;
      const name = variable.value;
      const lambda = resolveLambda(scope, name);
      if (lambda) return [{ kind: "lambda", binding: lambda }];
      const transform = resolveTransform(scope, name);
      if (transform) return [{ kind: "transform", binding: transform }];
      const partial = resolvePartial(scope, name);
      if (partial) return [{ kind: "partial", binding: partial }];
      const value = resolveValue(scope, name);
      if (!value) return [];
      const numericFilter = (variable.predicate ?? []).find(
        (stage) =>
          stage.type === "filter" &&
          (stage as unknown as FilterStage).expr.type === "number",
      ) as unknown as FilterStage | undefined;
      if (value.node.type === "array" && numericFilter) {
        const index = Number(
          ((numericFilter as unknown as FilterStage).expr as { value: number }).value,
        );
        const selected = (value.node as ArrayNode).expressions[index];
        return selected ? resolveCallableValues(selected, value.scope) : [];
      }
      return resolveCallableValues(value.node, value.scope);
    }
    if (node.type === "array") {
      return (node as ArrayNode).expressions.flatMap((value) =>
        resolveCallableValues(value, scope),
      );
    }
    if (node.type === "object") {
      return (node as ObjectNode).entries.flatMap(([, value]) =>
        resolveCallableValues(value, scope),
      );
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [
        ...resolveCallableValues(condition.then, scope),
        ...(condition.else ? resolveCallableValues(condition.else, scope) : []),
      ];
    }
    if (node.type === "block") {
      const block = node as BlockNode;
      let blockScope = childScope(scope);
      for (const [index, expression] of block.expressions.entries()) {
        const expressionScope = blockScope;
        if (index === block.expressions.length - 1) {
          return resolveCallableValues(expression, blockScope);
        }
        if (expression.type === "bind") {
          blockScope = bindCallableBlockValue(blockScope, expression as BindNode);
        }
        blockScope = runtime.core.bindArrayAssignmentEffects(expression, blockScope, expressionScope);
      }
      return [];
    }
    if (node.type === "path") {
      const path = node as PathNode;
      const method = resolveStoredMethodPath(path, scope);
      if (method) return resolveCallableValues(method.node, method.scope);
      const groupedValues = groupedPathCallableValues(path, scope);
      if (groupedValues.length > 0) return groupedValues;
      const projectionValues = pathProjectionCallableValues(path, scope);
      if (projectionValues.length > 0) return projectionValues;
      const [first, ...rawSuffixSteps] = path.steps;
      const suffixSteps = rawSuffixSteps.filter((step) => step.type !== "sort" &&
        !(step.type === "variable" && (step as VariableNode).value === "" && !(step as VariableNode).group));
      if (!first) return [];
  
      const { node: sourceNode, scope: sourceScope } =
        unwrapCallableContainerNode(first, scope);
  
      if (callableGroup(sourceNode)) {
        return groupedNodeCallableValues(sourceNode, sourceScope, suffixSteps);
      }
  
      if (sourceNode.type === "condition") {
        const condition = sourceNode as ConditionNode;
        return [condition.then, condition.else].flatMap((branch) =>
          branch
            ? resolveCallableValues(
                suffixSteps.length > 0
                  ? ({ type: "path", steps: [branch, ...suffixSteps] } as PathNode)
                  : branch,
                sourceScope,
              )
            : [],
        );
      }
      if (sourceNode.type === "array") {
        return callableArrayEntries(sourceNode as ArrayNode).flatMap((entry) =>
          resolveCallableValues(
            suffixSteps.length > 0
              ? ({ type: "path", steps: [entry, ...suffixSteps] } as PathNode)
              : entry,
            sourceScope,
          ),
        );
      }
      if (sourceNode.type === "apply") {
        const appliedFunction = runtime.functions.appliedFunctionFromApply(sourceNode as ApplyNode);
        return appliedFunction
          ? resolveCallableValues(
              suffixSteps.length > 0
                ? ({
                    type: "path",
                    steps: [appliedFunction, ...suffixSteps],
                  } as PathNode)
                : appliedFunction,
              sourceScope,
            )
          : [];
      }
      if (sourceNode.type === "path" && suffixSteps.length > 0) {
        // Grouped source nodes returned before entering this path branch.
        return resolveCallableValues(
          {
            ...sourceNode,
            steps: [...(sourceNode as PathNode).steps, ...suffixSteps],
          } as PathNode,
          sourceScope,
        );
      }
      if (sourceNode.type === "function") {
        const functionNode = sourceNode as FunctionNode;
        const evalExpression = resolveBuiltinCallableNames(functionNode.procedure, sourceScope).includes("eval")
          ? runtime.functions.getStaticEvalExpression(functionNode.arguments, sourceScope) : null;
        return [
          ...partialBuiltinResultCalls(functionNode, sourceScope).flatMap((call) => resolveCallableValues(
            suffixSteps.length > 0 ? { type: "path", steps: [call.node, ...suffixSteps] } as PathNode : call.node,
            call.scope,
          )),
          ...(evalExpression ? resolveCallableValues(
            suffixSteps.length > 0 ? { type: "path", steps: [evalExpression, ...suffixSteps] } as PathNode : evalExpression,
            runtime.functions.getStaticEvalScope(functionNode.arguments, sourceScope),
          ) : []),
          ...(resolveBuiltinCallableNames(functionNode.procedure, sourceScope).includes("lookup")
            ? resolveCallableValues(functionNode, sourceScope)
            : []),
          ...customFunctionResultCallableValues(
            functionNode,
            sourceScope,
            suffixSteps,
          ),
          ...runtime.transforms.transformUpdateCallableValues(
            functionNode,
            suffixSteps,
            sourceScope,
          ),
          ...higherOrderResultCallableValues(
            functionNode,
            sourceScope,
            suffixSteps,
          ),
          ...callableContainerProducerInputs(functionNode, sourceScope).flatMap((input) =>
            resolveCallableValues(
              suffixSteps.length > 0
                ? ({ type: "path", steps: [input, ...suffixSteps] } as PathNode)
                : input,
              sourceScope,
            ),
          ),
        ];
      }
  
      const [selector, ...rest] = suffixSteps;
      if (
        sourceNode.type === "object" &&
        (selector?.type === "name" || selector?.type === "wildcard")
      ) {
        return (sourceNode as ObjectNode).entries.flatMap(([key, value]) =>
          selector.type === "wildcard" ||
          runtime.aliases.staticObjectKey(key) === null ||
          runtime.aliases.staticObjectKey(key) === (selector as NameNode).value
            ? resolveCallableValues(
                rest.length > 0
                  ? ({ type: "path", steps: [value, ...rest] } as PathNode)
                  : value,
                sourceScope,
              )
            : [],
        );
      }
      return suffixSteps.length === 0
        ? resolveCallableValues(sourceNode, sourceScope)
        : [];
    }
    if (node.type === "apply") {
      const apply = node as ApplyNode;
      const lambda = compositionLambda(apply, scope);
      if (lambda) return [{ kind: "lambda", binding: { lambda, scope } }];
      const appliedFunction = runtime.functions.appliedFunctionFromApply(apply);
      if (appliedFunction) {
        return resolveCallableValues(appliedFunction, scope);
      }
      return [];
    }
    if (node.type !== "function") return [];
  
    const functionNode = node as FunctionNode;
    const partialCalls = partialBuiltinResultCalls(functionNode, scope);
    if (partialCalls.length > 0 || resolveCallableValues(functionNode.procedure, scope)
        .some((callable) => callable.kind === "partial")) {
      return [
        ...customFunctionResultCallableValues(functionNode, scope),
        ...partialCalls.flatMap((call) => resolveCallableValues(call.node, call.scope)),
        ...resolveBuiltinCallableNames(functionNode.procedure, scope).flatMap((name) => resolveCallableValues({
          ...functionNode,
          procedure: { type: "variable", value: name, position: functionNode.position, resolvedBuiltin: true },
        }, scope)),
      ];
    }
    const specialBuiltins = resolveBuiltinCallableNames(functionNode.procedure, scope)
      .filter((name) => name === "lookup" || name === "eval");
    if (specialBuiltins.length > 0 && resolveCallableValues(functionNode.procedure, scope).length > 0) {
      return [
        ...customFunctionResultCallableValues(functionNode, scope),
        ...specialBuiltins.flatMap((name) => resolveCallableValues({
          ...functionNode,
          procedure: { type: "variable", value: name, position: functionNode.position, resolvedBuiltin: true },
        }, scope)),
      ];
    }
    if (
      specialBuiltins.includes("eval")
    ) {
      const expression = runtime.functions.getStaticEvalExpression(functionNode.arguments, scope);
      if (!expression) return [];
      return resolveCallableValues(
        expression,
        runtime.functions.getStaticEvalScope(functionNode.arguments, scope),
      );
    }
    if (
      resolveBuiltinCallableNames(functionNode.procedure, scope).includes("lookup")
    ) {
      const objectArg = functionNode.arguments[0];
      if (!objectArg) return [];
      const keyArg = functionNode.arguments[1];
      const staticKey = keyArg?.type === "string"
        ? (keyArg as { value: string }).value
        : null;
      if (staticKey !== null) {
        return resolveCallableValues(
          {
            type: "path",
            steps: [
              objectArg,
              { type: "name", value: staticKey, position: functionNode.position },
            ],
          } as PathNode,
          scope,
        );
      }
      const selectedValues = resolveCallableValues(
        dynamicCallableLookupSelection(objectArg, functionNode.position),
        scope,
      );
      if (selectedValues.length > 0) return selectedValues;
      const directValues = resolveCallableValues(objectArg, scope);
      if (directValues.length > 0) return directValues;
      const { node: objectNode, scope: objectScope } =
        unwrapCallableContainerNode(objectArg, scope);
      if (objectNode.type === "condition") {
        const condition = objectNode as ConditionNode;
        return [condition.then, condition.else].flatMap((branch) =>
          branch
            ? resolveCallableValues(
                {
                  ...functionNode,
                  arguments: [branch, ...functionNode.arguments.slice(1)],
                },
                objectScope,
              )
            : [],
        );
      }
      if (objectNode.type === "function") {
        const producerValues = callableContainerProducerInputs(
          objectNode as FunctionNode,
          objectScope,
        ).flatMap((input) => resolveCallableValues(input, objectScope));
        if (producerValues.length > 0) return producerValues;
        return customFunctionResultBodies(
          objectNode as FunctionNode,
          objectScope,
        ).flatMap((body) =>
          resolveCallableValues(
            {
              ...functionNode,
              arguments: [
                body.node,
                ...functionNode.arguments.slice(1),
              ],
            },
            body.scope,
          ),
        );
      }
      if (objectNode.type === "path" && (objectNode as PathNode).group) {
        return (objectNode as PathNode).group!.entries.flatMap(([, value]) =>
          resolveCallableValues(value, objectScope),
        );
      }
      if (objectNode.type !== "object") return [];
  
      // A static key returned above; this fallback selects all possible values.
      return (objectNode as ObjectNode).entries.flatMap(([, value]) =>
        resolveCallableValues(value, objectScope),
      );
    }
    const higherOrderResults = higherOrderResultCallableValues(
      functionNode,
      scope,
    );
    if (higherOrderResults.length > 0) return higherOrderResults;
  
    const producerResults = callableContainerProducerInputs(functionNode, scope).flatMap(
      (input) => resolveCallableValues(input, scope),
    );
    if (producerResults.length > 0) return producerResults;
  
    const lambdaBinding =
      functionNode.procedure.type === "lambda"
        ? { lambda: functionNode.procedure, scope }
        : functionNode.procedure.type === "variable" && !functionNode.procedure.resolvedBuiltin
          ? resolveLambda(scope, functionNode.procedure.value)
          : null;
    if (!lambdaBinding) return [];
    return resolveCallableValues(
      lambdaBinding.lambda.body,
      lambdaCallScope(lambdaBinding, functionNode.arguments, scope),
    );
  }

  function resolveBuiltinCallableNames(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] {
    if (node.type === "lambda" && (node as LambdaNode).thunk) {
      return resolveBuiltinCallableNames((node as LambdaNode).body, scope);
    }
    const focusResult = terminalFocusResultNode(node);
    if (focusResult) return resolveBuiltinCallableNames(focusResult, scope);
    if (node.type === "path" && (node as PathNode).steps.some((step, index) => index > 0 &&
        step.type === "function" && runtime.functions.resultUsesContextDefault(step, scope))) {
      const chained = runtime.aliases.chainedPathContext(node as PathNode, scope);
      if (chained) return resolveBuiltinCallableNames(chained.tail, chained.scope);
    }
    if ((node.type === "name" || node.type === "path" &&
         (node as PathNode).steps[0]?.type === "name") && resolveValue(scope, "")) {
      return resolveBuiltinCallableNames(runtime.functions.explicitContextExpression(node, ""), scope);
    }
    if (node.type === "bind") return resolveBuiltinCallableNames((node as BindNode).rhs, scope);
    if (node.type !== "path" && callableGroup(node)) {
      return groupedNodeBuiltinCallableNames(node, scope);
    }
    if (node.type === "variable") {
      const variable = node as VariableNode;
      if (variable.resolvedBuiltin) return [variable.value];
      const value = resolveValue(scope, variable.value);
      if (!value) {
        return BUILTIN_FUNCTIONS.has(variable.value) ? [variable.value] : [];
      }
      if (value.node.type === "partial") return [];
      if (
        value.node.type === "apply" &&
        compositionLambda(value.node as ApplyNode, value.scope)
      ) {
        return [];
      }
      const numericFilter = (variable.predicate ?? []).find(
        (stage) =>
          stage.type === "filter" &&
          (stage as unknown as FilterStage).expr.type === "number",
      ) as unknown as FilterStage | undefined;
      if (value.node.type === "array" && numericFilter) {
        const index = Number(
          ((numericFilter as unknown as FilterStage).expr as { value: number }).value,
        );
        const selected = (value.node as ArrayNode).expressions[index];
        return selected ? resolveBuiltinCallableNames(selected, value.scope) : [];
      }
      return resolveBuiltinCallableNames(value.node, value.scope);
    }
    if (node.type === "partial") {
      return [];
    }
    if (node.type === "array") {
      return (node as ArrayNode).expressions.flatMap((value) =>
        resolveBuiltinCallableNames(value, scope),
      );
    }
    if (node.type === "object") {
      return (node as ObjectNode).entries.flatMap(([, value]) =>
        resolveBuiltinCallableNames(value, scope),
      );
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [
        ...resolveBuiltinCallableNames(condition.then, scope),
        ...(condition.else
          ? resolveBuiltinCallableNames(condition.else, scope)
          : []),
      ];
    }
    if (node.type === "path") {
      const path = node as PathNode;
      const method = resolveStoredMethodPath(path, scope);
      if (method) return resolveBuiltinCallableNames(method.node, method.scope);
      const groupedNames = groupedPathBuiltinCallableNames(path, scope);
      if (groupedNames.length > 0) return groupedNames;
      const projectionNames = pathProjectionBuiltinCallableNames(path, scope);
      if (projectionNames.length > 0) return projectionNames;
      const [first, ...rawSuffixSteps] = path.steps;
      const suffixSteps = rawSuffixSteps.filter((step) => step.type !== "sort" &&
        !(step.type === "variable" && (step as VariableNode).value === "" && !(step as VariableNode).group));
      if (!first) return [];
  
      const { node: sourceNode, scope: sourceScope } =
        unwrapCallableContainerNode(first, scope);
  
      if (callableGroup(sourceNode)) {
        return groupedNodeBuiltinCallableNames(
          sourceNode,
          sourceScope,
          suffixSteps,
        );
      }
  
      if (sourceNode.type === "condition") {
        const condition = sourceNode as ConditionNode;
        return [condition.then, condition.else].flatMap((branch) =>
          branch
            ? resolveBuiltinCallableNames(
                suffixSteps.length > 0
                  ? ({ type: "path", steps: [branch, ...suffixSteps] } as PathNode)
                  : branch,
                sourceScope,
              )
            : [],
        );
      }
      if (sourceNode.type === "array") {
        return callableArrayEntries(sourceNode as ArrayNode).flatMap((entry) =>
          resolveBuiltinCallableNames(
            suffixSteps.length > 0
              ? ({ type: "path", steps: [entry, ...suffixSteps] } as PathNode)
              : entry,
            sourceScope,
          ),
        );
      }
      if (sourceNode.type === "apply") {
        const appliedFunction = runtime.functions.appliedFunctionFromApply(sourceNode as ApplyNode);
        return appliedFunction
          ? resolveBuiltinCallableNames(
              suffixSteps.length > 0
                ? ({
                    type: "path",
                    steps: [appliedFunction, ...suffixSteps],
                  } as PathNode)
                : appliedFunction,
              sourceScope,
            )
          : [];
      }
      if (sourceNode.type === "path" && suffixSteps.length > 0) {
        // Grouped source nodes returned before entering this path branch.
        return resolveBuiltinCallableNames(
          {
            ...sourceNode,
            steps: [...(sourceNode as PathNode).steps, ...suffixSteps],
          } as PathNode,
          sourceScope,
        );
      }
      if (sourceNode.type === "function") {
        const functionNode = sourceNode as FunctionNode;
        const evalExpression = resolveBuiltinCallableNames(functionNode.procedure, sourceScope).includes("eval")
          ? runtime.functions.getStaticEvalExpression(functionNode.arguments, sourceScope) : null;
        return [
          ...partialBuiltinResultCalls(functionNode, sourceScope).flatMap((call) => resolveBuiltinCallableNames(
            suffixSteps.length > 0 ? { type: "path", steps: [call.node, ...suffixSteps] } as PathNode : call.node,
            call.scope,
          )),
          ...(evalExpression ? resolveBuiltinCallableNames(
            suffixSteps.length > 0 ? { type: "path", steps: [evalExpression, ...suffixSteps] } as PathNode : evalExpression,
            runtime.functions.getStaticEvalScope(functionNode.arguments, sourceScope),
          ) : []),
          ...(resolveBuiltinCallableNames(functionNode.procedure, sourceScope).includes("lookup")
            ? resolveBuiltinCallableNames(functionNode, sourceScope)
            : []),
          ...customFunctionResultBuiltinCallableNames(
            functionNode,
            sourceScope,
            suffixSteps,
          ),
          ...runtime.transforms.transformUpdateBuiltinCallableNames(
            functionNode,
            suffixSteps,
            sourceScope,
          ),
          ...higherOrderResultBuiltinCallableNames(
            functionNode,
            sourceScope,
            suffixSteps,
          ),
          ...callableContainerProducerInputs(functionNode, sourceScope).flatMap((input) =>
            resolveBuiltinCallableNames(
              suffixSteps.length > 0
                ? ({ type: "path", steps: [input, ...suffixSteps] } as PathNode)
                : input,
              sourceScope,
            ),
          ),
        ];
      }
  
      const [selector, ...rest] = suffixSteps;
      if (
        sourceNode.type === "object" &&
        (selector?.type === "name" || selector?.type === "wildcard")
      ) {
        return (sourceNode as ObjectNode).entries.flatMap(([key, value]) =>
          selector.type === "wildcard" ||
          runtime.aliases.staticObjectKey(key) === null ||
          runtime.aliases.staticObjectKey(key) === (selector as NameNode).value
            ? resolveBuiltinCallableNames(
                rest.length > 0
                  ? ({ type: "path", steps: [value, ...rest] } as PathNode)
                  : value,
                sourceScope,
              )
            : [],
        );
      }
      return suffixSteps.length === 0
        ? resolveBuiltinCallableNames(sourceNode, sourceScope)
        : [];
    }
    if (node.type === "apply") {
      const apply = node as ApplyNode;
      const appliedFunction =
        runtime.functions.appliedFunctionFromApply(apply) ??
        (isFunctionProcedureNode(apply.rhs)
          ? ({
              type: "function",
              value: "(",
              position: apply.position,
              procedure: apply.rhs,
              arguments: [apply.lhs],
            } as FunctionNode)
          : null);
      return appliedFunction
        ? resolveBuiltinCallableNames(appliedFunction, scope)
        : [];
    }
    if (node.type === "block") {
      const block = node as BlockNode;
      let blockScope = scope;
      for (const [index, expression] of block.expressions.entries()) {
        const expressionScope = blockScope;
        if (index === block.expressions.length - 1) {
          return resolveBuiltinCallableNames(expression, blockScope);
        }
        if (expression.type === "bind") {
          blockScope = bindCallableBlockValue(blockScope, expression as BindNode);
        }
        blockScope = runtime.core.bindArrayAssignmentEffects(expression, blockScope, expressionScope);
      }
    }
    if (node.type === "function") {
      const functionNode = node as FunctionNode;
      const partialCalls = partialBuiltinResultCalls(functionNode, scope);
      if (partialCalls.length > 0 || resolveCallableValues(functionNode.procedure, scope)
          .some((callable) => callable.kind === "partial")) {
        return [
          ...customFunctionResultBuiltinCallableNames(functionNode, scope),
          ...partialCalls.flatMap((call) => resolveBuiltinCallableNames(call.node, call.scope)),
          ...resolveBuiltinCallableNames(functionNode.procedure, scope).flatMap((name) => resolveBuiltinCallableNames({
            ...functionNode,
            procedure: { type: "variable", value: name, position: functionNode.position, resolvedBuiltin: true },
          }, scope)),
        ];
      }
      const specialBuiltins = resolveBuiltinCallableNames(functionNode.procedure, scope)
        .filter((name) => name === "lookup" || name === "eval");
      if (specialBuiltins.length > 0 && resolveCallableValues(functionNode.procedure, scope).length > 0) {
        return [
          ...customFunctionResultBuiltinCallableNames(functionNode, scope),
          ...specialBuiltins.flatMap((name) => resolveBuiltinCallableNames({
            ...functionNode,
            procedure: { type: "variable", value: name, position: functionNode.position, resolvedBuiltin: true },
          }, scope)),
        ];
      }
      if (
        specialBuiltins.includes("eval")
      ) {
        const expression = runtime.functions.getStaticEvalExpression(functionNode.arguments, scope);
        return expression
          ? resolveBuiltinCallableNames(
              expression,
              runtime.functions.getStaticEvalScope(functionNode.arguments, scope),
            )
          : [];
      }
      if (
        resolveBuiltinCallableNames(functionNode.procedure, scope).includes("lookup")
      ) {
        const objectArg = functionNode.arguments[0];
        if (!objectArg) return [];
        const keyArg = functionNode.arguments[1];
        const staticKey =
          keyArg?.type === "string"
            ? (keyArg as { value: string }).value
            : null;
        if (staticKey !== null) {
          return resolveBuiltinCallableNames(
            {
              type: "path",
              steps: [
                objectArg,
                { type: "name", value: staticKey, position: functionNode.position },
              ],
            } as PathNode,
            scope,
          );
        }
        const selectedNames = resolveBuiltinCallableNames(
          dynamicCallableLookupSelection(objectArg, functionNode.position),
          scope,
        );
        if (selectedNames.length > 0) return selectedNames;
        const directNames = resolveBuiltinCallableNames(objectArg, scope);
        if (directNames.length > 0) return directNames;
        const { node: objectNode, scope: objectScope } =
          unwrapCallableContainerNode(objectArg, scope);
        if (objectNode.type === "condition") {
          const condition = objectNode as ConditionNode;
          return [condition.then, condition.else].flatMap((branch) =>
            branch
              ? resolveBuiltinCallableNames(
                  {
                    ...functionNode,
                    arguments: [branch, ...functionNode.arguments.slice(1)],
                  },
                  objectScope,
                )
              : [],
          );
        }
        if (objectNode.type === "function") {
          const producerNames = callableContainerProducerInputs(
            objectNode as FunctionNode,
            objectScope,
          ).flatMap((input) =>
            resolveBuiltinCallableNames(input, objectScope),
          );
          if (producerNames.length > 0) return producerNames;
          return customFunctionResultBodies(
            objectNode as FunctionNode,
            objectScope,
          ).flatMap((body) =>
            resolveBuiltinCallableNames(
              {
                ...functionNode,
                arguments: [
                  body.node,
                  ...functionNode.arguments.slice(1),
                ],
              },
              body.scope,
            ),
          );
        }
        if (objectNode.type === "path" && (objectNode as PathNode).group) {
          return (objectNode as PathNode).group!.entries.flatMap(([, value]) =>
            resolveBuiltinCallableNames(value, objectScope),
          );
        }
        if (objectNode.type !== "object") return [];
  
        // A static key returned above; this fallback selects all possible values.
        return (objectNode as ObjectNode).entries.flatMap(([, value]) =>
          resolveBuiltinCallableNames(value, objectScope),
        );
      }
  
      const higherOrderResults = higherOrderResultBuiltinCallableNames(
        functionNode,
        scope,
      );
      if (higherOrderResults.length > 0) return higherOrderResults;
  
      const producerResults = callableContainerProducerInputs(
        functionNode,
        scope,
      ).flatMap((input) => resolveBuiltinCallableNames(input, scope));
      if (producerResults.length > 0) return producerResults;
  
      const lambdaBinding =
        functionNode.procedure.type === "lambda"
          ? { lambda: functionNode.procedure, scope }
          : functionNode.procedure.type === "variable" && !functionNode.procedure.resolvedBuiltin
            ? resolveLambda(scope, functionNode.procedure.value)
            : null;
      if (lambdaBinding) {
        return resolveBuiltinCallableNames(
          lambdaBinding.lambda.body,
          lambdaCallScope(lambdaBinding, functionNode.arguments, scope),
        );
      }
      return resolveCallableValues(functionNode.procedure, scope).flatMap(
        (callable) =>
          callable.kind === "lambda"
            ? resolveBuiltinCallableNames(
                callable.binding.lambda.body,
                lambdaCallScope(callable.binding, functionNode.arguments, scope),
              )
            : [],
      );
    }
    return [];
  }

  return {
    resolveStoredMethodPath,
    isFunctionProcedureNode,
    isFilteredCallableVariable,
    resolvedCallableNames,
    bindCallableBlockValue,
    callableProcedureVariableNames,
    bindForwardReferences,
    lambdaCallScope,
    compositionLambda,
    customFunctionResultCallableValues,
    customFunctionResultBuiltinCallableNames,
    higherOrderResultCallableValues,
    higherOrderResultBuiltinCallableNames,
    pathProjectionCallableValues,
    pathProjectionBuiltinCallableNames,
    groupedPathCallableScope,
    groupedPathCallableValues,
    groupedPathBuiltinCallableNames,
    resolveCallableValues,
    resolveBuiltinCallableNames,
  };
}
