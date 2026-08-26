import type { ArrayNode, AstNode, ApplyNode, BindNode, BlockNode, ConditionNode, FilterStage, FunctionNode, LambdaNode, NameNode, ObjectNode, PartialNode, PathNode, VariableNode, WildcardNode } from "../types.js";
import { buildPathString } from "../path-builder.js";
import { type ScopeTracker, childScope, bindVariable, bindLambdaReference, resolveLambda, resolvePartial, resolveValue, resolveVariable, resolveSuffixBasePaths, resolveObjectAlias, resolveDynamicObjectAlias, type DynamicObjectAlias, type LambdaBinding, type ObjectAlias } from "../scope.js";
import { HIGHER_ORDER_SEMANTICS } from "../builtins.js";
import { ROOT_PATH } from "./constants.js";
import { prefixProjectionPaths, appendPath, resolveParentPathSegments, isRootReference, markAbsolute, parentPath, isParentRelativePath, stripParentRelativePath, filterToBasePaths, hasPendingFocusReset } from "./path-utils.js";
import type { HigherOrderOperations, WalkerRuntime, ResolvedLambdaCall, ResolvedPartialCall } from "./runtime.js";

export function createHigherOrderOperations(runtime: WalkerRuntime): HigherOrderOperations {
  /**
   * Extract only the collection-identity (base) paths from a data argument node,
   * excluding filter predicate paths. Used specifically for HOF lambda parameter
   * binding to prevent predicate paths from leaking into element bindings.
   *
   * For PathNode: uses buildPathString to get the structural base path (skips filter stages)
   * For ApplyNode: recursively extracts from the lhs (chained apply base identity)
   * For VariableNode: resolves and filters to base paths only
   * For NameNode: returns the name value directly
   * Default: falls back to walkNode (no filter stages to strip)
   */
  function extractBasePaths(node: AstNode, scope: ScopeTracker): string[] {
    if (node.type === "variable" && (node as VariableNode).value === "") {
      const capturedCurrent = resolveVariable(scope, "");
      if (capturedCurrent !== null) return filterToBasePaths([...capturedCurrent]);
    }
    if (isRootReference(node)) return [ROOT_PATH];
  
    if (node.type === "path") {
      const pathNode = node as PathNode;
      const firstStep = pathNode.steps[0];
      if (firstStep?.type === "variable" && (firstStep as VariableNode).value === "") {
        const capturedCurrent = resolveVariable(scope, "");
        if (capturedCurrent !== null) {
          const suffix = buildPathString(pathNode.steps.slice(1));
          return filterToBasePaths([...capturedCurrent]).map((path) =>
            appendPath(path, suffix),
          );
        }
      }
      if (isRootReference(pathNode.steps[0])) {
        const rootPaths = extractBasePaths(
          { ...pathNode, steps: pathNode.steps.slice(1) },
          scope,
        );
        return rootPaths.length > 0 ? markAbsolute(rootPaths) : [ROOT_PATH];
      }
      const tupleBasePath = buildPathString(pathNode.steps);
      if (tupleBasePath && hasPendingFocusReset(pathNode.steps)) {
        return [parentPath(tupleBasePath) || ROOT_PATH];
      }
      // Check for variable steps (e.g., $v.children) -- must resolve variable
      const varStepIndex = pathNode.steps.findIndex((s) => s.type === "variable");
      if (varStepIndex >= 0) {
        const varStep = pathNode.steps[varStepIndex] as VariableNode;
        const objectAlias = resolveObjectAlias(scope, varStep.value);
        const dynamicObjectAlias = resolveDynamicObjectAlias(scope, varStep.value);
        if (objectAlias || dynamicObjectAlias) {
          const suffixSteps = pathNode.steps.slice(varStepIndex + 1);
          const suffixBasePaths = resolveSuffixBasePaths(scope, varStep.value) ?? [];
          const aliasPaths =
            suffixSteps.length > 0 && suffixBasePaths.length > 0
              ? runtime.aliases.selectAliasSuffixContextPaths(
                  suffixSteps,
                  objectAlias,
                  dynamicObjectAlias,
                  scope,
                  suffixBasePaths,
                )
              : runtime.aliases.selectVariableObjectAliasPaths(
                  objectAlias,
                  dynamicObjectAlias,
                  suffixSteps,
                  scope,
                );
          if (aliasPaths) return aliasPaths;
        }
  
        const resolved = resolveVariable(scope, varStep.value);
        if (resolved && resolved.length > 0) {
          const basePaths = filterToBasePaths([...resolved]);
          const suffixSteps = pathNode.steps.slice(varStepIndex + 1);
          const suffix = buildPathString(suffixSteps);
          return basePaths.map((p) => (suffix ? `${p}.${suffix}` : p));
        }
        return [];
      }
      if (pathNode.steps.some(runtime.aliases.isResultAliasStep)) {
        return runtime.aliases.pathResultAliasContextBasePaths(pathNode, scope).map(resolveParentPathSegments);
      }
      const basePath = buildPathString(pathNode.steps);
      return basePath ? [basePath] : [];
    }
    if (node.type === "apply") {
      // Chained apply base identity comes from the leftmost operand
      return extractBasePaths((node as ApplyNode).lhs, scope);
    }
    if (node.type === "block") {
      return runtime.results.getBlockResultSuffixBasePaths(node as BlockNode, scope);
    }
    if (node.type === "variable") {
      const varNode = node as VariableNode;
      const resolved = resolveVariable(scope, varNode.value);
      if (resolved && resolved.length > 0) {
        // Filter to only root paths -- strip predicate-derived suffix paths
        return filterToBasePaths([...resolved]);
      }
      return [];
    }
    if (node.type === "name") {
      return [(node as NameNode).value];
    }
    if (node.type === "object") {
      return (node as ObjectNode).entries.flatMap(([, value]) =>
        extractBasePaths(value, scope),
      );
    }
    // For other node types, walkNode is fine (no filter stages to strip)
    return runtime.core.walkNode(node, scope);
  }

  /**
   * Handle calls to higher-order built-in functions ($map, $filter, $reduce, etc.).
   *
   * Extracts paths from the data argument, then walks the lambda body with
   * parameter bindings according to the function's semantic role mapping.
   *
   * IMPORTANT: The full walkNode paths (including predicates) are emitted via
   * the for-loop for non-lambda args. Only the BINDING paths to lambda parameters
   * are restricted to base paths via extractBasePaths.
   */
  function walkHigherOrderCall(
    node: FunctionNode,
    semantics: Record<number, string>,
    scope: ScopeTracker,
  ): string[] {
    const args = node.arguments;
    const paths: string[] = [];
    const funcName =
      node.procedure.type === "variable" ? node.procedure.value : "";
    const callback = findResolvedHigherOrderLambdaCallbacks(
      args,
      scope,
      (funcName === "each" || funcName === "sift") && args.length === 1 ? 0 : 1,
    );
    const transformCallback = findHigherOrderTransformCallback(args, scope);
  
    // Extract paths from all non-lambda arguments (they're data reads)
    // This emits ALL paths including filter predicates (correct -- they are data reads)
    for (const [index, arg] of args.entries()) {
      if (
        arg.type !== "lambda" &&
        index !== callback?.index &&
        index !== transformCallback?.index
      ) {
        paths.push(...runtime.core.walkNode(arg, scope));
      }
    }
  
    if (callback) {
      // Get the data argument (first non-lambda arg) BASE paths for binding
      // Uses extractBasePaths to exclude filter predicate paths from binding
      const usesImplicitRoot =
        callback.index === 0 && (funcName === "each" || funcName === "sift");
      const dataArg = usesImplicitRoot ? undefined : args[0];
      const dataArgPaths = higherOrderCallbackDataPaths(
        funcName,
        dataArg,
        scope,
        usesImplicitRoot,
      );
      paths.push(...runtime.functions.walkCallableSelection(args[callback.index], scope));
  
      if (usesImplicitRoot) paths.push("*");
      if (!usesImplicitRoot && (funcName === "each" || funcName === "sift") && dataArg) {
        const identityPaths = runtime.functions.identityReferencePaths(dataArg, scope);
        if (identityPaths) {
          paths.push(...identityPaths.map((path) => appendPath(path, "*")));
        }
      }
  
      // Walk every possible lambda body with parameter bindings.
      for (const binding of callback.bindings) {
        paths.push(
          ...(funcName === "reduce"
            ? walkReduceLambdaWithBindings(binding.lambda, args, binding.scope, scope)
            : walkLambdaWithBindings(
                funcName,
                binding.lambda,
                dataArgPaths,
                dataArg,
                semantics,
                binding.scope,
                scope,
              )),
        );
      }
      const callbackInput =
        dataArg ??
        ({
          type: "wildcard",
          value: "*",
          position: node.position,
        } as WildcardNode);
      let partialCallbackInputs =
        dataArg && (funcName === "each" || funcName === "sift")
          ? higherOrderCallbackDataNodes("each", dataArg, scope)
          : [callbackInput];
      let partialCallbackScope = scope;
      let syntheticPartialValuePaths: string[] = [];
      if (dataArg && (funcName === "each" || funcName === "sift")) {
        const valuePaths = higherOrderCallbackDataPaths(funcName, dataArg, scope);
        const resolvedInputPaths = partialCallbackInputs.flatMap((input) =>
          runtime.aliases.bindingAliasPaths(input, scope),
        );
        const representsObjectValues =
          new Set(valuePaths).size === new Set(resolvedInputPaths).size &&
          valuePaths.every((path) => resolvedInputPaths.includes(path));
        if (!representsObjectValues) {
          const valueVariable: VariableNode = {
            type: "variable",
            value: `\0higherOrderCallbackValue${node.position}`,
            position: node.position,
          };
          partialCallbackScope = bindVariable(
            partialCallbackScope,
            valueVariable.value,
            valuePaths,
          );
          syntheticPartialValuePaths = valuePaths;
          partialCallbackInputs = [valueVariable];
        }
      }
      for (const binding of callback.partials) {
        for (const partialCallbackInput of partialCallbackInputs) {
          paths.push(
            ...walkPartialCall(
              binding,
              higherOrderCallbackCallArguments(
                funcName,
                partialCallbackInput,
                dataArg ?? partialCallbackInput,
                args,
                node.position,
              ),
              partialCallbackScope,
            ).filter((path) => !syntheticPartialValuePaths.includes(path)),
          );
        }
      }
    }
  
    if (transformCallback) {
      const usesImplicitRoot =
        transformCallback.index === 0 && (funcName === "each" || funcName === "sift");
      const dataArg = usesImplicitRoot
        ? ({
            type: "wildcard",
            value: "*",
            position: node.position,
          } as WildcardNode)
        : args[0];
      if (dataArg) {
        const producer = args[transformCallback.index];
        paths.push(...runtime.functions.walkCallableSelection(producer, scope));
        const transformCalls = runtime.transforms.resolveTransformFunctionCalls(
          {
            type: "function",
            value: "(",
            position: node.position,
            procedure: producer as FunctionNode["procedure"],
            arguments: [dataArg],
          },
          scope,
          false,
        );
        for (const call of transformCalls) {
          paths.push(...runtime.transforms.walkTransformCall(call.binding, call.arguments, scope));
        }
      }
    }
  
    return paths;
  }

  function higherOrderCallbackDataPaths(
    funcName: string,
    dataArg: AstNode | undefined,
    scope: ScopeTracker,
    usesImplicitRoot = false,
  ): string[] {
    const basePaths = usesImplicitRoot
      ? [ROOT_PATH]
      : dataArg
        ? extractBasePaths(dataArg, scope)
        : [];
    if (funcName === "map" && dataArg) {
      if (dataArg.type === "block") return basePaths;
      const callbackDataNodes = higherOrderCallbackDataNodes("map", dataArg, scope);
      if (callbackDataNodes.length !== 1 || callbackDataNodes[0] !== dataArg) {
        return callbackDataNodes.flatMap((node) => runtime.aliases.bindingAliasPaths(node, scope));
      }
    }
    if (funcName !== "each" && funcName !== "sift") return basePaths;
  
    if (dataArg?.type === "object") {
      return (dataArg as ObjectNode).entries.flatMap(([, value]) =>
        runtime.aliases.bindingAliasPaths(value, scope),
      );
    }
    const objectAlias = dataArg ? runtime.aliases.objectAliasForNode(dataArg, scope) : null;
    if (
      objectAlias &&
      objectAlias.size > 0 &&
      dataArg &&
      resolvesStaticEvalResult(dataArg, scope)
    ) {
      return [...objectAlias.values()].flatMap((paths) => [...paths]);
    }
    if ((funcName === "each" || funcName === "sift") && dataArg) {
      const callbackDataNodes = higherOrderCallbackDataNodes("each", dataArg, scope);
      if (callbackDataNodes.length !== 1 || callbackDataNodes[0] !== dataArg) {
        return eachInputNeedsWildcardValues(dataArg, scope)
          ? basePaths.map((path) => appendPath(path, "*"))
          : callbackDataNodes.flatMap((node) => runtime.aliases.bindingAliasPaths(node, scope));
      }
    }
    if (objectAlias && objectAlias.size > 0) {
      return [...objectAlias.values()].flatMap((paths) => [...paths]);
    }
    return basePaths.map((path) => appendPath(path, "*"));
  }

  function resolvesStaticEvalResult(
    node: AstNode,
    scope: ScopeTracker,
    resolvingVariables = new Set<string>(),
  ): boolean {
    if (node.type === "function") {
      const functionNode = node as FunctionNode;
      return (
        functionNode.procedure.type === "variable" &&
        functionNode.procedure.value === "eval" &&
        runtime.functions.getStaticEvalExpression(functionNode.arguments) !== null
      );
    }
    if (node.type === "variable") {
      const name = (node as VariableNode).value;
      if (resolvingVariables.has(name)) return false;
      const binding = resolveValue(scope, name);
      return binding
        ? resolvesStaticEvalResult(
            binding.node,
            binding.scope,
            new Set([...resolvingVariables, name]),
          )
        : false;
    }
    if (node.type === "block") {
      let blockScope = scope;
      let resolvesEval = false;
      for (const expression of (node as BlockNode).expressions) {
        if (expression.type === "bind") {
          blockScope = runtime.callables.bindCallableBlockValue(blockScope, expression as BindNode);
        } else {
          resolvesEval = resolvesStaticEvalResult(
            expression,
            blockScope,
            resolvingVariables,
          );
        }
      }
      return resolvesEval;
    }
    return false;
  }

  function eachInputNeedsWildcardValues(
    node: AstNode,
    scope: ScopeTracker,
    resolvingVariables = new Set<string>(),
  ): boolean {
    if (runtime.aliases.objectAliasForNode(node, scope)?.size) return false;
    if (node.type === "variable") {
      const name = (node as VariableNode).value;
      if (resolvingVariables.has(name)) return true;
      const binding = resolveValue(scope, name);
      return binding
        ? eachInputNeedsWildcardValues(
            binding.node,
            binding.scope,
            new Set([...resolvingVariables, name]),
          )
        : true;
    }
    if (node.type === "block") {
      let blockScope = scope;
      let needsWildcard = true;
      for (const expression of (node as BlockNode).expressions) {
        if (expression.type === "bind") {
          blockScope = runtime.callables.bindCallableBlockValue(blockScope, expression as BindNode);
        } else {
          needsWildcard = eachInputNeedsWildcardValues(
            expression,
            blockScope,
            resolvingVariables,
          );
        }
      }
      return needsWildcard;
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [condition.then, condition.else].some(
        (branch) =>
          !!branch &&
          eachInputNeedsWildcardValues(branch, scope, resolvingVariables),
      );
    }
    if (node.type === "function") {
      const functionNode = node as FunctionNode;
      if (
        functionNode.procedure.type === "variable" &&
        functionNode.procedure.value === "eval"
      ) {
        const expression = runtime.functions.getStaticEvalExpression(functionNode.arguments);
        if (expression) {
          return eachInputNeedsWildcardValues(
            expression,
            runtime.functions.getStaticEvalScope(functionNode.arguments, scope),
            resolvingVariables,
          );
        }
      }
    }
    if (node.type === "function" || node.type === "apply") return true;
    if (node.type === "object") return false;
    const callbackDataNodes = higherOrderCallbackDataNodes("each", node, scope);
    return callbackDataNodes.length === 1 && callbackDataNodes[0] === node;
  }

  function higherOrderCallbackDataNodes(
    funcName: "map" | "each",
    dataArg: AstNode | undefined,
    scope: ScopeTracker,
    resolvingVariables = new Set<string>(),
  ): AstNode[] {
    if (!dataArg) return [];
    if (dataArg.type === "variable") {
      const name = (dataArg as VariableNode).value;
      if (resolvingVariables.has(name)) return [dataArg];
      const binding = resolveValue(scope, name);
      if (binding) {
        return higherOrderCallbackDataNodes(
          funcName,
          binding.node,
          binding.scope,
          new Set([...resolvingVariables, name]),
        );
      }
    }
    if (dataArg.type === "array") {
      const arrayNode = dataArg as ArrayNode;
      const numericFilter = (arrayNode.predicate ?? []).find(
        (stage) =>
          stage.type === "filter" &&
          (stage as unknown as FilterStage).expr.type === "number",
      ) as unknown as FilterStage | undefined;
      if (numericFilter) {
        const index = Number(
          ((numericFilter as unknown as FilterStage).expr as { value: number }).value,
        );
        const selected = arrayNode.expressions[index];
        if (selected) {
          return higherOrderCallbackDataNodes(
            funcName,
            selected,
            scope,
            resolvingVariables,
          );
        }
      }
      if (funcName === "map") return arrayNode.expressions;
    }
    if (dataArg.type === "condition") {
      const condition = dataArg as ConditionNode;
      return [condition.then, condition.else].flatMap((branch) =>
        branch
          ? higherOrderCallbackDataNodes(
              funcName,
              branch,
              scope,
              resolvingVariables,
            )
          : [],
      );
    }
    if (dataArg.type === "block") {
      let blockScope = scope;
      let result: AstNode[] = [];
      for (const expression of (dataArg as BlockNode).expressions) {
        if (expression.type === "bind") {
          const bindNode = expression as BindNode;
          result = higherOrderCallbackDataNodes(
            funcName,
            bindNode.rhs,
            blockScope,
            resolvingVariables,
          );
          blockScope = runtime.callables.bindCallableBlockValue(blockScope, bindNode);
        } else {
          result = higherOrderCallbackDataNodes(
            funcName,
            expression,
            blockScope,
            resolvingVariables,
          );
        }
      }
      return result;
    }
    if (funcName === "each" && dataArg.type === "path") {
      const pathNode = dataArg as PathNode;
      const [first, ...selectorSteps] = pathNode.steps;
      if (first && selectorSteps.length > 0) {
        let candidates = pathContainerCandidates(first, scope);
        for (const selector of selectorSteps) {
          if (selector.type !== "name") {
            candidates = [];
            break;
          }
          candidates = candidates.flatMap((candidate) =>
            candidate.node.type === "object"
              ? (candidate.node as ObjectNode).entries.flatMap(([key, value]) =>
                  runtime.aliases.staticObjectKey(key) === (selector as NameNode).value
                    ? [{ node: value, scope: candidate.scope }]
                    : [],
                )
              : [],
          );
        }
        if (candidates.length > 0) {
          return candidates.flatMap((candidate) =>
            higherOrderCallbackDataNodes(
              funcName,
              candidate.node,
              candidate.scope,
              resolvingVariables,
            ),
          );
        }
      }
    }
    if (funcName === "each" && dataArg.type === "apply") {
      const appliedFunction = runtime.functions.appliedFunctionFromApply(dataArg as ApplyNode);
      if (appliedFunction) {
        return higherOrderCallbackDataNodes(
          funcName,
          appliedFunction,
          scope,
          resolvingVariables,
        );
      }
    }
    if (funcName === "each" && dataArg.type === "function") {
      const functionNode = dataArg as FunctionNode;
      const lambdaBinding =
        functionNode.procedure.type === "lambda"
          ? { lambda: functionNode.procedure, scope }
          : functionNode.procedure.type === "variable"
            ? resolveLambda(scope, functionNode.procedure.value)
            : null;
      if (lambdaBinding) {
        return higherOrderCallbackDataNodes(
          funcName,
          lambdaBinding.lambda.body,
          runtime.callables.lambdaCallScope(lambdaBinding, functionNode.arguments, scope),
          resolvingVariables,
        );
      }
      if (
        functionNode.procedure.type === "variable" &&
        functionNode.procedure.value === "eval"
      ) {
        const expression = runtime.functions.getStaticEvalExpression(functionNode.arguments);
        if (expression) {
          return higherOrderCallbackDataNodes(
            funcName,
            expression,
            runtime.functions.getStaticEvalScope(functionNode.arguments, scope),
            resolvingVariables,
          );
        }
      }
      if (
        functionNode.procedure.type === "variable" &&
        functionNode.procedure.value === "lookup" &&
        functionNode.arguments[0]
      ) {
        const objectArg = functionNode.arguments[0];
        const objectBinding =
          objectArg.type === "variable"
            ? resolveValue(scope, (objectArg as VariableNode).value)
            : null;
        const objectNode = objectBinding?.node ?? objectArg;
        const objectScope = objectBinding?.scope ?? scope;
        if (objectNode.type === "object") {
          const keyArg = functionNode.arguments[1];
          const staticKey =
            keyArg?.type === "string"
              ? (keyArg as { value: string }).value
              : null;
          return (objectNode as ObjectNode).entries.flatMap(([key, value]) =>
            staticKey === null || runtime.aliases.staticObjectKey(key) === staticKey
              ? higherOrderCallbackDataNodes(
                  funcName,
                  value,
                  objectScope,
                  resolvingVariables,
                )
              : [],
          );
        }
      }
      if (
        functionNode.procedure.type === "variable" &&
        functionNode.procedure.value === "merge" &&
        functionNode.arguments[0]?.type === "array"
      ) {
        return (functionNode.arguments[0] as ArrayNode).expressions.flatMap(
          (expression) =>
            higherOrderCallbackDataNodes(
              funcName,
              expression,
              scope,
              resolvingVariables,
            ),
        );
      }
      if (
        runtime.callables.resolveBuiltinCallableNames(functionNode.procedure, scope).some((name) =>
          ["clone", "sift"].includes(name),
        ) &&
        functionNode.arguments[0]
      ) {
        return higherOrderCallbackDataNodes(
          funcName,
          functionNode.arguments[0],
          scope,
          resolvingVariables,
        );
      }
    }
    if (funcName === "each" && dataArg.type === "object") {
      return (dataArg as ObjectNode).entries.map(([, value]) => value);
    }
    return [dataArg];
  }

  function pathContainerCandidates(
    node: AstNode,
    scope: ScopeTracker,
    resolvingVariables = new Set<string>(),
  ): Array<{ node: AstNode; scope: ScopeTracker }> {
    if (node.type === "variable") {
      const name = (node as VariableNode).value;
      if (resolvingVariables.has(name)) return [{ node, scope }];
      const binding = resolveValue(scope, name);
      if (binding) {
        return pathContainerCandidates(
          binding.node,
          binding.scope,
          new Set([...resolvingVariables, name]),
        );
      }
    }
    if (node.type === "block") {
      let blockScope = scope;
      let candidates: Array<{ node: AstNode; scope: ScopeTracker }> = [];
      for (const expression of (node as BlockNode).expressions) {
        if (expression.type === "bind") {
          blockScope = runtime.callables.bindCallableBlockValue(blockScope, expression as BindNode);
        } else {
          candidates = pathContainerCandidates(
            expression,
            blockScope,
            resolvingVariables,
          );
        }
      }
      return candidates;
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [condition.then, condition.else].flatMap((branch) =>
        branch
          ? pathContainerCandidates(branch, scope, resolvingVariables)
          : [],
      );
    }
    return [{ node, scope }];
  }

  function bindHigherOrderLambdaCallbackScope(
    funcName: "map" | "each",
    binding: LambdaBinding,
    dataArgPaths: string[],
    dataArg: AstNode | undefined,
    dataArgScope: ScopeTracker,
  ): ScopeTracker {
    let lambdaScope = childScope(binding.scope);
    for (let i = 0; i < binding.lambda.arguments.length; i++) {
      const role = HIGHER_ORDER_SEMANTICS[funcName][i];
      if (!role) continue;
      lambdaScope = bindHigherOrderParameter(
        lambdaScope,
        funcName,
        binding.lambda.arguments[i],
        role,
        dataArgPaths,
        dataArg,
        dataArgScope,
      );
    }
    return runtime.callables.bindForwardReferences(
      lambdaScope,
      binding.lambda,
      binding.forwardScope ?? dataArgScope,
      binding.name,
    );
  }

  function walkReduceLambdaWithBindings(
    lambda: LambdaNode,
    args: AstNode[],
    parentScope: ScopeTracker,
    dataArgScope: ScopeTracker,
  ): string[] {
    const dataArg = args[0];
    const accumulatorArg = args[2] ?? dataArg;
    const dataArgPaths = dataArg ? extractBasePaths(dataArg, dataArgScope) : [];
    const accumulatorPaths = accumulatorArg
      ? extractBasePaths(accumulatorArg, dataArgScope)
      : dataArgPaths;
    let lambdaScope = childScope(parentScope);
  
    for (let i = 0; i < lambda.arguments.length; i++) {
      const param = lambda.arguments[i];
      const role = HIGHER_ORDER_SEMANTICS.reduce[i];
  
      if (!role) continue;
      lambdaScope =
        role === "accumulator"
          ? bindHigherOrderParameter(
              lambdaScope,
              "reduce",
              param,
              role,
              accumulatorPaths,
              accumulatorArg,
              dataArgScope,
            )
          : bindHigherOrderParameter(
              lambdaScope,
              "reduce",
              param,
              role,
              dataArgPaths,
              dataArg,
              dataArgScope,
            );
    }
    lambdaScope = runtime.callables.bindForwardReferences(
      lambdaScope,
      lambda,
      dataArgScope,
    );
  
    return resolveCallbackParentPaths(runtime.core.walkNode(lambda.body, lambdaScope), dataArgPaths);
  }

  function findHigherOrderCallback(
    args: AstNode[],
    scope: ScopeTracker,
  ): { index: number; lambda: LambdaNode; scope: ScopeTracker } | null {
    const inlineIndex = args.findIndex((arg) => arg.type === "lambda");
    if (inlineIndex >= 0) {
      return { index: inlineIndex, lambda: args[inlineIndex] as LambdaNode, scope };
    }
  
    const variableIndex = args.findIndex((arg) => {
      return arg.type === "variable" && resolveLambda(scope, (arg as VariableNode).value);
    });
    if (variableIndex < 0) return null;
  
    const variable = args[variableIndex] as VariableNode;
    const binding = resolveLambda(scope, variable.value);
    return binding
      ? { index: variableIndex, lambda: binding.lambda, scope: binding.scope }
      : null;
  }

  function findResolvedHigherOrderLambdaCallbacks(
    args: AstNode[],
    scope: ScopeTracker,
    callbackIndex?: number,
  ): {
    index: number;
    bindings: LambdaBinding[];
    partials: NonNullable<ReturnType<typeof resolvePartial>>[];
  } | null {
    for (const [index, arg] of args.entries()) {
      if (callbackIndex !== undefined && index !== callbackIndex) continue;
      const callables = runtime.callables.resolveCallableValues(arg, scope);
      const bindings = callables.flatMap((callable) =>
        callable.kind === "lambda" ? [callable.binding] : [],
      );
      const partials = callables.flatMap((callable) =>
        callable.kind === "partial" && partialCanInvokeLambda(callable.binding)
          ? [callable.binding]
          : [],
      );
      if (bindings.length > 0 || partials.length > 0) {
        return { index, bindings, partials };
      }
    }
    return null;
  }

  function partialCanInvokeLambda(
    binding: NonNullable<ReturnType<typeof resolvePartial>>,
  ): boolean {
    return runtime.callables.resolveCallableValues(
      binding.partial.procedure,
      binding.scope,
    ).some(
      (callable) =>
        callable.kind === "lambda" ||
        (callable.kind === "partial" && partialCanInvokeLambda(callable.binding)),
    );
  }

  function resolveLambdaFunctionCalls(
    procedure: FunctionNode["procedure"],
    callArgs: AstNode[],
    scope: ScopeTracker,
  ): ResolvedLambdaCall[] {
    return runtime.callables.resolveCallableValues(procedure, scope).flatMap((callable) => {
      if (callable.kind === "lambda") {
        return [{ binding: callable.binding, arguments: callArgs }];
      }
      if (callable.kind !== "partial") return [];
      return resolveLambdaFunctionCalls(
        callable.binding.partial.procedure,
        applyPartialArguments(callable.binding.partial, callArgs),
        callable.binding.scope,
      );
    });
  }

  function higherOrderPartialLambdaCalls(
    funcName: "map" | "each" | "reduce",
    callback: NonNullable<ReturnType<typeof findResolvedHigherOrderLambdaCallbacks>>,
    dataArg: AstNode | undefined,
    scope: ScopeTracker,
    higherOrderArgs: AstNode[] = [],
  ): ResolvedLambdaCall[] {
    const callbackDataArgs =
      funcName === "each"
        ? higherOrderCallbackDataNodes(funcName, dataArg, scope)
        : dataArg
          ? [dataArg]
          : [];
    return callback.partials.flatMap((binding) =>
      callbackDataArgs.flatMap((callbackDataArg) =>
        resolveLambdaFunctionCalls(
          binding.partial.procedure,
          applyPartialArguments(
            binding.partial,
            higherOrderCallbackCallArguments(
              funcName,
              callbackDataArg,
              dataArg ?? callbackDataArg,
              higherOrderArgs,
              (callbackDataArg as { position?: number }).position ?? 0,
            ),
          ),
          binding.scope,
        ),
      ),
    );
  }

  function higherOrderPartialResultBasePaths(
    funcName: "map" | "each",
    args: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    return higherOrderPartialCalls(funcName, args, scope).flatMap((call) =>
      runtime.results.getPartialFunctionResultBasePaths(
        call.binding,
        call.arguments,
        scope,
      ),
    );
  }

  function higherOrderPartialCalls(
    funcName: "map" | "each" | "reduce",
    args: AstNode[],
    scope: ScopeTracker,
  ): ResolvedPartialCall[] {
    const dataArg = args[0];
    const callbackArg = args[1];
    if (!dataArg || !callbackArg) return [];
  
    const partials = runtime.callables.resolveCallableValues(callbackArg, scope).flatMap(
      (callable) => (callable.kind === "partial" ? [callable.binding] : []),
    );
    const callbackDataArgs =
      funcName === "reduce"
        ? [dataArg]
        : higherOrderCallbackDataNodes(funcName, dataArg, scope);
    return partials.flatMap((binding) =>
      callbackDataArgs.flatMap(
        (callbackDataArg) => [
          {
            binding,
            arguments: higherOrderCallbackCallArguments(
              funcName,
              callbackDataArg,
              dataArg,
              args,
              (callbackDataArg as { position?: number }).position ?? 0,
            ),
          },
        ],
      ),
    );
  }

  function higherOrderCallbackCallArguments(
    funcName: string,
    valueArg: AstNode,
    collectionArg: AstNode,
    higherOrderArgs: AstNode[],
    position: number,
  ): AstNode[] {
    const semantics = HIGHER_ORDER_SEMANTICS[funcName] ?? {};
    return Object.entries(semantics)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, role]) => {
        if (role === "accumulator") {
          return higherOrderArgs[2] ?? collectionArg;
        }
        if (role === "index") {
          return { type: "number", value: 0, position } as AstNode;
        }
        if (role === "key") {
          return { type: "string", value: "", position } as AstNode;
        }
        if (role === "array" || role === "object") return collectionArg;
        return valueArg;
      });
  }

  function findHigherOrderTransformCallback(
    args: AstNode[],
    scope: ScopeTracker,
  ): { index: number } | null {
    for (const [index, arg] of args.entries()) {
      const calls = runtime.transforms.resolveTransformFunctionCalls(
        {
          type: "function",
          value: "(",
          position: (arg as { position?: number }).position ?? 0,
          procedure: arg as FunctionNode["procedure"],
          arguments: [],
        },
        scope,
        false,
      );
      if (calls.length > 0) return { index };
    }
    return null;
  }

  /**
   * Walk a lambda body in the context of a higher-order function call.
   * Binds lambda parameters to data argument paths based on semantic roles.
   *
   * Roles:
   * - "element"/"value"/"left"/"right" -> bound to data arg's element paths
   * - "index"/"key" -> non-data-path (bind to empty)
   * - "array"/"accumulator" -> bound to full collection paths
   */
  function walkLambdaWithBindings(
    funcName: string,
    lambda: LambdaNode,
    dataArgPaths: string[],
    dataArg: AstNode | undefined,
    semantics: Record<number, string>,
    parentScope: ScopeTracker,
    dataArgScope: ScopeTracker,
  ): string[] {
    let lambdaScope = childScope(parentScope);
  
    // Bind each lambda parameter based on its semantic role
    for (let i = 0; i < lambda.arguments.length; i++) {
      const param = lambda.arguments[i];
      const role = semantics[i];
  
      if (!role) continue; // more params than semantics knows about
      lambdaScope = bindHigherOrderParameter(
        lambdaScope,
        funcName,
        param,
        role,
        dataArgPaths,
        dataArg,
        dataArgScope,
      );
    }
    lambdaScope = runtime.callables.bindForwardReferences(
      lambdaScope,
      lambda,
      dataArgScope,
    );
  
    return resolveCallbackParentPaths(runtime.core.walkNode(lambda.body, lambdaScope), dataArgPaths);
  }

  function resolveCallbackParentPaths(
    paths: string[],
    dataArgPaths: readonly string[],
  ): string[] {
    const parentContexts = dataArgPaths.map(parentPath);
    if (parentContexts.length === 0) return paths;
  
    return paths.flatMap((path) => {
      if (!isParentRelativePath(path)) return [path];
  
      const suffix = stripParentRelativePath(path);
      return parentContexts.map((parentContext) =>
        appendPath(parentContext, suffix || null),
      );
    });
  }

  function resolveCallbackObjectAliasParentPaths(
    alias: ObjectAlias,
    dataArgPaths: readonly string[],
  ): ObjectAlias {
    const fields = new Map<string, string[]>();
    for (const [key, paths] of alias) {
      fields.set(key, resolveCallbackParentPaths([...paths], dataArgPaths));
    }
    return fields;
  }

  function resolveCallbackDynamicObjectAliasParentPaths(
    alias: DynamicObjectAlias,
    dataArgPaths: readonly string[],
  ): DynamicObjectAlias {
    if (dataArgPaths.length === 0) return alias;
    return {
      variants: alias.variants.map((variant) => ({
        ...variant,
        parentDataArgPaths: dataArgPaths,
      })),
    };
  }

  function prefixDynamicObjectAlias(
    alias: DynamicObjectAlias,
    contextBasePaths: readonly string[],
  ): DynamicObjectAlias {
    if (contextBasePaths.length === 0) return alias;
    return {
      variants: alias.variants.map((variant) => ({
        ...variant,
        contextBasePaths: contextBasePaths.flatMap((basePath) =>
          prefixProjectionPaths(basePath, [
            ...(variant.contextBasePaths ?? [""]),
          ]),
        ),
      })),
    };
  }

  function resolveDynamicVariantPaths(
    paths: string[],
    variant: DynamicObjectAlias["variants"][number],
  ): string[] {
    const parentResolved = resolveCallbackParentPaths(
      paths,
      variant.parentDataArgPaths ?? [],
    );
    return variant.contextBasePaths?.length
      ? variant.contextBasePaths.flatMap((basePath) =>
          prefixProjectionPaths(basePath, parentResolved),
        )
      : parentResolved;
  }

  function resolveDynamicVariantObjectAlias(
    alias: ObjectAlias,
    variant: DynamicObjectAlias["variants"][number],
  ): ObjectAlias {
    const parentResolved = variant.parentDataArgPaths?.length
      ? resolveCallbackObjectAliasParentPaths(alias, variant.parentDataArgPaths)
      : alias;
    return variant.contextBasePaths?.length
      ? runtime.aliases.mergeObjectAliases(
          variant.contextBasePaths.map((basePath) =>
            runtime.aliases.prefixObjectAlias(parentResolved, basePath),
          ),
        )!
      : parentResolved;
  }

  function resolveDynamicVariantDynamicObjectAlias(
    alias: DynamicObjectAlias,
    variant: DynamicObjectAlias["variants"][number],
  ): DynamicObjectAlias {
    const parentResolved = variant.parentDataArgPaths?.length
      ? resolveCallbackDynamicObjectAliasParentPaths(
          alias,
          variant.parentDataArgPaths,
        )
      : alias;
    return variant.contextBasePaths?.length
      ? prefixDynamicObjectAlias(parentResolved, variant.contextBasePaths)
      : parentResolved;
  }

  function bindHigherOrderParameter(
    scope: ScopeTracker,
    funcName: string,
    param: VariableNode,
    role: string,
    argPaths: readonly string[],
    arg: AstNode | undefined,
    argScope: ScopeTracker,
  ): ScopeTracker {
    if (role === "index" || role === "key") {
      return bindVariable(scope, param.value, []);
    }
  
    if (
      (funcName === "each" || funcName === "sift") &&
      role === "value" &&
      arg
    ) {
      const valueScope = bindVariable(scope, param.value, argPaths);
      return runtime.callables.resolveCallableValues(arg, argScope).length > 0 ||
        runtime.callables.resolveBuiltinCallableNames(arg, argScope).length > 0
        ? runtime.functions.bindCallableValue(valueScope, param.value, arg, argScope)
        : valueScope;
    }
  
    if (
      role === "element" ||
      role === "value" ||
      role === "left" ||
      role === "right" ||
      role === "array" ||
      role === "object" ||
      role === "accumulator"
    ) {
      return arg && shouldBindDataArgumentAlias(funcName, role)
        ? bindArgumentParameter(scope, param, argPaths, arg, argScope)
        : bindVariable(scope, param.value, argPaths);
    }
  
    return scope;
  }

  function shouldBindDataArgumentAlias(funcName: string, role: string): boolean {
    if ((funcName === "each" || funcName === "sift") && role !== "object") return false;
    return (
      role === "element" ||
      role === "left" ||
      role === "right" ||
      role === "array" ||
      role === "object" ||
      role === "accumulator"
    );
  }

  function contextDefaultParameterIndex(lambda: LambdaNode): number {
    const definition = lambda.signature?.definition;
    if (!definition) return -1;
  
    let parameterIndex = -1;
    for (let index = 1; index < definition.length; index++) {
      const symbol = definition[index];
      if (symbol === ":") break;
      if ("snbloafjx".includes(symbol)) {
        parameterIndex += 1;
        continue;
      }
      if (symbol === "(") {
        parameterIndex += 1;
        while (index < definition.length && definition[index] !== ")") index += 1;
        continue;
      }
      if (symbol === "<") {
        let depth = 1;
        while (index + 1 < definition.length && depth > 0) {
          index += 1;
          if (definition[index] === "<") depth += 1;
          if (definition[index] === ">") depth -= 1;
        }
        continue;
      }
      if (symbol === "-") return parameterIndex;
    }
    return -1;
  }

  function lambdaContextDefaultArgumentVariants(
    lambda: LambdaNode,
    callArgs: AstNode[],
  ): AstNode[][] {
    const contextIndex = contextDefaultParameterIndex(lambda);
    if (contextIndex < 0 || callArgs.length >= lambda.arguments.length) {
      return [callArgs];
    }
  
    const withDefault = [
      ...callArgs.slice(0, contextIndex),
      {
        type: "variable",
        value: "",
        position: lambda.position,
      } as VariableNode,
      ...callArgs.slice(contextIndex),
    ];
    return callArgs.length === contextIndex
      ? [withDefault]
      : [callArgs, withDefault];
  }

  /**
   * Handle custom function calls where the procedure resolves to a lambda in scope.
   * Binds call-site argument paths to lambda parameters and walks the body.
   *
   * Example: `($fn := function($x) { $x.name }; $fn(account))`
   * -> $x bound to ["account"], body yields ["account.name"]
   * -> combined with call-site arg paths: ["account", "account.name"]
   */
  function walkCustomFunctionCall(
    binding: LambdaBinding,
    callArgs: AstNode[],
    callScope: ScopeTracker,
    defaultsApplied = false,
    argumentScopes: ScopeTracker[] = callArgs.map(() => callScope),
  ): string[] {
    const { lambda, scope } = binding;
    if (!defaultsApplied) {
      const variants = lambdaContextDefaultArgumentVariants(lambda, callArgs);
      if (variants.length > 1 || variants[0] !== callArgs) {
        const contextIndex = contextDefaultParameterIndex(lambda);
        return variants.flatMap((args) => {
          const variantScopes =
            args.length === callArgs.length
              ? argumentScopes
              : [
                  ...argumentScopes.slice(0, contextIndex),
                  callScope,
                  ...argumentScopes.slice(contextIndex),
                ];
          return walkCustomFunctionCall(
            binding,
            args,
            callScope,
            true,
            variantScopes,
          );
        });
      }
    }
    const paths: string[] = [];
  
    // Extract paths from all call-site arguments
    const argPathSets: string[][] = [];
    for (const [index, arg] of callArgs.entries()) {
      const argumentScope = argumentScopes[index] ?? callScope;
      const identityPaths = runtime.functions.identityReferencePaths(arg, argumentScope);
      const capturedArgumentContext = resolveVariable(argumentScope, "");
      const argPaths = identityPaths ??
        (capturedArgumentContext && capturedArgumentContext.length > 0
          ? capturedArgumentContext.flatMap((contextPrefix) =>
              runtime.paths.walkContextExpression(arg, contextPrefix, argumentScope),
            )
          : runtime.core.walkNode(arg, argumentScope));
      if (!identityPaths) paths.push(...argPaths);
      argPathSets.push(argPaths);
    }
  
    // Create a scope binding each lambda parameter to its corresponding arg paths
    let lambdaScope = childScope(scope);
    for (let i = 0; i < lambda.arguments.length; i++) {
      const param = lambda.arguments[i];
      const argPaths = i < argPathSets.length ? argPathSets[i] : [];
      lambdaScope =
        i < callArgs.length
          ? bindArgumentParameter(
              lambdaScope,
              param,
              argPaths,
              callArgs[i],
              argumentScopes[i] ?? callScope,
            )
          : bindVariable(lambdaScope, param.value, argPaths);
    }
    lambdaScope = runtime.callables.bindForwardReferences(
      lambdaScope,
      lambda,
      binding.forwardScope ?? callScope,
      binding.name,
    );
    // Walk the lambda body with parameter bindings
    const parentBasePaths = callArgs[0]
      ? extractBasePaths(callArgs[0], argumentScopes[0] ?? callScope)
      : [];
    const capturedContextPaths = resolveVariable(scope, "");
    const bodyPaths = capturedContextPaths?.length
      ? capturedContextPaths.flatMap((contextPath) =>
          runtime.paths.walkContextExpression(lambda.body, contextPath, lambdaScope),
        )
      : runtime.callables.resolveCallableValues(lambda.body, lambdaScope).length > 0
        ? runtime.functions.walkCallableSelection(lambda.body, lambdaScope)
        : runtime.core.walkNode(lambda.body, lambdaScope);
    const recursiveDescentPaths = binding.name
      ? recursiveLambdaDescentPaths(
          lambda.body,
          binding.name,
          lambdaScope,
          callScope,
        )
      : [];
    paths.push(
      ...resolveCallbackParentPaths(
        [...bodyPaths, ...recursiveDescentPaths],
        parentBasePaths.length > 0 ? parentBasePaths : (argPathSets[0] ?? []),
      ),
    );
  
    return paths;
  }

  function recursiveLambdaDescentPaths(
    node: AstNode,
    functionName: string,
    scope: ScopeTracker,
    callableScope: ScopeTracker,
  ): string[] {
    if (node.type === "block") {
      const paths: string[] = [];
      let localScope = scope;
      let localCallableScope = callableScope;
      for (const expression of (node as BlockNode).expressions) {
        paths.push(
          ...recursiveLambdaDescentPaths(
            expression,
            functionName,
            localScope,
            localCallableScope,
          ),
        );
        if (expression.type === "bind") {
          localScope = runtime.callables.bindCallableBlockValue(localScope, expression as BindNode);
          localCallableScope = runtime.callables.bindCallableBlockValue(
            localCallableScope,
            expression as BindNode,
          );
        }
      }
      return paths;
    }
  
    const paths: string[] = [];
    if (node.type === "function") {
      const functionNode = node as FunctionNode;
      const calledNames = [
        ...(functionNode.procedure.type === "variable"
          ? [(functionNode.procedure as VariableNode).value]
          : []),
        ...(functionNode.procedure.type === "partial" &&
        (functionNode.procedure as PartialNode).procedure.type === "variable"
          ? [
              ((functionNode.procedure as PartialNode).procedure as VariableNode)
                .value,
            ]
          : []),
        ...runtime.callables.resolveCallableValues(functionNode.procedure, callableScope).flatMap(
          (callable) => runtime.callables.resolvedCallableNames(callable),
        ),
      ];
      const entersCycle = calledNames.some(
        (calledName) =>
          calledName === functionName ||
          lambdaCallGraphReaches(
            calledName,
            functionName,
            callableScope,
            new Set([functionName]),
          ),
      );
      for (const arg of entersCycle ? functionNode.arguments : []) {
        paths.push(
          ...runtime.results.getResultBasePathsFromArg(arg, scope).map((path) =>
            appendPath(path, "**"),
          ),
        );
      }
    }
  
    for (const [key, value] of Object.entries(node)) {
      if (key === "source") continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object") {
            paths.push(
              ...recursiveLambdaDescentPaths(
                item as AstNode,
                functionName,
                scope,
                callableScope,
              ),
            );
          }
        }
      } else if (value && typeof value === "object") {
        paths.push(
          ...recursiveLambdaDescentPaths(
            value as AstNode,
            functionName,
            scope,
            callableScope,
          ),
        );
      }
    }
    return paths;
  }

  function lambdaCallGraphReaches(
    functionName: string,
    targetName: string,
    scope: ScopeTracker,
    visited: Set<string>,
  ): boolean {
    if (functionName === targetName) return true;
    if (visited.has(functionName)) return false;
    const binding = resolveLambda(scope, functionName);
    if (!binding) return false;
  
    const nextVisited = new Set(visited).add(functionName);
    return calledFunctionNames(binding.lambda.body, scope).some((calledName) =>
      lambdaCallGraphReaches(calledName, targetName, scope, nextVisited),
    );
  }

  function calledFunctionNames(node: AstNode, scope: ScopeTracker): string[] {
    const names: string[] = [];
    if (node.type === "function") {
      const functionNode = node as FunctionNode;
      if (functionNode.procedure.type === "variable") {
        names.push((functionNode.procedure as VariableNode).value);
      }
      names.push(
        ...runtime.callables.resolveCallableValues(functionNode.procedure, scope).flatMap(
          (callable) => runtime.callables.resolvedCallableNames(callable),
        ),
      );
    }
  
    for (const [key, value] of Object.entries(node)) {
      if (key === "source") continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object") {
            names.push(...calledFunctionNames(item as AstNode, scope));
          }
        }
      } else if (value && typeof value === "object") {
        names.push(...calledFunctionNames(value as AstNode, scope));
      }
    }
    return names;
  }

  function bindArgumentParameter(
    scope: ScopeTracker,
    param: VariableNode,
    argPaths: readonly string[],
    arg: AstNode,
    argScope: ScopeTracker,
  ): ScopeTracker {
    let nextScope = bindVariable(scope, param.value, argPaths);
    nextScope = runtime.aliases.bindSuffixBasePathsIfPresent(nextScope, param.value, arg, argScope);
    nextScope = runtime.aliases.bindObjectAliasIfPresent(nextScope, param.value, arg, argScope);
    nextScope = runtime.aliases.bindDynamicObjectAliasIfPresent(nextScope, param.value, arg, argScope);
    const callables = runtime.callables.resolveCallableValues(arg, argScope);
    if (
      callables.length === 0 &&
      runtime.callables.resolveBuiltinCallableNames(arg, argScope).length === 0
    ) {
      return nextScope;
    }
    nextScope = runtime.functions.bindCallableValue(nextScope, param.value, arg, argScope);
    return callables.length === 1 &&
      callables[0].kind === "lambda" &&
      lambdaNeedsForwardScope(callables[0].binding, argScope)
      ? bindLambdaReference(
          nextScope,
          param.value,
          callables[0].binding,
          argScope,
        )
      : nextScope;
  }

  function lambdaNeedsForwardScope(
    binding: LambdaBinding,
    candidateScope: ScopeTracker,
  ): boolean {
    const parameterNames = new Set(
      binding.lambda.arguments.map((argument) => argument.value),
    );
    return [...runtime.callables.callableProcedureVariableNames(binding.lambda.body)].some(
      (name) =>
        !parameterNames.has(name) &&
        !resolveValue(binding.scope, name) &&
        resolveValue(candidateScope, name) != null,
    );
  }

  function applyPartialArguments(
    partial: PartialNode,
    callArgs: AstNode[],
  ): AstNode[] {
    const args: AstNode[] = [];
    let callArgIndex = 0;
  
    for (const partialArg of partial.arguments) {
      if (runtime.functions.isPlaceholder(partialArg)) {
        if (callArgIndex < callArgs.length) {
          args.push(callArgs[callArgIndex]);
          callArgIndex++;
        }
      } else {
        args.push(partialArg);
      }
    }
  
    args.push(...callArgs.slice(callArgIndex));
    return args;
  }

  function applyPartialArgumentScopes(
    partial: PartialNode,
    callArgs: AstNode[],
    bindingScope: ScopeTracker,
    callScope: ScopeTracker,
  ): ScopeTracker[] {
    const scopes: ScopeTracker[] = [];
    let callArgIndex = 0;
  
    for (const partialArg of partial.arguments) {
      if (runtime.functions.isPlaceholder(partialArg)) {
        if (callArgIndex < callArgs.length) {
          scopes.push(callScope);
          callArgIndex++;
        }
      } else {
        scopes.push(bindingScope);
      }
    }
  
    scopes.push(...callArgs.slice(callArgIndex).map(() => callScope));
    return scopes;
  }

  function scopePartialArguments(
    args: AstNode[],
    argumentScopes: ScopeTracker[],
    callScope: ScopeTracker,
  ): { arguments: AstNode[]; scope: ScopeTracker } {
    let scopedCallScope = childScope(callScope);
    const scopedArguments = args.map((arg, index) => {
      const argumentScope = argumentScopes[index] ?? callScope;
      if (argumentScope === callScope) return arg;
  
      const variable: VariableNode = {
        type: "variable",
        value: `\0partialArgument${index}`,
        position: (arg as { position?: number }).position ?? 0,
      };
      const capturedArgumentContext = resolveVariable(argumentScope, "");
      scopedCallScope = bindArgumentParameter(
        scopedCallScope,
        variable,
        capturedArgumentContext !== null
          ? runtime.aliases.bindingAliasPaths(arg, argumentScope)
          : extractBasePaths(arg, argumentScope),
        arg,
        argumentScope,
      );
      return variable;
    });
    return { arguments: scopedArguments, scope: scopedCallScope };
  }

  function walkPartialCall(
    binding: NonNullable<ReturnType<typeof resolvePartial>>,
    callArgs: AstNode[],
    callScope: ScopeTracker,
  ): string[] {
    const boundPaths = runtime.functions.walkPartial(binding.partial, binding.scope);
    const callPaths = callArgs.flatMap((arg) => runtime.core.walkNode(arg, callScope));
    const appliedFunction: FunctionNode = {
      type: "function",
      value: "(",
      position: binding.partial.position,
      procedure: binding.partial.procedure,
      arguments: applyPartialArguments(binding.partial, callArgs),
    };
    const appliedArgs = appliedFunction.arguments;
    const appliedArgumentScopes = applyPartialArgumentScopes(
      binding.partial,
      callArgs,
      binding.scope,
      callScope,
    );
    const resolvedCallables = runtime.callables.resolveCallableValues(
      binding.partial.procedure,
      binding.scope,
    );
    const builtinNames = runtime.callables.resolveBuiltinCallableNames(
      binding.partial.procedure,
      binding.scope,
    );
    const scopedBuiltinCall = scopePartialArguments(
      appliedArgs,
      appliedArgumentScopes,
      callScope,
    );
    const invocationPaths = resolvedCallables.flatMap((callable) => {
      if (callable.kind === "lambda") {
        return walkCustomFunctionCall(
          callable.binding,
          appliedArgs,
          callScope,
          false,
          appliedArgumentScopes,
        );
      }
      if (callable.kind === "transform") {
        return runtime.transforms.walkTransformCall(callable.binding, appliedArgs, callScope);
      }
      return walkPartialCall(callable.binding, appliedArgs, callScope);
    });
    for (const name of builtinNames) {
      invocationPaths.push(
        ...runtime.functions.walkFunction(
          {
            ...appliedFunction,
            procedure: {
              type: "variable",
              value: name,
              position: appliedFunction.position,
            },
            arguments: scopedBuiltinCall.arguments,
          },
          scopedBuiltinCall.scope,
        ),
      );
    }
  
    return [
      ...boundPaths,
      ...callPaths,
      ...(resolvedCallables.length > 0 || builtinNames.length > 0
        ? invocationPaths
        : runtime.functions.walkFunction(appliedFunction, binding.scope)),
    ];
  }

  return {
    extractBasePaths,
    walkHigherOrderCall,
    higherOrderCallbackDataPaths,
    higherOrderCallbackDataNodes,
    bindHigherOrderLambdaCallbackScope,
    findHigherOrderCallback,
    findResolvedHigherOrderLambdaCallbacks,
    partialCanInvokeLambda,
    resolveLambdaFunctionCalls,
    higherOrderPartialLambdaCalls,
    higherOrderPartialResultBasePaths,
    higherOrderPartialCalls,
    higherOrderCallbackCallArguments,
    findHigherOrderTransformCallback,
    resolveCallbackParentPaths,
    resolveCallbackObjectAliasParentPaths,
    resolveCallbackDynamicObjectAliasParentPaths,
    prefixDynamicObjectAlias,
    resolveDynamicVariantPaths,
    resolveDynamicVariantObjectAlias,
    resolveDynamicVariantDynamicObjectAlias,
    bindHigherOrderParameter,
    contextDefaultParameterIndex,
    lambdaContextDefaultArgumentVariants,
    walkCustomFunctionCall,
    lambdaCallGraphReaches,
    bindArgumentParameter,
    applyPartialArguments,
    applyPartialArgumentScopes,
    scopePartialArguments,
    walkPartialCall,
  };
}
