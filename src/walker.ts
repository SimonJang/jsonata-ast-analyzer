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
  bindObjectAlias,
  bindDynamicObjectAlias,
  bindLambda,
  bindPartial,
  resolveLambda,
  resolvePartial,
  resolveVariable,
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
): string[] {
  const [selector, ...rest] = suffixSteps;
  if (!selector || (selector.type !== "name" && selector.type !== "wildcard")) return [];

  const paths: string[] = [];
  const suffix = buildPathString(rest);

  for (const [keyNode, valueNode] of node.entries) {
    if (staticObjectKey(keyNode)) continue;

    const nestedAlias = objectAliasForNode(valueNode, scope);
    const nestedPaths = nestedAlias ? selectObjectAliasPaths(nestedAlias, rest) : null;
    if (nestedPaths) {
      paths.push(...nestedPaths);
      continue;
    }

    if (valueNode.type === "object") continue;

    paths.push(
      ...bindingAliasPaths(valueNode, scope).map((path) => appendPath(path, suffix)),
    );
  }

  return paths;
}

function selectDynamicObjectAliasPaths(
  alias: DynamicObjectAlias,
  suffixSteps: AstNode[],
): string[] {
  return alias.variants.flatMap((variant) =>
    selectDynamicObjectValuePaths(variant.node, suffixSteps, variant.scope),
  );
}

function mergeDynamicObjectAliases(
  aliases: Array<DynamicObjectAlias | null>,
): DynamicObjectAlias | null {
  const variants = aliases.flatMap((alias) => alias?.variants ?? []);
  return variants.length > 0 ? { variants } : null;
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
      const nestedPaths = nestedAlias
        ? selectObjectAliasPaths(nestedAlias, suffixSteps)
        : null;
      if (nestedPaths) {
        paths.push(...nestedPaths);
        continue;
      }

      if (valueNode.type === "object") continue;

      paths.push(
        ...bindingAliasPaths(valueNode, variant.scope).map((path) =>
          appendPath(path, suffix),
        ),
      );
    }
  }

  return paths;
}

function selectVariableObjectAliasPaths(
  objectAlias: ObjectAlias | null,
  dynamicObjectAlias: DynamicObjectAlias | null,
  suffixSteps: AstNode[],
  scope: ScopeTracker,
): string[] | null {
  const [selector, ...rest] = suffixSteps;
  if (selector?.type === "sort") {
    const sortPaths = selectSortAliasPaths(
      selector as SortNode,
      objectAlias,
      dynamicObjectAlias,
      scope,
    );
    const resultPaths =
      selectVariableObjectAliasPaths(objectAlias, dynamicObjectAlias, rest, scope) ?? [];
    const paths = [...sortPaths, ...resultPaths];
    return paths.length > 0 ? paths : null;
  }

  const projectionPaths = selectAliasProjectionStepPaths(
    objectAlias,
    dynamicObjectAlias,
    selector,
    scope,
  );
  if (projectionPaths) return projectionPaths;

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
): string[] {
  const paths: string[] = [];

  for (const term of sortNode.terms) {
    if (term.expression.type !== "path") {
      paths.push(
        ...selectAliasExpressionPaths(
          objectAlias,
          dynamicObjectAlias,
          term.expression,
          scope,
        ),
      );
      continue;
    }

    const suffixSteps = (term.expression as PathNode).steps;
    paths.push(
      ...(objectAlias ? (selectObjectAliasPaths(objectAlias, suffixSteps) ?? []) : []),
      ...(dynamicObjectAlias
        ? selectDynamicObjectAliasPaths(dynamicObjectAlias, suffixSteps)
        : []),
    );
  }

  return paths;
}

function dynamicObjectSource(node: AstNode, scope: ScopeTracker): DynamicObjectAlias | null {
  if (node.type === "object") return { variants: [{ node: node as ObjectNode, scope }] };
  if (node.type !== "block") return null;

  const block = node as BlockNode;
  let currentScope = scope;

  for (const [index, expr] of block.expressions.entries()) {
    const isLast = index === block.expressions.length - 1;
    if (isLast) {
      return expr.type === "object"
        ? { variants: [{ node: expr as ObjectNode, scope: currentScope }] }
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
): string[] | null {
  const conditionPaths =
    step.type === "condition"
      ? walkNode((step as ConditionNode).condition, scope)
      : [];
  const stepReadPaths =
    step.type === "block" ||
    (step.type === "array" && ((step as ArrayNode).predicate?.length ?? 0) > 0) ||
    (step.type === "object" && ((step as ObjectNode).predicate?.length ?? 0) > 0)
      ? walkNode(step, scope)
      : conditionPaths;
  const resultBasePaths = bindingAliasPaths(step, scope);
  const objectAlias = objectAliasForNode(step, scope);
  const dynamicObject = dynamicObjectAliasForNode(step, scope);
  const aliasPaths = selectVariableObjectAliasPaths(
    objectAlias,
    dynamicObject,
    suffixSteps,
    scope,
  );
  if (aliasPaths) {
    return [...stepReadPaths, ...resultBasePaths, ...aliasPaths];
  }

  if (resultBasePaths.length === 0) {
    return stepReadPaths.length > 0 ? stepReadPaths : null;
  }
  if (dynamicObject) return [...stepReadPaths, ...resultBasePaths];

  const suffix = buildPathString(suffixSteps);
  return [
    ...stepReadPaths,
    ...resultBasePaths,
    ...resultBasePaths.map((path) => appendPath(path, suffix)),
  ];
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
): string[] | null {
  if (!step) return null;

  const expressions = projectionStepExpressions(step);
  if (!expressions) return null;

  const paths = expressions.flatMap((expr) =>
    selectAliasExpressionPaths(objectAlias, dynamicObject, expr, scope),
  );
  return paths.length > 0 ? paths : null;
}

function selectAliasExpressionPaths(
  objectAlias: ObjectAlias | null,
  dynamicObject: DynamicObjectAlias | null,
  expression: AstNode,
  scope: ScopeTracker,
): string[] {
  const paths: string[] = [];
  const localPaths = new Set(walkNode(expression, childScope(createScope())));

  for (const path of walkNode(expression, scope)) {
    if (path.startsWith(ROOT_PATH) || !localPaths.has(path)) {
      paths.push(path);
      continue;
    }

    const suffixSteps = aliasSuffixStepsFromPath(path);
    if (!suffixSteps) {
      paths.push(path);
      continue;
    }

    paths.push(
      ...(objectAlias ? (selectObjectAliasPaths(objectAlias, suffixSteps) ?? []) : []),
      ...(dynamicObject ? selectDynamicObjectAliasPaths(dynamicObject, suffixSteps) : []),
    );
  }

  return paths;
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
      const objectPaths = selectVariableObjectAliasPaths(
        objectAlias,
        dynamicObjectAlias,
        node.steps.slice(varStepIndex + 1),
        scope,
      );
      if (objectPaths) return objectPaths;
    }

    const resolved = resolveVariable(scope, varStep.value);

    if (resolved && resolved.length > 0) {
      const paths: string[] = [];

      // Inspect predicates on the resolved VariableNode for ADV-02 wildcard emission
      const predicates = varStep.predicate;
      if (predicates && predicates.length > 0) {
        for (const resolvedPath of resolved) {
          let predicateScope = scope;
          const predicateStageVariables = new Set<string>();
          if (varStep.focusBinding) {
            predicateScope = bindVariable(
              childScope(scope),
              varStep.focusBinding.name,
              [resolvedPath],
            );
            predicateStageVariables.add(varStep.focusBinding.name);
          }
          paths.push(
            ...walkFilterStages(
              predicates,
              resolvedPath,
              predicateScope,
              new Set(),
              predicateStageVariables,
            ),
          );
        }
      }

      // Build suffix from remaining steps after the variable
      const suffixSteps = node.steps.slice(varStepIndex + 1);
      const suffix = buildPathString(suffixSteps);
      let handledFocusProjection = false;

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
        paths.push(...resolved.map((p) => appendPath(p, suffix)));
      }

      for (const resolvedPath of resolved) {
        paths.push(
          ...walkResolvedVariableSuffixFilterStages(
            suffixSteps,
            resolvedPath,
            scope,
            new Set([varStep.value]),
          ),
        );
      }

      for (const resolvedPath of resolved) {
        paths.push(
          ...walkResolvedVariableSuffixSortTerms(
            suffixSteps,
            resolvedPath,
            scope,
            new Set([varStep.value]),
          ),
        );
      }

      if (node.group) {
        for (const resolvedPath of resolved) {
          const suffixBase = buildPathString(suffixSteps) ?? "";
          paths.push(
            ...walkContextGroupEntries(
              node.group,
              appendPath(resolvedPath, suffixBase),
              scope,
              new Set([varStep.value]),
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
  const suppressBase = lastStep?.type === "block";
  const basePath = buildPathString(node.steps);
  const resultAliasStepIndex = node.steps.findIndex(
    (step, index) => index < node.steps.length - 1 && isResultAliasStep(step),
  );
  const funcStepIndex = node.steps.findIndex((s) => s.type === "function");
  if (basePath && resultAliasStepIndex >= 0) {
    if (resultAliasStepIndex === 0) {
      const resultStep = node.steps[resultAliasStepIndex];
      const contextPrefix = buildPathString(node.steps.slice(0, resultAliasStepIndex)) ?? "";
      const resultPaths = selectResultAliasStepPaths(
        resultStep,
        node.steps.slice(resultAliasStepIndex + 1),
        scope,
      );
      if (resultPaths) paths.push(...prefixProjectionPaths(contextPrefix, resultPaths));
    }
  } else if (basePath && funcStepIndex >= 0) {
    // basePath is relative to the function result (e.g., "quantity" from $lookup(...).quantity)
    // Prefix it with the first argument path to produce the chained data path (e.g., "inventory.quantity")
    const funcStep = node.steps[funcStepIndex] as FunctionNode;
    const resultBasePaths = getFunctionResultBasePaths(funcStep, scope);
    if (resultBasePaths.length > 0) {
      for (const resultBasePath of resultBasePaths) {
        paths.push(...prefixPaths(resultBasePath, [basePath]));
      }
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
      !(i > 0 && isResultAliasStep(node.steps[i - 1]))
    ) {
      const projectionPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const resultPaths = selectResultAliasStepPaths(
        step,
        node.steps.slice(i + 1),
        stageScope,
      );
      if (resultPaths) {
        paths.push(
          ...(stageVariables.size > 0
            ? resultPaths
            : prefixProjectionPaths(projectionPrefix, resultPaths)),
        );
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
      if (nameStep.stages && nameStep.stages.length > 0) {
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
      // Object constructor step in path: orders.items.{"key": val}
      // Walk value expressions and prefix with path up to this step
      const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
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
    } else if (step.type === "array") {
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
    } else if (step.type === "block") {
      // Block expression step in path: orders.items.(expr)
      // Walk all expressions and prefix with path up to this step
      const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const blockStep = step as BlockNode;
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
          ...walkContextExpression(expr, contextPrefix, stageScope, stageVariables, true),
        );
      }
    } else if (step.type === "function") {
      // Function call step (e.g., $lookup(obj, key) in $lookup(obj, key).field)
      // Walk the function call to extract argument paths
      paths.push(...walkFunction(step as FunctionNode, stageScope));
    } else if (step.type === "apply") {
      paths.push(...walkApply(step as ApplyNode, stageScope));
    }
  }

  // Handle group-by on the PathNode (node.group)
  if (node.group) {
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
            )
          : selectResultAliasExpressionPaths(aliasStep, term.expression, scope)
        : null;
    paths.push(
      ...(aliasPaths ??
        walkContextExpression(
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

  const resultAliasStep = node.steps.find(isResultAliasStep);
  const objectAlias = resultAliasStep ? objectAliasForNode(resultAliasStep, scope) : null;
  const dynamicObjectAlias = resultAliasStep
    ? dynamicObjectAliasForNode(resultAliasStep, scope)
    : null;
  if (objectAlias || dynamicObjectAlias) {
    return walkAliasGroupEntries(groupNode, objectAlias, dynamicObjectAlias, scope);
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
): string[] {
  return groupNode.entries.flatMap(([keyExpr, valExpr]) => [
    ...selectAliasExpressionPaths(objectAlias, dynamicObjectAlias, keyExpr, scope),
    ...selectAliasExpressionPaths(objectAlias, dynamicObjectAlias, valExpr, scope),
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
  const patternPaths = walkNode(node.pattern, scope);
  const patternPrefixes = patternPaths.length > 0 ? patternPaths : [""];
  paths.push(...patternPaths);

  // Walk update and prefix results with pattern path
  if (node.update) {
    const updatePaths = walkNode(node.update, scope);
    paths.push(
      ...patternPrefixes.flatMap((patternPrefix) =>
        prefixPaths(patternPrefix, updatePaths),
      ),
    );
  }

  // Delete clause: string literals only, no paths extracted
  if (node.delete) {
    const deletePaths = walkNode(node.delete, scope);
    paths.push(
      ...patternPrefixes.flatMap((patternPrefix) =>
        prefixPaths(patternPrefix, deletePaths),
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
    const objectAlias = objectAliasFromBlock(node, scope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(node, scope);
    paths.push(
      ...(objectAlias || dynamicObjectAlias
        ? walkAliasGroupEntries(
            node.group,
            objectAlias,
            dynamicObjectAlias,
            currentScope,
          )
        : bindingAliasPathsFromBlock(node, scope).flatMap((basePath) =>
            walkContextGroupEntries(node.group!, basePath, currentScope),
          )),
    );
  }

  if (node.predicate && node.predicate.length > 0) {
    for (const resultBasePath of bindingAliasPathsFromBlock(node, scope)) {
      paths.push(...walkFilterStages(node.predicate, resultBasePath, currentScope));
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
    for (const resultBasePath of bindingAliasPaths(node, scope)) {
      paths.push(...walkFilterStages(node.predicate, resultBasePath, currentScope));
    }
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
    for (const stage of node.predicate) {
      if (stage.type !== "filter") continue;
      paths.push(
        ...selectAliasExpressionPaths(
          objectAlias,
          dynamicObjectAlias,
          (stage as unknown as FilterStage).expr,
          scope,
        ),
      );
    }
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
    const paths = [...resolved];

    // Inspect predicates on the standalone VariableNode (mirrors walkPath variable branch)
    const predicates = node.predicate;
    if (predicates && predicates.length > 0) {
      for (const resolvedPath of resolved) {
        let predicateScope = scope;
        const predicateStageVariables = new Set<string>();
        if (node.focusBinding) {
          predicateScope = bindVariable(
            childScope(scope),
            node.focusBinding.name,
            [resolvedPath],
          );
          predicateStageVariables.add(node.focusBinding.name);
        }
        paths.push(
          ...walkFilterStages(
            predicates,
            resolvedPath,
            predicateScope,
            new Set(),
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
      paths.push(
        ...(objectAlias || dynamicObjectAlias
          ? walkAliasGroupEntries(groupNode, objectAlias, dynamicObjectAlias, scope)
          : walkContextGroupEntries(
              groupNode,
              resolved.length > 0 ? resolved[0] : "",
              scope,
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

  return withFunctionStages(paths);
}

function walkFunctionPredicates(node: FunctionNode, scope: ScopeTracker): string[] {
  if (!node.predicate || node.predicate.length === 0) return [];

  const objectAlias = getFunctionResultObjectAlias(node, scope);
  const dynamicObjectAlias = getFunctionResultDynamicObjectAlias(node, scope);

  if (objectAlias || dynamicObjectAlias) {
    return node.predicate.flatMap((stage) =>
      stage.type === "filter"
        ? selectAliasExpressionPaths(
            objectAlias,
            dynamicObjectAlias,
            (stage as unknown as FilterStage).expr,
            scope,
          )
        : [],
    );
  }

  return getFunctionResultBasePaths(node, scope).flatMap((basePath) =>
    walkFilterStages(node.predicate!, basePath, scope),
  );
}

function walkFunctionGroupBy(node: FunctionNode, scope: ScopeTracker): string[] {
  if (!node.group) return [];

  const objectAlias = getFunctionResultObjectAlias(node, scope);
  const dynamicObjectAlias = getFunctionResultDynamicObjectAlias(node, scope);

  if (objectAlias || dynamicObjectAlias) {
    return walkAliasGroupEntries(node.group, objectAlias, dynamicObjectAlias, scope);
  }

  return getFunctionResultBasePaths(node, scope).flatMap((basePath) =>
    walkContextGroupEntries(node.group!, basePath, scope),
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
        const aliasPaths = selectVariableObjectAliasPaths(
          objectAlias,
          dynamicObjectAlias,
          pathNode.steps.slice(varStepIndex + 1),
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
    const basePath = buildPathString(pathNode.steps);
    return basePath ? [basePath] : [];
  }
  if (node.type === "apply") {
    // Chained apply base identity comes from the leftmost operand
    return extractBasePaths((node as ApplyNode).lhs, scope);
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

  return walkNode(lambda.body, lambdaScope);
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

  return walkNode(lambda.body, lambdaScope);
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
  paths.push(...walkNode(lambda.body, lambdaScope));

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

  if (!PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName)) return null;
  if (funcName === "lookup") return null;
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

  if (!PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName)) return null;
  if (funcName === "lookup") return null;
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

  return objectAliasForNode(lambda.body, lambdaScope);
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

  return dynamicObjectAliasForNode(lambda.body, lambdaScope);
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

  return objectAliasForNode(callback.lambda.body, lambdaScope);
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

  return dynamicObjectAliasForNode(callback.lambda.body, lambdaScope);
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

  return objectAliasForNode(callback.lambda.body, lambdaScope);
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

  return dynamicObjectAliasForNode(callback.lambda.body, lambdaScope);
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

  return bindingAliasPaths(lambda.body, lambdaScope);
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

  return bindingAliasPaths(callback.lambda.body, lambdaScope);
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

  return bindingAliasPaths(callback.lambda.body, lambdaScope);
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
  const paths: string[] = [];

  const objectAlias = objectAliasForNode(objectArg, scope);
  const objectPaths = objectAlias ? selectObjectAliasPaths(objectAlias, selectorSteps) : null;
  if (objectPaths) paths.push(...objectPaths);

  const dynamicObjectAlias = dynamicObjectAliasForNode(objectArg, scope);
  if (dynamicObjectAlias) {
    paths.push(...selectLookupDynamicObjectAliasPaths(dynamicObjectAlias, []));
  }

  return paths.length > 0 ? paths : getResultBasePathsFromArg(objectArg, scope);
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
  if (node.type === "function") {
    const paths = getFunctionResultBasePaths(node as FunctionNode, scope);
    return paths.length > 0 ? paths : walkNode(node, scope).slice(0, 1);
  }

  if (node.type === "path") {
    const pathNode = node as PathNode;
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
    // Inline lambda application: bind first parameter to lhs paths
    const lambda = node.rhs as LambdaNode;
    let lambdaScope = childScope(scope);
    if (lambda.arguments.length > 0) {
      lambdaScope = bindVariable(lambdaScope, lambda.arguments[0].value, lhsPaths);
    }
    paths.push(...walkNode(lambda.body, lambdaScope));
  } else if (node.rhs.type === "transform") {
    const transformPaths = walkTransform(node.rhs as TransformNode, scope);
    paths.push(...prefixPaths(lhsPaths[0] ?? "", transformPaths));
  } else {
    // Fallback: unusual RHS (e.g., variable reference)
    paths.push(...walkNode(node.rhs, scope));
  }

  return paths;
}
