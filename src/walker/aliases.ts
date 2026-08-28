import type { ArrayNode, AstNode, ApplyNode, BindNode, BlockNode, ConditionNode, FilterStage, FunctionNode, GroupByNode, LambdaNode, NameNode, ObjectNode, PathNode, SortNode, VariableNode, WildcardNode } from "../types.js";
import { buildPathString } from "../path-builder.js";
import { type ScopeTracker, createScope, childScope, bindVariable, bindSuffixBasePaths, bindObjectAlias, bindDynamicObjectAlias, resolveVariable, resolveObjectAlias, resolveDynamicObjectAlias, type DynamicObjectAlias, type ObjectAlias } from "../scope.js";
import { ROOT_PATH } from "./constants.js";
import { prefixPaths, prefixProjectionPaths, appendPath, markAbsolute, parentPath, isParentRelativePath, stripParentRelativePath, collectVariableNames, isNumericIndex } from "./path-utils.js";
import type { AliasOperations, WalkerRuntime } from "./runtime.js";

export function createAliasOperations(runtime: WalkerRuntime): AliasOperations {
  // Alias-local analysis deliberately runs without caller bindings. Reuse the
  // same empty scope so the core walk cache can safely reuse those results.
  const localAnalysisScope = childScope(createScope());
  const bindingAliasCache = new WeakMap<
    AstNode,
    WeakMap<ScopeTracker, string[]>
  >();
  const localPathSetCache = new WeakMap<AstNode, ReadonlySet<string>>();
  const objectAliasCache = new WeakMap<
    AstNode,
    WeakMap<ScopeTracker, ObjectAlias | null>
  >();

  function bindingAliasPaths(node: AstNode, scope: ScopeTracker): string[] {
    const cached = bindingAliasCache.get(node)?.get(scope);
    if (cached) return cached;
    const paths = computeBindingAliasPaths(node, scope);
    let scopeCache = bindingAliasCache.get(node);
    if (!scopeCache) {
      scopeCache = new WeakMap();
      bindingAliasCache.set(node, scopeCache);
    }
    scopeCache.set(scope, paths);
    return paths;
  }

  function computeBindingAliasPaths(node: AstNode, scope: ScopeTracker): string[] {
    const identityPaths = runtime.functions.identityReferencePaths(node, scope);
    if (identityPaths) return identityPaths;

    switch (node.type) {
      case "name": {
        const currentPaths = resolveVariable(scope, "");
        return currentPaths?.length
          ? markAbsolute(
              currentPaths.map((path) =>
                appendPath(path, (node as NameNode).value),
              ),
            )
          : [(node as NameNode).value];
      }
      case "path": {
        const paths = runtime.results.getResultBasePathsFromArg(node, scope);
        const currentPaths = resolveVariable(scope, "");
        return currentPaths?.length && (node as PathNode).steps[0]?.type === "name"
          ? markAbsolute(
              currentPaths.flatMap((currentPath) =>
                paths.map((path) => appendPath(currentPath, path)),
              ),
            )
          : paths;
      }
      case "variable":
        return [...(resolveVariable(scope, (node as VariableNode).value) ?? [])];
      case "array":
        return (node as ArrayNode).expressions.flatMap((expr) =>
          bindingAliasPaths(expr, scope),
        );
      case "object":
        return runtime.core.walkObject(node as ObjectNode, scope);
      case "wildcard":
        return ["*"];
      case "descendant":
        return ["**"];
      case "parent":
        return ["%"];
      case "function":
        return runtime.results.getFunctionResultBasePaths(node as FunctionNode, scope);
      case "lambda": {
        const lambda = node as LambdaNode;
        return lambda.thunk ? bindingAliasPaths(lambda.body, scope) : [];
      }
      case "block":
        return bindingAliasPathsFromBlock(node as BlockNode, scope);
      case "apply": {
        const func = runtime.functions.appliedFunctionFromApply(node as ApplyNode);
        return func ? runtime.results.getFunctionResultBasePaths(func, scope) : [];
      }
      case "condition": {
        const condition = node as ConditionNode;
        return [
          ...bindingAliasPaths(condition.then, scope),
          ...(condition.else ? bindingAliasPaths(condition.else, scope) : []),
        ];
      }
      default:
        return [];
    }
  }

  function staticObjectKey(node: AstNode): string | null {
    if (node.type === "string") {
      return (node as { value: string }).value;
    }
    return null;
  }

  function objectAliasFromObject(node: ObjectNode, scope: ScopeTracker): ObjectAlias | null {
    const fields = new Map<string, readonly string[]>();
  
    for (const [keyNode, valueNode] of node.entries) {
      const key = staticObjectKey(keyNode);
      if (!key) continue;
  
      const aliases = valueNode.type === "object" ? [] : bindingAliasPaths(valueNode, scope);
      if (aliases.length > 0) fields.set(key, aliases);
  
      const nestedAlias = objectAliasForNode(valueNode, scope);
      if (nestedAlias) {
        for (const [nestedKey, nestedAliases] of nestedAlias) {
          fields.set(`${key}.${nestedKey}`, nestedAliases);
        }
      }
    }
  
    return fields.size > 0 ? fields : null;
  }

  function mergeObjectAliases(aliases: Array<ObjectAlias | null>): ObjectAlias | null {
    const fields = new Map<string, string[]>();
  
    for (const alias of aliases) {
      if (!alias) continue;
  
      for (const [key, paths] of alias) {
        fields.set(key, [...(fields.get(key) ?? []), ...paths]);
      }
    }
  
    return fields.size > 0 ? fields : null;
  }

  function objectAliasFromPathProjection(
    node: PathNode,
    scope: ScopeTracker,
  ): ObjectAlias | null {
    const projectionStep = node.steps[node.steps.length - 1];
    if (projectionStep?.type === "block") {
      const contextPrefix = buildPathString(node.steps.slice(0, -1)) ?? "";
      if (!contextPrefix) return null;
      return prefixObjectAlias(objectAliasForNode(projectionStep, scope), contextPrefix);
    }
    if (projectionStep?.type !== "object") return null;
  
    const prefixSteps = node.steps.slice(0, -1);
    const varStep = prefixSteps.find((step) => step.type === "variable") as
      | VariableNode
      | undefined;
    const objectAlias = varStep ? resolveObjectAlias(scope, varStep.value) : null;
    const dynamicObjectAlias = varStep
      ? resolveDynamicObjectAlias(scope, varStep.value)
      : null;
    const contextPrefix = buildPathString(prefixSteps) ?? "";
    const contextPrefixes =
      contextPrefix || !varStep
        ? [contextPrefix]
        : [...(resolveVariable(scope, varStep.value) ?? [])];
    const fields = new Map<string, string[]>();
  
    for (const [keyNode, valueNode] of (projectionStep as ObjectNode).entries) {
      const key = staticObjectKey(keyNode);
      if (!key) continue;
  
      const aliases =
        objectAlias || dynamicObjectAlias
          ? selectAliasExpressionPaths(objectAlias, dynamicObjectAlias, valueNode, scope)
          : contextPrefixes.flatMap((prefix) =>
              runtime.paths.walkContextExpression(valueNode, prefix, scope),
            );
      if (aliases.length > 0) fields.set(key, aliases);
    }
  
    return fields.size > 0 ? fields : null;
  }

  function objectAliasForNode(node: AstNode, scope: ScopeTracker): ObjectAlias | null {
    const existingScopeCache = objectAliasCache.get(node);
    if (existingScopeCache?.has(scope)) return existingScopeCache.get(scope) ?? null;
    const alias = computeObjectAliasForNode(node, scope);
    let scopeCache = objectAliasCache.get(node);
    if (!scopeCache) {
      scopeCache = new WeakMap();
      objectAliasCache.set(node, scopeCache);
    }
    scopeCache.set(scope, alias);
    return alias;
  }

  function computeObjectAliasForNode(node: AstNode, scope: ScopeTracker): ObjectAlias | null {
    if (node.type === "object") return objectAliasFromObject(node as ObjectNode, scope);
    if (node.type === "path") return objectAliasFromPathProjection(node as PathNode, scope);
    if (node.type === "array") {
      return mergeObjectAliases(
        (node as ArrayNode).expressions.map((expr) =>
          groupResultObjectAliasForNode(expr, scope),
        ),
      );
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return mergeObjectAliases([
        groupResultObjectAliasForNode(condition.then, scope),
        condition.else
          ? groupResultObjectAliasForNode(condition.else, scope)
          : null,
      ]);
    }
    if (node.type === "lambda") {
      const lambda = node as LambdaNode;
      return lambda.thunk
        ? groupResultObjectAliasForNode(lambda.body, scope)
        : null;
    }
    if (node.type === "function") {
      return runtime.results.getFunctionResultObjectAlias(node as FunctionNode, scope);
    }
    if (node.type === "apply") {
      const func = runtime.functions.appliedFunctionFromApply(node as ApplyNode);
      return func ? runtime.results.getFunctionResultObjectAlias(func, scope) : null;
    }
    if (node.type === "variable") {
      return resolveObjectAlias(scope, (node as VariableNode).value);
    }
    if (node.type === "block") {
      return objectAliasFromBlock(node as BlockNode, scope);
    }
    return null;
  }

  function objectAliasFromBlock(node: BlockNode, scope: ScopeTracker): ObjectAlias | null {
    let currentScope = scope;
    let result: ObjectAlias | null = null;
  
    for (const expr of node.expressions) {
      if (expr.type === "bind") {
        const bindNode = expr as BindNode;
        const closureScope = currentScope;
        const aliases = bindingAliasPaths(bindNode.rhs, currentScope);
        currentScope = bindVariable(currentScope, bindNode.lhs.value, aliases);
        currentScope = bindSuffixBasePathsIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = bindObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = bindDynamicObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        result = groupResultObjectAliasForNode(bindNode.rhs, closureScope);
      } else {
        result = groupResultObjectAliasForNode(expr, currentScope);
      }
    }
  
    return result;
  }

  function selectObjectAliasPaths(
    alias: ObjectAlias,
    suffixSteps: AstNode[],
  ): string[] | null {
    const [selector, ...rest] = suffixSteps;
    if (!selector) return [...alias.values()].flatMap((paths) => [...paths]);
  
    if (selector.type === "name") {
      const keyParts: string[] = [];
      let best: { paths: readonly string[]; consumed: number } | null = null;
  
      for (const [index, step] of suffixSteps.entries()) {
        if (step.type !== "name") break;
  
        keyParts.push((step as NameNode).value);
        const paths = alias.get(keyParts.join("."));
        if (paths) best = { paths, consumed: index + 1 };
      }
  
      const wildcardStep = suffixSteps[keyParts.length];
      if (!best && wildcardStep?.type === "wildcard") {
        const prefix = `${keyParts.join(".")}.`;
        const suffix = buildPathString(suffixSteps.slice(keyParts.length + 1));
        const wildcardPaths: string[] = [];
  
        for (const [key, paths] of alias) {
          const restKey = key.startsWith(prefix) ? key.slice(prefix.length) : "";
          if (restKey && !restKey.includes(".")) {
            wildcardPaths.push(...paths.map((path) => appendPath(path, suffix)));
          }
        }
  
        return wildcardPaths.length > 0 ? wildcardPaths : null;
      }
  
      if (!best) return null;
  
      const selectedStep = suffixSteps[best.consumed - 1] as NameNode;
      let remainingSteps = suffixSteps.slice(best.consumed);
      if (
        selectedStep.focusBinding &&
        remainingSteps[0]?.type === "variable" &&
        (remainingSteps[0] as VariableNode).value === selectedStep.focusBinding.name
      ) {
        remainingSteps = remainingSteps.slice(1);
      }
      const suffix = buildPathString(remainingSteps);
      return best.paths.map((path) => appendPath(path, suffix));
    }
    if (selector.type === "wildcard") {
      const suffix = buildPathString(rest);
      return [...alias.values()].flatMap((paths) =>
        paths.map((path) => appendPath(path, suffix)),
      );
    }
    return null;
  }

  function selectDynamicObjectValuePaths(
    node: ObjectNode,
    suffixSteps: AstNode[],
    scope: ScopeTracker,
    parentDataArgPaths: readonly string[] = [],
    contextBasePaths: readonly string[] = [],
  ): string[] {
    const [selector, ...rest] = suffixSteps;
    if (!selector || (selector.type !== "name" && selector.type !== "wildcard")) return [];
  
    const paths: string[] = [];
    const suffix = buildPathString(rest);
  
    for (const [keyNode, valueNode] of node.entries) {
      if (staticObjectKey(keyNode)) continue;
  
      const nestedAlias = objectAliasForNode(valueNode, scope);
      const resolvedNestedAlias = nestedAlias
        ? runtime.higherOrder.resolveDynamicVariantObjectAlias(nestedAlias, {
            node,
            scope,
            parentDataArgPaths,
            contextBasePaths,
          })
        : null;
      const nestedPaths = resolvedNestedAlias
        ? selectObjectAliasPaths(resolvedNestedAlias, rest)
        : null;
      if (nestedPaths) {
        paths.push(...nestedPaths);
        continue;
      }
  
      const nestedDynamicAlias = dynamicObjectAliasForNode(valueNode, scope);
      const resolvedNestedDynamicAlias = nestedDynamicAlias
        ? runtime.higherOrder.resolveDynamicVariantDynamicObjectAlias(nestedDynamicAlias, {
            node,
            scope,
            parentDataArgPaths,
            contextBasePaths,
          })
        : null;
      const nestedDynamicPaths = resolvedNestedDynamicAlias
        ? selectDynamicObjectAliasPaths(resolvedNestedDynamicAlias, rest)
        : [];
      if (nestedDynamicPaths.length > 0) {
        paths.push(...nestedDynamicPaths);
        continue;
      }
  
      if (valueNode.type === "object") continue;
  
      paths.push(
        ...runtime.higherOrder.resolveDynamicVariantPaths(bindingAliasPaths(valueNode, scope), {
          node,
          scope,
          parentDataArgPaths,
          contextBasePaths,
        }).map((path) => appendPath(path, suffix)),
      );
    }
  
    return paths;
  }

  function selectDynamicObjectAliasPaths(
    alias: DynamicObjectAlias,
    suffixSteps: AstNode[],
  ): string[] {
    return alias.variants.flatMap((variant) => {
      const prefixedSuffixSteps = dynamicVariantSuffixSteps(variant, suffixSteps);
      return prefixedSuffixSteps
        ? selectDynamicObjectValuePaths(
            variant.node,
            prefixedSuffixSteps,
            variant.scope,
            variant.parentDataArgPaths,
            variant.contextBasePaths,
          )
        : [];
    });
  }

  function mergeDynamicObjectAliases(
    aliases: Array<DynamicObjectAlias | null>,
  ): DynamicObjectAlias | null {
    const variants = aliases.flatMap((alias) => alias?.variants ?? []);
    return variants.length > 0 ? { variants } : null;
  }

  function dynamicVariantSuffixSteps(
    variant: DynamicObjectAlias["variants"][number],
    suffixSteps: AstNode[],
  ): AstNode[] | null {
    const prefixSteps = variant.prefixSteps ?? [];
    if (prefixSteps.length === 0) return suffixSteps;
    if (suffixSteps.length < prefixSteps.length) return null;
  
    for (const [index, prefix] of prefixSteps.entries()) {
      const step = suffixSteps[index];
      const matchesPrefix =
        step?.type === "wildcard" ||
        (step?.type === "name" && (step as NameNode).value === prefix);
      if (!matchesPrefix) {
        return null;
      }
    }
  
    return suffixSteps.slice(prefixSteps.length);
  }

  function selectLookupDynamicObjectAliasPaths(
    alias: DynamicObjectAlias,
    suffixSteps: AstNode[],
  ): string[] {
    const suffix = buildPathString(suffixSteps);
    const paths: string[] = [];
  
    for (const variant of alias.variants) {
      for (const [keyNode, valueNode] of variant.node.entries) {
        if (staticObjectKey(keyNode)) continue;
  
        const nestedAlias = objectAliasForNode(valueNode, variant.scope);
        const resolvedNestedAlias = nestedAlias
          ? runtime.higherOrder.resolveDynamicVariantObjectAlias(nestedAlias, variant)
          : null;
        const nestedPaths = resolvedNestedAlias
          ? selectObjectAliasPaths(resolvedNestedAlias, suffixSteps)
          : null;
        if (nestedPaths) {
          paths.push(...nestedPaths);
          continue;
        }
  
        const nestedDynamicAlias = dynamicObjectAliasForNode(valueNode, variant.scope);
        const resolvedNestedDynamicAlias = nestedDynamicAlias
          ? runtime.higherOrder.resolveDynamicVariantDynamicObjectAlias(nestedDynamicAlias, variant)
          : null;
        const nestedDynamicPaths = resolvedNestedDynamicAlias
          ? selectDynamicObjectAliasPaths(resolvedNestedDynamicAlias, suffixSteps)
          : [];
        if (nestedDynamicPaths.length > 0) {
          paths.push(...nestedDynamicPaths);
          continue;
        }
  
        if (valueNode.type === "object") continue;
  
        paths.push(
          ...runtime.higherOrder.resolveDynamicVariantPaths(
            bindingAliasPaths(valueNode, variant.scope),
            variant,
          ).map((path) => appendPath(path, suffix)),
        );
      }
    }
  
    return paths;
  }

  function selectLookupDynamicObjectResultAlias(
    alias: DynamicObjectAlias,
    selectorSteps: AstNode[],
  ): DynamicObjectAlias | null {
    const selector = selectorSteps[0];
    const variants = alias.variants.flatMap((variant) =>
      variant.node.entries.flatMap(([keyNode, valueNode]) => {
        if ((variant.prefixSteps?.length ?? 0) > 0) return [];
  
        const key = staticObjectKey(keyNode);
        const selectorMatches =
          !key ||
          selector?.type !== "name" ||
          key === (selector as NameNode).value;
        if (!selectorMatches) return [];
  
        const valueAlias = dynamicObjectAliasForNode(valueNode, variant.scope);
        const resolvedValueAlias = valueAlias
          ? runtime.higherOrder.resolveDynamicVariantDynamicObjectAlias(valueAlias, variant)
          : null;
        return resolvedValueAlias?.variants ?? [];
      }),
    );
  
    return variants.length > 0 ? { variants } : null;
  }

  function selectLookupDynamicObjectResultObjectAlias(
    alias: DynamicObjectAlias,
    selectorSteps: AstNode[],
  ): ObjectAlias | null {
    const selector = selectorSteps[0];
    return mergeObjectAliases(
      alias.variants.flatMap((variant) =>
        variant.node.entries.flatMap(([keyNode, valueNode]) => {
          if ((variant.prefixSteps?.length ?? 0) > 0) return [];
  
          const key = staticObjectKey(keyNode);
          const selectorMatches =
            !key ||
            selector?.type !== "name" ||
            key === (selector as NameNode).value;
          if (!selectorMatches) return [];
  
          const valueAlias = objectAliasForNode(valueNode, variant.scope);
          return valueAlias
            ? runtime.higherOrder.resolveDynamicVariantObjectAlias(valueAlias, variant)
            : null;
        }),
      ),
    );
  }

  function selectVariableObjectAliasPaths(
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    suffixSteps: AstNode[],
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
    preserveUnmappedLocalPaths = false,
  ): string[] | null {
    const [selector, ...rest] = suffixSteps;
    if (selector?.type === "sort") {
      const sortPaths = selectSortAliasPaths(
        selector as SortNode,
        objectAlias,
        dynamicObjectAlias,
        scope,
        suffixBasePaths,
      );
      const resultPaths =
        selectVariableObjectAliasPaths(
          objectAlias,
          dynamicObjectAlias,
          rest,
          scope,
          suffixBasePaths,
          preserveUnmappedLocalPaths,
        ) ?? [];
      const paths = [...sortPaths, ...resultPaths];
      return paths.length > 0 ? paths : null;
    }
  
    const projectionPaths = selectAliasProjectionStepPaths(
      objectAlias,
      dynamicObjectAlias,
      selector,
      scope,
      preserveUnmappedLocalPaths,
    );
    if (projectionPaths) {
      const suffix = buildPathString(rest);
      const projectionBasePaths =
        selector && selector.type !== "object"
          ? (projectionStepExpressions(selector) ?? []).flatMap((expr) =>
              bindingAliasPaths(expr, scope),
            )
          : [];
      return suffix && selector?.type !== "object"
        ? [
            ...projectionPaths,
            ...projectionBasePaths.map((path) => appendPath(path, suffix)),
          ]
        : projectionPaths;
    }
  
    const paths = [
      ...(objectAlias ? (selectObjectAliasPaths(objectAlias, suffixSteps) ?? []) : []),
      ...(dynamicObjectAlias
        ? selectDynamicObjectAliasPaths(dynamicObjectAlias, suffixSteps)
        : []),
    ];
    return paths.length > 0 ? paths : null;
  }

  function selectSortAliasPaths(
    sortNode: SortNode,
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
  ): string[] {
    const paths: string[] = [];
  
    for (const term of sortNode.terms) {
      if (collectVariableNames(term.expression).size > 0) {
        paths.push(
          ...selectAliasExpressionPaths(
            objectAlias,
            dynamicObjectAlias,
            term.expression,
            scope,
            suffixBasePaths,
          ),
        );
        continue;
      }
  
      if (term.expression.type !== "path") {
        paths.push(
          ...selectAliasExpressionPaths(
            objectAlias,
            dynamicObjectAlias,
            term.expression,
            scope,
            suffixBasePaths,
          ),
        );
        continue;
      }
  
      const suffixSteps = (term.expression as PathNode).steps;
      const suffix = buildPathString(suffixSteps);
      paths.push(
        ...(objectAlias ? (selectObjectAliasPaths(objectAlias, suffixSteps) ?? []) : []),
        ...(dynamicObjectAlias
          ? selectDynamicObjectAliasPaths(dynamicObjectAlias, suffixSteps)
          : []),
        ...(suffix ? suffixBasePaths.map((path) => appendPath(path, suffix)) : []),
      );
    }
  
    return paths;
  }

  function selectAliasSuffixContextPaths(
    suffixSteps: AstNode[],
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
  ): string[] {
    const aliasPaths =
      selectVariableObjectAliasPaths(
        objectAlias,
        dynamicObjectAlias,
        suffixSteps,
        scope,
        suffixBasePaths,
      ) ?? [];
    const suffix = buildPathString(suffixSteps);
    const unmatchedSuffixBasePaths = unmatchedAliasSuffixBasePaths(
      objectAlias,
      suffixBasePaths,
    );
    const suffixBaseContextPaths =
      suffix && unmatchedSuffixBasePaths.length > 0
        ? unmatchedSuffixBasePaths.map((path) => appendPath(path, suffix))
        : [];
    const suffixBaseRoots = new Set(unmatchedSuffixBasePaths);
    return [
      ...aliasPaths.filter((path) => !suffixBaseRoots.has(path)),
      ...suffixBaseContextPaths,
    ];
  }

  function walkAliasSuffixFilterStages(
    suffixSteps: AstNode[],
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
    preserveUnmappedLocalPaths = false,
  ): string[] {
    const paths: string[] = [];
  
    for (const [index, step] of suffixSteps.entries()) {
      if (step.type !== "name") continue;
  
      const nameStep = step as NameNode;
      const contextPaths = selectAliasSuffixContextPaths(
        suffixSteps.slice(0, index + 1),
        objectAlias,
        dynamicObjectAlias,
        scope,
        suffixBasePaths,
      );
      const parentContextPaths =
        index > 0
          ? selectAliasSuffixContextPaths(
              suffixSteps.slice(0, index),
              objectAlias,
              dynamicObjectAlias,
              scope,
              suffixBasePaths,
            )
          : [];
      for (const stage of nameStep.stages ?? []) {
        if (stage.type !== "filter") continue;
  
        const filterStage = stage as unknown as FilterStage;
        if (isNumericIndex(filterStage.expr)) continue;
  
        paths.push(
          ...walkAliasSuffixContextExpression(
            filterStage.expr,
            contextPaths,
            parentContextPaths,
            scope,
          ),
          ...(collectVariableNames(filterStage.expr).size > 0
            ? selectAliasExpressionPaths(
                objectAlias,
                dynamicObjectAlias,
                filterStage.expr,
                scope,
                suffixBasePaths,
                preserveUnmappedLocalPaths,
                true,
              )
            : []),
        );
      }
    }
  
    return paths;
  }

  function walkAliasSuffixSortTerms(
    suffixSteps: AstNode[],
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
    preserveUnmappedLocalPaths = false,
  ): string[] {
    const paths: string[] = [];
  
    for (const [index, step] of suffixSteps.entries()) {
      if (step.type !== "sort") continue;
  
      const contextPrefixSteps = suffixSteps.slice(0, index);
      const contextPaths =
        contextPrefixSteps.length > 0
          ? selectAliasSuffixContextPaths(
              contextPrefixSteps,
              objectAlias,
              dynamicObjectAlias,
              scope,
              suffixBasePaths,
            )
          : [];
      const parentContextPaths =
        contextPrefixSteps.length > 1
          ? selectAliasSuffixContextPaths(
              contextPrefixSteps.slice(0, -1),
              objectAlias,
              dynamicObjectAlias,
              scope,
              suffixBasePaths,
            )
          : [];
      if (contextPrefixSteps.length === 0) {
        paths.push(
          ...selectSortAliasPaths(
            step as SortNode,
            objectAlias,
            dynamicObjectAlias,
            scope,
            suffixBasePaths,
          ),
        );
        continue;
      }
      for (const term of (step as SortNode).terms) {
        paths.push(
          ...walkAliasSuffixContextExpression(
            term.expression,
            contextPaths,
            parentContextPaths,
            scope,
          ),
          ...(collectVariableNames(term.expression).size > 0
            ? selectAliasExpressionPaths(
                objectAlias,
                dynamicObjectAlias,
                term.expression,
                scope,
                suffixBasePaths,
                preserveUnmappedLocalPaths,
                true,
              )
            : []),
        );
      }
    }
  
    return paths;
  }

  function walkAliasSuffixProjectionSteps(
    suffixSteps: AstNode[],
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
    preserveUnmappedLocalPaths = false,
  ): string[] {
    const paths: string[] = [];
  
    for (const [index, step] of suffixSteps.entries()) {
      const expressions = projectionStepExpressions(step);
      if (!expressions) continue;
  
      const contextPrefixSteps = suffixSteps.slice(0, index);
      const contextPaths =
        contextPrefixSteps.length > 0
          ? selectAliasSuffixContextPaths(
              contextPrefixSteps,
              objectAlias,
              dynamicObjectAlias,
              scope,
              suffixBasePaths,
            )
          : [];
      const parentContextPaths =
        contextPrefixSteps.length > 1
          ? selectAliasSuffixContextPaths(
              contextPrefixSteps.slice(0, -1),
              objectAlias,
              dynamicObjectAlias,
              scope,
              suffixBasePaths,
            )
          : [];
  
      for (const expr of expressions) {
        paths.push(
          ...walkAliasSuffixContextExpression(
            expr,
            contextPaths,
            parentContextPaths,
            scope,
          ),
          ...(collectVariableNames(expr).size > 0
            ? selectAliasExpressionPaths(
                objectAlias,
                dynamicObjectAlias,
                expr,
                scope,
                suffixBasePaths,
                preserveUnmappedLocalPaths,
                true,
              )
            : []),
        );
      }
    }
  
    return paths;
  }

  function walkAliasSuffixFunctionSteps(
    suffixSteps: AstNode[],
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
  ): string[] {
    const paths: string[] = [];
  
    for (const [index, step] of suffixSteps.entries()) {
      if (step.type !== "function") continue;
  
      const contextPrefixSteps = suffixSteps.slice(0, index);
      const contextPaths =
        contextPrefixSteps.length > 0
          ? selectAliasSuffixContextPaths(
              contextPrefixSteps,
              objectAlias,
              dynamicObjectAlias,
              scope,
              suffixBasePaths,
            )
          : [];
      const parentContextPaths =
        contextPrefixSteps.length > 1
          ? selectAliasSuffixContextPaths(
              contextPrefixSteps.slice(0, -1),
              objectAlias,
              dynamicObjectAlias,
              scope,
              suffixBasePaths,
            )
          : [];
  
      paths.push(
        ...walkAliasSuffixContextExpression(
          step,
          contextPaths,
          parentContextPaths,
          scope,
        ),
      );
    }
  
    return paths;
  }

  function walkAliasSuffixContextExpression(
    expr: AstNode,
    contextPaths: readonly string[],
    parentContextPaths: readonly string[],
    scope: ScopeTracker,
  ): string[] {
    const alignedParentContexts =
      parentContextPaths.length === contextPaths.length ? parentContextPaths : null;

    return contextPaths.flatMap((contextPath, index) => {
      const contextScope = bindVariable(
        childScope(createScope()),
        "",
        [contextPath],
      );
      const localPaths = runtime.core.walkNode(expr, contextScope);
      const parentPaths = alignedParentContexts
        ? [alignedParentContexts[index]].filter(Boolean)
        : parentContextPaths;

      return localPaths.flatMap((localPath) => {
        if (
          localPath.startsWith(ROOT_PATH) ||
          localPath === contextPath ||
          localPath.startsWith(`${contextPath}.`)
        ) {
          return [localPath];
        }
        if (!isParentRelativePath(localPath)) {
          return prefixPaths(contextPath, [localPath]);
        }

        if (parentPaths.length === 0) {
          return prefixPaths(contextPath, [localPath]);
        }
  
        const suffix = stripParentRelativePath(localPath);
        return parentPaths.map((parentPath) => appendPath(parentPath, suffix || null));
      });
    });
  }

  function walkAliasSuffixGroupEntries(
    groupNode: GroupByNode,
    groupBasePaths: readonly string[],
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
    preserveUnmappedLocalPaths = false,
  ): string[] {
    const parentGroupBasePaths = groupBasePaths.map(parentPath);
    const contextPaths = groupNode.entries.flatMap(([keyExpr, valExpr]) => [
      ...walkAliasSuffixContextExpression(
        keyExpr,
        groupBasePaths,
        parentGroupBasePaths,
        scope,
      ),
      ...walkAliasSuffixContextExpression(
        valExpr,
        groupBasePaths,
        parentGroupBasePaths,
        scope,
      ),
    ]);
    const aliasPaths = groupNode.entries.flatMap(([keyExpr, valExpr]) => [
      ...(collectVariableNames(keyExpr).size > 0
        ? selectAliasExpressionPaths(
            objectAlias,
            dynamicObjectAlias,
            keyExpr,
            scope,
            suffixBasePaths,
            preserveUnmappedLocalPaths,
            true,
          )
        : []),
      ...(collectVariableNames(valExpr).size > 0
        ? selectAliasExpressionPaths(
            objectAlias,
            dynamicObjectAlias,
            valExpr,
            scope,
            suffixBasePaths,
            preserveUnmappedLocalPaths,
            true,
          )
        : []),
    ]);
  
    return [...contextPaths, ...aliasPaths];
  }

  function dynamicObjectAliasFromObject(
    node: ObjectNode,
    scope: ScopeTracker,
  ): DynamicObjectAlias {
    const variants: Array<DynamicObjectAlias["variants"][number]> = [{ node, scope }];
  
    for (const [keyNode, valueNode] of node.entries) {
      const key = staticObjectKey(keyNode);
      if (!key) continue;
  
      const nestedAlias = dynamicObjectAliasForNode(valueNode, scope);
      if (!nestedAlias) continue;
  
      variants.push(
        ...nestedAlias.variants.map((variant) => ({
          ...variant,
          prefixSteps: [key, ...(variant.prefixSteps ?? [])],
        })),
      );
    }
  
    return { variants };
  }

  function dynamicObjectSource(node: AstNode, scope: ScopeTracker): DynamicObjectAlias | null {
    if (node.type === "object") return dynamicObjectAliasFromObject(node as ObjectNode, scope);
    if (node.type !== "block") return null;
  
    const block = node as BlockNode;
    let currentScope = scope;
  
    for (const [index, expr] of block.expressions.entries()) {
      const isLast = index === block.expressions.length - 1;
      if (isLast) {
        return expr.type === "object"
          ? dynamicObjectAliasFromObject(expr as ObjectNode, currentScope)
          : groupResultDynamicObjectAliasForNode(expr, currentScope);
      }
  
      if (expr.type === "bind") {
        const bindNode = expr as BindNode;
        const closureScope = currentScope;
        currentScope = bindVariable(
          currentScope,
          bindNode.lhs.value,
          bindingAliasPaths(bindNode.rhs, currentScope),
        );
        currentScope = bindSuffixBasePathsIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = bindObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = bindDynamicObjectAliasIfPresent(
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
    }
  
    return null;
  }

  function dynamicObjectAliasForNode(
    node: AstNode,
    scope: ScopeTracker,
  ): DynamicObjectAlias | null {
    const source = dynamicObjectSource(node, scope);
    if (source) return source;
    if (node.type === "variable") {
      return resolveDynamicObjectAlias(scope, (node as VariableNode).value);
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return mergeDynamicObjectAliases([
        groupResultDynamicObjectAliasForNode(condition.then, scope),
        condition.else
          ? groupResultDynamicObjectAliasForNode(condition.else, scope)
          : null,
      ]);
    }
    if (node.type === "array") {
      return mergeDynamicObjectAliases(
        (node as ArrayNode).expressions.map((expr) =>
          groupResultDynamicObjectAliasForNode(expr, scope),
        ),
      );
    }
    if (node.type === "lambda") {
      const lambda = node as LambdaNode;
      return lambda.thunk
        ? groupResultDynamicObjectAliasForNode(lambda.body, scope)
        : null;
    }
    if (node.type === "function") {
      return runtime.results.getFunctionResultDynamicObjectAlias(node as FunctionNode, scope);
    }
    if (node.type === "apply") {
      const func = runtime.functions.appliedFunctionFromApply(node as ApplyNode);
      return func ? runtime.results.getFunctionResultDynamicObjectAlias(func, scope) : null;
    }
    return null;
  }

  function groupResultObjectAliasForNode(
    node: AstNode,
    scope: ScopeTracker,
  ): ObjectAlias | null {
    const group = (node as AstNode & { group?: GroupByNode }).group;
    if (!group) return objectAliasForNode(node, scope);
  
    const contextPaths = runtime.results.getResultBasePathsFromArg(
      { ...node, group: undefined } as AstNode,
      scope,
    );
    const fields = new Map<string, string[]>();
    for (const [keyNode, valueNode] of group.entries) {
      const key = staticObjectKey(keyNode);
      if (!key) continue;
      const aliases = contextPaths.flatMap((contextPath) =>
        runtime.paths.walkContextExpression(valueNode, contextPath, scope),
      );
      if (aliases.length > 0) fields.set(key, aliases);
    }
    return fields.size > 0 ? fields : null;
  }

  function groupResultDynamicObjectAliasForNode(
    node: AstNode,
    scope: ScopeTracker,
  ): DynamicObjectAlias | null {
    const group = (node as AstNode & { group?: GroupByNode }).group;
    if (!group) return dynamicObjectAliasForNode(node, scope);
  
    const groupObject: ObjectNode = {
      type: "object",
      position: group.position ?? 0,
      entries: group.entries,
    };
    return runtime.higherOrder.prefixDynamicObjectAlias(
      dynamicObjectAliasFromObject(groupObject, scope),
      runtime.results.getResultBasePathsFromArg(
        { ...node, group: undefined } as AstNode,
        scope,
      ),
    );
  }

  function groupResultSuffixBasePaths(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] {
    return (node as AstNode & { group?: GroupByNode }).group
      ? []
      : runtime.results.getResultSuffixBasePaths(node, scope);
  }

  function groupResultSuffixableBasePaths(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] {
    return (node as AstNode & { group?: GroupByNode }).group
      ? []
      : runtime.results.getSuffixableResultBasePaths(node, scope);
  }

  function bindObjectAliasIfPresent(
    scope: ScopeTracker,
    name: string,
    node: AstNode,
    aliasScope: ScopeTracker,
  ): ScopeTracker {
    const alias = groupResultObjectAliasForNode(node, aliasScope);
    return alias ? bindObjectAlias(scope, name, alias) : scope;
  }

  function bindDynamicObjectAliasIfPresent(
    scope: ScopeTracker,
    name: string,
    node: AstNode,
    aliasScope: ScopeTracker,
  ): ScopeTracker {
    const alias = groupResultDynamicObjectAliasForNode(node, aliasScope);
    return alias ? bindDynamicObjectAlias(scope, name, alias) : scope;
  }

  function bindFocusObjectAliasScope(
    scope: ScopeTracker,
    name: string,
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    basePaths: readonly string[],
    suffixBasePaths: readonly string[],
  ): ScopeTracker {
    let focusScope = bindVariable(childScope(scope), name, basePaths);
    if (objectAlias) focusScope = bindObjectAlias(focusScope, name, objectAlias);
    if (dynamicObjectAlias) {
      focusScope = bindDynamicObjectAlias(focusScope, name, dynamicObjectAlias);
    }
    const objectAliasBases = new Set(
      objectAlias ? [...objectAlias.values()].flatMap((paths) => [...paths]) : [],
    );
    const pathLikeBases = suffixBasePaths.filter((path) => !objectAliasBases.has(path));
    focusScope = bindSuffixBasePaths(focusScope, name, pathLikeBases);
    return focusScope;
  }

  function bindStepFocusScope(step: AstNode, scope: ScopeTracker): ScopeTracker {
    if (step.type === "apply") {
      const func = runtime.functions.appliedFunctionFromApply(step as ApplyNode);
      return func ? bindStepFocusScope(func, scope) : scope;
    }
  
    if (
      step.type !== "block" &&
      step.type !== "array" &&
      step.type !== "object" &&
      step.type !== "function"
    ) {
      return scope;
    }
  
    const focusStep = step as BlockNode | ArrayNode | ObjectNode | FunctionNode;
    let nextScope = scope;
    if (focusStep.focusBinding) {
      nextScope = bindFocusObjectAliasScope(
        scope,
        focusStep.focusBinding.name,
        objectAliasForNode(focusStep, scope),
        dynamicObjectAliasForNode(focusStep, scope),
        bindingAliasPaths(focusStep, scope),
        runtime.results.getResultSuffixBasePaths(focusStep, scope),
      );
    }
    if (focusStep.indexBinding) {
      if (nextScope === scope) nextScope = childScope(scope);
      nextScope = bindVariable(nextScope, focusStep.indexBinding.name, []);
    }
    return nextScope;
  }

  function bindSuffixBasePathsIfPresent(
    scope: ScopeTracker,
    name: string,
    node: AstNode,
    aliasScope: ScopeTracker,
  ): ScopeTracker {
    const currentPaths = resolveVariable(aliasScope, "");
    const paths =
      currentPaths?.length &&
      node.type === "path" &&
      (node as PathNode).steps[0]?.type === "name"
        ? bindingAliasPaths(node, aliasScope)
        : groupResultSuffixBasePaths(node, aliasScope);
    return bindSuffixBasePaths(scope, name, paths);
  }

  function isResultAliasStep(step: AstNode): boolean {
    return (
      step.type === "block" ||
      step.type === "condition" ||
      step.type === "function" ||
      step.type === "apply" ||
      step.type === "array" ||
      step.type === "object"
    );
  }

  function firstUnboundPathVariableIndex(steps: AstNode[]): number {
    const localVariables = new Set<string>();
  
    for (const [index, step] of steps.entries()) {
      if (step.type === "variable") {
        const name = (step as VariableNode).value;
        if (name !== "" && !localVariables.has(name)) return index;
      }
  
      const bindingStep = step as AstNode & {
        focusBinding?: { name: string };
        indexBinding?: { name: string };
      };
      if (bindingStep.focusBinding) localVariables.add(bindingStep.focusBinding.name);
      if (bindingStep.indexBinding) localVariables.add(bindingStep.indexBinding.name);
    }
  
    return -1;
  }

  function selectResultAliasStepPaths(
    step: AstNode,
    suffixSteps: AstNode[],
    scope: ScopeTracker,
    includeStepReadPaths = true,
    preserveUnmappedLocalPaths = false,
  ): string[] | null {
    const suffixScope = bindStepFocusScope(step, scope);
    const preserveAliasLocalPaths =
      preserveUnmappedLocalPaths ||
      Boolean((step as AstNode & { focusBinding?: unknown }).focusBinding);
    const conditionPaths =
      step.type === "condition"
        ? runtime.core.walkNode((step as ConditionNode).condition, scope)
        : [];
    const stepReadPaths =
      includeStepReadPaths &&
      (step.type === "block" ||
        (step.type === "array" && ((step as ArrayNode).predicate?.length ?? 0) > 0) ||
        (step.type === "object" && ((step as ObjectNode).predicate?.length ?? 0) > 0))
        ? runtime.core.walkNode(step, scope)
        : conditionPaths;
    const resultBasePaths = bindingAliasPaths(step, scope);
    const objectAlias = objectAliasForNode(step, scope);
    const dynamicObject = dynamicObjectAliasForNode(step, scope);
    const aliasPaths = selectVariableObjectAliasPaths(
      objectAlias,
      dynamicObject,
      suffixSteps,
      suffixScope,
      [],
      preserveAliasLocalPaths,
    );
    if (aliasPaths) {
      const suffix = buildPathString(suffixSteps);
      const suffixBasePaths = suffix
        ? runtime.results.getResultSuffixBasePaths(step, scope).map((path) => appendPath(path, suffix))
        : [];
      return [...stepReadPaths, ...resultBasePaths, ...aliasPaths, ...suffixBasePaths];
    }
  
    if (resultBasePaths.length === 0) {
      return stepReadPaths.length > 0 ? stepReadPaths : null;
    }
    const suffix = buildPathString(suffixSteps);
    if (dynamicObject) {
      const suffixBasePaths = suffix
        ? unmatchedAliasSuffixBasePaths(
            objectAlias,
            runtime.results.getResultSuffixBasePaths(step, scope),
          ).map((path) => appendPath(path, suffix))
        : [];
      return [...stepReadPaths, ...resultBasePaths, ...suffixBasePaths];
    }
  
    return [
      ...stepReadPaths,
      ...resultBasePaths,
      ...resultBasePaths.map((path) => appendPath(path, suffix)),
    ];
  }

  function walkResultAliasSuffixStages(
    step: AstNode,
    suffixSteps: AstNode[],
    groupNode: GroupByNode | undefined,
    scope: ScopeTracker,
  ): string[] {
    const objectAlias = objectAliasForNode(step, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(step, scope);
    if (!objectAlias && !dynamicObjectAlias) return [];
    const suffixScope = bindStepFocusScope(step, scope);
  
    const suffixBasePaths = runtime.results.getResultSuffixBasePaths(step, scope);
    const selectedPaths =
      selectVariableObjectAliasPaths(
        objectAlias,
        dynamicObjectAlias,
        suffixSteps,
        suffixScope,
        suffixBasePaths,
      ) ?? [];
    const suffix = buildPathString(suffixSteps);
    const suffixBaseContextPaths =
      suffix && suffixBasePaths.length > 0
        ? suffixBasePaths.map((path) => appendPath(path, suffix))
        : [];
    const suffixBaseRoots = new Set(suffixBasePaths);
    const groupBasePaths = [
      ...selectedPaths.filter((path) => !suffixBaseRoots.has(path)),
      ...suffixBaseContextPaths,
    ];
  
    return [
      ...walkAliasSuffixFilterStages(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        suffixScope,
        suffixBasePaths,
      ),
      ...walkAliasSuffixSortTerms(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        suffixScope,
        suffixBasePaths,
      ),
      ...walkAliasSuffixProjectionSteps(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        suffixScope,
        suffixBasePaths,
      ),
      ...walkAliasSuffixFunctionSteps(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        suffixScope,
        suffixBasePaths,
      ),
      ...(groupNode
        ? walkAliasSuffixGroupEntries(
            groupNode,
            groupBasePaths,
            objectAlias,
            dynamicObjectAlias,
            suffixScope,
            suffixBasePaths,
          )
        : []),
    ];
  }

  function walkResultBaseSuffixStages(
    basePaths: readonly string[],
    suffixSteps: AstNode[],
    groupNode: GroupByNode | undefined,
    scope: ScopeTracker,
  ): string[] {
    const paths = basePaths.flatMap((basePath) => [
      ...runtime.paths.walkResolvedVariableSuffixFilterStages(suffixSteps, basePath, scope, new Set()),
      ...runtime.paths.walkResolvedVariableSuffixSortTerms(suffixSteps, basePath, scope, new Set()),
    ]);
  
    paths.push(...walkResultBaseSuffixProjectionSteps(basePaths, suffixSteps, scope));
    paths.push(...walkResultBaseSuffixFunctionSteps(basePaths, suffixSteps, scope));
  
    if (groupNode) {
      const suffix = buildPathString(suffixSteps) ?? "";
      paths.push(
        ...basePaths.flatMap((basePath) =>
          runtime.paths.walkContextGroupEntries(groupNode, appendPath(basePath, suffix), scope),
        ),
      );
    }
  
    return paths;
  }

  function walkResultBaseSuffixProjectionSteps(
    basePaths: readonly string[],
    suffixSteps: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const paths: string[] = [];
  
    for (const [index, step] of suffixSteps.entries()) {
      const expressions = projectionStepExpressions(step);
      if (!expressions) continue;
  
      const contextPrefixSteps = suffixSteps.slice(0, index);
      const contextSuffix = buildPathString(contextPrefixSteps) ?? "";
      const contextPaths = basePaths.map((basePath) =>
        appendPath(basePath, contextSuffix),
      );
      const parentContextPaths =
        contextPrefixSteps.length > 1
          ? basePaths.map((basePath) =>
              appendPath(
                basePath,
                buildPathString(contextPrefixSteps.slice(0, -1)) ?? "",
              ),
            )
          : [];
  
      for (const expr of expressions) {
        paths.push(
          ...walkAliasSuffixContextExpression(
            expr,
            contextPaths,
            parentContextPaths,
            scope,
          ),
        );
      }
    }
  
    return paths;
  }

  function walkResultBaseSuffixFunctionSteps(
    basePaths: readonly string[],
    suffixSteps: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const paths: string[] = [];
  
    for (const [index, step] of suffixSteps.entries()) {
      if (step.type !== "function") continue;
  
      const contextPrefixSteps = suffixSteps.slice(0, index);
      const contextSuffix = buildPathString(contextPrefixSteps) ?? "";
      const contextPaths = basePaths.map((basePath) =>
        appendPath(basePath, contextSuffix),
      );
      const parentContextPaths =
        contextPrefixSteps.length > 1
          ? basePaths.map((basePath) =>
              appendPath(
                basePath,
                buildPathString(contextPrefixSteps.slice(0, -1)) ?? "",
              ),
            )
          : [];
  
      paths.push(
        ...walkAliasSuffixContextExpression(
          step,
          contextPaths,
          parentContextPaths,
          scope,
        ),
      );
    }
  
    return paths;
  }

  function aliasSuffixStepsFromPath(path: string): AstNode[] | null {
    if (!path || path.startsWith(ROOT_PATH)) return null;
  
    const steps: AstNode[] = [];
    for (const segment of path.split(".")) {
      if (!segment || segment.includes("[") || segment === "**" || segment === "%") {
        return null;
      }
      if (segment === "*") {
        steps.push({ type: "wildcard", value: "*", position: 0 } as WildcardNode);
      } else {
        steps.push({ type: "name", value: segment, position: 0 } as NameNode);
      }
    }
  
    return steps;
  }

  function selectResultAliasExpressionPaths(
    step: AstNode,
    expression: AstNode,
    scope: ScopeTracker,
  ): string[] | null {
    const objectAlias = objectAliasForNode(step, scope);
    const dynamicObject = dynamicObjectAliasForNode(step, scope);
    if (!objectAlias && !dynamicObject) return null;
  
    const paths = [
      ...bindingAliasPaths(step, scope),
      ...selectAliasExpressionPaths(objectAlias, dynamicObject, expression, scope),
    ];
  
    return paths.length > 0 ? paths : null;
  }

  function contextBindingAliasPaths(
    node: AstNode,
    contextPrefix: string,
    scope: ScopeTracker,
  ): string[] {
    return prefixProjectionPaths(contextPrefix, bindingAliasPaths(node, scope));
  }

  function arrayConstructorContextBasePaths(
    node: ArrayNode,
    contextPrefix: string,
    scope: ScopeTracker,
  ): string[] {
    return node.expressions.flatMap((expr) =>
      contextBindingAliasPaths(expr, contextPrefix, scope),
    );
  }

  function objectConstructorContextBasePaths(
    node: ObjectNode,
    contextPrefix: string,
    scope: ScopeTracker,
  ): string[] {
    return node.entries.flatMap(([, value]) =>
      contextBindingAliasPaths(value, contextPrefix, scope),
    );
  }

  function objectConstructorContextAlias(
    node: ObjectNode,
    prefixSteps: AstNode[],
    scope: ScopeTracker,
  ): ObjectAlias | null {
    if (prefixSteps.length === 0) return objectAliasForNode(node, scope);
  
    return objectAliasFromPathProjection({
      type: "path",
      steps: [...prefixSteps, node],
      source: node.source,
    } as PathNode, scope);
  }

  function blockContextBasePaths(
    node: BlockNode,
    contextPrefix: string,
    scope: ScopeTracker,
  ): string[] {
    return prefixProjectionPaths(contextPrefix, bindingAliasPaths(node, scope));
  }

  function pathResultAliasContextBasePaths(
    node: PathNode,
    scope: ScopeTracker,
  ): string[] {
    const resultAliasStepIndex = node.steps.findIndex(isResultAliasStep);
    if (resultAliasStepIndex < 0) return runtime.results.getResultBasePathsFromArg(node, scope);
  
    const resultAliasStep = node.steps[resultAliasStepIndex];
    const contextPrefix = buildPathString(node.steps.slice(0, resultAliasStepIndex)) ?? "";
    const suffixSteps = node.steps.slice(resultAliasStepIndex + 1);
    const suffix = buildPathString(suffixSteps);
    if (
      suffix &&
      resultAliasStep.type === "function" &&
      runtime.transforms.transformWritesSuffix(resultAliasStep as FunctionNode, suffixSteps, scope)
    ) {
      return [];
    }
    const withContext = (paths: string[]) =>
      prefixProjectionPaths(
        contextPrefix,
        suffix ? paths.map((path) => appendPath(path, suffix)) : paths,
      );
  
    const objectAlias = objectAliasForNode(resultAliasStep, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(resultAliasStep, scope);
    if (suffixSteps.length > 0 && (objectAlias || dynamicObjectAlias)) {
      const aliasPaths = selectAliasSuffixContextPaths(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        bindStepFocusScope(resultAliasStep, scope),
        runtime.results.getResultSuffixBasePaths(resultAliasStep, scope),
      );
      if (aliasPaths.length > 0) return prefixProjectionPaths(contextPrefix, aliasPaths);
    }
  
    if (resultAliasStep.type === "array") {
      return withContext(
        arrayConstructorContextBasePaths(resultAliasStep as ArrayNode, "", scope),
      );
    }
    if (resultAliasStep.type === "object") {
      return [];
    }
    if (resultAliasStep.type === "block") {
      return withContext(blockContextBasePaths(resultAliasStep as BlockNode, "", scope));
    }
  
    const resultBasePaths = suffix
      ? runtime.results.getResultSuffixBasePaths(resultAliasStep, scope)
      : bindingAliasPaths(resultAliasStep, scope);
    return resultBasePaths.length > 0 ? withContext(resultBasePaths) : [];
  }

  function hasResultAliasObjectSuffixSelection(
    node: PathNode,
    scope: ScopeTracker,
  ): boolean {
    const resultAliasStepIndex = node.steps.findIndex(isResultAliasStep);
    if (resultAliasStepIndex < 0 || resultAliasStepIndex >= node.steps.length - 1) {
      return false;
    }
    if (hasVariableBeforeResultAlias(node, resultAliasStepIndex)) return false;
  
    const resultAliasStep = node.steps[resultAliasStepIndex];
    const objectAlias = objectAliasForNode(resultAliasStep, scope);
    if (!objectAlias) return false;
  
    return (
      selectAliasSuffixContextPaths(
        node.steps.slice(resultAliasStepIndex + 1),
        objectAlias,
        dynamicObjectAliasForNode(resultAliasStep, scope),
        bindStepFocusScope(resultAliasStep, scope),
        runtime.results.getResultSuffixBasePaths(resultAliasStep, scope),
      ).length > 0
    );
  }

  function hasVariableBeforeResultAlias(
    node: PathNode,
    resultAliasStepIndex = node.steps.findIndex(isResultAliasStep),
  ): boolean {
    return (
      resultAliasStepIndex > 0 &&
      node.steps
        .slice(0, resultAliasStepIndex)
        .some((step) => step.type === "variable")
    );
  }

  function prefixObjectAlias(
    alias: ObjectAlias | null,
    contextPrefix: string,
  ): ObjectAlias | null {
    if (!alias || !contextPrefix) return alias;
  
    const fields = new Map<string, string[]>();
    for (const [key, paths] of alias) {
      fields.set(key, prefixProjectionPaths(contextPrefix, [...paths]));
    }
    return fields;
  }

  function unmatchedAliasSuffixBasePaths(
    objectAlias: ObjectAlias | null,
    suffixBasePaths: readonly string[],
  ): string[] {
    if (!objectAlias || suffixBasePaths.length === 0) return [...suffixBasePaths];
  
    const aliasValueRoots = new Set(
      [...objectAlias.values()].flatMap((paths) => [...paths]),
    );
    return suffixBasePaths.filter((path) => !aliasValueRoots.has(path));
  }

  function selectResultAliasProjectionStepPaths(
    step: AstNode,
    projectionStep: AstNode,
    scope: ScopeTracker,
    preserveUnmappedLocalPaths = false,
  ): string[] | null {
    const objectAlias = objectAliasForNode(step, scope);
    const dynamicObject = dynamicObjectAliasForNode(step, scope);
    if (!objectAlias && !dynamicObject) return null;
  
    const projectionPaths = selectAliasProjectionStepPaths(
      objectAlias,
      dynamicObject,
      projectionStep,
      scope,
      preserveUnmappedLocalPaths,
    );
    return projectionPaths
      ? [...bindingAliasPaths(step, scope), ...projectionPaths]
      : null;
  }

  function projectionStepExpressions(step: AstNode): AstNode[] | null {
    if (step.type === "block") return (step as BlockNode).expressions;
    if (step.type === "array") return (step as ArrayNode).expressions;
    if (step.type === "object") {
      return (step as ObjectNode).entries.flatMap(([key, value]) => [key, value]);
    }
    return null;
  }

  function selectAliasProjectionStepPaths(
    objectAlias: ObjectAlias | null,
    dynamicObject: DynamicObjectAlias | null,
    step: AstNode | undefined,
    scope: ScopeTracker,
    preserveUnmappedLocalPaths = false,
  ): string[] | null {
    if (!step) return null;
  
    const expressions = projectionStepExpressions(step);
    if (!expressions) return null;
  
    const paths = expressions.flatMap((expr) =>
      selectAliasExpressionPaths(
        objectAlias,
        dynamicObject,
        expr,
        scope,
        [],
        preserveUnmappedLocalPaths,
      ),
    );
    return paths.length > 0 ? paths : null;
  }

  function selectAliasExpressionPaths(
    objectAlias: ObjectAlias | null,
    dynamicObject: DynamicObjectAlias | null,
    expression: AstNode,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
    preserveUnmappedLocalPaths = false,
    skipLocalPaths = false,
  ): string[] {
    const paths: string[] = [];
    let localPaths = localPathSetCache.get(expression);
    if (!localPaths) {
      localPaths = new Set(runtime.core.walkNode(expression, localAnalysisScope));
      localPathSetCache.set(expression, localPaths);
    }
    const localAliasPaths = skipLocalPaths
      ? new Set(
          [...localPaths].flatMap((path) => {
            const suffixSteps = aliasSuffixStepsFromPath(path);
            return suffixSteps
              ? selectAliasSuffixPaths(
                  objectAlias,
                  dynamicObject,
                  suffixSteps,
                  suffixBasePaths,
                )
              : [];
          }),
        )
      : new Set<string>();
  
    for (const path of runtime.core.walkNode(expression, scope)) {
      if (path.startsWith(ROOT_PATH) || !localPaths.has(path)) {
        if (skipLocalPaths && localAliasPaths.has(path)) continue;
        paths.push(path);
        continue;
      }
  
      if (skipLocalPaths) continue;
  
      if (preserveUnmappedLocalPaths) {
        paths.push(path);
        continue;
      }
  
      const suffixSteps = aliasSuffixStepsFromPath(path);
      if (!suffixSteps) {
        paths.push(path);
        continue;
      }
  
      const aliasPaths = selectAliasSuffixPaths(
        objectAlias,
        dynamicObject,
        suffixSteps,
        suffixBasePaths,
      );
      paths.push(
        ...(aliasPaths.length > 0 || !preserveUnmappedLocalPaths ? aliasPaths : [path]),
      );
    }
  
    return paths;
  }

  function selectAliasSuffixPaths(
    objectAlias: ObjectAlias | null,
    dynamicObject: DynamicObjectAlias | null,
    suffixSteps: AstNode[],
    suffixBasePaths: readonly string[],
  ): string[] {
    const suffix = buildPathString(suffixSteps);
    return [
      ...(objectAlias ? (selectObjectAliasPaths(objectAlias, suffixSteps) ?? []) : []),
      ...(dynamicObject ? selectDynamicObjectAliasPaths(dynamicObject, suffixSteps) : []),
      ...(suffix ? suffixBasePaths.map((path) => appendPath(path, suffix)) : []),
    ];
  }

  function bindingAliasPathsFromBlock(node: BlockNode, scope: ScopeTracker): string[] {
    let currentScope = scope;
    let result: string[] = [];
  
    for (const expr of node.expressions) {
      if (expr.type === "bind") {
        const bindNode = expr as BindNode;
        const closureScope = currentScope;
        result = bindingAliasPaths(bindNode.rhs, currentScope);
        currentScope = bindVariable(currentScope, bindNode.lhs.value, result);
        currentScope = bindSuffixBasePathsIfPresent(
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
        result = bindingAliasPathsFromBlock(expr as BlockNode, childScope(currentScope));
      } else {
        result = bindingAliasPaths(expr, currentScope);
      }
    }
  
    return result;
  }

  return {
    bindingAliasPaths,
    staticObjectKey,
    objectAliasFromObject,
    mergeObjectAliases,
    objectAliasForNode,
    objectAliasFromBlock,
    selectObjectAliasPaths,
    mergeDynamicObjectAliases,
    selectLookupDynamicObjectAliasPaths,
    selectLookupDynamicObjectResultAlias,
    selectLookupDynamicObjectResultObjectAlias,
    selectVariableObjectAliasPaths,
    selectAliasSuffixContextPaths,
    walkAliasSuffixFilterStages,
    walkAliasSuffixSortTerms,
    walkAliasSuffixProjectionSteps,
    walkAliasSuffixFunctionSteps,
    walkAliasSuffixGroupEntries,
    dynamicObjectAliasForNode,
    groupResultObjectAliasForNode,
    groupResultDynamicObjectAliasForNode,
    groupResultSuffixBasePaths,
    groupResultSuffixableBasePaths,
    bindObjectAliasIfPresent,
    bindDynamicObjectAliasIfPresent,
    bindFocusObjectAliasScope,
    bindStepFocusScope,
    bindSuffixBasePathsIfPresent,
    isResultAliasStep,
    firstUnboundPathVariableIndex,
    selectResultAliasStepPaths,
    walkResultAliasSuffixStages,
    walkResultBaseSuffixStages,
    walkResultBaseSuffixProjectionSteps,
    walkResultBaseSuffixFunctionSteps,
    selectResultAliasExpressionPaths,
    arrayConstructorContextBasePaths,
    objectConstructorContextBasePaths,
    objectConstructorContextAlias,
    blockContextBasePaths,
    pathResultAliasContextBasePaths,
    hasResultAliasObjectSuffixSelection,
    hasVariableBeforeResultAlias,
    prefixObjectAlias,
    unmatchedAliasSuffixBasePaths,
    selectResultAliasProjectionStepPaths,
    projectionStepExpressions,
    selectAliasExpressionPaths,
    bindingAliasPathsFromBlock,
  };
}
