import type { ArrayNode, AstNode, BlockNode, ConditionNode, FunctionNode, NameNode, ObjectNode, PathNode, TransformNode, VariableNode } from "../types.js";
import { buildPathString } from "../path-builder.js";
import { type ScopeTracker, createScope, childScope, bindVariable, resolvePartial, resolveTransform, resolveSuffixBasePaths, resolveObjectAlias, resolveDynamicObjectAlias, type DynamicObjectAlias, type ObjectAlias, type TransformBinding } from "../scope.js";
import { ROOT_PATH, TRANSFORM_CURRENT_PATH } from "./constants.js";
import { prefixPaths, appendPath, prefixTransformContextPaths, resolveParentPathSegments, isRootReference, markAbsolute } from "./path-utils.js";
import type { TransformOperations, WalkerRuntime, ResolvedCallable, ResolvedTransformCall } from "./runtime.js";

export function createTransformOperations(runtime: WalkerRuntime): TransformOperations {
  function walkTransformContextExpression(
    prefix: string,
    expr: AstNode,
    scope: ScopeTracker,
  ): string[] {
    const localScope = bindVariable(
      childScope(createScope()),
      "",
      [TRANSFORM_CURRENT_PATH],
    );
    const localPaths = runtime.core.walkNode(expr, localScope);
    const currentSuffix = (path: string): string | null => {
      const markerIndex = path.indexOf(TRANSFORM_CURRENT_PATH);
      if (markerIndex < 0) return null;
      return path
        .slice(markerIndex + TRANSFORM_CURRENT_PATH.length)
        .replace(/^\./, "");
    };
    const representedPaths = new Set(
      localPaths.map((path) => {
        const suffix = currentSuffix(path);
        return suffix === null
          ? path
          : appendPath(ROOT_PATH, suffix || null);
      }),
    );
    const localContextPaths = localPaths.flatMap((path) => {
      const suffix = currentSuffix(path);
      if (suffix !== null) {
        return prefixTransformContextPaths(prefix, [suffix]);
      }
      if (path.startsWith(ROOT_PATH)) return [path];
      return prefixTransformContextPaths(prefix, [path]);
    });
    const capturedPaths = runtime.core.walkNode(expr, scope)
      .filter((path) => !representedPaths.has(path))
      .flatMap((path) => markAbsolute([resolveParentPathSegments(path)]));
  
    return [...localContextPaths, ...capturedPaths];
  }

  function transformPatternPrefixes(
    pattern: AstNode,
    patternPaths: readonly string[],
    scope: ScopeTracker,
  ): string[] {
    const variableBasePaths = transformVariablePatternPrefixes(pattern, scope);
    if (variableBasePaths.length > 0) return variableBasePaths;
  
    const variableAliasBasePaths = transformVariableAliasPatternPrefixes(pattern, scope);
    if (variableAliasBasePaths.length > 0) return variableAliasBasePaths;
  
    const arrayConstructorBasePaths = transformArrayConstructorPatternPrefixes(
      pattern,
      scope,
    );
    if (arrayConstructorBasePaths.length > 0) return arrayConstructorBasePaths;
  
    const blockBasePaths = transformBlockPatternPrefixes(pattern, scope);
    if (blockBasePaths.length > 0) return blockBasePaths;
  
    const basePaths = runtime.higherOrder.extractBasePaths(pattern, scope).map(resolveParentPathSegments);
    if (basePaths.length > 0) return basePaths;
    return patternPaths.length > 0 ? [...patternPaths] : [""];
  }

  function transformVariablePatternPrefixes(
    pattern: AstNode,
    scope: ScopeTracker,
  ): string[] {
    if (pattern.type !== "variable") return [];
  
    const suffixBasePaths =
      resolveSuffixBasePaths(scope, (pattern as VariableNode).value) ?? [];
    return suffixBasePaths.map(resolveParentPathSegments);
  }

  function transformVariableAliasPatternPrefixes(
    pattern: AstNode,
    scope: ScopeTracker,
  ): string[] {
    if (pattern.type !== "path") return [];
  
    const pathNode = pattern as PathNode;
    const varStepIndex = pathNode.steps.findIndex((step) => step.type === "variable");
    if (varStepIndex < 0) return [];
  
    const varStep = pathNode.steps[varStepIndex] as VariableNode;
    const objectAlias = resolveObjectAlias(scope, varStep.value);
    const dynamicObjectAlias = resolveDynamicObjectAlias(scope, varStep.value);
    if (!objectAlias && !dynamicObjectAlias) return [];
  
    const suffixBasePaths = resolveSuffixBasePaths(scope, varStep.value) ?? [];
    const aliasPaths = runtime.aliases.selectVariableObjectAliasPaths(
      objectAlias,
      dynamicObjectAlias,
      pathNode.steps.slice(varStepIndex + 1),
      scope,
      runtime.aliases.unmatchedAliasSuffixBasePaths(objectAlias, suffixBasePaths),
    );
    return aliasPaths ? aliasPaths.map(resolveParentPathSegments) : [];
  }

  function transformArrayConstructorPatternPrefixes(
    pattern: AstNode,
    scope: ScopeTracker,
  ): string[] {
    if (pattern.type !== "path") return [];
  
    const pathNode = pattern as PathNode;
    const arrayStepIndex = pathNode.steps.findIndex((step) => step.type === "array");
    if (arrayStepIndex < 0) return [];
  
    const contextPrefix = buildPathString(pathNode.steps.slice(0, arrayStepIndex)) ?? "";
    return runtime.aliases.arrayConstructorContextBasePaths(
      pathNode.steps[arrayStepIndex] as ArrayNode,
      contextPrefix,
      scope,
    ).map(resolveParentPathSegments);
  }

  function transformBlockPatternPrefixes(
    pattern: AstNode,
    scope: ScopeTracker,
  ): string[] {
    if (pattern.type !== "path") return [];
  
    const pathNode = pattern as PathNode;
    const blockStepIndex = pathNode.steps.findIndex((step) => step.type === "block");
    if (blockStepIndex < 0) return [];
  
    const contextPrefix = buildPathString(pathNode.steps.slice(0, blockStepIndex)) ?? "";
    return runtime.aliases.blockContextBasePaths(
      pathNode.steps[blockStepIndex] as BlockNode,
      contextPrefix,
      scope,
    ).map(resolveParentPathSegments);
  }

  function transformPatternSteps(pattern: AstNode): AstNode[] | null {
    if (pattern.type === "name" || pattern.type === "wildcard") return [pattern];
    if (pattern.type === "path") return (pattern as PathNode).steps;
    return null;
  }

  function staticTransformPatternSequences(pattern: AstNode): string[][] {
    if (isRootReference(pattern)) return [[]];
    if (pattern.type === "name") return [[(pattern as NameNode).value]];
    if (pattern.type === "wildcard") return [["*"]];
    if (pattern.type === "array") {
      return (pattern as ArrayNode).expressions.flatMap(staticTransformPatternSequences);
    }
    if (pattern.type !== "path") return [];
  
    const sequence: string[] = [];
    for (const step of (pattern as PathNode).steps) {
      if (step.type === "name") {
        sequence.push((step as NameNode).value);
      } else if (step.type === "wildcard") {
        sequence.push("*");
      } else if (isRootReference(step)) {
        continue;
      } else {
        return [];
      }
    }
    return [sequence];
  }

  function resolveTransformFunctionCalls(
    functionNode: FunctionNode,
    scope: ScopeTracker,
    requireAllCallables = true,
  ): ResolvedTransformCall[] {
    if (functionNode.procedure.type === "transform") {
      return [{
        binding: { transform: functionNode.procedure, scope },
        arguments: functionNode.arguments,
      }];
    }
  
    if (
      functionNode.procedure.type === "variable" &&
      ["map", "each"].includes(functionNode.procedure.value)
    ) {
      const callback = runtime.higherOrder.findHigherOrderTransformCallback(
        functionNode.arguments,
        scope,
      );
      const dataArg = functionNode.arguments[0];
      if (callback && dataArg) {
        return resolveTransformFunctionCalls(
          {
            ...functionNode,
            procedure: functionNode.arguments[
              callback.index
            ] as FunctionNode["procedure"],
            arguments: [dataArg],
          },
          scope,
        );
      }
    }
  
    const selectedCallables = runtime.callables.resolveCallableValues(functionNode.procedure, scope);
    if (selectedCallables.length > 0) {
      const resolvedCalls: ResolvedTransformCall[] = [];
      for (const callable of selectedCallables) {
        if (callable.kind === "transform") {
          resolvedCalls.push({
            binding: callable.binding,
            arguments: functionNode.arguments,
          });
          continue;
        }
        if (callable.kind !== "partial") {
          if (requireAllCallables) return [];
          continue;
        }
        const partialCalls = resolveTransformFunctionCalls(
          {
            ...functionNode,
            procedure: callable.binding.partial.procedure,
            arguments: runtime.higherOrder.applyPartialArguments(
              callable.binding.partial,
              functionNode.arguments,
            ),
          },
          callable.binding.scope,
          requireAllCallables,
        );
        if (partialCalls.length === 0 && requireAllCallables) return [];
        resolvedCalls.push(...partialCalls);
      }
      return resolvedCalls;
    }
    if (functionNode.procedure.type !== "variable") return [];
  
    const directBinding = resolveTransform(scope, functionNode.procedure.value);
    if (directBinding) {
      return [{ binding: directBinding, arguments: functionNode.arguments }];
    }
  
    const partialBinding = resolvePartial(scope, functionNode.procedure.value);
    if (!partialBinding) return [];
    return resolveTransformFunctionCalls(
      {
        ...functionNode,
        procedure: partialBinding.partial.procedure,
        arguments: runtime.higherOrder.applyPartialArguments(
          partialBinding.partial,
          functionNode.arguments,
        ),
      },
      partialBinding.scope,
      requireAllCallables,
    );
  }

  function transformWritesSuffix(
    functionNode: FunctionNode,
    suffixSteps: AstNode[],
    scope: ScopeTracker,
  ): boolean {
    const resolvedCalls = resolveTransformFunctionCalls(functionNode, scope);
    if (resolvedCalls.length === 0) return false;
  
    const suffixNames: string[] = [];
    for (const step of suffixSteps) {
      if (step.type !== "name") return false;
      suffixNames.push((step as NameNode).value);
    }
  
    return resolvedCalls.every(({ binding }) => {
      if (binding.transform.update.type !== "object") return false;
      const updateKeys = new Set(
        (binding.transform.update as ObjectNode).entries
          .map(([key]) => runtime.aliases.staticObjectKey(key))
          .filter((key): key is string => key !== null),
      );
      return staticTransformPatternSequences(binding.transform.pattern).some(
        (pattern) =>
          suffixNames.length === pattern.length + 1 &&
          pattern.every(
            (segment, index) => segment === "*" || segment === suffixNames[index],
          ) &&
          updateKeys.has(suffixNames[pattern.length]),
      );
    });
  }

  interface TransformOutputSelection {
    readonly binding: TransformBinding;
    readonly callArguments: readonly AstNode[];
    readonly matchedPattern: readonly string[];
    readonly updateValue: AstNode;
    readonly remainder: readonly AstNode[];
  }

  function transformOutputSelections(
    functionNode: FunctionNode,
    suffixSteps: AstNode[],
    scope: ScopeTracker,
  ): TransformOutputSelection[] {
    const resolvedCalls = resolveTransformFunctionCalls(functionNode, scope);
    if (resolvedCalls.length === 0) return [];
    if (
      suffixSteps.some(
        (step) =>
          step.type !== "name" || ((step as NameNode).stages?.length ?? 0) > 0,
      )
    ) {
      return [];
    }
  
    const suffixNames = suffixSteps.map((step) => (step as NameNode).value);
    const selections: TransformOutputSelection[] = [];
    for (const resolvedCall of resolvedCalls) {
      const { binding } = resolvedCall;
      if (binding.transform.update.type !== "object") return [];
      const callSelections: TransformOutputSelection[] = [];
      for (const pattern of staticTransformPatternSequences(binding.transform.pattern)) {
        if (
          suffixNames.length <= pattern.length ||
          !pattern.every(
            (segment, index) => segment === "*" || segment === suffixNames[index],
          )
        ) {
          continue;
        }
  
        const updateKey = suffixNames[pattern.length];
        for (const [keyNode, updateValue] of (binding.transform.update as ObjectNode)
          .entries) {
          if (runtime.aliases.staticObjectKey(keyNode) !== updateKey) continue;
          callSelections.push({
            binding,
            callArguments: resolvedCall.arguments,
            matchedPattern: suffixNames.slice(0, pattern.length),
            updateValue,
            remainder: suffixSteps.slice(pattern.length + 1),
          });
        }
      }
      if (callSelections.length === 0) return [];
      selections.push(...callSelections);
    }
    return selections;
  }

  function appendSelectionSteps(node: AstNode, steps: readonly AstNode[]): AstNode {
    if (steps.length === 0) return node;
    if (node.type === "path") {
      return {
        ...node,
        steps: [...(node as PathNode).steps, ...steps],
      } as PathNode;
    }
    return {
      type: "path",
      steps: [node, ...steps],
      source: node.source,
    } as PathNode;
  }

  function transformOutputSelectionSourcePaths(
    functionNode: FunctionNode,
    suffixSteps: AstNode[],
    scope: ScopeTracker,
  ): string[] | null {
    const selections = transformOutputSelections(functionNode, suffixSteps, scope);
    if (selections.length === 0) return null;
  
    return selections.flatMap((selection) => {
      if (selection.remainder.length === 0) return [];
      const input = selection.callArguments[0];
      if (!input) return [];
      const inputPaths = runtime.functions.identityReferencePaths(input, scope) ?? runtime.core.walkNode(input, scope);
      const inputBasePaths = runtime.higherOrder.extractBasePaths(input, scope);
      const inputPrefixes =
        inputBasePaths.length > 0 ? inputBasePaths : [inputPaths[0] ?? ""];
      const selectedUpdateValue = appendSelectionSteps(
        selection.updateValue,
        selection.remainder,
      );
      const localSourcePaths = walkTransformContextExpression(
        selection.matchedPattern.join("."),
        selectedUpdateValue,
        transformInvocationScope(selection.binding, scope),
      );
      return inputPrefixes.flatMap((prefix) =>
        prefixPaths(prefix, localSourcePaths),
      );
    });
  }

  function transformApplyAliasProjectionContextPaths(
    transformNode: TransformNode,
    patternSteps: AstNode[],
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[],
  ): string[] | null {
    const projectionIndex = patternSteps.findIndex((step) =>
      Boolean(runtime.aliases.projectionStepExpressions(step)),
    );
    if (projectionIndex <= 0) return null;
  
    const projectionContextSteps = patternSteps.slice(0, projectionIndex);
    const projectionContextPaths = runtime.aliases.selectAliasSuffixContextPaths(
      projectionContextSteps,
      objectAlias,
      dynamicObjectAlias,
      scope,
      suffixBasePaths,
    );
    if (projectionContextPaths.length === 0) return null;
  
    const selectedSuffix = buildPathString(patternSteps.slice(projectionIndex + 1));
    const selectedPatternPrefixes = selectedSuffix
      ? projectionContextPaths.map((path) => appendPath(path, selectedSuffix))
      : projectionContextPaths;
  
    return [
      ...runtime.aliases.walkAliasSuffixProjectionSteps(
        patternSteps,
        objectAlias,
        dynamicObjectAlias,
        scope,
        suffixBasePaths,
      ),
      ...selectedPatternPrefixes,
      ...(transformNode.update
        ? selectedPatternPrefixes.flatMap((prefix) =>
            walkTransformContextExpression(prefix, transformNode.update!, scope),
          )
        : []),
      ...(transformNode.delete
        ? selectedPatternPrefixes.flatMap((prefix) =>
            walkTransformContextExpression(prefix, transformNode.delete!, scope),
          )
        : []),
    ];
  }

  function transformApplyAliasContextPaths(
    transformNode: TransformNode,
    transformPaths: string[],
    lhs: AstNode,
    lhsPaths: readonly string[],
    scope: ScopeTracker,
  ): string[] | null {
    const objectAlias = runtime.aliases.objectAliasForNode(lhs, scope);
    const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(lhs, scope);
    if (!objectAlias && !dynamicObjectAlias) return null;
  
    const patternSteps = transformPatternSteps(transformNode.pattern);
    const patternPrefix = patternSteps ? buildPathString(patternSteps) : null;
    if (!patternSteps || !patternPrefix) return null;
  
    const suffixBasePaths =
      lhs.type === "variable"
        ? (resolveSuffixBasePaths(scope, (lhs as VariableNode).value) ?? [])
        : runtime.results.getResultSuffixBasePaths(lhs, scope);
    const projectionContextPaths = transformApplyAliasProjectionContextPaths(
      transformNode,
      patternSteps,
      objectAlias,
      dynamicObjectAlias,
      scope,
      suffixBasePaths,
    );
    if (projectionContextPaths) return projectionContextPaths;
  
    const selectedPatternPrefixes = runtime.aliases.selectAliasSuffixContextPaths(
      patternSteps,
      objectAlias,
      dynamicObjectAlias,
      scope,
      suffixBasePaths,
    );
    if (selectedPatternPrefixes.length === 0) return null;
  
    const transformBasePaths = runtime.higherOrder.extractBasePaths(lhs, scope);
    const unmatchedSuffixBasePaths = runtime.aliases.unmatchedAliasSuffixBasePaths(
      objectAlias,
      suffixBasePaths,
    );
    const fallbackPrefixes =
      suffixBasePaths.length > 0
        ? unmatchedSuffixBasePaths
        : transformBasePaths.length > 0
          ? transformBasePaths
          : [lhsPaths[0] ?? ""];
  
    return transformPaths.flatMap((path) => {
      if (path === patternPrefix) return selectedPatternPrefixes;
      if (path.startsWith(`${patternPrefix}.`)) {
        const suffix = path.slice(patternPrefix.length + 1);
        return selectedPatternPrefixes.map((prefix) => appendPath(prefix, suffix));
      }
      return fallbackPrefixes.flatMap((prefix) => prefixPaths(prefix, [path]));
    });
  }

  /**
   * Handle transform operator: | pattern | update, delete |
   * Pattern is walked for base paths.
   * Update values are walked via walkNode (reusing walkUnary for "{" nodes)
   * and prefixed with the pattern path.
   * Delete clauses usually contain string literals, but dynamic delete
   * expressions can read input paths and are walked like update values.
   */
  function walkTransform(node: TransformNode, scope: ScopeTracker): string[] {
    const paths: string[] = [];
  
    // Walk pattern for base paths
    const patternPaths = runtime.core.walkNode(node.pattern, scope).map(resolveParentPathSegments);
    const patternPrefixes = transformPatternPrefixes(
      node.pattern,
      patternPaths,
      scope,
    );
    paths.push(...patternPaths);
  
    // Walk update and prefix results with pattern path
    if (node.update) {
      paths.push(
        ...patternPrefixes.flatMap((patternPrefix) =>
          walkTransformContextExpression(patternPrefix, node.update!, scope),
        ),
      );
    }
  
    // Delete clause: string literals only, no paths extracted
    if (node.delete) {
      paths.push(
        ...patternPrefixes.flatMap((patternPrefix) =>
          walkTransformContextExpression(patternPrefix, node.delete!, scope),
        ),
      );
    }
  
    paths.push(
      ...runtime.paths.walkSourceLessFilterStages(node.predicate ?? [], scope),
      ...(node.group ? runtime.paths.walkSourceLessGroupEntries(node.group, scope) : []),
    );
  
    return paths;
  }

  function staticTransformPatternAlternatives(node: AstNode): string[][] {
    if (node.type === "array") {
      return (node as ArrayNode).expressions.flatMap((expression) =>
        staticTransformPatternAlternatives(expression),
      );
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [condition.then, condition.else].flatMap((branch) =>
        branch ? staticTransformPatternAlternatives(branch) : [],
      );
    }
    if (node.type === "block") {
      const expressions = (node as BlockNode).expressions;
      const result = expressions[expressions.length - 1];
      return result ? staticTransformPatternAlternatives(result) : [];
    }
    if (node.type === "path") {
      let alternatives: string[][] = [[]];
      for (const step of (node as PathNode).steps) {
        const stepAlternatives = staticTransformPatternAlternatives(step);
        if (stepAlternatives.length === 0) return [];
        alternatives = alternatives.flatMap((prefix) =>
          stepAlternatives.map((suffix) => [...prefix, ...suffix]),
        );
      }
      return alternatives;
    }
    if (node.type === "name") return [[(node as NameNode).value]];
    if (node.type === "wildcard") return [["*"]];
    return [];
  }

  function transformUpdateMatches(
    pattern: AstNode,
    suffixSteps: AstNode[],
  ): Array<{ locationNames: string[]; updateSuffix: AstNode[] }> {
    return staticTransformPatternAlternatives(pattern).flatMap(
      (patternNames) => {
        const locationSteps = suffixSteps.slice(0, patternNames.length);
        if (locationSteps.length !== patternNames.length) return [];
        const locationNames = locationSteps.map((step) =>
          step.type === "name"
            ? (step as NameNode).value
            : step.type === "wildcard"
              ? "*"
              : null,
        );
        if (
          locationNames.some((name) => name === null) ||
          patternNames.some(
            (name, index) =>
              name !== "*" && locationNames[index] !== name,
          )
        ) {
          return [];
        }
        return [
          {
            locationNames: locationNames as string[],
            updateSuffix: suffixSteps.slice(patternNames.length),
          },
        ];
      },
    );
  }

  function transformUpdateCallableValues(
    node: FunctionNode,
    suffixSteps: AstNode[],
    scope: ScopeTracker,
  ): ResolvedCallable[] {
    return runtime.callables.resolveCallableValues(node.procedure, scope).flatMap((callable) => {
      if (callable.kind !== "transform") return [];
      return transformUpdateMatches(
        callable.binding.transform.pattern,
        suffixSteps,
      ).flatMap(({ locationNames, updateSuffix }) => {
        if (updateSuffix.length === 0) return [];
        const input = node.arguments[0];
        const inputBases = input ? runtime.higherOrder.extractBasePaths(input, scope) : [];
        const matchContextPaths = inputBases.map((base) =>
          appendPath(base, locationNames.join(".")),
        );
        let updateScope = transformInvocationScope(callable.binding, scope);
        if (matchContextPaths.length > 0) {
          updateScope = bindVariable(updateScope, "", matchContextPaths);
        }
        return runtime.callables.resolveCallableValues(
          {
            type: "path",
            steps: [callable.binding.transform.update, ...updateSuffix],
          } as PathNode,
          updateScope,
        );
      });
    });
  }

  function transformUpdateBuiltinCallableNames(
    node: FunctionNode,
    suffixSteps: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    return runtime.callables.resolveCallableValues(node.procedure, scope).flatMap((callable) => {
      if (callable.kind !== "transform") return [];
      return transformUpdateMatches(
        callable.binding.transform.pattern,
        suffixSteps,
      ).flatMap(({ locationNames, updateSuffix }) => {
        if (updateSuffix.length === 0) return [];
        const input = node.arguments[0];
        const inputBases = input ? runtime.higherOrder.extractBasePaths(input, scope) : [];
        const matchContextPaths = inputBases.map((base) =>
          appendPath(base, locationNames.join(".")),
        );
        let updateScope = transformInvocationScope(callable.binding, scope);
        if (matchContextPaths.length > 0) {
          updateScope = bindVariable(updateScope, "", matchContextPaths);
        }
        return runtime.callables.resolveBuiltinCallableNames(
          {
            type: "path",
            steps: [callable.binding.transform.update, ...updateSuffix],
          } as PathNode,
          updateScope,
        );
      });
    });
  }

  function walkTransformCall(
    binding: TransformBinding,
    callArgs: AstNode[],
    callScope: ScopeTracker,
  ): string[] {
    const paths: string[] = [];
    const input = callArgs[0];
  
    for (const arg of callArgs) {
      const identityPaths = runtime.functions.identityReferencePaths(arg, callScope);
      if (identityPaths) {
        paths.push(...identityPaths.filter((path) => path !== ROOT_PATH));
      } else {
        paths.push(...runtime.core.walkNode(arg, callScope));
      }
    }
    if (!input) return paths;
  
    const transformScope = bindVariable(
      transformInvocationScope(binding, callScope),
      "",
      [],
    );
    const transformPaths = walkTransform(binding.transform, transformScope);
    const inputPaths =
      runtime.functions.identityReferencePaths(input, callScope) ?? runtime.core.walkNode(input, callScope);
    const transformBasePaths = runtime.higherOrder.extractBasePaths(input, callScope);
    if (transformBasePaths.includes(ROOT_PATH)) paths.push("**");
  
    const aliasContextPaths = transformApplyAliasContextPaths(
      binding.transform,
      transformPaths,
      input,
      inputPaths,
      callScope,
    );
    if (aliasContextPaths) return [...paths, ...aliasContextPaths];
  
    const transformPrefixes =
      transformBasePaths.length > 0
        ? transformBasePaths
        : [inputPaths[0] ?? ""];
    paths.push(
      ...transformPrefixes.flatMap((prefix) => prefixPaths(prefix, transformPaths)),
    );
    return paths;
  }

  function transformInvocationScope(
    binding: TransformBinding,
    callScope: ScopeTracker,
  ): ScopeTracker {
    return runtime.callables.bindForwardReferences(
      childScope(binding.scope),
      {
        type: "lambda",
        position: binding.transform.position ?? 0,
        arguments: [],
        body: binding.transform,
      },
      callScope,
    );
  }

  return {
    resolveTransformFunctionCalls,
    transformWritesSuffix,
    transformOutputSelectionSourcePaths,
    transformApplyAliasContextPaths,
    walkTransform,
    transformUpdateCallableValues,
    transformUpdateBuiltinCallableNames,
    walkTransformCall,
  };
}
