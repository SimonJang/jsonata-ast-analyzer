import type { ArrayNode, AstNode, ApplyNode, BindNode, BlockNode, ConditionNode, FilterStage, FunctionNode, GroupByNode, LambdaNode, NameNode, ObjectNode, PartialNode, PathNode, TransformNode, VariableNode, WildcardNode } from "../types.js";
import { type ScopeTracker, childScope, bindVariable, bindSuffixBasePaths, bindObjectAlias, bindDynamicObjectAlias, resolveLambda, resolvePartial, resolveTransform, resolveValue, resolveValueFrame, resolveVariable, resolveSuffixBasePaths, resolveObjectAlias, resolveDynamicObjectAlias, type LambdaBinding } from "../scope.js";
import { BUILTIN_FUNCTIONS } from "../builtins.js";
import { PATH_PRESERVING_RESULT_FUNCTIONS } from "./constants.js";
import { markAbsolute, collectVariableNames, buildProjectionContextPath } from "./path-utils.js";
import type { CallableOperations, WalkerRuntime, ResolvedCallable } from "./runtime.js";

export function createCallableOperations(runtime: WalkerRuntime): CallableOperations {
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
        resultScope = bindVariable(
          resultScope,
          name,
          resolveVariable(resultScope, name) ?? [],
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
      const argPaths = arg ? runtime.higherOrder.extractBasePaths(arg, callScope) : [];
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

  function unwrapCallableContainerNode(
    node: AstNode,
    scope: ScopeTracker,
    depth = 0,
  ): { readonly node: AstNode; readonly scope: ScopeTracker } {
    if (depth >= 16) return { node, scope };
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
      }
    }
    if (
      node.type === "function" &&
      (node as FunctionNode).procedure.type === "variable" &&
      ((node as FunctionNode).procedure as VariableNode).value === "eval"
    ) {
      const functionNode = node as FunctionNode;
      const expression = runtime.functions.getStaticEvalExpression(functionNode.arguments);
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

  function callableContainerProducerInputs(
    node: FunctionNode,
    scope: ScopeTracker,
  ): AstNode[] {
    if (node.procedure.type !== "variable") return [];
    const funcName = node.procedure.value;
    if (
      funcName === "reduce" &&
      node.arguments[1] &&
      resolveBuiltinCallableNames(node.arguments[1], scope).includes("append")
    ) {
      return [node.arguments[0], node.arguments[2]].filter(
        (input): input is AstNode => Boolean(input),
      );
    }
    if (funcName === "append" || funcName === "zip") return node.arguments;
    if (
      funcName !== "lookup" &&
      PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName)
    ) {
      return node.arguments[0] ? [node.arguments[0]] : [];
    }
    return [];
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
        { index: 1, bindings: [], partials },
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
    return runtime.higherOrder.resolveLambdaFunctionCalls(
      node.procedure,
      node.arguments,
      scope,
    ).map((call) => ({
      node: call.binding.lambda.body,
      scope: lambdaCallScope(call.binding, call.arguments, scope),
    }));
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
        if (index === block.expressions.length - 1) {
          return resolveCallableValues(expression, blockScope);
        }
        if (expression.type === "bind") {
          blockScope = bindCallableBlockValue(blockScope, expression as BindNode);
        }
      }
      return [];
    }
    if (node.type === "path") {
      const path = node as PathNode;
      const groupedValues = groupedPathCallableValues(path, scope);
      if (groupedValues.length > 0) return groupedValues;
      const projectionValues = pathProjectionCallableValues(path, scope);
      if (projectionValues.length > 0) return projectionValues;
      const [first, ...rawSuffixSteps] = path.steps;
      const suffixSteps = rawSuffixSteps.filter((step) => step.type !== "sort");
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
        const groupedSourceValues = groupedPathCallableValues(
          sourceNode as PathNode,
          sourceScope,
          suffixSteps,
        );
        if (groupedSourceValues.length > 0) return groupedSourceValues;
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
        return [
          ...(functionNode.procedure.type === "variable" &&
          functionNode.procedure.value === "lookup"
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
    if (
      functionNode.procedure.type === "variable" &&
      functionNode.procedure.value === "eval"
    ) {
      const expression = runtime.functions.getStaticEvalExpression(functionNode.arguments);
      if (!expression) return [];
      return resolveCallableValues(
        expression,
        runtime.functions.getStaticEvalScope(functionNode.arguments, scope),
      );
    }
    if (
      functionNode.procedure.type === "variable" &&
      functionNode.procedure.value === "lookup"
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
  
      return (objectNode as ObjectNode).entries.flatMap(([key, value]) =>
        staticKey === null || runtime.aliases.staticObjectKey(key) === staticKey
          ? resolveCallableValues(value, objectScope)
          : [],
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
        : functionNode.procedure.type === "variable"
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
    if (node.type !== "path" && callableGroup(node)) {
      return groupedNodeBuiltinCallableNames(node, scope);
    }
    if (node.type === "variable") {
      const variable = node as VariableNode;
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
      return resolveBuiltinCallableNames(
        (node as PartialNode).procedure,
        scope,
      );
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
      const groupedNames = groupedPathBuiltinCallableNames(path, scope);
      if (groupedNames.length > 0) return groupedNames;
      const projectionNames = pathProjectionBuiltinCallableNames(path, scope);
      if (projectionNames.length > 0) return projectionNames;
      const [first, ...rawSuffixSteps] = path.steps;
      const suffixSteps = rawSuffixSteps.filter((step) => step.type !== "sort");
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
        const groupedSourceNames = groupedPathBuiltinCallableNames(
          sourceNode as PathNode,
          sourceScope,
          suffixSteps,
        );
        if (groupedSourceNames.length > 0) return groupedSourceNames;
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
        return [
          ...(functionNode.procedure.type === "variable" &&
          functionNode.procedure.value === "lookup"
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
        if (index === block.expressions.length - 1) {
          return resolveBuiltinCallableNames(expression, blockScope);
        }
        if (expression.type === "bind") {
          blockScope = bindCallableBlockValue(blockScope, expression as BindNode);
        }
      }
    }
    if (node.type === "function") {
      const functionNode = node as FunctionNode;
      if (
        functionNode.procedure.type === "variable" &&
        functionNode.procedure.value === "eval"
      ) {
        const expression = runtime.functions.getStaticEvalExpression(functionNode.arguments);
        return expression
          ? resolveBuiltinCallableNames(
              expression,
              runtime.functions.getStaticEvalScope(functionNode.arguments, scope),
            )
          : [];
      }
      if (
        functionNode.procedure.type === "variable" &&
        functionNode.procedure.value === "lookup"
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
  
        return (objectNode as ObjectNode).entries.flatMap(([key, value]) =>
          staticKey === null || runtime.aliases.staticObjectKey(key) === staticKey
            ? resolveBuiltinCallableNames(value, objectScope)
            : [],
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
          : functionNode.procedure.type === "variable"
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
