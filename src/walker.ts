import type {
  ArrayNode,
  AstNode,
  ApplyNode,
  BinaryNode,
  BindNode,
  BlockNode,
  ConditionNode,
  FilterStage,
  FunctionNode,
  GroupByNode,
  LambdaNode,
  NameNode,
  NegateNode,
  ObjectNode,
  PathNode,
  PartialNode,
  SortNode,
  TransformNode,
  VariableNode,
  WildcardNode,
} from "./types.js";
import { buildPathString } from "./path-builder.js";
import {
  type ScopeTracker,
  createScope,
  childScope,
  bindVariable,
  bindSuffixBasePaths,
  bindObjectAlias,
  bindDynamicObjectAlias,
  bindLambda,
  bindPartial,
  resolveLambda,
  resolvePartial,
  resolveVariable,
  resolveSuffixBasePaths,
  resolveObjectAlias,
  resolveDynamicObjectAlias,
  type DynamicObjectAlias,
  type LambdaBinding,
  type ObjectAlias,
} from "./scope.js";
import { BUILTIN_FUNCTIONS, HIGHER_ORDER_SEMANTICS } from "./builtins.js";

const ROOT_PATH = "\0";
const PATH_PRESERVING_RESULT_FUNCTIONS = new Set([
  "lookup",
  "filter",
  "single",
  "sort",
  "append",
  "zip",
  "reverse",
  "shuffle",
  "distinct",
  "merge",
  "spread",
  "sift",
  "clone",
]);

/**
 * Walk an AST node and extract all data paths as raw strings.
 * Dispatches on node.type using a switch statement.
 * Threads an immutable scope for variable resolution.
 * Unknown node types return empty array (skip silently).
 */
export function walkNode(
  node: AstNode,
  scope: ScopeTracker = createScope(),
): string[] {
  switch (node.type) {
    case "path":
      return walkPath(node as PathNode, scope);
    case "name":
      return [(node as NameNode).value];
    case "wildcard":
      return ["*"];
    case "descendant":
      return ["**"];
    case "binary":
      return walkBinary(node as BinaryNode, scope);
    case "condition":
      return walkCondition(node as ConditionNode, scope);
    case "block":
      return walkBlock(node as BlockNode, scope);
    case "negate":
      return walkNegate(node as NegateNode, scope);
    case "array":
      return walkArray(node as ArrayNode, scope);
    case "object":
      return walkObject(node as ObjectNode, scope);
    case "bind":
      return walkBind(node as BindNode, scope);
    case "function":
      return walkFunction(node as FunctionNode, scope);
    case "lambda":
      return walkLambda(node as LambdaNode, scope);
    case "apply":
      return walkApply(node as ApplyNode, scope);
    case "partial":
      return walkPartial(node as PartialNode, scope);
    case "string":
    case "number":
    case "value":
    case "regex":
      return []; // literals produce no paths
    case "variable":
      return walkVariable(node as VariableNode, scope);
    case "parent":
      // ADV-01: parent operator produces "%" as a literal path segment
      return ["%"];
    case "transform":
      return walkTransform(node as TransformNode, scope);
    default:
      // Unknown node type -- skip silently (over-approximate: don't crash)
      return [];
  }
}

/**
 * Prefix each path with a context string.
 * Used by context-relative operators (filter, sort, group-by, transform).
 * Empty prefix or empty paths are handled gracefully.
 */
function prefixPaths(prefix: string, paths: string[]): string[] {
  if (!prefix) return paths;
  if (prefix.startsWith(ROOT_PATH)) {
    return paths.map((p) => (p.startsWith(ROOT_PATH) ? p : appendPath(prefix, p)));
  }
  if (paths.some((p) => p.startsWith(ROOT_PATH))) {
    return paths.map((p) => (p.startsWith(ROOT_PATH) ? p : appendPath(prefix, p)));
  }
  return paths.map((p) => (p ? `${prefix}.${p}` : p));
}

function prefixProjectionPaths(prefix: string, paths: string[]): string[] {
  if (!prefix) return paths;
  return paths.map((path) =>
    path.startsWith(ROOT_PATH) || path === prefix || path.startsWith(`${prefix}.`)
      ? path
      : appendPath(prefix, path),
  );
}

function appendPath(base: string, suffix: string | null): string {
  if (!suffix) return base;
  return base ? `${base}.${suffix}` : suffix;
}

function prefixTransformContextPaths(prefix: string, paths: string[]): string[] {
  return paths.flatMap((path) => {
    if (!path.startsWith(ROOT_PATH)) {
      return prefixPaths(prefix, [path]).map(resolveParentPathSegments);
    }

    const localPath = path.replace(/^\0\.?/, "");
    return [resolveParentPathSegments(appendPath(prefix, localPath || null))];
  });
}

function walkTransformContextExpression(
  prefix: string,
  expr: AstNode,
  scope: ScopeTracker,
): string[] {
  const localPaths = new Set(walkNode(expr, childScope(createScope())));

  return walkNode(expr, scope).flatMap((path) =>
    path.startsWith(ROOT_PATH) || localPaths.has(path)
      ? prefixTransformContextPaths(prefix, [path])
      : markAbsolute([resolveParentPathSegments(path)]),
  );
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

  const basePaths = extractBasePaths(pattern, scope).map(resolveParentPathSegments);
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
  const aliasPaths = selectVariableObjectAliasPaths(
    objectAlias,
    dynamicObjectAlias,
    pathNode.steps.slice(varStepIndex + 1),
    scope,
    unmatchedAliasSuffixBasePaths(objectAlias, suffixBasePaths),
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
  return arrayConstructorContextBasePaths(
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
  return blockContextBasePaths(
    pathNode.steps[blockStepIndex] as BlockNode,
    contextPrefix,
    scope,
  ).map(resolveParentPathSegments);
}

function resolveParentPathSegments(path: string): string {
  if (!path || path.startsWith(ROOT_PATH)) return path;

  const segments: string[] = [];
  for (const segment of path.split(".")) {
    if (segment === "%") {
      if (segments.length > 0) {
        segments.pop();
      } else {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }
  return segments.join(".");
}

function isRootReference(node: AstNode): boolean {
  return node.type === "variable" && (node as VariableNode).value === "";
}

function markAbsolute(paths: string[]): string[] {
  return paths.map((path) => (path.startsWith(ROOT_PATH) ? path : appendPath(ROOT_PATH, path)));
}

function appliedFunctionFromApply(node: ApplyNode): FunctionNode | null {
  if (node.rhs.type === "function") {
    const func = node.rhs as FunctionNode;
    return { ...func, arguments: [node.lhs, ...func.arguments] };
  }
  if (node.rhs.type === "variable") {
    const procedure = node.rhs as VariableNode;
    return {
      type: "function",
      value: "(",
      position: procedure.position,
      procedure,
      arguments: [node.lhs],
    };
  }
  return null;
}

function bindingAliasPaths(node: AstNode, scope: ScopeTracker): string[] {
  if (isRootReference(node)) return [ROOT_PATH];

  switch (node.type) {
    case "name":
      return [(node as NameNode).value];
    case "path":
      return getResultBasePathsFromArg(node, scope);
    case "variable":
      return [...(resolveVariable(scope, (node as VariableNode).value) ?? [])];
    case "array":
      return (node as ArrayNode).expressions.flatMap((expr) =>
        bindingAliasPaths(expr, scope),
      );
    case "object":
      return walkObject(node as ObjectNode, scope);
    case "wildcard":
      return ["*"];
    case "descendant":
      return ["**"];
    case "parent":
      return ["%"];
    case "function":
      return getFunctionResultBasePaths(node as FunctionNode, scope);
    case "lambda": {
      const lambda = node as LambdaNode;
      return lambda.thunk ? bindingAliasPaths(lambda.body, scope) : [];
    }
    case "block":
      return bindingAliasPathsFromBlock(node as BlockNode, scope);
    case "apply": {
      const func = appliedFunctionFromApply(node as ApplyNode);
      return func ? getFunctionResultBasePaths(func, scope) : [];
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
            walkContextExpression(valueNode, prefix, scope),
          );
    if (aliases.length > 0) fields.set(key, aliases);
  }

  return fields.size > 0 ? fields : null;
}

function objectAliasForNode(node: AstNode, scope: ScopeTracker): ObjectAlias | null {
  if (node.type === "object") return objectAliasFromObject(node as ObjectNode, scope);
  if (node.type === "path") return objectAliasFromPathProjection(node as PathNode, scope);
  if (node.type === "array") {
    return mergeObjectAliases(
      (node as ArrayNode).expressions.map((expr) => objectAliasForNode(expr, scope)),
    );
  }
  if (node.type === "condition") {
    const condition = node as ConditionNode;
    return mergeObjectAliases([
      objectAliasForNode(condition.then, scope),
      condition.else ? objectAliasForNode(condition.else, scope) : null,
    ]);
  }
  if (node.type === "function") {
    return getFunctionResultObjectAlias(node as FunctionNode, scope);
  }
  if (node.type === "apply") {
    const func = appliedFunctionFromApply(node as ApplyNode);
    return func ? getFunctionResultObjectAlias(func, scope) : null;
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
      result = objectAliasForNode(bindNode.rhs, closureScope);
    } else {
      result = objectAliasForNode(expr, currentScope);
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

    const suffix = buildPathString(suffixSteps.slice(best.consumed));
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
): string[] {
  const [selector, ...rest] = suffixSteps;
  if (!selector || (selector.type !== "name" && selector.type !== "wildcard")) return [];

  const paths: string[] = [];
  const suffix = buildPathString(rest);

  for (const [keyNode, valueNode] of node.entries) {
    if (staticObjectKey(keyNode)) continue;

    const nestedAlias = objectAliasForNode(valueNode, scope);
    const resolvedNestedAlias =
      nestedAlias && parentDataArgPaths.length > 0
        ? resolveCallbackObjectAliasParentPaths(nestedAlias, parentDataArgPaths)
        : nestedAlias;
    const nestedPaths = resolvedNestedAlias
      ? selectObjectAliasPaths(resolvedNestedAlias, rest)
      : null;
    if (nestedPaths) {
      paths.push(...nestedPaths);
      continue;
    }

    const nestedDynamicAlias = dynamicObjectAliasForNode(valueNode, scope);
    const resolvedNestedDynamicAlias =
      nestedDynamicAlias && parentDataArgPaths.length > 0
        ? resolveCallbackDynamicObjectAliasParentPaths(
            nestedDynamicAlias,
            parentDataArgPaths,
          )
        : nestedDynamicAlias;
    const nestedDynamicPaths = resolvedNestedDynamicAlias
      ? selectDynamicObjectAliasPaths(resolvedNestedDynamicAlias, rest)
      : [];
    if (nestedDynamicPaths.length > 0) {
      paths.push(...nestedDynamicPaths);
      continue;
    }

    if (valueNode.type === "object") continue;

    paths.push(
      ...resolveCallbackParentPaths(
        bindingAliasPaths(valueNode, scope),
        parentDataArgPaths,
      ).map((path) => appendPath(path, suffix)),
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
      const resolvedNestedAlias =
        nestedAlias && variant.parentDataArgPaths?.length
          ? resolveCallbackObjectAliasParentPaths(
              nestedAlias,
              variant.parentDataArgPaths,
            )
          : nestedAlias;
      const nestedPaths = resolvedNestedAlias
        ? selectObjectAliasPaths(resolvedNestedAlias, suffixSteps)
        : null;
      if (nestedPaths) {
        paths.push(...nestedPaths);
        continue;
      }

      const nestedDynamicAlias = dynamicObjectAliasForNode(valueNode, variant.scope);
      const resolvedNestedDynamicAlias =
        nestedDynamicAlias && variant.parentDataArgPaths?.length
          ? resolveCallbackDynamicObjectAliasParentPaths(
              nestedDynamicAlias,
              variant.parentDataArgPaths,
            )
          : nestedDynamicAlias;
      const nestedDynamicPaths = resolvedNestedDynamicAlias
        ? selectDynamicObjectAliasPaths(resolvedNestedDynamicAlias, suffixSteps)
        : [];
      if (nestedDynamicPaths.length > 0) {
        paths.push(...nestedDynamicPaths);
        continue;
      }

      if (valueNode.type === "object") continue;

      paths.push(
        ...resolveCallbackParentPaths(
          bindingAliasPaths(valueNode, variant.scope),
          variant.parentDataArgPaths ?? [],
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
      const resolvedValueAlias =
        valueAlias && variant.parentDataArgPaths?.length
          ? resolveCallbackDynamicObjectAliasParentPaths(
              valueAlias,
              variant.parentDataArgPaths,
            )
          : valueAlias;
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
        return valueAlias && variant.parentDataArgPaths?.length
          ? resolveCallbackObjectAliasParentPaths(
              valueAlias,
              variant.parentDataArgPaths,
            )
          : valueAlias;
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
  const localPaths = walkNode(expr, childScope(createScope()));
  const alignedParentContexts =
    parentContextPaths.length === contextPaths.length ? parentContextPaths : null;

  return contextPaths.flatMap((contextPath, index) => {
    const parentPaths = alignedParentContexts
      ? [alignedParentContexts[index]].filter(Boolean)
      : parentContextPaths;

    return localPaths.flatMap((localPath) => {
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

function parentPath(path: string): string {
  if (!path || path === ROOT_PATH) return "";
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(0, index) : "";
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
        : dynamicObjectAliasForNode(expr, currentScope);
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

      if (bindNode.rhs.type === "lambda") {
        currentScope = bindLambda(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs as LambdaNode,
          closureScope,
        );
      } else if (bindNode.rhs.type === "partial") {
        currentScope = bindPartial(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs as PartialNode,
          closureScope,
        );
      }
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
      dynamicObjectAliasForNode(condition.then, scope),
      condition.else ? dynamicObjectAliasForNode(condition.else, scope) : null,
    ]);
  }
  if (node.type === "array") {
    return mergeDynamicObjectAliases(
      (node as ArrayNode).expressions.map((expr) =>
        dynamicObjectAliasForNode(expr, scope),
      ),
    );
  }
  if (node.type === "lambda") {
    const lambda = node as LambdaNode;
    return lambda.thunk ? dynamicObjectAliasForNode(lambda.body, scope) : null;
  }
  if (node.type === "function") {
    return getFunctionResultDynamicObjectAlias(node as FunctionNode, scope);
  }
  if (node.type === "apply") {
    const func = appliedFunctionFromApply(node as ApplyNode);
    return func ? getFunctionResultDynamicObjectAlias(func, scope) : null;
  }
  return null;
}

function bindObjectAliasIfPresent(
  scope: ScopeTracker,
  name: string,
  node: AstNode,
  aliasScope: ScopeTracker,
): ScopeTracker {
  const alias = objectAliasForNode(node, aliasScope);
  return alias ? bindObjectAlias(scope, name, alias) : scope;
}

function bindDynamicObjectAliasIfPresent(
  scope: ScopeTracker,
  name: string,
  node: AstNode,
  aliasScope: ScopeTracker,
): ScopeTracker {
  const alias = dynamicObjectAliasForNode(node, aliasScope);
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
    const func = appliedFunctionFromApply(step as ApplyNode);
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
      getResultSuffixBasePaths(focusStep, scope),
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
  return bindSuffixBasePaths(scope, name, getResultSuffixBasePaths(node, aliasScope));
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

function selectResultAliasStepPaths(
  step: AstNode,
  suffixSteps: AstNode[],
  scope: ScopeTracker,
  includeStepReadPaths = true,
): string[] | null {
  const suffixScope = bindStepFocusScope(step, scope);
  const conditionPaths =
    step.type === "condition"
      ? walkNode((step as ConditionNode).condition, scope)
      : [];
  const stepReadPaths =
    includeStepReadPaths &&
    (step.type === "block" ||
      (step.type === "array" && ((step as ArrayNode).predicate?.length ?? 0) > 0) ||
      (step.type === "object" && ((step as ObjectNode).predicate?.length ?? 0) > 0))
      ? walkNode(step, scope)
      : conditionPaths;
  const resultBasePaths = bindingAliasPaths(step, scope);
  const objectAlias = objectAliasForNode(step, scope);
  const dynamicObject = dynamicObjectAliasForNode(step, scope);
  const aliasPaths = selectVariableObjectAliasPaths(
    objectAlias,
    dynamicObject,
    suffixSteps,
    suffixScope,
  );
  if (aliasPaths) {
    const suffix = buildPathString(suffixSteps);
    const suffixBasePaths = suffix
      ? getResultSuffixBasePaths(step, scope).map((path) => appendPath(path, suffix))
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
          getResultSuffixBasePaths(step, scope),
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

  const suffixBasePaths = getResultSuffixBasePaths(step, scope);
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
    ...walkResolvedVariableSuffixFilterStages(suffixSteps, basePath, scope, new Set()),
    ...walkResolvedVariableSuffixSortTerms(suffixSteps, basePath, scope, new Set()),
  ]);

  paths.push(...walkResultBaseSuffixProjectionSteps(basePaths, suffixSteps, scope));
  paths.push(...walkResultBaseSuffixFunctionSteps(basePaths, suffixSteps, scope));

  if (groupNode) {
    const suffix = buildPathString(suffixSteps) ?? "";
    paths.push(
      ...basePaths.flatMap((basePath) =>
        walkContextGroupEntries(groupNode, appendPath(basePath, suffix), scope),
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
  if (resultAliasStepIndex < 0) return getResultBasePathsFromArg(node, scope);

  const resultAliasStep = node.steps[resultAliasStepIndex];
  const contextPrefix = buildPathString(node.steps.slice(0, resultAliasStepIndex)) ?? "";
  const suffixSteps = node.steps.slice(resultAliasStepIndex + 1);
  const suffix = buildPathString(suffixSteps);
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
      getResultSuffixBasePaths(resultAliasStep, scope),
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
    ? getResultSuffixBasePaths(resultAliasStep, scope)
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
      getResultSuffixBasePaths(resultAliasStep, scope),
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
): string[] | null {
  const objectAlias = objectAliasForNode(step, scope);
  const dynamicObject = dynamicObjectAliasForNode(step, scope);
  if (!objectAlias && !dynamicObject) return null;

  const projectionPaths = selectAliasProjectionStepPaths(
    objectAlias,
    dynamicObject,
    projectionStep,
    scope,
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
  const localPaths = new Set(walkNode(expression, childScope(createScope())));
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

  for (const path of walkNode(expression, scope)) {
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

      if (bindNode.rhs.type === "lambda") {
        currentScope = bindLambda(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs as LambdaNode,
          closureScope,
        );
      } else if (bindNode.rhs.type === "partial") {
        currentScope = bindPartial(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs as PartialNode,
          closureScope,
        );
      }
    } else if (expr.type === "block") {
      result = bindingAliasPathsFromBlock(expr as BlockNode, childScope(currentScope));
    } else {
      result = bindingAliasPaths(expr, currentScope);
    }
  }

  return result;
}

function walkContextExpression(
  expr: AstNode,
  contextPrefix: string,
  scope: ScopeTracker,
  stageVariables: ReadonlySet<string> = new Set(),
  keepBarePathsRootRelative = false,
): string[] {
  const localPaths = walkNode(expr, childScope(createScope()));
  const localSet = new Set(localPaths);

  const variables = collectVariableNames(expr);
  const hasStageVariable = [...variables].some((name) => stageVariables.has(name));
  if (keepBarePathsRootRelative && stageVariables.size > 0) {
    return hasStageVariable ? walkNode(expr, scope) : [...localPaths];
  }

  const paths = prefixPaths(contextPrefix, localPaths);
  if (hasStageVariable) {
    for (const scopedPath of walkNode(expr, scope)) {
      if (!localSet.has(scopedPath)) paths.push(scopedPath);
    }
  }

  return paths;
}

function isParentRelativePath(path: string): boolean {
  return path === "%" || path.startsWith("%.");
}

function stripParentRelativePath(path: string): string {
  return path === "%" ? "" : path.slice(2);
}

function collectVariableNames(node: AstNode, names = new Set<string>()): Set<string> {
  if (node.type === "variable") {
    names.add((node as VariableNode).value);
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "source") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          collectVariableNames(item as AstNode, names);
        }
      }
    } else if (value && typeof value === "object") {
      collectVariableNames(value as AstNode, names);
    }
  }

  return names;
}

/**
 * Extract paths from a path node's steps, handling variable steps,
 * filter stages on name steps, sort steps, and group-by expressions.
 */
function walkPath(node: PathNode, scope: ScopeTracker): string[] {
  let stageScope = childScope(scope);
  const stageVariables = new Set<string>();
  const nonPathVariables = new Set<string>();

  if (isRootReference(node.steps[0])) {
    const rootPaths = walkPath({ ...node, steps: node.steps.slice(1) }, scope);
    return rootPaths.length > 0 ? markAbsolute(rootPaths) : [ROOT_PATH];
  }

  // Check if any step is a variable (e.g., $x.name)
  const varStepIndex = node.steps.findIndex((s) => s.type === "variable");

  if (varStepIndex >= 0) {
    const varStep = node.steps[varStepIndex] as VariableNode;
    const objectAlias = resolveObjectAlias(scope, varStep.value);
    const dynamicObjectAlias = resolveDynamicObjectAlias(scope, varStep.value);
    if (objectAlias || dynamicObjectAlias) {
      const suffixBaseBinding = resolveSuffixBasePaths(scope, varStep.value) ?? [];
      const unmatchedSuffixBaseBinding = unmatchedAliasSuffixBasePaths(
        objectAlias,
        suffixBaseBinding,
      );
      const aliasScope = varStep.focusBinding
        ? bindFocusObjectAliasScope(
            scope,
            varStep.focusBinding.name,
            objectAlias,
            dynamicObjectAlias,
            resolveVariable(scope, varStep.value) ?? [],
            suffixBaseBinding,
          )
        : scope;
      const suffixSteps = node.steps.slice(varStepIndex + 1);
      const objectPaths = selectVariableObjectAliasPaths(
        objectAlias,
        dynamicObjectAlias,
        suffixSteps,
        aliasScope,
        unmatchedSuffixBaseBinding,
        Boolean(varStep.focusBinding),
      );
      const variableStagePaths = [
        ...(varStep.predicate ?? []).flatMap((stage) =>
          stage.type === "filter"
            ? selectAliasExpressionPaths(
                objectAlias,
                dynamicObjectAlias,
                (stage as unknown as FilterStage).expr,
                aliasScope,
                unmatchedSuffixBaseBinding,
              )
            : [],
        ),
        ...(varStep.group
          ? walkAliasGroupEntries(
              varStep.group,
              objectAlias,
              dynamicObjectAlias,
              aliasScope,
              unmatchedSuffixBaseBinding,
            )
          : []),
      ];
      const suffixStagePaths = walkAliasSuffixFilterStages(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        aliasScope,
        suffixBaseBinding,
        Boolean(varStep.focusBinding),
      );
      const suffixSortPaths = walkAliasSuffixSortTerms(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        aliasScope,
        unmatchedSuffixBaseBinding,
        Boolean(varStep.focusBinding),
      );
      const suffixProjectionPaths = walkAliasSuffixProjectionSteps(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        aliasScope,
        suffixBaseBinding,
        Boolean(varStep.focusBinding),
      );
      const suffixFunctionPaths = walkAliasSuffixFunctionSteps(
        suffixSteps,
        objectAlias,
        dynamicObjectAlias,
        aliasScope,
        suffixBaseBinding,
      );
      const suffix = buildPathString(suffixSteps);
      const suffixBasePaths =
        suffix && unmatchedSuffixBaseBinding.length > 0
          ? unmatchedSuffixBaseBinding.map((path) => appendPath(path, suffix))
          : [];
      const selectedObjectPaths = objectPaths ?? [];
      const suffixBaseRoots = new Set(unmatchedSuffixBaseBinding);
      const groupBasePaths = [
        ...selectedObjectPaths.filter((path) => !suffixBaseRoots.has(path)),
        ...suffixBasePaths,
      ];
      const suffixGroupPaths = node.group
        ? suffixSteps.every((step) => step.type === "sort")
          ? walkAliasGroupEntries(
              node.group,
              objectAlias,
              dynamicObjectAlias,
              aliasScope,
              unmatchedSuffixBaseBinding,
            )
          : walkAliasSuffixGroupEntries(
              node.group,
              groupBasePaths,
              objectAlias,
              dynamicObjectAlias,
              aliasScope,
              suffixBaseBinding,
              Boolean(varStep.focusBinding),
            )
        : [];
      return [
        ...variableStagePaths,
        ...suffixStagePaths,
        ...suffixSortPaths,
        ...suffixProjectionPaths,
        ...suffixFunctionPaths,
        ...suffixGroupPaths,
        ...selectedObjectPaths,
        ...suffixBasePaths,
      ];
    }

    const resolved = resolveVariable(scope, varStep.value);

    if (resolved && resolved.length > 0) {
      const paths: string[] = [];
      const resolvedSuffixBases = [
        ...(resolveSuffixBasePaths(scope, varStep.value) ?? []),
      ];
      const suffixContextPaths =
        resolvedSuffixBases.length > 0 ? resolvedSuffixBases : [...resolved];

      // Inspect predicates on the resolved VariableNode for ADV-02 wildcard emission
      const predicates = varStep.predicate;
      if (predicates && predicates.length > 0) {
        for (const resolvedPath of suffixContextPaths) {
          let predicateScope = scope;
          const predicateStageVariables = new Set<string>();
          const predicateNonPathVariables = new Set<string>();
          if (varStep.focusBinding) {
            predicateScope = bindVariable(
              childScope(scope),
              varStep.focusBinding.name,
              [resolvedPath],
            );
            predicateStageVariables.add(varStep.focusBinding.name);
          }
          if (varStep.indexBinding) {
            if (predicateScope === scope) predicateScope = childScope(predicateScope);
            predicateScope = bindVariable(predicateScope, varStep.indexBinding.name, []);
            predicateNonPathVariables.add(varStep.indexBinding.name);
          }
          paths.push(
            ...walkFilterStages(
              predicates,
              resolvedPath,
              predicateScope,
              predicateNonPathVariables,
              predicateStageVariables,
            ),
          );
        }
      }

      // Build suffix from remaining steps after the variable
      const suffixSteps = node.steps.slice(varStepIndex + 1);
      const suffix = buildPathString(suffixSteps);
      let handledFocusProjection = false;
      const suffixScopeFor = (resolvedPath: string) => {
        let suffixScope = scope;
        const suffixStageVariables = new Set([varStep.value]);

        if (varStep.focusBinding) {
          suffixScope = bindVariable(
            childScope(scope),
            varStep.focusBinding.name,
            [resolvedPath],
          );
          suffixStageVariables.add(varStep.focusBinding.name);
        }
        if (varStep.indexBinding) {
          if (suffixScope === scope) suffixScope = childScope(suffixScope);
          suffixScope = bindVariable(suffixScope, varStep.indexBinding.name, []);
        }

        return { suffixScope, suffixStageVariables };
      };

      if (varStep.focusBinding) {
        const projectionStepIndex = suffixSteps.findIndex(isResultAliasStep);
        if (projectionStepIndex >= 0) {
          handledFocusProjection = true;
          for (const resolvedPath of resolved) {
            const focusScope = bindVariable(
              childScope(scope),
              varStep.focusBinding.name,
              [resolvedPath],
            );
            const projectionPaths = selectResultAliasStepPaths(
              suffixSteps[projectionStepIndex],
              suffixSteps.slice(projectionStepIndex + 1),
              focusScope,
            );
            if (projectionPaths) paths.push(...projectionPaths);
          }
        }
      }

      // Concatenate resolved paths with suffix
      if (!handledFocusProjection) {
        paths.push(...suffixContextPaths.map((p) => appendPath(p, suffix)));
      }

      for (const resolvedPath of suffixContextPaths) {
        const { suffixScope, suffixStageVariables } = suffixScopeFor(resolvedPath);
        paths.push(
          ...walkResolvedVariableSuffixFilterStages(
            suffixSteps,
            resolvedPath,
            suffixScope,
            suffixStageVariables,
          ),
        );
      }

      for (const resolvedPath of suffixContextPaths) {
        const { suffixScope, suffixStageVariables } = suffixScopeFor(resolvedPath);
        paths.push(
          ...walkResolvedVariableSuffixSortTerms(
            suffixSteps,
            resolvedPath,
            suffixScope,
            suffixStageVariables,
          ),
        );
      }

      for (const resolvedPath of suffixContextPaths) {
        const { suffixScope } = suffixScopeFor(resolvedPath);
        paths.push(
          ...walkResultBaseSuffixProjectionSteps(
            [resolvedPath],
            suffixSteps,
            suffixScope,
          ),
        );
      }

      for (const resolvedPath of suffixContextPaths) {
        const { suffixScope } = suffixScopeFor(resolvedPath);
        paths.push(
          ...walkResultBaseSuffixFunctionSteps([resolvedPath], suffixSteps, suffixScope),
        );
      }

      if (node.group) {
        for (const resolvedPath of suffixContextPaths) {
          const suffixBase = buildPathString(suffixSteps) ?? "";
          const { suffixScope, suffixStageVariables } = suffixScopeFor(resolvedPath);
          paths.push(
            ...walkContextGroupEntries(
              node.group,
              appendPath(resolvedPath, suffixBase),
              suffixScope,
              suffixStageVariables,
            ),
          );
        }
      }

      return paths;
    }
    // Unresolvable variable in path: drop the entire path (silent skip)
    return [];
  }

  // Build the base path first (existing behavior).
  // When a path terminates with a block step (e.g., items.(expr)), suppress
  // the base path -- the block is a pure projection whose inner expressions
  // fully describe the accessed paths once prefixed.
  const paths: string[] = [];
  const lastStep = node.steps[node.steps.length - 1];
  const suppressBase = lastStep?.type === "block" || lastStep?.type === "function";
  const basePath = buildPathString(node.steps);
  const resultAliasStepIndex = node.steps.findIndex(
    (step, index) => index < node.steps.length - 1 && isResultAliasStep(step),
  );
  const funcStepIndex = node.steps.findIndex((s) => s.type === "function");
  let skipFunctionResultSuffixStages = false;
  let resultAliasSuffixStageStart = -1;
  let skipResultAliasGroupBy = false;
  if (
    (resultAliasStepIndex === 0 &&
      (node.steps[0]?.type === "function" ||
        (node.steps[0]?.type === "block" &&
          !objectAliasForNode(node.steps[0], scope) &&
          !dynamicObjectAliasForNode(node.steps[0], scope)))) ||
    (basePath && resultAliasStepIndex >= 0)
  ) {
    if (resultAliasStepIndex === 0) {
      const resultStep = node.steps[resultAliasStepIndex];
      const suffixSteps = node.steps.slice(resultAliasStepIndex + 1);
      const contextPrefix = buildPathString(node.steps.slice(0, resultAliasStepIndex)) ?? "";
      const hasResultAlias = Boolean(
        objectAliasForNode(resultStep, scope) ||
          dynamicObjectAliasForNode(resultStep, scope),
      );
      const resultPaths = selectResultAliasStepPaths(
        resultStep,
        suffixSteps,
        scope,
      );
      if (resultPaths) paths.push(...prefixProjectionPaths(contextPrefix, resultPaths));
      const aliasSuffixStagePaths = walkResultAliasSuffixStages(
        resultStep,
        suffixSteps,
        node.group,
        scope,
      );
      if (hasResultAlias) {
        paths.push(...aliasSuffixStagePaths);
        resultAliasSuffixStageStart = resultAliasStepIndex;
        skipResultAliasGroupBy = Boolean(node.group);
      }
      if (!hasResultAlias) {
        const resultBasePaths = pathResultAliasContextBasePaths(
          { ...node, steps: [resultStep], group: undefined },
          scope,
        );
        const resultBaseSuffixStagePaths = walkResultBaseSuffixStages(
          resultBasePaths,
          suffixSteps,
          node.group,
          scope,
        );
        if (resultBaseSuffixStagePaths.length > 0) {
          paths.push(...resultBaseSuffixStagePaths);
          resultAliasSuffixStageStart = resultAliasStepIndex;
          skipResultAliasGroupBy = Boolean(node.group);
        }
      }
      if (resultStep.type === "function" && !hasResultAlias) {
        const resultBasePaths = getFunctionResultBasePaths(
          resultStep as FunctionNode,
          scope,
        );
        for (const resultBasePath of resultBasePaths) {
          paths.push(
            ...walkResolvedVariableSuffixFilterStages(
              node.steps.slice(resultAliasStepIndex + 1),
              resultBasePath,
              scope,
              new Set(),
            ),
          );
        }
        skipFunctionResultSuffixStages = resultBasePaths.length > 0;
      }
    }
  } else if (basePath && funcStepIndex >= 0 && funcStepIndex < node.steps.length - 1) {
    // basePath is relative to the function result (e.g., "quantity" from $lookup(...).quantity)
    // Prefix it with the first argument path to produce the chained data path (e.g., "inventory.quantity")
    const funcStep = node.steps[funcStepIndex] as FunctionNode;
    const resultBasePaths = getFunctionResultBasePaths(funcStep, scope);
    if (resultBasePaths.length > 0) {
      for (const resultBasePath of resultBasePaths) {
        paths.push(...prefixPaths(resultBasePath, [basePath]));
        paths.push(
          ...walkResolvedVariableSuffixFilterStages(
            node.steps.slice(funcStepIndex + 1),
            resultBasePath,
            scope,
            new Set(),
          ),
        );
      }
      skipFunctionResultSuffixStages = true;
      // Don't push bare basePath -- it's not a standalone data path
    }
  } else if (basePath && !suppressBase) {
    paths.push(basePath);
  }

  // Iterate steps and handle filter stages on name steps, sort steps
  for (let i = 0; i < node.steps.length; i++) {
    const step = node.steps[i];
    const contextPrefix = buildPathString(node.steps.slice(0, i + 1)) ?? "";

    if (
      i < node.steps.length - 1 &&
      isResultAliasStep(step) &&
      !(i > 0 && isResultAliasStep(node.steps[i - 1])) &&
      !(resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart)
    ) {
      const projectionPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const resultPaths = selectResultAliasStepPaths(
        step,
        node.steps.slice(i + 1),
        stageScope,
        !(step.type === "block" && projectionPrefix),
      );
      if (resultPaths) {
        paths.push(
          ...(stageVariables.size > 0
            ? resultPaths
            : prefixProjectionPaths(projectionPrefix, resultPaths)),
        );
      }
      if (resultAliasSuffixStageStart < 0) {
        const suffixSteps = node.steps.slice(i + 1);
        const suffixGroupNode = suffixSteps.some((suffixStep) => suffixStep.type === "sort")
          ? undefined
          : node.group;
        const aliasSuffixStagePaths = walkResultAliasSuffixStages(
          step,
          suffixSteps,
          suffixGroupNode,
          stageScope,
        );
        if (aliasSuffixStagePaths.length > 0) {
          paths.push(
            ...(stageVariables.size > 0
              ? aliasSuffixStagePaths
              : prefixProjectionPaths(projectionPrefix, aliasSuffixStagePaths)),
          );
          resultAliasSuffixStageStart = i;
          skipResultAliasGroupBy = Boolean(suffixGroupNode);
        }
      }
    }

    if (step.type === "name") {
      const nameStep = step as NameNode;
      if (nameStep.focusBinding) {
        stageScope = bindVariable(
          stageScope,
          nameStep.focusBinding.name,
          contextPrefix ? [contextPrefix] : [],
        );
        stageVariables.add(nameStep.focusBinding.name);
      }
      if (nameStep.indexBinding) {
        stageScope = bindVariable(stageScope, nameStep.indexBinding.name, []);
        nonPathVariables.add(nameStep.indexBinding.name);
      }
      if (
        nameStep.stages &&
        nameStep.stages.length > 0 &&
        !(skipFunctionResultSuffixStages && i > funcStepIndex) &&
        !(resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart)
      ) {
        paths.push(
          ...walkFilterStages(
            nameStep.stages!,
            contextPrefix,
            stageScope,
            nonPathVariables,
            stageVariables,
          ),
        );
      }
    } else if (step.type === "sort") {
      if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
        continue;
      }
      const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const aliasStep = node.steps[i - 1];
      paths.push(
        ...walkSortTerms(
          step as SortNode,
          contextPrefix,
          stageScope,
          stageVariables,
          aliasStep && isResultAliasStep(aliasStep) ? aliasStep : undefined,
        ),
      );
    } else if (step.type === "object") {
      if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
        continue;
      }
      // Object constructor step in path: orders.items.{"key": val}
      // Walk value expressions and prefix with path up to this step
      const prefixSteps = node.steps.slice(0, i);
      const contextPrefix = buildPathString(prefixSteps) ?? "";
      const objectStep = step as ObjectNode;
      const aliasPaths =
        i > 0 && isResultAliasStep(node.steps[i - 1])
          ? selectResultAliasProjectionStepPaths(node.steps[i - 1], step, stageScope)
          : null;
      if (aliasPaths) {
        paths.push(...aliasPaths);
        continue;
      }
      for (const [key, val] of objectStep.entries) {
        paths.push(
          ...walkContextExpression(key, contextPrefix, stageScope, stageVariables, true),
        );
        paths.push(
          ...walkContextExpression(val, contextPrefix, stageScope, stageVariables, true),
        );
      }
      if (objectStep.predicate && objectStep.predicate.length > 0) {
        const objectAlias = objectConstructorContextAlias(
          objectStep,
          prefixSteps,
          stageScope,
        );
        const dynamicObjectAlias = dynamicObjectAliasForNode(objectStep, stageScope);
        const resultBasePaths = objectConstructorContextBasePaths(
          objectStep,
          contextPrefix,
          stageScope,
        );
        let predicateScope = stageScope;

        if (objectStep.focusBinding) {
          predicateScope = bindFocusObjectAliasScope(
            predicateScope,
            objectStep.focusBinding.name,
            objectAlias,
            dynamicObjectAlias,
            resultBasePaths,
            [],
          );
        }
        if (objectStep.indexBinding) {
          if (predicateScope === stageScope) predicateScope = childScope(predicateScope);
          predicateScope = bindVariable(
            predicateScope,
            objectStep.indexBinding.name,
            [],
          );
        }

        for (const stage of objectStep.predicate) {
          if (stage.type !== "filter") continue;
          paths.push(
            ...selectAliasExpressionPaths(
              objectAlias,
              dynamicObjectAlias,
              (stage as unknown as FilterStage).expr,
              predicateScope,
            ),
          );
        }
      }
    } else if (step.type === "array") {
      if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
        continue;
      }
      const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const arrayStep = step as ArrayNode;
      const aliasPaths =
        i > 0 && isResultAliasStep(node.steps[i - 1])
          ? selectResultAliasProjectionStepPaths(node.steps[i - 1], step, stageScope)
          : null;
      if (aliasPaths) {
        paths.push(...aliasPaths);
        continue;
      }
      for (const expr of arrayStep.expressions) {
        paths.push(
          ...walkContextExpression(expr, contextPrefix, stageScope, stageVariables, true),
        );
      }
      if (arrayStep.predicate && arrayStep.predicate.length > 0) {
        const resultBasePaths = arrayConstructorContextBasePaths(
          arrayStep,
          contextPrefix,
          stageScope,
        );
        let predicateScope = stageScope;
        const predicateStageVariables = new Set(stageVariables);
        const predicateNonPathVariables = new Set(nonPathVariables);

        if (arrayStep.focusBinding) {
          predicateScope = bindFocusObjectAliasScope(
            predicateScope,
            arrayStep.focusBinding.name,
            objectAliasForNode(arrayStep, stageScope),
            dynamicObjectAliasForNode(arrayStep, stageScope),
            resultBasePaths,
            resultBasePaths,
          );
          predicateStageVariables.add(arrayStep.focusBinding.name);
        }
        if (arrayStep.indexBinding) {
          if (predicateScope === stageScope) predicateScope = childScope(predicateScope);
          predicateScope = bindVariable(
            predicateScope,
            arrayStep.indexBinding.name,
            [],
          );
          predicateNonPathVariables.add(arrayStep.indexBinding.name);
        }

        for (const resultBasePath of resultBasePaths) {
          paths.push(
            ...walkFilterStages(
              arrayStep.predicate,
              resultBasePath,
              predicateScope,
              predicateNonPathVariables,
              predicateStageVariables,
            ),
          );
        }
      }
    } else if (step.type === "block") {
      if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
        continue;
      }
      // Block expression step in path: orders.items.(expr)
      // Walk all expressions and prefix with path up to this step
      const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const blockStep = step as BlockNode;
      const blockBasePaths = blockContextBasePaths(
        blockStep,
        contextPrefix,
        stageScope,
      );
      const blockObjectAlias = prefixObjectAlias(
        objectAliasForNode(blockStep, stageScope),
        contextPrefix,
      );
      const blockDynamicObjectAlias = dynamicObjectAliasForNode(blockStep, stageScope);
      const blockSuffixBasePaths = blockBasePaths;
      const blockExpressionStageVariables = new Set(stageVariables);
      if (blockStep.focusBinding) {
        stageScope = bindFocusObjectAliasScope(
          stageScope,
          blockStep.focusBinding.name,
          blockObjectAlias,
          blockDynamicObjectAlias,
          blockBasePaths,
          blockSuffixBasePaths,
        );
        stageVariables.add(blockStep.focusBinding.name);
      }
      if (blockStep.indexBinding) {
        stageScope = bindVariable(stageScope, blockStep.indexBinding.name, []);
        nonPathVariables.add(blockStep.indexBinding.name);
      }
      const aliasPaths =
        i > 0 && isResultAliasStep(node.steps[i - 1])
          ? selectResultAliasProjectionStepPaths(node.steps[i - 1], step, stageScope)
          : null;
      if (aliasPaths) {
        paths.push(...aliasPaths);
        continue;
      }
      for (const expr of blockStep.expressions) {
        paths.push(
          ...walkContextExpression(
            expr,
            contextPrefix,
            stageScope,
            blockExpressionStageVariables,
            true,
          ),
        );
      }
      if (blockStep.predicate && blockStep.predicate.length > 0) {
        const predicatePrefixes =
          blockBasePaths.length > 0
            ? blockBasePaths
            : contextPrefix
              ? [contextPrefix]
              : [];
        let predicateScope = stageScope;
        const predicateStageVariables = new Set(stageVariables);
        const predicateNonPathVariables = new Set(nonPathVariables);

        if (blockStep.focusBinding || blockStep.indexBinding) {
          predicateScope = childScope(stageScope);
        }
        if (blockStep.focusBinding) {
          predicateScope = bindFocusObjectAliasScope(
            stageScope,
            blockStep.focusBinding.name,
            blockObjectAlias,
            blockDynamicObjectAlias,
            blockBasePaths,
            blockSuffixBasePaths,
          );
          predicateStageVariables.add(blockStep.focusBinding.name);
        }
        if (blockStep.indexBinding) {
          predicateScope = bindVariable(
            predicateScope,
            blockStep.indexBinding.name,
            [],
          );
          predicateNonPathVariables.add(blockStep.indexBinding.name);
        }

        for (const prefix of predicatePrefixes) {
          if (blockObjectAlias || blockDynamicObjectAlias) {
            for (const stage of blockStep.predicate) {
              if (stage.type !== "filter") continue;
              paths.push(
                ...selectAliasExpressionPaths(
                  blockObjectAlias,
                  blockDynamicObjectAlias,
                  (stage as unknown as FilterStage).expr,
                  predicateScope,
                ),
              );
            }
          } else {
            paths.push(
              ...walkFilterStages(
                blockStep.predicate,
                prefix,
                predicateScope,
                predicateNonPathVariables,
                predicateStageVariables,
              ),
            );
          }
        }
      }
    } else if (step.type === "function") {
      if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
        continue;
      }
      // Function call step (e.g., $lookup(obj, key) in $lookup(obj, key).field)
      // Function arguments in a path step are evaluated against the prior path context.
      const functionContextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      paths.push(
        ...(functionContextPrefix
          ? walkContextExpression(
              step,
              functionContextPrefix,
              stageScope,
              stageVariables,
            )
          : walkFunction(step as FunctionNode, stageScope)),
      );
    } else if (step.type === "apply") {
      paths.push(...walkApply(step as ApplyNode, stageScope));
    }
  }

  // Handle group-by on the PathNode (node.group)
  if (node.group && !skipResultAliasGroupBy) {
    paths.push(...walkGroupBy(node, stageScope, stageVariables));
  }

  return paths;
}

function walkResolvedVariableSuffixFilterStages(
  suffixSteps: AstNode[],
  resolvedPath: string,
  scope: ScopeTracker,
  stageVariables: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];
  let suffixScope = scope;
  const suffixStageVariables = new Set(stageVariables);
  const nonPathVariables = new Set<string>();

  for (let i = 0; i < suffixSteps.length; i++) {
    const step = suffixSteps[i];
    if (step.type !== "name") continue;

    const nameStep = step as NameNode;
    const contextSuffix = buildPathString(suffixSteps.slice(0, i + 1)) ?? "";
    const contextPrefix = appendPath(resolvedPath, contextSuffix);

    if (nameStep.focusBinding) {
      suffixScope = bindVariable(
        suffixScope,
        nameStep.focusBinding.name,
        contextPrefix ? [contextPrefix] : [],
      );
      suffixStageVariables.add(nameStep.focusBinding.name);
    }
    if (nameStep.indexBinding) {
      suffixScope = bindVariable(suffixScope, nameStep.indexBinding.name, []);
      nonPathVariables.add(nameStep.indexBinding.name);
    }
    if (nameStep.stages && nameStep.stages.length > 0) {
      paths.push(
        ...walkFilterStages(
          nameStep.stages,
          contextPrefix,
          suffixScope,
          nonPathVariables,
          suffixStageVariables,
        ),
      );
    }
  }

  return paths;
}

function walkResolvedVariableSuffixSortTerms(
  suffixSteps: AstNode[],
  resolvedPath: string,
  scope: ScopeTracker,
  stageVariables: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];
  let suffixScope = scope;
  const suffixStageVariables = new Set(stageVariables);

  for (let i = 0; i < suffixSteps.length; i++) {
    const step = suffixSteps[i];

    if (step.type === "name") {
      const nameStep = step as NameNode;
      const contextSuffix = buildPathString(suffixSteps.slice(0, i + 1)) ?? "";
      const contextPrefix = appendPath(resolvedPath, contextSuffix);

      if (nameStep.focusBinding) {
        suffixScope = bindVariable(
          suffixScope,
          nameStep.focusBinding.name,
          contextPrefix ? [contextPrefix] : [],
        );
        suffixStageVariables.add(nameStep.focusBinding.name);
      }
      if (nameStep.indexBinding) {
        suffixScope = bindVariable(suffixScope, nameStep.indexBinding.name, []);
      }
    } else if (step.type === "sort") {
      const contextSuffix = buildPathString(suffixSteps.slice(0, i)) ?? "";
      const contextPrefix = appendPath(resolvedPath, contextSuffix);
      paths.push(
        ...walkSortTerms(
          step as SortNode,
          contextPrefix,
          suffixScope,
          suffixStageVariables,
        ),
      );
    }
  }

  return paths;
}

/**
 * Walk sort terms on a sort step, extracting and context-prefixing paths.
 * Context prefix uses steps BEFORE the sort step (slice(0, i), NOT slice(0, i+1))
 * because the sort step itself is not a path segment.
 */
function walkSortTerms(
  sortNode: SortNode,
  contextPrefix: string,
  scope: ScopeTracker,
  stageVariables: ReadonlySet<string> = new Set(),
  aliasStep?: AstNode,
): string[] {
  const paths: string[] = [];
  for (const term of sortNode.terms) {
    const aliasPaths =
      aliasStep
        ? term.expression.type === "path"
          ? selectResultAliasStepPaths(
              aliasStep,
              (term.expression as PathNode).steps,
              scope,
              !(aliasStep.type === "block" && contextPrefix),
            )
          : selectResultAliasExpressionPaths(aliasStep, term.expression, scope)
        : null;
    paths.push(
      ...(aliasPaths
        ? prefixProjectionPaths(contextPrefix, aliasPaths)
        : walkContextExpression(
            term.expression,
            contextPrefix,
            scope,
            stageVariables,
          )),
    );
  }
  return paths;
}

/**
 * Walk group-by expression on a PathNode, extracting key and value paths.
 * Both key and value expressions are prefixed with the base path of the
 * PathNode (computed from all steps, with sort steps skipped by buildPathString).
 */
function walkGroupBy(
  node: PathNode,
  scope: ScopeTracker,
  stageVariables: ReadonlySet<string> = new Set(),
): string[] {
  const groupNode = node.group;
  if (!groupNode) return [];

  const resultAliasStepIndex = node.steps.findIndex(isResultAliasStep);
  if (resultAliasStepIndex >= 0) {
    const resultAliasStep = node.steps[resultAliasStepIndex];
    const prefixSteps = node.steps.slice(0, resultAliasStepIndex);
    const contextPrefix = buildPathString(prefixSteps) ?? "";
    const objectAlias =
      resultAliasStep.type === "object"
        ? objectConstructorContextAlias(
            resultAliasStep as ObjectNode,
            prefixSteps,
            scope,
          )
        : resultAliasStep.type === "block"
          ? prefixObjectAlias(objectAliasForNode(resultAliasStep, scope), contextPrefix)
        : objectAliasForNode(resultAliasStep, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(resultAliasStep, scope);
    const resultBasePaths =
      resultAliasStep.type === "array"
        ? arrayConstructorContextBasePaths(
            resultAliasStep as ArrayNode,
            contextPrefix,
            scope,
          )
        : resultAliasStep.type === "object"
          ? objectConstructorContextBasePaths(
              resultAliasStep as ObjectNode,
              contextPrefix,
              scope,
            )
          : resultAliasStep.type === "block"
            ? blockContextBasePaths(
                resultAliasStep as BlockNode,
                contextPrefix,
                scope,
              )
            : bindingAliasPaths(resultAliasStep, scope);
    const focusStep =
      resultAliasStep.type === "apply"
        ? appliedFunctionFromApply(resultAliasStep as ApplyNode)
        : resultAliasStep.type === "block" ||
            resultAliasStep.type === "array" ||
            resultAliasStep.type === "object" ||
            resultAliasStep.type === "function"
          ? (resultAliasStep as BlockNode | ArrayNode | ObjectNode | FunctionNode)
          : null;
    const focusBinding = focusStep?.focusBinding;
    const indexBinding = focusStep?.indexBinding;
    let groupScope = scope;
    if (focusBinding) {
      groupScope = bindFocusObjectAliasScope(
        scope,
        focusBinding.name,
        objectAlias,
        dynamicObjectAlias,
        resultBasePaths,
        resultBasePaths,
      );
    }
    if (indexBinding) {
      if (groupScope === scope) groupScope = childScope(scope);
      groupScope = bindVariable(groupScope, indexBinding.name, []);
    }
    if (objectAlias || dynamicObjectAlias) {
      return walkAliasGroupEntries(
        groupNode,
        objectAlias,
        dynamicObjectAlias,
        groupScope,
      );
    }

    const groupStageVariables = new Set(
      focusBinding ? [focusBinding.name] : [],
    );
    if (resultBasePaths.length > 0) {
      return resultBasePaths.flatMap((basePath) =>
        walkContextGroupEntries(groupNode, basePath, groupScope, groupStageVariables),
      );
    }
  }

  const groupBasePath = buildPathString(node.steps) ?? "";
  return walkContextGroupEntries(groupNode, groupBasePath, scope, stageVariables);
}

function walkContextGroupEntries(
  groupNode: GroupByNode,
  groupBasePath: string,
  scope: ScopeTracker,
  stageVariables: ReadonlySet<string> = new Set(),
): string[] {
  return groupNode.entries.flatMap(([keyExpr, valExpr]) => [
    ...walkContextExpression(keyExpr, groupBasePath, scope, stageVariables),
    ...walkContextExpression(valExpr, groupBasePath, scope, stageVariables),
  ]);
}

function walkAliasGroupEntries(
  groupNode: GroupByNode,
  objectAlias: ObjectAlias | null,
  dynamicObjectAlias: DynamicObjectAlias | null,
  scope: ScopeTracker,
  suffixBasePaths: readonly string[] = [],
): string[] {
  return groupNode.entries.flatMap(([keyExpr, valExpr]) => [
    ...selectAliasExpressionPaths(
      objectAlias,
      dynamicObjectAlias,
      keyExpr,
      scope,
      suffixBasePaths,
    ),
    ...selectAliasExpressionPaths(
      objectAlias,
      dynamicObjectAlias,
      valExpr,
      scope,
      suffixBasePaths,
    ),
  ]);
}

/**
 * Walk filter stages on a name step, extracting and context-prefixing paths.
 * Numeric index stages are skipped (EXPR-06). Focus variables (@$v) are
 * bound in a child scope before walking filter expressions.
 */
function walkFilterStages(
  stages: AstNode[],
  contextPrefix: string,
  scope: ScopeTracker,
  nonPathVariables: ReadonlySet<string> = new Set(),
  stageVariables: ReadonlySet<string> = new Set(),
): string[] {
  const paths: string[] = [];

  for (const stage of stages) {
    if (stage.type !== "filter") continue;

    const filterStage = stage as unknown as FilterStage;

    // EXPR-06: Numeric index guard -- skip array indexing
    if (isNumericIndex(filterStage.expr)) continue;

    // ADV-02: pure $variable in bracket position with no resolved data paths -> dynamic wildcard
    if (filterStage.expr.type === "variable") {
      const varNode = filterStage.expr as VariableNode;
      const resolved = resolveVariable(scope, varNode.value);
      if (nonPathVariables.has(varNode.value)) continue;
      if (!resolved) {
        paths.push(`${contextPrefix}[*]`);
        continue; // [*] replaces predicate walk -- do not also walk the predicate
      }
      if (resolved.length === 0) continue;
    }

    paths.push(
      ...walkContextExpression(
        filterStage.expr,
        contextPrefix,
        scope,
        stageVariables,
      ),
    );
  }

  return paths;
}

/**
 * Check if an expression represents a numeric array index.
 * Handles both positive (items[0]) and negative (items[-1]) literals.
 */
function isNumericIndex(expr: AstNode): boolean {
  if (expr.type === "number") return true;
  if (
    expr.type === "negate" &&
    (expr as NegateNode).expression?.type === "number"
  ) {
    return true;
  }
  return false;
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
  const patternPaths = walkNode(node.pattern, scope).map(resolveParentPathSegments);
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

  return paths;
}

/** Extract paths from both sides of a binary operator. */
function walkBinary(node: BinaryNode, scope: ScopeTracker): string[] {
  return [...walkNode(node.lhs, scope), ...walkNode(node.rhs, scope)];
}

/** Extract paths from condition, then-branch, and optional else-branch. */
function walkCondition(node: ConditionNode, scope: ScopeTracker): string[] {
  return [
    ...walkNode(node.condition, scope),
    ...walkNode(node.then, scope),
    ...(node.else ? walkNode(node.else, scope) : []),
  ];
}

/**
 * Process block expressions sequentially, accumulating scope bindings.
 * Each bind node adds to the running scope before subsequent expressions
 * are processed. Inner blocks use a child scope to prevent leaking.
 * Lambda RHS nodes are stored in scope for custom function call tracing.
 */
function walkBlock(node: BlockNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];
  let currentScope = scope;

  for (const expr of node.expressions) {
    if (expr.type === "bind") {
      const bindNode = expr as BindNode;
      const closureScope = currentScope;
      const rhsPaths = isRootReference(bindNode.rhs)
        ? [ROOT_PATH]
        : walkNode(bindNode.rhs, currentScope);
      paths.push(...rhsPaths.filter((path) => path !== ROOT_PATH));
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

      // If the RHS is a lambda, store the lambda node for SCOPE-05 tracing
      if (bindNode.rhs.type === "lambda") {
        currentScope = bindLambda(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs as LambdaNode,
          closureScope,
        );
      } else if (bindNode.rhs.type === "partial") {
        currentScope = bindPartial(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs as PartialNode,
          closureScope,
        );
      }
    } else if (expr.type === "block") {
      // Inner block: create a child scope so bindings don't leak
      const innerScope = childScope(currentScope);
      paths.push(...walkBlock(expr as BlockNode, innerScope));
    } else {
      paths.push(...walkNode(expr, currentScope));
    }
  }

  if (node.group) {
    const groupScope = bindStepFocusScope(node, currentScope);
    const groupStageVariables = new Set(
      node.focusBinding ? [node.focusBinding.name] : [],
    );
    const objectAlias = objectAliasFromBlock(node, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(node, scope);
    const suffixBasePaths = getBlockResultSuffixBasePaths(node, scope);
    paths.push(
      ...(objectAlias || dynamicObjectAlias
        ? walkAliasGroupEntries(
            node.group,
            objectAlias,
            dynamicObjectAlias,
            groupScope,
            suffixBasePaths,
          )
        : bindingAliasPathsFromBlock(node, scope).flatMap((basePath) =>
            walkContextGroupEntries(
              node.group!,
              basePath,
              groupScope,
              groupStageVariables,
            ),
          )),
    );
  }

  if (node.predicate && node.predicate.length > 0) {
    const predicateScope = bindStepFocusScope(node, currentScope);
    const predicateStageVariables = new Set<string>();
    if (node.focusBinding) predicateStageVariables.add(node.focusBinding.name);
    const objectAlias = objectAliasFromBlock(node, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(node, scope);
    if (objectAlias || dynamicObjectAlias) {
      paths.push(
        ...node.predicate.flatMap((stage) =>
          stage.type === "filter"
            ? selectAliasExpressionPaths(
                objectAlias,
                dynamicObjectAlias,
                (stage as unknown as FilterStage).expr,
                predicateScope,
                getBlockResultSuffixBasePaths(node, scope),
              )
            : [],
        ),
      );
    } else {
      for (const resultBasePath of bindingAliasPathsFromBlock(node, scope)) {
        paths.push(
          ...walkFilterStages(
            node.predicate,
            resultBasePath,
            predicateScope,
            new Set(),
            predicateStageVariables,
          ),
        );
      }
    }
  }

  return paths;
}

/**
 * Handle a standalone bind node (outside of a block).
 * Walks the RHS to extract data paths.
 */
function walkBind(node: BindNode, scope: ScopeTracker): string[] {
  return walkNode(node.rhs, scope);
}

/** Extract paths from negation. */
function walkNegate(node: NegateNode, scope: ScopeTracker): string[] {
  return node.expression ? walkNode(node.expression, scope) : [];
}

/** Extract paths from array constructor entries. */
function walkArray(node: ArrayNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];
  let currentScope = scope;
  for (const expr of node.expressions) {
    if (expr.type === "bind") {
      const bindNode = expr as BindNode;
      const closureScope = currentScope;
      const rhsPaths = isRootReference(bindNode.rhs)
        ? [ROOT_PATH]
        : walkNode(bindNode.rhs, currentScope);
      paths.push(...rhsPaths.filter((path) => path !== ROOT_PATH));
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
    } else {
      paths.push(...walkNode(expr, currentScope));
    }
  }
  if (node.predicate && node.predicate.length > 0) {
    let predicateScope = currentScope;
    const predicateStageVariables = new Set<string>();
    const predicateNonPathVariables = new Set<string>();
    const resultBasePaths = bindingAliasPaths(node, scope);

    if (node.focusBinding) {
      predicateScope = bindFocusObjectAliasScope(
        predicateScope,
        node.focusBinding.name,
        objectAliasForNode(node, scope),
        dynamicObjectAliasForNode(node, scope),
        resultBasePaths,
        getResultSuffixBasePaths(node, scope),
      );
      predicateStageVariables.add(node.focusBinding.name);
    }
    if (node.indexBinding) {
      if (predicateScope === currentScope) predicateScope = childScope(predicateScope);
      predicateScope = bindVariable(predicateScope, node.indexBinding.name, []);
      predicateNonPathVariables.add(node.indexBinding.name);
    }

    const objectAlias = objectAliasForNode(node, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(node, scope);
    if (objectAlias || dynamicObjectAlias) {
      paths.push(
        ...node.predicate.flatMap((stage) =>
          stage.type === "filter"
            ? selectAliasExpressionPaths(
                objectAlias,
                dynamicObjectAlias,
                (stage as unknown as FilterStage).expr,
                predicateScope,
                getResultSuffixBasePaths(node, scope),
              )
            : [],
        ),
      );
    } else {
      for (const resultBasePath of resultBasePaths) {
        paths.push(
          ...walkFilterStages(
            node.predicate,
            resultBasePath,
            predicateScope,
            predicateNonPathVariables,
            predicateStageVariables,
          ),
        );
      }
    }
  }
  if (node.group) {
    const groupScope = bindStepFocusScope(node, currentScope);
    const objectAlias = objectAliasForNode(node, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(node, scope);
    const resultBasePaths = bindingAliasPaths(node, scope);
    paths.push(
      ...(objectAlias || dynamicObjectAlias
        ? walkAliasGroupEntries(node.group, objectAlias, dynamicObjectAlias, groupScope)
        : resultBasePaths.flatMap((basePath) =>
            walkContextGroupEntries(
              node.group!,
              basePath,
              groupScope,
              new Set(node.focusBinding ? [node.focusBinding.name] : []),
            ),
          )),
    );
  }
  return paths;
}

/** Extract value paths from an object constructor. */
function walkObject(node: ObjectNode, scope: ScopeTracker): string[] {
  const paths = node.entries.flatMap(([key, val]) => [
    ...walkNode(key, scope),
    ...walkNode(val, scope),
  ]);
  if (node.predicate && node.predicate.length > 0) {
    const objectAlias = objectAliasFromObject(node, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(node, scope);
    const resultBasePaths = node.entries.flatMap(([, value]) =>
      bindingAliasPaths(value, scope),
    );
    let predicateScope = scope;

    if (node.focusBinding) {
      predicateScope = bindFocusObjectAliasScope(
        predicateScope,
        node.focusBinding.name,
        objectAlias,
        dynamicObjectAlias,
        resultBasePaths,
        [],
      );
    }
    if (node.indexBinding) {
      if (predicateScope === scope) predicateScope = childScope(predicateScope);
      predicateScope = bindVariable(predicateScope, node.indexBinding.name, []);
    }

    for (const stage of node.predicate) {
      if (stage.type !== "filter") continue;
      paths.push(
        ...selectAliasExpressionPaths(
          objectAlias,
          dynamicObjectAlias,
          (stage as unknown as FilterStage).expr,
          predicateScope,
        ),
      );
    }
  }
  if (node.group) {
    const objectAlias = objectAliasFromObject(node, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(node, scope);
    const resultBasePaths = node.entries.flatMap(([, value]) =>
      bindingAliasPaths(value, scope),
    );
    let groupScope = scope;
    const groupStageVariables = new Set<string>();

    if (node.focusBinding) {
      groupScope = bindFocusObjectAliasScope(
        groupScope,
        node.focusBinding.name,
        objectAlias,
        dynamicObjectAlias,
        resultBasePaths,
        [],
      );
      groupStageVariables.add(node.focusBinding.name);
    }
    if (node.indexBinding) {
      if (groupScope === scope) groupScope = childScope(groupScope);
      groupScope = bindVariable(groupScope, node.indexBinding.name, []);
    }

    paths.push(
      ...(objectAlias || dynamicObjectAlias
        ? walkAliasGroupEntries(node.group, objectAlias, dynamicObjectAlias, groupScope)
        : resultBasePaths.flatMap((basePath) =>
            walkContextGroupEntries(
              node.group!,
              basePath,
              groupScope,
              groupStageVariables,
            ),
          )),
    );
  }
  return paths;
}

function isPlaceholder(node: AstNode): boolean {
  return node.type === "operator" && (node as { value?: unknown }).value === "?";
}

/** Extract read effects from bound partial-application arguments. */
function walkPartial(node: PartialNode, scope: ScopeTracker): string[] {
  return node.arguments.flatMap((arg) =>
    isPlaceholder(arg) ? [] : walkNode(arg, scope),
  );
}

/**
 * Resolve a variable reference using the scope chain.
 * Built-in function names and the root reference ($) produce no paths.
 */
function walkVariable(node: VariableNode, scope: ScopeTracker): string[] {
  // Root reference ($) produces no paths
  if (node.value === "") {
    return [];
  }

  // Check scope first (scope bindings shadow built-ins)
  const resolved = resolveVariable(scope, node.value);
  if (resolved) {
    const suffixBasePaths = [...(resolveSuffixBasePaths(scope, node.value) ?? [])];
    const variableBasePaths =
      suffixBasePaths.length > 0 ? suffixBasePaths : [...resolved];
    const paths = [...variableBasePaths];

    // Inspect predicates on the standalone VariableNode (mirrors walkPath variable branch)
    const predicates = node.predicate;
    if (predicates && predicates.length > 0) {
      const objectAlias = resolveObjectAlias(scope, node.value);
      const dynamicObjectAlias = resolveDynamicObjectAlias(scope, node.value);
      for (const resolvedPath of variableBasePaths) {
        let predicateScope = scope;
        const predicateStageVariables = new Set<string>();
        const predicateNonPathVariables = new Set<string>();
        if (node.focusBinding) {
          predicateScope = bindFocusObjectAliasScope(
            scope,
            node.focusBinding.name,
            objectAlias,
            dynamicObjectAlias,
            [resolvedPath],
            suffixBasePaths.length > 0 ? suffixBasePaths : [resolvedPath],
          );
          predicateStageVariables.add(node.focusBinding.name);
        }
        if (node.indexBinding) {
          if (predicateScope === scope) predicateScope = childScope(predicateScope);
          predicateScope = bindVariable(predicateScope, node.indexBinding.name, []);
          predicateNonPathVariables.add(node.indexBinding.name);
        }
        paths.push(
          ...walkFilterStages(
            predicates,
            resolvedPath,
            predicateScope,
            predicateNonPathVariables,
            predicateStageVariables,
          ),
        );
      }
    }

    // Handle group-by on variable node (mirrors walkGroupBy for PathNode)
    if (node.group) {
      const groupNode = node.group;
      const objectAlias = resolveObjectAlias(scope, node.value);
      const dynamicObjectAlias = resolveDynamicObjectAlias(scope, node.value);
      let groupScope = scope;
      const groupStageVariables = new Set<string>();
      if (node.focusBinding) {
        groupScope = bindFocusObjectAliasScope(
          scope,
          node.focusBinding.name,
          objectAlias,
          dynamicObjectAlias,
          variableBasePaths,
          suffixBasePaths.length > 0 ? suffixBasePaths : variableBasePaths,
        );
        groupStageVariables.add(node.focusBinding.name);
      }
      if (node.indexBinding) {
        if (groupScope === scope) groupScope = childScope(scope);
        groupScope = bindVariable(groupScope, node.indexBinding.name, []);
      }
      paths.push(
        ...(objectAlias || dynamicObjectAlias
          ? walkAliasGroupEntries(
              groupNode,
              objectAlias,
              dynamicObjectAlias,
              groupScope,
              suffixBasePaths,
            )
          : variableBasePaths.flatMap((basePath) =>
              walkContextGroupEntries(
                groupNode,
                basePath,
                groupScope,
                groupStageVariables,
              ),
            )),
      );
    }

    return paths;
  }

  // Built-in function names produce no paths
  if (BUILTIN_FUNCTIONS.has(node.value)) {
    return [];
  }

  // Unresolvable variable: silent skip
  return [];
}

/**
 * Handle a lambda node encountered during walking.
 *
 * A real lambda definition (user-written `function($x) { ... }`) is just a
 * value -- it doesn't execute, so no paths are extracted.
 *
 * However, JSONata's parser generates "thunk" lambdas (with `thunk: true`
 * and no arguments) to wrap certain expressions like nested higher-order
 * function calls. These thunks must be unwrapped: walk their body with
 * the current scope to extract paths.
 */
function walkLambda(node: LambdaNode, scope: ScopeTracker): string[] {
  // Thunk lambdas are parser-generated wrappers, not user-defined functions
  if (node.thunk) {
    return walkNode(node.body, scope);
  }
  return [];
}

/**
 * Extract paths from function calls with lambda-aware resolution.
 *
 * Handles three cases:
 * 1. Higher-order built-in ($map, $filter, etc.) -- bind lambda params to data arg paths
 * 2. Custom function call ($fn bound to lambda in scope) -- trace args into lambda body
 * 3. Non-higher-order / unknown function -- pass-through all arguments
 */
function walkFunction(node: FunctionNode, scope: ScopeTracker): string[] {
  const withFunctionStages = (readPaths: string[]) => [
    ...readPaths,
    ...walkFunctionPredicates(node, scope),
    ...walkFunctionGroupBy(node, scope),
  ];

  if (node.procedure.type === "lambda") {
    return withFunctionStages(
      walkCustomFunctionCall(
        { lambda: node.procedure, scope },
        node.arguments,
        scope,
      ),
    );
  }

  const funcName = node.procedure.value;
  const args = node.arguments;
  const paths: string[] = [];

  // Step 1: Check if this is a known higher-order function
  const semantics = HIGHER_ORDER_SEMANTICS[funcName];
  if (semantics) {
    return withFunctionStages(walkHigherOrderCall(node, semantics, scope));
  }

  // Step 2: Check if this is a custom function call (lambda bound in scope)
  const lambdaBinding = resolveLambda(scope, funcName);
  if (lambdaBinding) {
    return withFunctionStages(walkCustomFunctionCall(lambdaBinding, args, scope));
  }

  const partialBinding = resolvePartial(scope, funcName);
  if (partialBinding) {
    return withFunctionStages(walkPartialCall(partialBinding, args, scope));
  }

  // Step 3: Non-higher-order built-in or unknown function -- pass-through all args
  for (const arg of args) {
    if (arg.type === "lambda") {
      // Walk lambda body with current scope (closure capture)
      const lambda = arg as LambdaNode;
      const lambdaScope = childScope(scope);
      paths.push(...walkNode(lambda.body, lambdaScope));
    } else {
      paths.push(...walkNode(arg, scope));
    }
  }

  if (funcName === "lookup") {
    paths.push(...getLookupResultBasePaths(args, scope));
  }

  return withFunctionStages(paths);
}

function walkFunctionPredicates(node: FunctionNode, scope: ScopeTracker): string[] {
  if (!node.predicate || node.predicate.length === 0) return [];

  const predicateScope = bindStepFocusScope(node, scope);
  const predicateStageVariables = new Set(
    node.focusBinding ? [node.focusBinding.name] : [],
  );
  const predicateNonPathVariables = new Set(
    node.indexBinding ? [node.indexBinding.name] : [],
  );
  const objectAlias = getFunctionResultObjectAlias(node, scope);
  const dynamicObjectAlias = getFunctionResultDynamicObjectAlias(node, scope);

  if (objectAlias || dynamicObjectAlias) {
    const suffixBasePaths = getFunctionResultSuffixBasePaths(node, scope);
    return node.predicate.flatMap((stage) =>
      stage.type === "filter"
        ? selectAliasExpressionPaths(
            objectAlias,
            dynamicObjectAlias,
            (stage as unknown as FilterStage).expr,
            predicateScope,
            suffixBasePaths,
          )
        : [],
    );
  }

  return getFunctionResultBasePaths(node, scope).flatMap((basePath) =>
    walkFilterStages(
      node.predicate!,
      basePath,
      predicateScope,
      predicateNonPathVariables,
      predicateStageVariables,
    ),
  );
}

function walkFunctionGroupBy(node: FunctionNode, scope: ScopeTracker): string[] {
  if (!node.group) return [];

  const groupScope = bindStepFocusScope(node, scope);
  const groupStageVariables = new Set(
    node.focusBinding ? [node.focusBinding.name] : [],
  );
  const objectAlias = getFunctionResultObjectAlias(node, scope);
  const dynamicObjectAlias = getFunctionResultDynamicObjectAlias(node, scope);

  if (objectAlias || dynamicObjectAlias) {
    return walkAliasGroupEntries(
      node.group,
      objectAlias,
      dynamicObjectAlias,
      groupScope,
      getFunctionResultSuffixBasePaths(node, scope),
    );
  }

  return getFunctionResultBasePaths(node, scope).flatMap((basePath) =>
    walkContextGroupEntries(node.group!, basePath, groupScope, groupStageVariables),
  );
}

/**
 * Filter a set of paths to keep only "base" paths -- paths where no other
 * path in the set is a proper dot-prefix. This strips predicate-derived
 * suffix paths from variable-resolved path sets.
 *
 * Example: ["items", "items.active"] -> ["items"]
 * Example: ["orders.items", "orders.items.price"] -> ["orders.items"]
 */
function filterToBasePaths(paths: string[]): string[] {
  return paths.filter(
    (p) => !paths.some((other) => other !== p && p.startsWith(other + ".")),
  );
}

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
  if (isRootReference(node)) return [ROOT_PATH];

  if (node.type === "path") {
    const pathNode = node as PathNode;
    if (isRootReference(pathNode.steps[0])) {
      return markAbsolute(
        extractBasePaths({ ...pathNode, steps: pathNode.steps.slice(1) }, scope),
      );
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
            ? selectAliasSuffixContextPaths(
                suffixSteps,
                objectAlias,
                dynamicObjectAlias,
                scope,
                suffixBasePaths,
              )
            : selectVariableObjectAliasPaths(
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
    if (pathNode.steps.some(isResultAliasStep)) {
      return pathResultAliasContextBasePaths(pathNode, scope).map(resolveParentPathSegments);
    }
    const basePath = buildPathString(pathNode.steps);
    return basePath ? [basePath] : [];
  }
  if (node.type === "apply") {
    // Chained apply base identity comes from the leftmost operand
    return extractBasePaths((node as ApplyNode).lhs, scope);
  }
  if (node.type === "block") {
    return getBlockResultSuffixBasePaths(node as BlockNode, scope);
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
  return walkNode(node, scope);
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
  const callback = findHigherOrderCallback(args, scope);

  // Extract paths from all non-lambda arguments (they're data reads)
  // This emits ALL paths including filter predicates (correct -- they are data reads)
  for (const [index, arg] of args.entries()) {
    if (arg.type !== "lambda" && index !== callback?.index) {
      paths.push(...walkNode(arg, scope));
    }
  }

  if (callback) {
    // Get the data argument (first non-lambda arg) BASE paths for binding
    // Uses extractBasePaths to exclude filter predicate paths from binding
    const dataArg = args[0];
    const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
    const funcName =
      node.procedure.type === "variable" ? node.procedure.value : "";

    // Walk lambda body with parameter bindings
    paths.push(
      ...(funcName === "reduce"
        ? walkReduceLambdaWithBindings(callback.lambda, args, callback.scope, scope)
        : walkLambdaWithBindings(
            funcName,
            callback.lambda,
            dataArgPaths,
            dataArg,
            semantics,
            callback.scope,
            scope,
          )),
    );
  }

  return paths;
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

  return resolveCallbackParentPaths(walkNode(lambda.body, lambdaScope), dataArgPaths);
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

  return resolveCallbackParentPaths(walkNode(lambda.body, lambdaScope), dataArgPaths);
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
    role === "element" ||
    role === "value" ||
    role === "left" ||
    role === "right" ||
    role === "array" ||
    role === "accumulator"
  ) {
    return arg && shouldBindDataArgumentAlias(funcName, role)
      ? bindArgumentParameter(scope, param, argPaths, arg, argScope)
      : bindVariable(scope, param.value, argPaths);
  }

  return scope;
}

function shouldBindDataArgumentAlias(funcName: string, role: string): boolean {
  if (funcName === "each" || funcName === "sift") return false;
  return (
    role === "element" ||
    role === "left" ||
    role === "right" ||
    role === "array" ||
    role === "accumulator"
  );
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
): string[] {
  const { lambda, scope } = binding;
  const paths: string[] = [];

  // Extract paths from all call-site arguments
  const argPathSets: string[][] = [];
  for (const arg of callArgs) {
    const argPaths = walkNode(arg, callScope);
    paths.push(...argPaths);
    argPathSets.push(argPaths);
  }

  // Create a scope binding each lambda parameter to its corresponding arg paths
  let lambdaScope = childScope(scope);
  for (let i = 0; i < lambda.arguments.length; i++) {
    const param = lambda.arguments[i];
    const argPaths = i < argPathSets.length ? argPathSets[i] : [];
    lambdaScope =
      i < callArgs.length
        ? bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
        : bindVariable(lambdaScope, param.value, argPaths);
  }

  // Walk the lambda body with parameter bindings
  const parentBasePaths = callArgs[0] ? extractBasePaths(callArgs[0], callScope) : [];
  paths.push(
    ...resolveCallbackParentPaths(
      walkNode(lambda.body, lambdaScope),
      parentBasePaths.length > 0 ? parentBasePaths : (argPathSets[0] ?? []),
    ),
  );

  return paths;
}

function bindArgumentParameter(
  scope: ScopeTracker,
  param: VariableNode,
  argPaths: readonly string[],
  arg: AstNode,
  argScope: ScopeTracker,
): ScopeTracker {
  let nextScope = bindVariable(scope, param.value, argPaths);
  nextScope = bindSuffixBasePathsIfPresent(nextScope, param.value, arg, argScope);
  nextScope = bindObjectAliasIfPresent(nextScope, param.value, arg, argScope);
  nextScope = bindDynamicObjectAliasIfPresent(nextScope, param.value, arg, argScope);
  return nextScope;
}

function applyPartialArguments(
  partial: PartialNode,
  callArgs: AstNode[],
): AstNode[] {
  const args: AstNode[] = [];
  let callArgIndex = 0;

  for (const partialArg of partial.arguments) {
    if (isPlaceholder(partialArg)) {
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

function walkPartialCall(
  binding: NonNullable<ReturnType<typeof resolvePartial>>,
  callArgs: AstNode[],
  callScope: ScopeTracker,
): string[] {
  const boundPaths = walkPartial(binding.partial, binding.scope);
  const callPaths = callArgs.flatMap((arg) => walkNode(arg, callScope));
  const appliedFunction: FunctionNode = {
    type: "function",
    value: "(",
    position: binding.partial.position,
    procedure: binding.partial.procedure,
    arguments: applyPartialArguments(binding.partial, callArgs),
  };

  return [
    ...boundPaths,
    ...callPaths,
    ...walkFunction(appliedFunction, binding.scope),
  ];
}

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

  const partialBinding = resolvePartial(scope, node.procedure.value);
  let funcName = node.procedure.value;
  let args = node.arguments;
  let argScope = scope;

  if (partialBinding) {
    funcName = partialBinding.partial.procedure.value;
    args = applyPartialArguments(partialBinding.partial, node.arguments);
    argScope = partialBinding.scope;
  }

  const lambdaBinding = resolveLambda(argScope, funcName);
  if (lambdaBinding) {
    return getCustomFunctionResultObjectAlias(lambdaBinding, args, argScope);
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
    return mergeObjectAliases(args.map((arg) => objectAliasForNode(arg, argScope)));
  }
  return args.length > 0 ? objectAliasForNode(args[0], argScope) : null;
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

  const partialBinding = resolvePartial(scope, node.procedure.value);
  let funcName = node.procedure.value;
  let args = node.arguments;
  let argScope = scope;

  if (partialBinding) {
    funcName = partialBinding.partial.procedure.value;
    args = applyPartialArguments(partialBinding.partial, node.arguments);
    argScope = partialBinding.scope;
  }

  const lambdaBinding = resolveLambda(argScope, funcName);
  if (lambdaBinding) {
    return getCustomFunctionResultDynamicObjectAlias(lambdaBinding, args, argScope);
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
    return mergeDynamicObjectAliases(
      args.map((arg) => dynamicObjectAliasForNode(arg, argScope)),
    );
  }
  return args.length > 0 ? dynamicObjectAliasForNode(args[0], argScope) : null;
}

function getCustomFunctionResultObjectAlias(
  binding: LambdaBinding,
  callArgs: AstNode[],
  callScope: ScopeTracker,
): ObjectAlias | null {
  const { lambda, scope } = binding;
  let lambdaScope = childScope(scope);

  for (let i = 0; i < lambda.arguments.length; i++) {
    const param = lambda.arguments[i];
    const argPaths = i < callArgs.length ? extractBasePaths(callArgs[i], callScope) : [];
    lambdaScope =
      i < callArgs.length
        ? bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
        : bindVariable(lambdaScope, param.value, argPaths);
  }

  const alias = objectAliasForNode(lambda.body, lambdaScope);
  const firstArgPaths = callArgs[0] ? extractBasePaths(callArgs[0], callScope) : [];
  return alias ? resolveCallbackObjectAliasParentPaths(alias, firstArgPaths) : null;
}

function getCustomFunctionResultDynamicObjectAlias(
  binding: LambdaBinding,
  callArgs: AstNode[],
  callScope: ScopeTracker,
): DynamicObjectAlias | null {
  const { lambda, scope } = binding;
  let lambdaScope = childScope(scope);

  for (let i = 0; i < lambda.arguments.length; i++) {
    const param = lambda.arguments[i];
    const argPaths = i < callArgs.length ? extractBasePaths(callArgs[i], callScope) : [];
    lambdaScope =
      i < callArgs.length
        ? bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
        : bindVariable(lambdaScope, param.value, argPaths);
  }

  const alias = dynamicObjectAliasForNode(lambda.body, lambdaScope);
  const firstArgPaths = callArgs[0] ? extractBasePaths(callArgs[0], callScope) : [];
  return alias
    ? resolveCallbackDynamicObjectAliasParentPaths(alias, firstArgPaths)
    : null;
}

function getCallbackResultObjectAlias(
  funcName: "map" | "each",
  args: AstNode[],
  scope: ScopeTracker,
): ObjectAlias | null {
  const callback = findHigherOrderCallback(args, scope);
  if (!callback) return null;

  const dataArg = args[0];
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  let lambdaScope = childScope(callback.scope);

  for (let i = 0; i < callback.lambda.arguments.length; i++) {
    const param = callback.lambda.arguments[i];
    const role = HIGHER_ORDER_SEMANTICS[funcName][i];

    if (!role) continue;
    lambdaScope = bindHigherOrderParameter(
      lambdaScope,
      funcName,
      param,
      role,
      dataArgPaths,
      dataArg,
      scope,
    );
  }

  const alias = objectAliasForNode(callback.lambda.body, lambdaScope);
  return alias ? resolveCallbackObjectAliasParentPaths(alias, dataArgPaths) : null;
}

function getCallbackResultDynamicObjectAlias(
  funcName: "map" | "each",
  args: AstNode[],
  scope: ScopeTracker,
): DynamicObjectAlias | null {
  const callback = findHigherOrderCallback(args, scope);
  if (!callback) return null;

  const dataArg = args[0];
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  let lambdaScope = childScope(callback.scope);

  for (let i = 0; i < callback.lambda.arguments.length; i++) {
    const param = callback.lambda.arguments[i];
    const role = HIGHER_ORDER_SEMANTICS[funcName][i];

    if (!role) continue;
    lambdaScope = bindHigherOrderParameter(
      lambdaScope,
      funcName,
      param,
      role,
      dataArgPaths,
      dataArg,
      scope,
    );
  }

  const alias = dynamicObjectAliasForNode(callback.lambda.body, lambdaScope);
  return alias
    ? resolveCallbackDynamicObjectAliasParentPaths(alias, dataArgPaths)
    : null;
}

function getReduceResultObjectAlias(
  args: AstNode[],
  scope: ScopeTracker,
): ObjectAlias | null {
  const callback = findHigherOrderCallback(args, scope);
  if (!callback) return null;

  const dataArg = args[0];
  const accumulatorArg = args[2] ?? dataArg;
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  const accumulatorPaths = accumulatorArg
    ? extractBasePaths(accumulatorArg, scope)
    : dataArgPaths;
  let lambdaScope = childScope(callback.scope);

  for (let i = 0; i < callback.lambda.arguments.length; i++) {
    const param = callback.lambda.arguments[i];
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
            scope,
          )
        : bindHigherOrderParameter(
            lambdaScope,
            "reduce",
            param,
            role,
            dataArgPaths,
            dataArg,
            scope,
          );
  }

  const bodyAlias = objectAliasForNode(callback.lambda.body, lambdaScope);
  return mergeObjectAliases([
    bodyAlias ? resolveCallbackObjectAliasParentPaths(bodyAlias, dataArgPaths) : null,
    args[2] ? objectAliasForNode(args[2], scope) : null,
  ]);
}

function getReduceResultDynamicObjectAlias(
  args: AstNode[],
  scope: ScopeTracker,
): DynamicObjectAlias | null {
  const callback = findHigherOrderCallback(args, scope);
  if (!callback) return null;

  const dataArg = args[0];
  const accumulatorArg = args[2] ?? dataArg;
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  const accumulatorPaths = accumulatorArg
    ? extractBasePaths(accumulatorArg, scope)
    : dataArgPaths;
  let lambdaScope = childScope(callback.scope);

  for (let i = 0; i < callback.lambda.arguments.length; i++) {
    const param = callback.lambda.arguments[i];
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
            scope,
          )
        : bindHigherOrderParameter(
            lambdaScope,
            "reduce",
            param,
            role,
            dataArgPaths,
            dataArg,
            scope,
          );
  }

  const callbackAlias = dynamicObjectAliasForNode(callback.lambda.body, lambdaScope);
  return mergeDynamicObjectAliases([
    callbackAlias
      ? resolveCallbackDynamicObjectAliasParentPaths(callbackAlias, dataArgPaths)
      : null,
    args[2] ? dynamicObjectAliasForNode(args[2], scope) : null,
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

  const partialBinding = resolvePartial(scope, node.procedure.value);
  let funcName = node.procedure.value;
  let args = node.arguments;
  let argScope = scope;

  if (partialBinding) {
    funcName = partialBinding.partial.procedure.value;
    args = applyPartialArguments(partialBinding.partial, node.arguments);
    argScope = partialBinding.scope;
  }

  const lambdaBinding = resolveLambda(argScope, funcName);
  if (lambdaBinding) {
    return getCustomFunctionResultBasePaths(lambdaBinding, args, argScope);
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
  return args.length > 0 ? getResultBasePathsFromArg(args[0], argScope) : [];
}

function getCustomFunctionResultBasePaths(
  binding: LambdaBinding,
  callArgs: AstNode[],
  callScope: ScopeTracker,
): string[] {
  const { lambda, scope } = binding;
  let lambdaScope = childScope(scope);

  for (let i = 0; i < lambda.arguments.length; i++) {
    const param = lambda.arguments[i];
    const argPaths = i < callArgs.length ? extractBasePaths(callArgs[i], callScope) : [];
    lambdaScope =
      i < callArgs.length
        ? bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
        : bindVariable(lambdaScope, param.value, argPaths);
  }

  const firstArgPaths = callArgs[0] ? extractBasePaths(callArgs[0], callScope) : [];
  return resolveCallbackParentPaths(
    bindingAliasPaths(lambda.body, lambdaScope),
    firstArgPaths,
  );
}

function getCallbackResultBasePaths(
  funcName: "map" | "each",
  args: AstNode[],
  scope: ScopeTracker,
): string[] {
  const callback = findHigherOrderCallback(args, scope);
  if (!callback) return [];

  const dataArg = args[0];
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  let lambdaScope = childScope(callback.scope);

  for (let i = 0; i < callback.lambda.arguments.length; i++) {
    const param = callback.lambda.arguments[i];
    const role = HIGHER_ORDER_SEMANTICS[funcName][i];

    if (!role) continue;
    lambdaScope = bindHigherOrderParameter(
      lambdaScope,
      funcName,
      param,
      role,
      dataArgPaths,
      dataArg,
      scope,
    );
  }

  return resolveCallbackParentPaths(
    bindingAliasPaths(callback.lambda.body, lambdaScope),
    dataArgPaths,
  );
}

function getReduceResultBasePaths(args: AstNode[], scope: ScopeTracker): string[] {
  const callback = findHigherOrderCallback(args, scope);
  if (!callback) return [];

  const dataArg = args[0];
  const accumulatorArg = args[2] ?? dataArg;
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  const accumulatorPaths = accumulatorArg
    ? extractBasePaths(accumulatorArg, scope)
    : dataArgPaths;
  let lambdaScope = childScope(callback.scope);

  for (let i = 0; i < callback.lambda.arguments.length; i++) {
    const param = callback.lambda.arguments[i];
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
            scope,
          )
        : bindHigherOrderParameter(
            lambdaScope,
            "reduce",
            param,
            role,
            dataArgPaths,
            dataArg,
            scope,
          );
  }

  return resolveCallbackParentPaths(
    bindingAliasPaths(callback.lambda.body, lambdaScope),
    dataArgPaths,
  );
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

  const partialBinding = resolvePartial(scope, func.procedure.value);
  let funcName = func.procedure.value;
  let args = func.arguments;
  let argScope = scope;

  if (partialBinding) {
    funcName = partialBinding.partial.procedure.value;
    args = applyPartialArguments(partialBinding.partial, func.arguments);
    argScope = partialBinding.scope;
  }

  const lambdaBinding = resolveLambda(argScope, funcName);
  if (lambdaBinding) {
    return getCustomFunctionResultSuffixBasePaths(lambdaBinding, args, argScope);
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

  if (!PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName) || funcName === "lookup") {
    return [];
  }

  if (funcName === "append" || funcName === "zip") {
    return args.flatMap((arg) => getSuffixableResultBasePaths(arg, argScope));
  }

  return args[0] ? getResultSuffixBasePaths(args[0], argScope) : [];
}

function getResultSuffixBasePaths(node: AstNode, scope: ScopeTracker): string[] {
  if (node.type === "block") {
    return getBlockResultSuffixBasePaths(node as BlockNode, scope);
  }

  if (node.type === "condition") {
    const condition = node as ConditionNode;
    return [
      ...getSuffixableResultBasePaths(condition.then, scope),
      ...(condition.else ? getSuffixableResultBasePaths(condition.else, scope) : []),
    ];
  }

  if (node.type === "path") {
    const pathNode = node as PathNode;
    const resultAliasStepIndex = pathNode.steps.findIndex(isResultAliasStep);
    if (
      resultAliasStepIndex < pathNode.steps.length - 1 &&
      hasVariableBeforeResultAlias(pathNode, resultAliasStepIndex)
    ) {
      return getResultBasePathsFromArg(pathNode, scope);
    }
    return pathResultAliasContextBasePaths(pathNode, scope);
  }

  if (node.type === "array") {
    return (node as ArrayNode).expressions.flatMap((expr) =>
      getResultSuffixBasePaths(expr, scope),
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

  return getSuffixableResultBasePaths(accumulatorArg, scope);
}

function getReduceCallbackResultSuffixBasePaths(
  args: AstNode[],
  scope: ScopeTracker,
): string[] {
  const callback = findHigherOrderCallback(args, scope);
  if (!callback) return [];

  const dataArg = args[0];
  const accumulatorArg = args[2] ?? dataArg;
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  const accumulatorPaths = accumulatorArg
    ? extractBasePaths(accumulatorArg, scope)
    : dataArgPaths;
  let lambdaScope = childScope(callback.scope);

  for (let i = 0; i < callback.lambda.arguments.length; i++) {
    const param = callback.lambda.arguments[i];
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
            scope,
          )
        : bindHigherOrderParameter(
            lambdaScope,
            "reduce",
            param,
            role,
            dataArgPaths,
            dataArg,
            scope,
          );
  }

  return getResultSuffixBasePaths(callback.lambda.body, lambdaScope);
}

function getCustomFunctionResultSuffixBasePaths(
  binding: LambdaBinding,
  callArgs: AstNode[],
  callScope: ScopeTracker,
): string[] {
  const { lambda, scope } = binding;
  let lambdaScope = childScope(scope);

  for (let i = 0; i < lambda.arguments.length; i++) {
    const param = lambda.arguments[i];
    const argPaths = i < callArgs.length ? extractBasePaths(callArgs[i], callScope) : [];
    lambdaScope =
      i < callArgs.length
        ? bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
        : bindVariable(lambdaScope, param.value, argPaths);
  }

  return getResultSuffixBasePaths(lambda.body, lambdaScope);
}

function getCallbackResultSuffixBasePaths(
  funcName: "map" | "each",
  args: AstNode[],
  scope: ScopeTracker,
): string[] {
  const callback = findHigherOrderCallback(args, scope);
  if (!callback) return [];

  const dataArg = args[0];
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  let lambdaScope = childScope(callback.scope);

  for (let i = 0; i < callback.lambda.arguments.length; i++) {
    const param = callback.lambda.arguments[i];
    const role = HIGHER_ORDER_SEMANTICS[funcName][i];

    if (!role) continue;
    lambdaScope = bindHigherOrderParameter(
      lambdaScope,
      funcName,
      param,
      role,
      dataArgPaths,
      dataArg,
      scope,
    );
  }

  return getResultSuffixBasePaths(callback.lambda.body, lambdaScope);
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

      if (bindNode.rhs.type === "lambda") {
        currentScope = bindLambda(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs as LambdaNode,
          closureScope,
        );
      } else if (bindNode.rhs.type === "partial") {
        currentScope = bindPartial(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs as PartialNode,
          closureScope,
        );
      }
    } else if (expr.type === "block") {
      result = getBlockResultSuffixBasePaths(expr as BlockNode, childScope(currentScope));
    } else {
      result = getResultSuffixBasePaths(expr, currentScope);
    }
  }

  return result;
}

function getSuffixableResultBasePaths(node: AstNode, scope: ScopeTracker): string[] {
  switch (node.type) {
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
  const paths: string[] = [];

  const objectAlias = objectAliasForNode(objectArg, scope);
  const objectPaths = objectAlias ? selectObjectAliasPaths(objectAlias, selectorSteps) : null;
  if (objectPaths) paths.push(...objectPaths);

  if (objectArg.type === "variable") {
    const suffix = buildPathString(selectorSteps);
    const objectAliasBases = new Set(
      objectAlias ? [...objectAlias.values()].flatMap((basePaths) => [...basePaths]) : [],
    );
    const suffixBasePaths = resolveSuffixBasePaths(
      scope,
      (objectArg as VariableNode).value,
    );
    if (suffixBasePaths && suffix) {
      paths.push(
        ...suffixBasePaths
          .filter((path) => !objectAliasBases.has(path))
          .map((path) => appendPath(path, suffix)),
      );
    }
  }

  const dynamicObjectAlias = dynamicObjectAliasForNode(objectArg, scope);
  if (dynamicObjectAlias) {
    paths.push(...selectLookupDynamicObjectAliasPaths(dynamicObjectAlias, []));
  }

  if (!staticSelector && paths.length === 0 && !objectAlias && !dynamicObjectAlias) {
    const basePaths = isRootReference(objectArg)
      ? [ROOT_PATH]
      : getResultBasePathsFromArg(objectArg, scope);
    paths.push(...basePaths.map(appendDynamicLookupMarker));
  }

  if (paths.length > 0) return paths;

  const basePaths = isRootReference(objectArg)
    ? [ROOT_PATH]
    : getResultBasePathsFromArg(objectArg, scope);
  return staticSelector
    ? basePaths.map((path) => appendPath(path, staticSelector))
    : basePaths;
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

  const dynamicObjectAlias = dynamicObjectAliasForNode(objectArg, scope);
  return dynamicObjectAlias
    ? selectLookupDynamicObjectResultAlias(
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

  const dynamicObjectAlias = dynamicObjectAliasForNode(objectArg, scope);
  return dynamicObjectAlias
    ? selectLookupDynamicObjectResultObjectAlias(
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
  if (isRootReference(node)) return [ROOT_PATH];

  if (node.type === "function") {
    const paths = getFunctionResultBasePaths(node as FunctionNode, scope);
    return paths.length > 0 ? paths : walkNode(node, scope).slice(0, 1);
  }

  if (node.type === "block") {
    return getBlockResultSuffixBasePaths(node as BlockNode, scope);
  }

  if (node.type === "path") {
    const pathNode = node as PathNode;
    if (hasResultAliasObjectSuffixSelection(pathNode, scope)) {
      return pathResultAliasContextBasePaths(pathNode, scope).map(resolveParentPathSegments);
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
    return extractBasePaths(node, scope);
  }

  if (node.type === "apply") {
    const func = appliedFunctionFromApply(node as ApplyNode);
    if (func) return getFunctionResultBasePaths(func, scope);
  }

  return walkNode(node, scope).slice(0, 1);
}

/**
 * Handle the apply operator (~>).
 * `lhs ~> rhs` where rhs is typically a function call.
 * The lhs becomes the first argument to the function on the rhs.
 *
 * Example: `items ~> $map(function($v) { $v.name })`
 * is equivalent to `$map(items, function($v) { $v.name })`
 */
function walkApply(node: ApplyNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];

  // Extract paths from the lhs (it's a data read)
  const lhsPaths = walkNode(node.lhs, scope);
  paths.push(...lhsPaths);

  const appliedFunction = appliedFunctionFromApply(node);
  if (appliedFunction) {
    // walkFunction will re-walk the lhs arg, but dedup in extractPaths handles it
    paths.push(...walkFunction(appliedFunction, scope));
  } else if (node.rhs.type === "path") {
    const pathNode = node.rhs as PathNode;
    if (pathNode.steps[0]?.type === "function") {
      const funcNode = pathNode.steps[0] as FunctionNode;
      paths.push(
        ...walkPath(
          {
            ...pathNode,
            steps: [
              { ...funcNode, arguments: [node.lhs, ...funcNode.arguments] },
              ...pathNode.steps.slice(1),
            ],
          },
          scope,
        ),
      );
    } else {
      paths.push(...walkNode(node.rhs, scope));
    }
  } else if (node.rhs.type === "lambda") {
    // Inline lambda application: bind first parameter to lhs base paths
    const lambda = node.rhs as LambdaNode;
    let lambdaScope = childScope(scope);
    let callbackBasePaths: string[] = [];
    if (lambda.arguments.length > 0) {
      const lhsBasePaths = extractBasePaths(node.lhs, scope);
      callbackBasePaths = lhsBasePaths.length > 0 ? lhsBasePaths : lhsPaths;
      lambdaScope = bindArgumentParameter(
        lambdaScope,
        lambda.arguments[0],
        callbackBasePaths,
        node.lhs,
        scope,
      );
    }
    paths.push(
      ...resolveCallbackParentPaths(walkNode(lambda.body, lambdaScope), callbackBasePaths),
    );
  } else if (node.rhs.type === "transform") {
    const transformPaths = walkTransform(node.rhs as TransformNode, scope);
    const transformBasePaths = extractBasePaths(node.lhs, scope);
    const transformPrefixes =
      transformBasePaths.length > 0 ? transformBasePaths : [lhsPaths[0] ?? ""];
    paths.push(
      ...transformPrefixes.flatMap((prefix) => prefixPaths(prefix, transformPaths)),
    );
  } else {
    // Fallback: unusual RHS (e.g., variable reference)
    paths.push(...walkNode(node.rhs, scope));
  }

  return paths;
}
