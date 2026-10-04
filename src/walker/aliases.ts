import type { ArrayNode, AstNode, ApplyNode, BindNode, BlockNode, ConditionNode, FilterStage, FunctionNode, GroupByNode, LambdaNode, NameNode, ObjectNode, PathNode, PositionBindingNode, SortNode, VariableNode, WildcardNode } from "../types.js";
import { buildPathString } from "../path-builder.js";
import { type ScopeTracker, createScope, childScope, bindVariable, bindSuffixBasePaths, bindObjectAlias, bindDynamicObjectAlias, resolveVariable, resolveSuffixBasePaths, resolveObjectAlias, resolveDynamicObjectAlias, type DynamicObjectAlias, type ObjectAlias } from "../scope.js";
import { ROOT_PATH } from "./constants.js";
import { prefixPaths, prefixProjectionPaths, appendPath, markAbsolute, parentPath, isParentRelativePath, stripParentRelativePath, collectVariableNames, isNumericIndex, buildProjectionContextPath, hasPendingProjectionFocusReset, isTransparentPathBlock } from "./path-utils.js";
import type { AliasOperations, WalkerRuntime } from "./runtime.js";
import { createSelectionOperations } from "./selection.js";

const LOCAL_CONTEXT = "\u0001context";
type SelectedAliasContext = {
  objectAlias: ObjectAlias | null;
  dynamicObjectAlias: DynamicObjectAlias | null;
  suffixBasePaths: string[];
};

export function createAliasOperations(runtime: WalkerRuntime): AliasOperations {
  const selection = createSelectionOperations(runtime);
  function bindingAliasPaths(node: AstNode, scope: ScopeTracker): string[] {
    if ((node as AstNode & { group?: GroupByNode }).group) {
      return selection.getSelectedResultPaths(node, scope);
    }
    if ((node.type === "name" || node.type === "path" &&
        (node as PathNode).steps.every((step) =>
          ["name", "variable", "wildcard", "descendant", "parent"].includes(step.type),
        )) && resolveVariable(scope, "") !== null &&
        (resolveObjectAlias(scope, "") || resolveDynamicObjectAlias(scope, ""))) {
      return selection.getSelectedResultPaths(node, scope);
    }
    const identityPaths = runtime.functions.identityReferencePaths(node, scope);
    if (identityPaths) return identityPaths;
  
    switch (node.type) {
      case "bind":
        return bindingAliasPaths((node as BindNode).rhs, scope);
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

  // Alias map separators represent nested fields, so literal dots must not
  // collide with them. Escape percent first to keep encoded-looking keys distinct.
  function aliasKeySegment(key: string): string {
    return key.replaceAll("%", "%25").replaceAll(".", "%2E");
  }

  function objectAliasFromObject(node: ObjectNode, scope: ScopeTracker): ObjectAlias | null {
    const fields = new Map<string, readonly string[]>();
  
    for (const [keyNode, valueNode] of node.entries) {
      const field = staticObjectKey(keyNode);
      if (field === null) continue;
      const key = aliasKeySegment(field);
  
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
    const selected = selectedPathAliasContext(node, scope);
    if (selected) return selected.objectAlias;
    const chained = chainedPathContext(node, scope);
    if (chained) {
      return groupResultObjectAliasForNode(
        chained.tail.steps.length === 1 && !chained.tail.group
          ? chained.tail.steps[0] : chained.tail,
        chained.scope,
      );
    }
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
      const field = staticObjectKey(keyNode);
      if (field === null) continue;
      const key = aliasKeySegment(field);
  
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
    if (node.type === "bind") return groupResultObjectAliasForNode((node as BindNode).rhs, scope);
    if (node.type === "object") return objectAliasFromObject(node as ObjectNode, scope);
    if (node.type === "path") {
      const method = runtime.callables.resolveStoredMethodPath(node as PathNode, scope);
      return method ? objectAliasForNode(method.node, method.scope)
        : objectAliasFromPathProjection(node as PathNode, scope);
    }
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
      const expressionScope = currentScope;
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
        currentScope = runtime.functions.bindCallableValue(
          currentScope, bindNode.lhs.value, bindNode.rhs, closureScope,
        );
        result = groupResultObjectAliasForNode(bindNode.rhs, closureScope);
      } else {
        result = groupResultObjectAliasForNode(expr, currentScope);
      }
      currentScope = runtime.core.bindArrayAssignmentEffects(expr, currentScope, expressionScope);
    }
  
    return result;
  }

  function selectObjectAliasPaths(
    alias: ObjectAlias,
    suffixSteps: AstNode[],
  ): string[] | null {
    const [selector] = suffixSteps;
    if (!selector) return [...alias.values()].flatMap((paths) => [...paths]);
  
    if (selector.type === "name") {
      const keyParts: string[] = [];
      let best: { paths: readonly string[]; consumed: number } | null = null;
  
      for (const [index, step] of suffixSteps.entries()) {
        if (step.type !== "name") break;
  
        keyParts.push(aliasKeySegment((step as NameNode).value));
        const paths = alias.get(keyParts.join("."));
        if (paths) best = { paths, consumed: index + 1 };
      }
  
      const wildcardStep = suffixSteps[keyParts.length];
      if (!best && wildcardStep?.type === "wildcard") {
        return selectWildcardObjectAliasPaths(alias, suffixSteps);
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
      return selectWildcardObjectAliasPaths(alias, suffixSteps);
    }
    return null;
  }

  function selectWildcardObjectAliasPaths(alias: ObjectAlias, suffixSteps: AstNode[]): string[] | null {
    const steps = suffixSteps.filter((step, index) => step.type !== "variable" ||
      (suffixSteps[index - 1] as AstNode & { focusBinding?: { name: string } })?.focusBinding?.name !==
        (step as VariableNode).value);
    const paths: string[] = [];
    for (const [key, sources] of alias) {
      const fields = key.split(".");
      let consumed = 0;
      while (consumed < fields.length && consumed < steps.length) {
        const step = steps[consumed];
        if (step.type === "wildcard" || step.type === "name" &&
            aliasKeySegment((step as NameNode).value) === fields[consumed]) {
          consumed++;
        } else {
          break;
        }
      }
      // A remaining virtual field must match before following its input origin.
      if (consumed < fields.length && consumed < steps.length) continue;
      const suffix = buildPathString(steps.slice(consumed));
      paths.push(...sources.map((source) => appendPath(source, suffix)));
    }
    return paths.length ? paths : null;
  }

  function selectedPathAliasContext(node: PathNode, scope: ScopeTracker): SelectedAliasContext | null {
    const leadingArray = node.steps[0] as ArrayNode;
    if (leadingArray?.type === "array" && leadingArray.initialPathPredicate && node.steps.length > 1) {
      const chained = chainedPathContext(node, scope);
      if (chained) {
        const result = chained.tail.steps.length === 1 && !chained.tail.group ? chained.tail.steps[0] : chained.tail;
        return {
          objectAlias: groupResultObjectAliasForNode(result, chained.scope),
          dynamicObjectAlias: groupResultDynamicObjectAliasForNode(result, chained.scope),
          suffixBasePaths: groupResultSuffixBasePaths(result, chained.scope),
        };
      }
    }
    const focusIndex = node.steps.findIndex((step, index) => {
      const focused = step as NameNode & { predicate?: AstNode[] };
      // First-step predicates without an index run before the focus is bound.
      return Boolean(focused.focusBinding) && (index > 0 || step.type !== "variable" &&
        (!focused.predicate?.length || focused.indexBinding ||
          focused.predicate.some((stage) => stage.type === "position-binding")));
    });
    if (focusIndex >= 0) {
      const focusStep = node.steps[focusIndex] as NameNode;
      const prefixSteps = [
        ...node.steps.slice(0, focusIndex),
        { ...focusStep, focusBinding: undefined, indexBinding: undefined } as AstNode,
      ];
      const selected = focusIndex === 0 ? {
        objectAlias: groupResultObjectAliasForNode(prefixSteps[0], scope),
        dynamicObjectAlias: groupResultDynamicObjectAliasForNode(prefixSteps[0], scope),
        suffixBasePaths: groupResultSuffixBasePaths(prefixSteps[0], scope),
      } : selectedPathAliasContext({ type: "path", steps: prefixSteps }, scope);
      if (selected?.objectAlias || selected?.dynamicObjectAlias) {
        const parent: AstNode = focusIndex === 0 ? { type: "variable", value: "", position: 0 }
          : focusIndex === 1 ? node.steps[0]
          : { type: "path", steps: node.steps.slice(0, focusIndex) };
        if (focusIndex === node.steps.length - 1) {
          return {
            objectAlias: groupResultObjectAliasForNode(parent, scope),
            dynamicObjectAlias: groupResultDynamicObjectAliasForNode(parent, scope),
            suffixBasePaths: groupResultSuffixBasePaths(parent, scope),
          };
        }
        let focusScope = bindFocusObjectAliasScope(
          scope, focusStep.focusBinding!.name, selected.objectAlias, selected.dynamicObjectAlias,
          [], selected.suffixBasePaths,
        );
        if (focusStep.indexBinding) focusScope = bindVariable(focusScope, focusStep.indexBinding.name, []);
        const stagedFocus = focusStep as NameNode & { predicate?: AstNode[] };
        for (const stage of stagedFocus.stages ?? stagedFocus.predicate ?? []) {
          if (stage.type === "position-binding") focusScope = bindVariable(focusScope, (stage as PositionBindingNode).name, []);
        }
        let contextScope = runtime.higherOrder.bindArgumentParameter(
          childScope(focusScope), { type: "variable", value: "", position: 0 },
          bindingAliasPaths(parent, scope), parent, scope,
        );
        const tailSteps = node.steps.slice(focusIndex + 1);
        for (const step of tailSteps) {
          if (step.type !== "sort") break;
          const sort = step as SortNode;
          for (const stage of sort.predicate ?? []) {
            if (stage.type === "position-binding") contextScope = bindVariable(contextScope, (stage as PositionBindingNode).name, []);
          }
        }
        const selectors = tailSteps.filter((step) => step.type !== "sort");
        if (!selectors.length) return {
          objectAlias: resolveObjectAlias(contextScope, ""),
          dynamicObjectAlias: resolveDynamicObjectAlias(contextScope, ""),
          suffixBasePaths: [...(resolveSuffixBasePaths(contextScope, "") ?? [])],
        };
        const tail = (runtime.functions.explicitContextExpression(
          { type: "path", steps: selectors }, "",
        ) as PathNode).steps;
        if (tail.length === 1) return {
          objectAlias: groupResultObjectAliasForNode(tail[0], contextScope),
          dynamicObjectAlias: groupResultDynamicObjectAliasForNode(tail[0], contextScope),
          suffixBasePaths: groupResultSuffixBasePaths(tail[0], contextScope),
        };
        const tailNode: PathNode = { ...node, steps: tail };
        const chained = chainedPathContext(tailNode, contextScope);
        if (chained) {
          const result = chained.tail.steps.length === 1 && !chained.tail.group
            ? chained.tail.steps[0] : chained.tail;
          return {
            objectAlias: groupResultObjectAliasForNode(result, chained.scope),
            dynamicObjectAlias: groupResultDynamicObjectAliasForNode(result, chained.scope),
            suffixBasePaths: groupResultSuffixBasePaths(result, chained.scope),
          };
        }
        return selectedPathAliasContext(tailNode, contextScope) ?? {
          objectAlias: groupResultObjectAliasForNode(tailNode, contextScope),
          dynamicObjectAlias: groupResultDynamicObjectAliasForNode(tailNode, contextScope),
          suffixBasePaths: groupResultSuffixBasePaths(tailNode, contextScope),
        };
      }
    }
    const [first, ...selectors] = node.steps.filter((step) => step.type !== "sort");
    if (!first || first.type === "name" || !selectors.length ||
        !selectors.every((step) => step.type === "name" || step.type === "wildcard")) return null;
    const name = first.type === "variable" ? (first as VariableNode).value : null;
    const alias = name !== null ? resolveObjectAlias(scope, name) : groupResultObjectAliasForNode(first, scope);
    const dynamic = name !== null ? resolveDynamicObjectAlias(scope, name) : groupResultDynamicObjectAliasForNode(first, scope);
    return alias || dynamic
      ? selectedAliasContext(alias, dynamic, selectors, name !== null
          ? resolveSuffixBasePaths(scope, name) ?? [] : groupResultSuffixBasePaths(first, scope)) : null;
  }

  function selectedAliasContext(
    alias: ObjectAlias | null,
    dynamic: DynamicObjectAlias | null,
    selectors: AstNode[],
    sourceBases: readonly string[],
  ): SelectedAliasContext {
    if (!selectors.length) return { objectAlias: alias, dynamicObjectAlias: dynamic, suffixBasePaths: [...sourceBases] };
    const fields = new Map<string, string[]>();
    const suffixBasePaths = sourceBases.map((source) => appendPath(source, buildPathString(selectors)));
    for (const [key, sources] of alias ?? []) {
      const keys = key.split(".");
      let consumed = 0;
      while (consumed < keys.length && consumed < selectors.length &&
          (selectors[consumed].type === "wildcard" ||
           aliasKeySegment((selectors[consumed] as NameNode).value) === keys[consumed])) consumed++;
      if (consumed < keys.length && consumed < selectors.length) continue;
      if (consumed < keys.length) {
        const remaining = keys.slice(consumed).join(".");
        fields.set(remaining, [...(fields.get(remaining) ?? []), ...sources]);
      } else {
        suffixBasePaths.push(...sources.map((source) => appendPath(source, buildPathString(selectors.slice(consumed)))));
      }
    }
    const aliases: Array<ObjectAlias | null> = [fields.size ? fields : null];
    const variants: Array<DynamicObjectAlias["variants"][number]> = [];
    for (const variant of dynamic?.variants ?? []) {
      const prefixes = variant.prefixSteps ?? [];
      if (prefixes.length >= selectors.length && selectors.every((step, index) =>
          step.type === "wildcard" || (step as NameNode).value === prefixes[index])) {
        variants.push({ ...variant, prefixSteps: prefixes.slice(selectors.length) });
        continue;
      }
      const relative = dynamicVariantSuffixSteps(variant, selectors);
      if (!relative?.length) continue;
      for (const [key, value] of variant.node.entries) {
        if (staticObjectKey(key) !== null) continue;
        const objectAlias = groupResultObjectAliasForNode(value, variant.scope);
        const dynamicAlias = groupResultDynamicObjectAliasForNode(value, variant.scope);
        const selectedField = value.type === "name" || value.type === "path" &&
          (value as PathNode).steps.every((step) => ["name", "variable", "wildcard", "descendant", "parent"].includes(step.type));
        const valueBases = !objectAlias && !dynamicAlias && selectedField
          ? bindingAliasPaths(value, variant.scope) : groupResultSuffixBasePaths(value, variant.scope);
        const selected = selectedAliasContext(
          objectAlias ? runtime.higherOrder.resolveDynamicVariantObjectAlias(objectAlias, variant) : null,
          dynamicAlias ? runtime.higherOrder.resolveDynamicVariantDynamicObjectAlias(dynamicAlias, variant) : null,
          relative.slice(1),
          runtime.higherOrder.resolveDynamicVariantPaths(valueBases, variant),
        );
        aliases.push(selected.objectAlias);
        variants.push(...(selected.dynamicObjectAlias?.variants ?? []));
        suffixBasePaths.push(...selected.suffixBasePaths);
      }
    }
    return {
      objectAlias: mergeObjectAliases(aliases),
      dynamicObjectAlias: variants.length ? { variants } : null,
      suffixBasePaths,
    };
  }

  function aliasSuffixContextScope(
    selectors: AstNode[],
    objectAlias: ObjectAlias | null,
    dynamicObject: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[],
  ): ScopeTracker | null {
    if ((!objectAlias && !dynamicObject) || !selectors.length) return null;
    const contextName = "\u0000alias-stage";
    const sourceScope = bindFocusObjectAliasScope(
      scope, contextName, objectAlias, dynamicObject, [], suffixBasePaths,
    );
    const source: PathNode = {
      type: "path", steps: [{ type: "variable", value: contextName, position: 0 }, ...selectors],
    };
    const selected = selectedPathAliasContext(source, sourceScope);
    if (!selected || !selected.objectAlias && !selected.dynamicObjectAlias) return null;
    return bindFocusObjectAliasScope(
      scope, "", selected.objectAlias, selected.dynamicObjectAlias,
      selectAliasSuffixContextPaths(selectors, objectAlias, dynamicObject, scope, suffixBasePaths),
      selected.suffixBasePaths,
    );
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
      if (staticObjectKey(keyNode) !== null) continue;
  
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
        if (staticObjectKey(keyNode) !== null) continue;
  
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
          key === null ||
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
            key === null ||
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
          ? projectionStepExpressions(selector)!.flatMap((expr) =>
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
    const suffixBaseContextPaths =
      suffix && suffixBasePaths.length > 0
        ? suffixBasePaths.map((path) => appendPath(path, suffix))
        : [];
    const suffixBaseRoots = new Set(suffixBasePaths);
    return [
      ...aliasPaths.filter((path) => !suffixBaseRoots.has(path)),
      ...suffixBaseContextPaths,
    ];
  }

  function walkAliasFilterStages(
    stages: AstNode[],
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
  ): string[] {
    const paths: string[] = [];
    let stageScope = scope;
    for (const stage of stages) {
      if (stage.type === "position-binding") {
        stageScope = bindVariable(stageScope, (stage as PositionBindingNode).name, []);
      } else if (stage.type === "filter") {
        paths.push(...selectAliasExpressionPaths(
          objectAlias, dynamicObjectAlias,
          runtime.functions.asBooleanExpression((stage as unknown as FilterStage).expr), stageScope, suffixBasePaths,
        ));
      }
    }
    return paths;
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
      if (step.type !== "name" && step.type !== "wildcard") continue;
  
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
      let predicateScope = nameStep.indexBinding
        ? bindVariable(childScope(scope), nameStep.indexBinding.name, []) : scope;
      let selectedScope = aliasSuffixContextScope(
        suffixSteps.slice(0, index + 1), objectAlias, dynamicObjectAlias, predicateScope, suffixBasePaths,
      );
      const stages = step.type === "wildcard" ? (step as WildcardNode).predicate : nameStep.stages;
      for (const stage of stages ?? []) {
        if (stage.type === "position-binding") {
          const name = (stage as PositionBindingNode).name;
          predicateScope = bindVariable(predicateScope, name, []);
          if (selectedScope) selectedScope = bindVariable(selectedScope, name, []);
          continue;
        }
        if (stage.type !== "filter") continue;
  
        const filterStage = stage as unknown as FilterStage;
        if (isNumericIndex(filterStage.expr)) continue;
        const predicate = runtime.functions.asBooleanExpression(filterStage.expr);
        if (selectedScope) {
          paths.push(...selectAliasExpressionPaths(
            resolveObjectAlias(selectedScope, ""), resolveDynamicObjectAlias(selectedScope, ""),
            predicate, selectedScope, resolveSuffixBasePaths(selectedScope, "") ?? [],
          ));
          continue;
        }
  
        paths.push(
          ...walkAliasSuffixContextExpression(
            predicate,
            contextPaths,
            parentContextPaths,
            predicateScope,
          ),
          ...(collectVariableNames(filterStage.expr).size > 0
            ? selectAliasExpressionPaths(
                objectAlias,
                dynamicObjectAlias,
                predicate,
                bindObjectAlias(bindVariable(childScope(predicateScope), "", []), "", new Map()),
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
      const selectedScope = aliasSuffixContextScope(
        contextPrefixSteps, objectAlias, dynamicObjectAlias, scope, suffixBasePaths,
      );
      if (selectedScope) {
        paths.push(...selectSortAliasPaths(
          step as SortNode, resolveObjectAlias(selectedScope, ""),
          resolveDynamicObjectAlias(selectedScope, ""), selectedScope,
          resolveSuffixBasePaths(selectedScope, "") ?? [],
        ));
        continue;
      }
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
    const localPaths = runtime.core.walkNode(
      expr, bindVariable(childScope(createScope()), "", [LOCAL_CONTEXT]),
    );
    const alignedParentContexts =
      parentContextPaths.length === contextPaths.length ? parentContextPaths : null;
  
    return contextPaths.flatMap((contextPath, index) => {
      const parentPaths = alignedParentContexts
        ? [alignedParentContexts[index]].filter(Boolean)
        : parentContextPaths;
  
      return localPaths.flatMap((rawPath) => {
        const path = rawPath.startsWith(`${ROOT_PATH}.${LOCAL_CONTEXT}`)
          ? rawPath.slice(ROOT_PATH.length + 1) : rawPath;
        if (path === LOCAL_CONTEXT) return [contextPath];
        if (path.startsWith(`${LOCAL_CONTEXT}[*]`)) {
          return [`${contextPath}${path.slice(LOCAL_CONTEXT.length)}`];
        }
        const localPath = path.startsWith(`${LOCAL_CONTEXT}.`)
          ? path.slice(LOCAL_CONTEXT.length + 1) : path;
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
      if (key === null) continue;
  
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
      const expressionScope = currentScope;
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
      currentScope = runtime.core.bindArrayAssignmentEffects(expr, currentScope, expressionScope);
    }
  
    return null;
  }

  function dynamicObjectAliasForNode(
    node: AstNode,
    scope: ScopeTracker,
  ): DynamicObjectAlias | null {
    if (node.type === "bind") return groupResultDynamicObjectAliasForNode((node as BindNode).rhs, scope);
    if (node.type === "path") {
      const method = runtime.callables.resolveStoredMethodPath(node as PathNode, scope);
      if (method) return dynamicObjectAliasForNode(method.node, method.scope);
      const path = node as PathNode;
      const selected = selectedPathAliasContext(path, scope);
      if (selected) return selected.dynamicObjectAlias;
      const chained = chainedPathContext(node as PathNode, scope);
      if (chained) {
        return groupResultDynamicObjectAliasForNode(
          chained.tail.steps.length === 1 && !chained.tail.group
            ? chained.tail.steps[0] : chained.tail,
          chained.scope,
        );
      }
    }
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
  
    const groupScope = groupResultScope(node, scope);
    const fields = new Map<string, string[]>();
    for (const [keyNode, valueNode] of group.entries) {
      const field = staticObjectKey(keyNode);
      if (field === null) continue;
      const key = aliasKeySegment(field);
      const nestedAlias = groupResultObjectAliasForNode(valueNode, groupScope);
      const dynamicAlias = groupResultDynamicObjectAliasForNode(valueNode, groupScope);
      const aliases = nestedAlias || dynamicAlias
        ? groupResultSuffixBasePaths(valueNode, groupScope)
        : selection.getSelectedResultPaths(valueNode, groupScope);
      if (aliases.length > 0) fields.set(key, aliases);
      if (nestedAlias) {
        for (const [nestedKey, nestedPaths] of nestedAlias) {
          fields.set(`${key}.${nestedKey}`, [...nestedPaths]);
        }
      }
    }
    return fields.size > 0 ? fields : null;
  }

  function groupResultScope(node: AstNode, scope: ScopeTracker): ScopeTracker {
    const source = { ...node, group: undefined } as AstNode;
    const steps = source.type === "path" ? (source as PathNode).steps : [source];
    const prefixNode = (prefix: AstNode[]): AstNode => prefix.length === 1
      ? prefix[0]
      : { type: "path", steps: prefix } as PathNode;
    let groupScope = childScope(scope);
    let usesTupleStream = false;
    let hasTupleBindings = false;
    let terminalTupleSort = false;
    const tupleNames = new Set<string>();
    for (const [index, step] of steps.entries()) {
      const bindingStep = step as AstNode & {
        focusBinding?: { name: string };
        indexBinding?: { name: string };
        tuple?: boolean;
      };
      const stagedStep = step as NameNode & { predicate?: AstNode[] };
      const stages = stagedStep.stages ?? stagedStep.predicate ?? [];
      terminalTupleSort = step.type === "sort" && hasTupleBindings;
      usesTupleStream ||= Boolean(bindingStep.tuple || bindingStep.focusBinding || bindingStep.indexBinding ||
        stages.some((stage) => stage.type === "position-binding"));
      if (source.type === "path" && index === 0 && step.type === "array" &&
        (step as ArrayNode).initialPathPredicate) continue;
      if (bindingStep.focusBinding) {
        tupleNames.add(bindingStep.focusBinding.name);
        const focused = prefixNode([
          ...steps.slice(0, index),
          { ...step, focusBinding: undefined, indexBinding: undefined } as AstNode,
        ]);
        groupScope = runtime.higherOrder.bindArgumentParameter(
          groupScope,
          { type: "variable", value: bindingStep.focusBinding.name, position: 0 },
          bindingAliasPaths(focused, groupScope),
          focused,
          groupScope,
        );
      }
      // Sorting existing tuples retains their bindings; only the sort that
      // starts the tuple stream assigns its direct positional variable.
      if (bindingStep.indexBinding && !(step.type === "sort" && hasTupleBindings)) {
        tupleNames.add(bindingStep.indexBinding.name);
        groupScope = bindVariable(groupScope, bindingStep.indexBinding.name, []);
      }
      for (const stage of stages) {
        if (stage.type === "position-binding") {
          const name = (stage as PositionBindingNode).name;
          tupleNames.add(name);
          groupScope = bindVariable(groupScope, name, []);
        }
      }
      hasTupleBindings ||= usesTupleStream;
    }
    const withOuterTupleOrigins = (resultScope: ScopeTracker): ScopeTracker => {
      if (!terminalTupleSort) return resultScope;
      // JSONata's sort retains the tuple-stream flag for singletons but drops
      // it for larger streams. Group entries can therefore use outer bindings.
      for (const name of tupleNames) {
        const outerPaths = resolveVariable(scope, name) ?? [];
        const outerAlias = resolveObjectAlias(scope, name);
        const outerDynamicAlias = resolveDynamicObjectAlias(scope, name);
        const outerSuffixPaths = resolveSuffixBasePaths(scope, name) ?? [];
        if (!outerPaths.length && !outerAlias && !outerDynamicAlias && !outerSuffixPaths.length) continue;
        resultScope = bindFocusObjectAliasScope(
          resultScope, name,
          mergeObjectAliases([resolveObjectAlias(resultScope, name), outerAlias]),
          mergeDynamicObjectAliases([resolveDynamicObjectAlias(resultScope, name), outerDynamicAlias]),
          [...(resolveVariable(resultScope, name) ?? []), ...outerPaths],
          [...(resolveSuffixBasePaths(resultScope, name) ?? []), ...outerSuffixPaths],
        );
      }
      return resultScope;
    };
    let finalIndex = steps.length - 1;
    while (finalIndex >= 0 && steps[finalIndex].type === "sort") finalIndex--;
    const finalStep = steps[finalIndex];
    const selectedContext = source.type === "path"
      ? selectedPathAliasContext(source as PathNode, scope) : null;
    if (selectedContext && !(finalStep as AstNode & { focusBinding?: unknown })?.focusBinding) {
      return withOuterTupleOrigins(bindFocusObjectAliasScope(
        groupScope, "", selectedContext.objectAlias, selectedContext.dynamicObjectAlias,
        [], selectedContext.suffixBasePaths,
      ));
    }
    const focusStep = finalStep?.type === "apply"
      ? runtime.functions.appliedFunctionFromApply(finalStep as ApplyNode)
      : finalStep as AstNode & { focusBinding?: { name: string }; indexBinding?: { name: string } };
    if (finalStep && isResultAliasStep(finalStep)) {
      const prefixSteps = steps.slice(0, finalIndex);
      const structuralPrefix = buildProjectionContextPath(prefixSteps) ?? "";
      const contextPrefix = hasPendingProjectionFocusReset(prefixSteps)
        ? parentPath(structuralPrefix)
        : structuralPrefix;
      const resultScope = prefixSteps.length > 0
        ? hasPendingProjectionFocusReset(prefixSteps)
          ? bindVariable(childScope(groupScope), "", markAbsolute([contextPrefix || ROOT_PATH]))
          : runtime.higherOrder.bindArgumentParameter(
              childScope(groupScope),
              { type: "variable", value: "", position: 0 },
              markAbsolute(bindingAliasPaths(prefixNode(prefixSteps), groupScope)),
              prefixNode(prefixSteps), groupScope,
            )
        : groupScope;
      const alias = finalStep.type === "object"
        ? objectConstructorContextAlias(finalStep as ObjectNode, prefixSteps, resultScope)
        : prefixObjectAlias(objectAliasForNode(finalStep, resultScope), contextPrefix);
      const resultDynamicAlias = dynamicObjectAliasForNode(finalStep, resultScope);
      const dynamicAlias = resultDynamicAlias
        ? runtime.higherOrder.prefixDynamicObjectAlias(
            resultDynamicAlias, contextPrefix ? [contextPrefix] : [],
          )
        : null;
      const basePaths = finalStep.type === "array"
        ? arrayConstructorContextBasePaths(finalStep as ArrayNode, contextPrefix, resultScope)
        : finalStep.type === "object"
          ? objectConstructorContextBasePaths(finalStep as ObjectNode, contextPrefix, resultScope)
          : finalStep.type === "block"
            ? blockContextBasePaths(finalStep as BlockNode, contextPrefix, resultScope)
            : prefixProjectionPaths(contextPrefix, bindingAliasPaths(finalStep, resultScope));
      let suffixPaths = prefixProjectionPaths(
        contextPrefix, groupResultSuffixBasePaths(finalStep, resultScope),
      );
      if (!alias && !dynamicAlias && suffixPaths.length === 0) suffixPaths = basePaths;
      if (focusStep?.focusBinding) {
        groupScope = bindFocusObjectAliasScope(
          groupScope, focusStep.focusBinding.name, alias, dynamicAlias, basePaths, suffixPaths,
        );
      }
      if (focusStep?.indexBinding) {
        groupScope = bindVariable(groupScope, focusStep.indexBinding.name, []);
      }
      if (!focusStep?.focusBinding) {
        return withOuterTupleOrigins(bindFocusObjectAliasScope(
          groupScope, "", alias, dynamicAlias,
          alias || dynamicAlias ? [] : basePaths, suffixPaths,
        ));
      }
    }
    const context = focusStep?.focusBinding
      ? finalIndex > 0
        ? prefixNode(steps.slice(0, finalIndex))
        : { type: "variable", value: "", position: 0 } as VariableNode
      : source;
    const contextSourceScope = focusStep?.focusBinding ? scope : groupScope;
    return withOuterTupleOrigins(runtime.higherOrder.bindArgumentParameter(
      groupScope,
      { type: "variable", value: "", position: 0 },
      bindingAliasPaths(context, contextSourceScope),
      context,
      contextSourceScope,
    ));
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
    return dynamicObjectAliasFromObject(groupObject, groupResultScope(node, scope));
  }

  function groupResultSuffixBasePaths(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] {
    return (node as AstNode & { group?: GroupByNode }).group
      ? []
      : runtime.results.getResultSuffixBasePaths(node, scope);
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
    focusScope = bindSuffixBasePaths(focusScope, name, suffixBasePaths);
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
      (node as PathNode).steps[0]?.type === "name" &&
      !(node as PathNode).steps.some(isResultAliasStep)
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

  function isFunctionResultStep(step: AstNode): boolean {
    // Parentheses preserve the final expression's value, including a function
    // followed by a field selection inside the block.
    while (step.type === "block") {
      const expressions = (step as BlockNode).expressions;
      if (expressions.length === 0) return false;
      step = expressions[expressions.length - 1];
    }
    return step.type === "path"
      ? (step as PathNode).steps.some(isFunctionResultStep)
      : step.type === "function";
  }

  function chainedPathContext(node: PathNode, scope: ScopeTracker) {
    const first = node.steps[0] as ArrayNode;
    if (first?.type === "array" && first.initialPathPredicate && node.steps.length > 1 &&
      (first.focusBinding || first.indexBinding || first.predicate?.some((stage) => stage.type === "position-binding"))) {
      // JSONata evaluates a leading explicit array before entering its tuple
      // stream, so its tuple bindings and stages are never applied.
      const prefix: ArrayNode = {
        ...first, predicate: first.initialPathPredicate, initialPathPredicate: undefined,
        focusBinding: undefined, indexBinding: undefined,
      };
      const context: AstNode = first.focusBinding
        ? { type: "variable", value: "", position: 0 } : prefix;
      const contextScope = runtime.higherOrder.bindArgumentParameter(
        childScope(scope), { type: "variable", value: "", position: 0 },
        bindingAliasPaths(context, scope), context, scope,
      );
      return { prefix, tail: { ...node, steps: node.steps.slice(1) }, scope: contextScope };
    }
    const projectionResult = (projection: AstNode): AstNode | undefined => {
      let result: AstNode | undefined = projection;
      while (result?.type === "block") result = (result as BlockNode).expressions.at(-1);
      return result;
    };
    const projectsDataPath = (projection: AstNode): boolean => {
      if (projection.type !== "block" && projection.type !== "array") return false;
      if (projectionResult(projection)?.type === "name") return false;
      const localSelections = new Map<string, boolean>();
      const selectsData = (value: AstNode): boolean => {
        if (value.type === "variable") {
          const name = (value as VariableNode).value;
          return name === "" || localSelections.get(name) === true;
        }
        if (value.type === "name") return true;
        if (value.type === "path") return (value as PathNode).steps.every(
          (part) => ["name", "variable", "wildcard", "descendant"].includes(part.type),
        );
        if (value.type === "array") return (value as ArrayNode).expressions.every(selectsData);
        if (value.type === "block") {
          const expressions = (value as BlockNode).expressions;
          for (const expression of expressions.slice(0, -1)) {
            if (expression.type === "bind") {
              const binding = expression as BindNode;
              localSelections.set(binding.lhs.value, selectsData(binding.rhs));
            }
          }
          return expressions.length > 0 && selectsData(expressions[expressions.length - 1]);
        }
        return false;
      };
      return selectsData(projection);
    };
    // Mixed constructors and focused variables retain their dedicated suffix
    // handling; a plain block projection can consume all selected source paths.
    const hasVariableProjectionSource = (step: AstNode, projection: AstNode): boolean => {
      if (isTransparentPathBlock(step)) {
        return hasVariableProjectionSource(((step as BlockNode).expressions[0] as PathNode).steps[0], projection);
      }
      if (step.type !== "variable" || (step as VariableNode).focusBinding) return false;
      const name = (step as VariableNode).value;
      const objectAlias = resolveObjectAlias(scope, name);
      if (objectAlias) {
        return (resolveSuffixBasePaths(scope, name)?.length ?? 0) === 0 || projectsDataPath(projection);
      }
      if (resolveDynamicObjectAlias(scope, name)) return projectsDataPath(projection);
      const paths = resolveVariable(scope, name) ?? [];
      if (paths.length === 1) return true;
      return paths.length > 0 && projectsDataPath(projection);
    };
    const projectsVariable = (step: AstNode, prefixSteps: AstNode[]): boolean => {
      if (step.type !== "variable") return false;
      const name = (step as VariableNode).value;
      if (name && name !== "$" && prefixSteps.some((prefix) => prefix.type === "sort")) return true;
      return prefixSteps.some((prefix) => {
        const staged = prefix as NameNode & { predicate?: AstNode[] };
        const stages = staged.stages ?? staged.predicate ?? [];
        return staged.indexBinding?.name === name && stages.some((stage) => stage.type === "filter") ||
          stages.some((stage) => stage.type === "position-binding" && (stage as PositionBindingNode).name === name);
      });
    };
    const index = node.steps.findIndex((step, index) =>
      index > 0 && (projectsVariable(step, node.steps.slice(0, index)) || (isResultAliasStep(step) ||
        (isFunctionResultStep(node.steps[index - 1]) &&
          (node.steps[index - 1] as AstNode & { focusBinding?: unknown }).focusBinding)) &&
      (node.steps.slice(0, index).some(isFunctionResultStep) ||
        node.steps.slice(0, index).some((prefixStep) => hasVariableProjectionSource(prefixStep, step)) ||
        (projectsDataPath(step) && node.steps.slice(0, index).some((prefixStep) =>
          isResultAliasStep(prefixStep) && !isTransparentPathBlock(prefixStep))) ||
        step.type === "function" ||
        step.type === "block" && ["function", "apply"].includes(projectionResult(step)?.type ?? "")) &&
      // Stored callable procedures need their full producer path so that the
      // callable resolver can inspect the function's returned container.
      !(step.type === "function" && (step as FunctionNode).procedure.type === "path" &&
        runtime.callables.resolveCallableValues({
          ...((step as FunctionNode).procedure as PathNode),
          steps: [
            ...node.steps.slice(0, index),
            ...((step as FunctionNode).procedure as PathNode).steps,
          ],
        } as PathNode, scope).length > 0)),
    );
    if (index < 0) return null;

    // A later projection consumes the preceding value, rather than the path
    // string obtained by skipping its function or constructor steps.
    const prefixSteps = node.steps.slice(0, index);
    const prefixNode = (steps: AstNode[]): AstNode => steps.length === 1 && !["name", "sort"].includes(steps[0].type)
      ? steps[0] : { ...node, steps, group: undefined };
    const prefix = prefixNode(prefixSteps);
    const lastStep = prefixSteps[prefixSteps.length - 1] as AstNode & {
      focusBinding?: { name: string };
    };
    // A focus binding stores the selected value while leaving the current
    // context at the value before that step.
    const context = lastStep.focusBinding
      ? prefixSteps.length > 1
        ? prefixNode(prefixSteps.slice(0, -1))
        : { type: "variable", value: "", position: 0 } as VariableNode
      : prefix;
    let contextScope = childScope(scope);
    let beforeLastFocus = contextScope;
    for (const [index, step] of prefixSteps.entries()) {
      const bindingStep = step as AstNode & {
        focusBinding?: { name: string };
        indexBinding?: { name: string };
      };
      if (bindingStep.focusBinding) {
        if (index === prefixSteps.length - 1) beforeLastFocus = contextScope;
        const focused = prefixNode([
          ...prefixSteps.slice(0, index),
          { ...step, focusBinding: undefined, indexBinding: undefined } as AstNode,
        ]);
        contextScope = runtime.higherOrder.bindArgumentParameter(
          contextScope, { type: "variable", value: bindingStep.focusBinding.name, position: 0 },
          bindingAliasPaths(focused, contextScope), focused, contextScope,
        );
      }
      if (bindingStep.indexBinding) contextScope = bindVariable(contextScope, bindingStep.indexBinding.name, []);
      const staged = step as NameNode & { predicate?: AstNode[] };
      for (const stage of staged.stages ?? staged.predicate ?? []) {
        if (stage.type === "position-binding") contextScope = bindVariable(contextScope, (stage as PositionBindingNode).name, []);
      }
    }
    const sourceScope = lastStep.focusBinding ? beforeLastFocus : contextScope;
    contextScope = runtime.higherOrder.bindArgumentParameter(
      contextScope, { type: "variable", value: "", position: 0 },
      bindingAliasPaths(context, sourceScope), context, sourceScope,
    );
    return {
      prefix,
      tail: { ...node, steps: node.steps.slice(index) },
      scope: contextScope,
    };
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
        ? runtime.core.walkNode(
            runtime.functions.asBooleanExpression((step as ConditionNode).condition),
            scope,
          )
        : [];
    const stepReadPaths =
      includeStepReadPaths &&
      (step.type === "block" ||
        (step.type === "array" && ((step as ArrayNode).predicate?.length ?? 0) > 0) ||
        (step.type === "object" && ((step as ObjectNode).predicate?.length ?? 0) > 0))
        ? runtime.core.walkNode(step, scope)
        : conditionPaths;
    const resultBasePaths = bindingAliasPaths(step, scope);
    const selected = selectedPathAliasContext({ type: "path", steps: [step, ...suffixSteps] }, scope);
    if (selected) return [
      ...stepReadPaths,
      ...resultBasePaths,
      ...(selected.objectAlias ? [...selected.objectAlias.values()].flatMap((paths) => [...paths]) : []),
      ...(selected.dynamicObjectAlias ? selectLookupDynamicObjectAliasPaths(selected.dynamicObjectAlias, []) : []),
      ...selected.suffixBasePaths,
    ];
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
        ? runtime.results.getResultSuffixBasePaths(step, scope).map((path) => appendPath(path, suffix))
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
  
    const selectedGroupScope = groupNode ? aliasSuffixContextScope(
      suffixSteps.filter((part) => part.type !== "sort"),
      objectAlias, dynamicObjectAlias, suffixScope, suffixBasePaths,
    ) : null;
    const groupPaths = !groupNode ? [] : selectedGroupScope
      ? groupNode.entries.flatMap(([key, value]) => [key, value].flatMap((expression) =>
          selectAliasExpressionPaths(
            resolveObjectAlias(selectedGroupScope, ""), resolveDynamicObjectAlias(selectedGroupScope, ""),
            expression, selectedGroupScope, resolveSuffixBasePaths(selectedGroupScope, "") ?? [],
          )))
      : walkAliasSuffixGroupEntries(
          groupNode, groupBasePaths, objectAlias, dynamicObjectAlias, suffixScope, suffixBasePaths,
        );
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
      ...groupPaths,
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
    suffixBasesOnly = false,
  ): string[] {
    const resultAliasStepIndex = node.steps.findIndex(isResultAliasStep);
    if (resultAliasStepIndex < 0) return runtime.results.getResultBasePathsFromArg(node, scope);
  
    const resultAliasStep = node.steps[resultAliasStepIndex];
    const contextPrefix = buildPathString(node.steps.slice(0, resultAliasStepIndex)) ?? "";
    const suffixSteps = node.steps.slice(resultAliasStepIndex + 1);
    const suffix = buildPathString(suffixSteps);
    let resultScope = scope;
    if (resultAliasStepIndex > 0 && (collectVariableNames(resultAliasStep).has("") ||
      runtime.functions.resultUsesContextDefault(resultAliasStep, scope))) {
      const prefix: AstNode = {
        type: "path", steps: node.steps.slice(0, resultAliasStepIndex),
      } as PathNode;
      resultScope = runtime.higherOrder.bindArgumentParameter(
        childScope(scope),
        { type: "variable", value: "", position: 0 },
        markAbsolute(bindingAliasPaths(prefix, scope)),
        prefix,
        scope,
      );
    }
    if (
      suffix &&
      resultAliasStep.type === "function" &&
      runtime.transforms.transformWritesSuffix(resultAliasStep as FunctionNode, suffixSteps, resultScope)
    ) {
      return [];
    }
    const withContext = (paths: string[]) =>
      prefixProjectionPaths(
        contextPrefix,
        suffix ? paths.map((path) => appendPath(path, suffix)) : paths,
      );
  
    const objectAlias = objectAliasForNode(resultAliasStep, resultScope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(resultAliasStep, resultScope);
    if (suffixSteps.length > 0 && (objectAlias || dynamicObjectAlias)) {
      const aliasPaths = selectAliasSuffixContextPaths(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        bindStepFocusScope(resultAliasStep, resultScope),
        runtime.results.getResultSuffixBasePaths(resultAliasStep, resultScope),
      );
      if (aliasPaths.length > 0) return prefixProjectionPaths(contextPrefix, aliasPaths);
    }
  
    if (resultAliasStep.type === "array") {
      return withContext(
        suffixBasesOnly
          ? groupResultSuffixBasePaths(resultAliasStep, resultScope)
          : arrayConstructorContextBasePaths(resultAliasStep as ArrayNode, "", resultScope),
      );
    }
    if (resultAliasStep.type === "object") {
      return [];
    }
    if (resultAliasStep.type === "block") {
      return withContext(suffixBasesOnly
        ? groupResultSuffixBasePaths(resultAliasStep, resultScope)
        : blockContextBasePaths(resultAliasStep as BlockNode, "", resultScope));
    }
  
    const resultBasePaths = suffix || suffixBasesOnly
      ? runtime.results.getResultSuffixBasePaths(resultAliasStep, resultScope)
      : bindingAliasPaths(resultAliasStep, resultScope);
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
    const dynamicAlias = dynamicObjectAliasForNode(resultAliasStep, scope);
    if (!objectAlias && !dynamicAlias) return false;
  
    return (
      selectAliasSuffixContextPaths(
        node.steps.slice(resultAliasStepIndex + 1),
        objectAlias,
        dynamicAlias,
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
    // Re-parsing rendered paths loses literal selector boundaries. Explicit $
    // references and descendants need alias context before block-local walks.
    const requiresAliasContext = (value: unknown): boolean => {
      if (!value || typeof value !== "object" || value instanceof RegExp) return false;
      const record = value as Record<string, unknown>;
      if (record.type === "descendant" &&
          (objectAlias?.size || dynamicObject || suffixBasePaths.length)) return true;
      if (record.type === "name" && typeof record.value === "string" &&
          (!record.value || /[.%[\]*]/.test(record.value))) return true;
      return Object.values(record).some(requiresAliasContext);
    };
    if (!preserveUnmappedLocalPaths &&
        (requiresAliasContext(expression) ||
         (objectAlias?.size || dynamicObject || suffixBasePaths.length) &&
         collectVariableNames(expression).has(""))) {
      const contextName = "\u0000alias-expression";
      const rewritten = runtime.functions.explicitContextExpression(expression, contextName);
      const aliasScope = (parent: ScopeTracker): ScopeTracker =>
        bindFocusObjectAliasScope(
          bindFocusObjectAliasScope(parent, "", objectAlias, dynamicObject, suffixBasePaths, suffixBasePaths),
          contextName, objectAlias, dynamicObject, suffixBasePaths, suffixBasePaths,
        );
      const mappedPaths = runtime.core.walkNode(rewritten, aliasScope(scope));
      if (!skipLocalPaths) return mappedPaths;
      const localMappedPaths = new Set(runtime.core.walkNode(rewritten, aliasScope(createScope())));
      return mappedPaths.filter((path) => !localMappedPaths.has(path));
    }
    const paths: string[] = [];
    const localPaths = new Set(runtime.core.walkNode(expression, childScope(createScope())));
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
      // Unmapped-path preservation has already continued above.
      paths.push(...aliasPaths);
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
    // Both callers supply nonempty steps validated by aliasSuffixStepsFromPath.
    return [
      ...(objectAlias ? (selectObjectAliasPaths(objectAlias, suffixSteps) ?? []) : []),
      ...(dynamicObject ? selectDynamicObjectAliasPaths(dynamicObject, suffixSteps) : []),
      ...suffixBasePaths.map((path) => appendPath(path, suffix)),
    ];
  }

  function bindingAliasPathsFromBlock(node: BlockNode, scope: ScopeTracker): string[] {
    let currentScope = scope;
    let result: string[] = [];
  
    for (const expr of node.expressions) {
      const expressionScope = currentScope;
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
        currentScope = bindObjectAliasIfPresent(
          currentScope, bindNode.lhs.value, bindNode.rhs, closureScope,
        );
        currentScope = bindDynamicObjectAliasIfPresent(
          currentScope, bindNode.lhs.value, bindNode.rhs, closureScope,
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
      currentScope = runtime.core.bindArrayAssignmentEffects(expr, currentScope, expressionScope);
    }
  
    return result;
  }

  return {
    chainedPathContext,
    bindingAliasPaths,
    staticObjectKey,
    objectAliasFromObject,
    mergeObjectAliases,
    objectAliasForNode,
    selectedPathAliasContext,
    objectAliasFromBlock,
    selectObjectAliasPaths,
    mergeDynamicObjectAliases,
    selectLookupDynamicObjectAliasPaths,
    selectLookupDynamicObjectResultAlias,
    selectLookupDynamicObjectResultObjectAlias,
    selectVariableObjectAliasPaths,
    selectAliasSuffixContextPaths,
    walkAliasFilterStages,
    walkAliasSuffixFilterStages,
    walkAliasSuffixSortTerms,
    walkAliasSuffixProjectionSteps,
    walkAliasSuffixFunctionSteps,
    walkAliasSuffixGroupEntries,
    dynamicObjectAliasForNode,
    groupResultObjectAliasForNode,
    groupResultScope,
    groupResultDynamicObjectAliasForNode,
    groupResultSuffixBasePaths,
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
    selectResultAliasProjectionStepPaths,
    projectionStepExpressions,
    selectAliasExpressionPaths,
    bindingAliasPathsFromBlock,
  };
}
