import type {
  ArrayNode,
  AstNode,
  ApplyNode,
  BinaryNode,
  BindNode,
  BlockNode,
  ConditionNode,
  DescendantNode,
  FilterStage,
  FunctionNode,
  GroupByNode,
  LambdaNode,
  NameNode,
  NegateNode,
  ObjectNode,
  ParentNode,
  PathNode,
  PartialNode,
  PositionBindingNode,
  SortNode,
  TransformNode,
  VariableNode,
  WildcardNode,
} from "./types.js";
import { buildPathString } from "./path-builder.js";
import { parse } from "./parser.js";
import {
  type ScopeTracker,
  createScope,
  childScope,
  bindVariable,
  bindSuffixBasePaths,
  bindObjectAlias,
  bindDynamicObjectAlias,
  bindLambda,
  bindLambdaReference,
  bindPartial,
  bindTransform,
  bindValue,
  resolveLambda,
  resolvePartial,
  resolveTransform,
  resolveValue,
  resolveValueFrame,
  resolveVariable,
  resolveSuffixBasePaths,
  resolveObjectAlias,
  resolveDynamicObjectAlias,
  type DynamicObjectAlias,
  type LambdaBinding,
  type ObjectAlias,
  type TransformBinding,
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

function bindCallableValue(
  scope: ScopeTracker,
  name: string,
  value: AstNode,
  closureScope: ScopeTracker,
): ScopeTracker {
  const valueScope = bindValue(scope, name, value, closureScope);
  if (value.type === "lambda") {
    return bindLambda(valueScope, name, value as LambdaNode, closureScope);
  }
  if (value.type === "partial") {
    return bindPartial(valueScope, name, value as PartialNode, closureScope);
  }
  if (value.type === "transform") {
    return bindTransform(valueScope, name, value as TransformNode, closureScope);
  }
  if (value.type === "apply") {
    const composition = compositionLambda(value as ApplyNode, closureScope);
    if (composition) return bindLambda(valueScope, name, composition, closureScope);
  }
  return valueScope;
}
const IMPLICIT_ROOT_SHALLOW_FUNCTIONS = new Set([
  "keys",
  "spread",
  "boolean",
  "not",
]);
const IMPLICIT_ROOT_DEEP_FUNCTIONS = new Set(["clone", "string"]);
const MATCHER_CALLBACK_FUNCTIONS = new Set([
  "contains",
  "match",
  "replace",
  "split",
]);

const CONTEXT_DEFAULT_BUILTINS = new Set([
  "string",
  "substring",
  "substringBefore",
  "substringAfter",
  "lowercase",
  "uppercase",
  "length",
  "trim",
  "pad",
  "match",
  "contains",
  "replace",
  "split",
  "formatNumber",
  "formatBase",
  "formatInteger",
  "parseInteger",
  "number",
  "floor",
  "ceil",
  "round",
  "abs",
  "sqrt",
  "power",
  "boolean",
  "not",
  "sift",
  "keys",
  "lookup",
  "spread",
  "each",
  "base64encode",
  "base64decode",
  "encodeUrlComponent",
  "encodeUrl",
  "decodeUrlComponent",
  "decodeUrl",
  "toMillis",
  "fromMillis",
  "clone",
]);

function builtinUsesContextDefault(funcName: string, args: AstNode[]): boolean {
  if (!CONTEXT_DEFAULT_BUILTINS.has(funcName)) return false;
  if (args.length === 0) return true;

  switch (funcName) {
    case "substring":
      return args[0]?.type !== "string";
    case "substringBefore":
    case "substringAfter":
    case "contains":
    case "split":
    case "parseInteger":
      return args.length < 2;
    case "replace":
      return args.length < 3;
    case "pad":
      return args[0]?.type === "number";
    case "formatNumber":
    case "formatInteger":
    case "fromMillis":
      return args[0]?.type !== "number";
    case "match":
      return args[0]?.type !== "string";
    case "power":
      return args.length < 2;
    case "lookup":
    case "each":
    case "sift":
      return args.length === 1;
    default:
      return false;
  }
}

function functionUsesContextDefault(
  node: FunctionNode,
  scope: ScopeTracker,
): boolean {
  const builtins = resolveBuiltinCallableNames(node.procedure, scope);
  const lambdas = resolveCallableValues(node.procedure, scope).flatMap(
    (callable) => (callable.kind === "lambda" ? [callable.binding.lambda] : []),
  );
  return (
    (builtins.length > 0 &&
      builtins.every((name) => builtinUsesContextDefault(name, node.arguments))) ||
    (lambdas.length > 0 &&
      lambdas.every(
        (lambda) =>
          contextDefaultParameterIndex(lambda) >= 0 &&
          node.arguments.length < lambda.arguments.length,
      ))
  );
}

function resultUsesContextDefault(node: AstNode, scope: ScopeTracker): boolean {
  if (node.type === "function") {
    return functionUsesContextDefault(node as FunctionNode, scope);
  }
  if (node.type === "condition") {
    const condition = node as ConditionNode;
    const branches = [condition.then, condition.else].filter(
      (branch): branch is AstNode => Boolean(branch),
    );
    return (
      branches.length > 0 &&
      branches.every((branch) => resultUsesContextDefault(branch, scope))
    );
  }
  if (node.type === "path") {
    const firstStep = (node as PathNode).steps[0];
    return firstStep ? resultUsesContextDefault(firstStep, scope) : false;
  }
  if (node.type === "block") {
    const block = node as BlockNode;
    let blockScope = scope;
    for (const [index, expression] of block.expressions.entries()) {
      if (index === block.expressions.length - 1) {
        return resultUsesContextDefault(expression, blockScope);
      }
      if (expression.type === "bind") {
        blockScope = bindCallableBlockValue(blockScope, expression as BindNode);
      }
    }
  }
  return false;
}

function withImplicitRootFunctionArgument(
  funcName: string,
  args: AstNode[],
  position: number,
  scope?: ScopeTracker,
): AstNode[] {
  if (!["lookup", "each", "sift"].includes(funcName) || args.length !== 1) {
    return args;
  }

  return [
    {
      type: "variable",
      value: scope && resolveVariable(scope, "") !== null ? "" : "$",
      position,
    } as VariableNode,
    ...args,
  ];
}

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
      return walkWildcard(node as WildcardNode, scope);
    case "descendant":
      return walkDescendant(node as DescendantNode, scope);
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
      return walkLiteralPredicates(node, scope);
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

function walkLiteralPredicates(
  node: AstNode & {
    predicate?: AstNode[];
    group?: GroupByNode;
    focusBinding?: { name: string };
    indexBinding?: { name: string };
  },
  scope: ScopeTracker,
): string[] {
  let literalScope = scope;
  if (node.focusBinding) {
    literalScope = bindVariable(childScope(literalScope), node.focusBinding.name, []);
  }
  if (node.indexBinding) {
    if (literalScope === scope) literalScope = childScope(literalScope);
    literalScope = bindVariable(literalScope, node.indexBinding.name, []);
  }
  return [
    ...walkSourceLessFilterStages(
      node.predicate ?? [],
      literalScope,
    ),
    ...(node.group
      ? walkSourceLessGroupEntries(node.group, literalScope)
      : []),
  ];
}

function walkWildcard(node: WildcardNode, scope: ScopeTracker): string[] {
  const { stageScope, stageVariables, nonPathVariables } = bindBroadStepScope(
    node,
    "*",
    scope,
  );
  return [
    "*",
    ...walkFilterStages(
      node.predicate ?? [],
      "*",
      stageScope,
      nonPathVariables,
      stageVariables,
    ),
    ...(node.group
      ? walkContextGroupEntries(node.group, "*", stageScope, stageVariables)
      : []),
  ];
}

function walkDescendant(node: DescendantNode, scope: ScopeTracker): string[] {
  const { stageScope, stageVariables, nonPathVariables } = bindBroadStepScope(
    node,
    "**",
    scope,
  );
  return [
    "**",
    ...walkFilterStages(
      node.predicate ?? [],
      "**",
      stageScope,
      nonPathVariables,
      stageVariables,
    ),
    ...(node.group
      ? walkContextGroupEntries(node.group, "**", stageScope, stageVariables)
      : []),
  ];
}

function bindBroadStepScope(
  node: WildcardNode | DescendantNode,
  basePath: string,
  scope: ScopeTracker,
): {
  stageScope: ScopeTracker;
  stageVariables: Set<string>;
  nonPathVariables: Set<string>;
} {
  let stageScope = scope;
  const stageVariables = new Set<string>();
  const nonPathVariables = new Set<string>();
  if (node.focusBinding) {
    stageScope = bindVariable(childScope(stageScope), node.focusBinding.name, [basePath]);
    stageVariables.add(node.focusBinding.name);
  }
  if (node.indexBinding) {
    if (stageScope === scope) stageScope = childScope(stageScope);
    stageScope = bindVariable(stageScope, node.indexBinding.name, []);
    stageVariables.add(node.indexBinding.name);
    nonPathVariables.add(node.indexBinding.name);
  }
  return { stageScope, stageVariables, nonPathVariables };
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

interface ResolvedTransformCall {
  readonly binding: TransformBinding;
  readonly arguments: AstNode[];
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
    const callback = findHigherOrderTransformCallback(
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

  const selectedCallables = resolveCallableValues(functionNode.procedure, scope);
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
          arguments: applyPartialArguments(
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
      arguments: applyPartialArguments(
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
        .map(([key]) => staticObjectKey(key))
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
        if (staticObjectKey(keyNode) !== updateKey) continue;
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
    const inputPaths = identityReferencePaths(input, scope) ?? walkNode(input, scope);
    const inputBasePaths = extractBasePaths(input, scope);
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
    Boolean(projectionStepExpressions(step)),
  );
  if (projectionIndex <= 0) return null;

  const projectionContextSteps = patternSteps.slice(0, projectionIndex);
  const projectionContextPaths = selectAliasSuffixContextPaths(
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
    ...walkAliasSuffixProjectionSteps(
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
  const objectAlias = objectAliasForNode(lhs, scope);
  const dynamicObjectAlias = dynamicObjectAliasForNode(lhs, scope);
  if (!objectAlias && !dynamicObjectAlias) return null;

  const patternSteps = transformPatternSteps(transformNode.pattern);
  const patternPrefix = patternSteps ? buildPathString(patternSteps) : null;
  if (!patternSteps || !patternPrefix) return null;

  const suffixBasePaths =
    lhs.type === "variable"
      ? (resolveSuffixBasePaths(scope, (lhs as VariableNode).value) ?? [])
      : getResultSuffixBasePaths(lhs, scope);
  const projectionContextPaths = transformApplyAliasProjectionContextPaths(
    transformNode,
    patternSteps,
    objectAlias,
    dynamicObjectAlias,
    scope,
    suffixBasePaths,
  );
  if (projectionContextPaths) return projectionContextPaths;

  const selectedPatternPrefixes = selectAliasSuffixContextPaths(
    patternSteps,
    objectAlias,
    dynamicObjectAlias,
    scope,
    suffixBasePaths,
  );
  if (selectedPatternPrefixes.length === 0) return null;

  const transformBasePaths = extractBasePaths(lhs, scope);
  const unmatchedSuffixBasePaths = unmatchedAliasSuffixBasePaths(
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
  return node.type === "variable" && ["", "$"].includes((node as VariableNode).value);
}

function identityReferencePaths(
  node: AstNode,
  scope: ScopeTracker,
): string[] | null {
  if (!isRootReference(node)) return null;
  if ((node as VariableNode).value === "") {
    const capturedCurrent = resolveVariable(scope, "");
    if (capturedCurrent !== null) return [...capturedCurrent];
  }
  return [ROOT_PATH];
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
  const identityPaths = identityReferencePaths(node, scope);
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
      const paths = getResultBasePathsFromArg(node, scope);
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
      ? resolveDynamicVariantObjectAlias(nestedAlias, {
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
      ? resolveDynamicVariantDynamicObjectAlias(nestedDynamicAlias, {
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
      ...resolveDynamicVariantPaths(bindingAliasPaths(valueNode, scope), {
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
        ? resolveDynamicVariantObjectAlias(nestedAlias, variant)
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
        ? resolveDynamicVariantDynamicObjectAlias(nestedDynamicAlias, variant)
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
        ...resolveDynamicVariantPaths(
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
        ? resolveDynamicVariantDynamicObjectAlias(valueAlias, variant)
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
          ? resolveDynamicVariantObjectAlias(valueAlias, variant)
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

      currentScope = bindCallableValue(
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
    return getFunctionResultDynamicObjectAlias(node as FunctionNode, scope);
  }
  if (node.type === "apply") {
    const func = appliedFunctionFromApply(node as ApplyNode);
    return func ? getFunctionResultDynamicObjectAlias(func, scope) : null;
  }
  return null;
}

function groupResultObjectAliasForNode(
  node: AstNode,
  scope: ScopeTracker,
): ObjectAlias | null {
  const group = (node as AstNode & { group?: GroupByNode }).group;
  if (!group) return objectAliasForNode(node, scope);

  const contextPaths = getResultBasePathsFromArg(
    { ...node, group: undefined } as AstNode,
    scope,
  );
  const fields = new Map<string, string[]>();
  for (const [keyNode, valueNode] of group.entries) {
    const key = staticObjectKey(keyNode);
    if (!key) continue;
    const aliases = contextPaths.flatMap((contextPath) =>
      walkContextExpression(valueNode, contextPath, scope),
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
  return prefixDynamicObjectAlias(
    dynamicObjectAliasFromObject(groupObject, scope),
    getResultBasePathsFromArg(
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
    : getResultSuffixBasePaths(node, scope);
}

function groupResultSuffixableBasePaths(
  node: AstNode,
  scope: ScopeTracker,
): string[] {
  return (node as AstNode & { group?: GroupByNode }).group
    ? []
    : getSuffixableResultBasePaths(node, scope);
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
    [],
    preserveAliasLocalPaths,
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
  if (
    suffix &&
    resultAliasStep.type === "function" &&
    transformWritesSuffix(resultAliasStep as FunctionNode, suffixSteps, scope)
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

      currentScope = bindCallableValue(
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
  const usesCurrentContext =
    variables.has("") ||
    containsContextDefaultLambda(expr) ||
    containsContextDefaultCall(expr, scope) ||
    containsBuiltinContextDefaultCall(expr) ||
    resultUsesContextDefault(expr, scope);
  if (usesCurrentContext && contextPrefix) {
    const contextScope = bindVariable(childScope(scope), "", [contextPrefix]);
    const contextPaths = walkNode(expr, contextScope);
    if (keepBarePathsRootRelative && stageVariables.size > 0) {
      return contextPaths;
    }
    return contextPaths.flatMap((path) =>
      localSet.has(path) ? prefixPaths(contextPrefix, [path]) : [path],
    );
  }

  const hasStageVariable = [...variables].some((name) => stageVariables.has(name));
  if (keepBarePathsRootRelative && stageVariables.size > 0) {
    return hasStageVariable ? walkNode(expr, scope) : [...localPaths];
  }

  const paths = prefixPaths(contextPrefix, localPaths);
  for (const scopedPath of walkNode(expr, scope)) {
    if (!localSet.has(scopedPath)) paths.push(scopedPath);
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

function containsContextDefaultLambda(node: AstNode): boolean {
  if (
    node.type === "lambda" &&
    contextDefaultParameterIndex(node as LambdaNode) >= 0
  ) {
    return true;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "source") continue;
    if (Array.isArray(value)) {
      if (
        value.some(
          (item) =>
            item &&
            typeof item === "object" &&
            containsContextDefaultLambda(item as AstNode),
        )
      ) {
        return true;
      }
    } else if (
      value &&
      typeof value === "object" &&
      containsContextDefaultLambda(value as AstNode)
    ) {
      return true;
    }
  }
  return false;
}

function containsContextDefaultCall(
  node: AstNode,
  scope: ScopeTracker,
): boolean {
  if (node.type === "function") {
    const functionNode = node as FunctionNode;
    const binding =
      functionNode.procedure.type === "lambda"
        ? { lambda: functionNode.procedure, scope }
        : functionNode.procedure.type === "variable"
          ? resolveLambda(scope, functionNode.procedure.value)
          : null;
    if (
      binding &&
      contextDefaultParameterIndex(binding.lambda) >= 0 &&
      functionNode.arguments.length < binding.lambda.arguments.length
    ) {
      return true;
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "source") continue;
    if (Array.isArray(value)) {
      if (
        value.some(
          (item) =>
            item &&
            typeof item === "object" &&
            containsContextDefaultCall(item as AstNode, scope),
        )
      ) {
        return true;
      }
    } else if (
      value &&
      typeof value === "object" &&
      containsContextDefaultCall(value as AstNode, scope)
    ) {
      return true;
    }
  }
  return false;
}

function containsBuiltinContextDefaultCall(node: AstNode): boolean {
  if (
    node.type === "function" &&
    (node as FunctionNode).procedure.type === "variable" &&
    builtinUsesContextDefault(
      ((node as FunctionNode).procedure as VariableNode).value,
      (node as FunctionNode).arguments,
    )
  ) {
    return true;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "source") continue;
    if (Array.isArray(value)) {
      if (
        value.some(
          (item) =>
            item &&
            typeof item === "object" &&
            containsBuiltinContextDefaultCall(item as AstNode),
        )
      ) {
        return true;
      }
    } else if (
      value &&
      typeof value === "object" &&
      containsBuiltinContextDefaultCall(value as AstNode)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Extract paths from a path node's steps, handling variable steps,
 * filter stages on name steps, sort steps, and group-by expressions.
 */
function walkPath(node: PathNode, scope: ScopeTracker): string[] {
  if (node.steps.length === 0) return [];

  const transparentBlockCount = node.steps.filter(isTransparentPathBlock).length;
  const transparentSteps = flattenTransparentPathBlocks(node.steps);
  if (
    isTransparentPathBlock(node.steps[0]) &&
    transparentBlockCount >= 2 &&
    transparentSteps
  ) {
    return walkPath({ ...node, steps: transparentSteps }, scope);
  }

  const storedCallableFunctionIndex = node.steps.findIndex(
    (step, index) =>
      index > 0 && step.type === "function" &&
      (step as FunctionNode).procedure.type === "path",
  );
  if (storedCallableFunctionIndex > 0) {
    const functionStep = node.steps[storedCallableFunctionIndex] as FunctionNode;
    const procedure = {
      ...(functionStep.procedure as PathNode),
      steps: [
        ...node.steps.slice(0, storedCallableFunctionIndex),
        ...(functionStep.procedure as PathNode).steps,
      ],
    } as PathNode;
    if (resolveCallableValues(procedure, scope).length > 0) {
      return walkPath(
        {
          ...node,
          steps: [
            { ...functionStep, procedure },
            ...node.steps.slice(storedCallableFunctionIndex + 1),
          ],
        },
        scope,
      );
    }
  }

  let stageScope = childScope(scope);
  const stageVariables = new Set<string>();
  const nonPathVariables = new Set<string>();

  const firstStep = node.steps[0];
  const capturedCurrentPaths =
    firstStep.type === "variable" && (firstStep as VariableNode).value === ""
      ? resolveVariable(scope, "")
      : null;
  if (capturedCurrentPaths && capturedCurrentPaths.length > 0) {
    const currentStep = firstStep as VariableNode;
    const suffixSteps = node.steps.slice(1);
    const suffix = buildPathString(suffixSteps);
    const paths = capturedCurrentPaths.map((path) => appendPath(path, suffix));
    for (const capturedPath of capturedCurrentPaths) {
      paths.push(
        ...walkFilterStages(
          currentStep.predicate ?? [],
          capturedPath,
          scope,
        ),
        ...walkResolvedVariableSuffixFilterStages(
          suffixSteps,
          capturedPath,
          scope,
          new Set(),
        ),
      );
    }
    return paths;
  }
  if (capturedCurrentPaths !== null) return [];

  if (isRootReference(node.steps[0])) {
    const rootStep = node.steps[0] as VariableNode;
    let rootScope = childScope(scope);
    if (rootStep.focusBinding) {
      rootScope = bindVariable(rootScope, rootStep.focusBinding.name, [ROOT_PATH]);
      stageVariables.add(rootStep.focusBinding.name);
    }
    if (rootStep.indexBinding) {
      rootScope = bindVariable(rootScope, rootStep.indexBinding.name, []);
      nonPathVariables.add(rootStep.indexBinding.name);
    }
    const stagePaths = walkFilterStages(
      rootStep.predicate ?? [],
      ROOT_PATH,
      rootScope,
      nonPathVariables,
      stageVariables,
    );
    const rootPaths = walkPath(
      { ...node, steps: node.steps.slice(1) },
      rootScope,
    );
    return [
      ...stagePaths,
      ...(rootPaths.length > 0 ? markAbsolute(rootPaths) : [ROOT_PATH]),
    ];
  }

  const rootContextStepIndex = node.steps.findIndex(
    (step, index) =>
      index > 0 &&
      step.type === "variable" &&
      (step as VariableNode).value === "$",
  );
  if (rootContextStepIndex >= 0) {
    const rootStep = node.steps[rootContextStepIndex] as VariableNode;
    let rootScope = childScope(scope);
    const rootStageVariables = new Set<string>();
    const rootNonPathVariables = new Set<string>();
    if (rootStep.focusBinding) {
      rootScope = bindVariable(rootScope, rootStep.focusBinding.name, [ROOT_PATH]);
      rootStageVariables.add(rootStep.focusBinding.name);
    }
    if (rootStep.indexBinding) {
      rootScope = bindVariable(rootScope, rootStep.indexBinding.name, []);
      rootNonPathVariables.add(rootStep.indexBinding.name);
    }
    const prefixPaths = walkPath(
      { ...node, steps: node.steps.slice(0, rootContextStepIndex), group: undefined },
      scope,
    );
    const suffixPaths = walkPath(
      { ...node, steps: node.steps.slice(rootContextStepIndex + 1) },
      rootScope,
    );
    return [
      ...prefixPaths,
      ...walkFilterStages(
        rootStep.predicate ?? [],
        ROOT_PATH,
        rootScope,
        rootNonPathVariables,
        rootStageVariables,
      ),
      ...(suffixPaths.length > 0 ? markAbsolute(suffixPaths) : [ROOT_PATH]),
    ];
  }

  const initialLookupStep = node.steps[0];
  if (
    initialLookupStep?.type === "function" &&
    (initialLookupStep as FunctionNode).procedure.type === "variable" &&
    ((initialLookupStep as FunctionNode).procedure as VariableNode).value === "lookup" &&
    (initialLookupStep as FunctionNode).arguments.length === 1
  ) {
    const lookup = initialLookupStep as FunctionNode;
    return walkPath(
      {
        ...node,
        steps: [
          {
            ...lookup,
            arguments: withImplicitRootFunctionArgument(
              "lookup",
              lookup.arguments,
              lookup.position,
            ),
          },
          ...node.steps.slice(1),
        ],
      },
      scope,
    );
  }

  const contextDefaultLookupIndex = node.steps.findIndex(
    (step, index) =>
      index > 0 &&
      step.type === "function" &&
      (step as FunctionNode).procedure.type === "variable" &&
      ((step as FunctionNode).procedure as VariableNode).value === "lookup" &&
      (step as FunctionNode).arguments.length === 1,
  );
  if (contextDefaultLookupIndex >= 0) {
    const lookup = node.steps[contextDefaultLookupIndex] as FunctionNode;
    const apply: ApplyNode = {
      type: "apply",
      value: "~>",
      position: lookup.position,
      lhs: {
        ...node,
        steps: node.steps.slice(0, contextDefaultLookupIndex),
        group: undefined,
      },
      rhs: lookup,
    };
    const suffixSteps = node.steps.slice(contextDefaultLookupIndex + 1);
    return suffixSteps.length === 0 && !node.group
      ? walkApply(apply, scope)
      : walkPath({ ...node, steps: [apply, ...suffixSteps] }, scope);
  }

  // Check if any step is an externally scoped variable (e.g., $x.name).
  // Variables introduced by earlier path-stage @/# bindings are handled by the
  // normal path walker below after those bindings are in scope.
  const varStepIndex = firstUnboundPathVariableIndex(node.steps);

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
          ).map(resolveParentPathSegments),
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
            ).map(resolveParentPathSegments),
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
  let localVariableSuffixStart = -1;
  const referencedVariables = collectVariableNames(node);
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
    const functionSuffixSteps = node.steps.slice(funcStepIndex + 1);
    const suffixIsTransformOutput = transformWritesSuffix(
      funcStep,
      functionSuffixSteps,
      scope,
    );
    const resultBasePaths = getFunctionResultBasePaths(funcStep, scope);
    if (resultBasePaths.length > 0) {
      for (const resultBasePath of resultBasePaths) {
        if (!suffixIsTransformOutput) {
          paths.push(...prefixPaths(resultBasePath, [basePath]));
        }
        paths.push(
          ...walkResolvedVariableSuffixFilterStages(
            functionSuffixSteps,
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
    if (localVariableSuffixStart >= 0 && i > localVariableSuffixStart) continue;
    const step = node.steps[i];
    const contextPrefix = buildPathString(node.steps.slice(0, i + 1)) ?? "";

    if (
      i < node.steps.length - 1 &&
      isResultAliasStep(step) &&
      !(i > 0 && isResultAliasStep(node.steps[i - 1])) &&
      !(resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart)
    ) {
      const projectionPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const usesContextDefault = resultUsesContextDefault(step, stageScope);
      const resultAliasScope =
        projectionPrefix &&
        (collectVariableNames(step).has("") || usesContextDefault)
          ? bindVariable(childScope(stageScope), "", [projectionPrefix])
          : stageScope;
      const resultPaths = selectResultAliasStepPaths(
        step,
        node.steps.slice(i + 1),
        resultAliasScope,
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
          resultAliasScope,
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
        if (!referencedVariables.has(nameStep.focusBinding.name) && contextPrefix) {
          paths.push(contextPrefix);
        }
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
            nameStep.focusBinding ? parentPath(contextPrefix) : contextPrefix,
            stageScope,
            nonPathVariables,
            stageVariables,
          ),
        );
      }
    } else if (step.type === "variable" && (step as VariableNode).value === "") {
      const contextStep = step as VariableNode;
      if (contextStep.focusBinding) {
        stageScope = bindVariable(
          stageScope,
          contextStep.focusBinding.name,
          contextPrefix ? [contextPrefix] : [],
        );
        stageVariables.add(contextStep.focusBinding.name);
      }
      if (contextStep.indexBinding) {
        stageScope = bindVariable(stageScope, contextStep.indexBinding.name, []);
        nonPathVariables.add(contextStep.indexBinding.name);
      }
      paths.push(
        ...walkFilterStages(
          contextStep.predicate ?? [],
          contextPrefix,
          stageScope,
          nonPathVariables,
          stageVariables,
        ),
      );
    } else if (step.type === "variable") {
      if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
        continue;
      }
      const variableStep = step as VariableNode;
      const resolved = resolveVariable(stageScope, variableStep.value);
      if (resolved && resolved.length > 0) {
        const suffixSteps = node.steps.slice(i + 1);
        const suffix = buildPathString(suffixSteps);
        paths.push(...resolved.map((path) => appendPath(path, suffix)));
        for (const resolvedPath of resolved) {
          paths.push(
            ...walkResolvedVariableSuffixFilterStages(
              suffixSteps,
              resolvedPath,
              stageScope,
              stageVariables,
            ),
            ...walkResolvedVariableSuffixSortTerms(
              suffixSteps,
              resolvedPath,
              stageScope,
              stageVariables,
            ),
            ...walkResultBaseSuffixProjectionSteps(
              [resolvedPath],
              suffixSteps,
              stageScope,
            ).map(resolveParentPathSegments),
            ...walkResultBaseSuffixFunctionSteps(
              [resolvedPath],
              suffixSteps,
              stageScope,
            ),
          );
          if (node.group) {
            paths.push(
              ...walkContextGroupEntries(
                node.group,
                appendPath(resolvedPath, suffix),
                stageScope,
                stageVariables,
              ),
            );
          }
        }
        if (node.group) skipResultAliasGroupBy = true;
        localVariableSuffixStart = i;
      }
    } else if (step.type === "wildcard") {
      const wildcardStep = step as WildcardNode;
      const wildcardBindings = bindBroadStepScope(
        wildcardStep,
        contextPrefix,
        stageScope,
      );
      stageScope = wildcardBindings.stageScope;
      wildcardBindings.stageVariables.forEach((name) => stageVariables.add(name));
      wildcardBindings.nonPathVariables.forEach((name) =>
        nonPathVariables.add(name),
      );
      if (wildcardStep.predicate && wildcardStep.predicate.length > 0) {
        paths.push(
          ...walkFilterStages(
            wildcardStep.predicate,
            contextPrefix,
            stageScope,
            nonPathVariables,
            stageVariables,
          ),
        );
      }
    } else if (step.type === "descendant") {
      const descendantStep = step as DescendantNode;
      const descendantBindings = bindBroadStepScope(
        descendantStep,
        contextPrefix,
        stageScope,
      );
      stageScope = descendantBindings.stageScope;
      descendantBindings.stageVariables.forEach((name) =>
        stageVariables.add(name),
      );
      descendantBindings.nonPathVariables.forEach((name) =>
        nonPathVariables.add(name),
      );
      if (descendantStep.predicate && descendantStep.predicate.length > 0) {
        paths.push(
          ...walkFilterStages(
            descendantStep.predicate,
            contextPrefix,
            stageScope,
            nonPathVariables,
            stageVariables,
          ),
        );
      }
    } else if (step.type === "parent") {
      const parentStep = step as ParentNode;
      if (parentStep.predicate && parentStep.predicate.length > 0) {
        paths.push(
          ...walkFilterStages(
            parentStep.predicate,
            contextPrefix,
            stageScope,
            nonPathVariables,
            stageVariables,
          ),
        );
      }
    } else if (["string", "number", "value", "regex"].includes(step.type)) {
      const literalStep = step as AstNode & {
        predicate?: AstNode[];
        group?: GroupByNode;
        focusBinding?: { name: string };
        indexBinding?: { name: string };
      };
      if (literalStep.focusBinding) {
        stageScope = bindVariable(
          stageScope,
          literalStep.focusBinding.name,
          [],
        );
        stageVariables.add(literalStep.focusBinding.name);
      }
      if (literalStep.indexBinding) {
        stageScope = bindVariable(stageScope, literalStep.indexBinding.name, []);
        stageVariables.add(literalStep.indexBinding.name);
        nonPathVariables.add(literalStep.indexBinding.name);
      }
      paths.push(
        ...walkSourceLessFilterStages(
          literalStep.predicate ?? [],
          stageScope,
        ),
        ...(literalStep.group
          ? walkSourceLessGroupEntries(literalStep.group, stageScope)
          : []),
      );
    } else if (
      step.type === "partial" ||
      step.type === "lambda" ||
      step.type === "transform"
    ) {
      paths.push(...walkNode(step, stageScope));
    } else if (step.type === "sort") {
      if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
        continue;
      }
      const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const aliasStep = node.steps[i - 1];
      const aliasUsesContextDefault = aliasStep
        ? resultUsesContextDefault(aliasStep, stageScope)
        : false;
      const sortAliasScope =
        contextPrefix && aliasUsesContextDefault
          ? bindVariable(childScope(stageScope), "", [contextPrefix])
          : stageScope;
      const sortStep = step as SortNode;
      if (sortStep.indexBinding) {
        stageScope = bindVariable(stageScope, sortStep.indexBinding.name, []);
        nonPathVariables.add(sortStep.indexBinding.name);
      }
      paths.push(
        ...walkSortTerms(
          sortStep,
          contextPrefix,
          sortAliasScope,
          stageVariables,
          aliasStep && isResultAliasStep(aliasStep) ? aliasStep : undefined,
        ),
      );
      paths.push(
        ...walkFilterStages(
          sortStep.predicate ?? [],
          contextPrefix,
          stageScope,
          nonPathVariables,
          stageVariables,
        ),
      );
    } else if (step.type === "object") {
      if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
        continue;
      }
      // Object constructor step in path: orders.items.{"key": val}
      // Walk value expressions and prefix with path up to this step
      const prefixSteps = node.steps.slice(0, i);
      const contextPrefix = buildProjectionContextPath(prefixSteps) ?? "";
      const keepBarePathsRootRelative = hasPendingProjectionFocusReset(prefixSteps);
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
          ...walkContextExpression(
            key,
            contextPrefix,
            stageScope,
            stageVariables,
            keepBarePathsRootRelative,
          ),
        );
        paths.push(
          ...walkContextExpression(
            val,
            contextPrefix,
            stageScope,
            stageVariables,
            keepBarePathsRootRelative,
          ),
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

        if (resultBasePaths.length === 0) {
          paths.push(
            ...walkSourceLessFilterStages(
              arrayStep.predicate,
              predicateScope,
            ),
          );
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
      const prefixSteps = node.steps.slice(0, i);
      const structuralContextPrefix = buildProjectionContextPath(prefixSteps) ?? "";
      const contextPrefix = hasPendingProjectionFocusReset(prefixSteps)
        ? parentPath(structuralContextPrefix)
        : structuralContextPrefix;
      const blockStep = step as BlockNode;
      const blockPathStart = paths.length;
      if (blockStep.expressions.length === 0 && contextPrefix) {
        paths.push(contextPrefix);
      }
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
      const explicitlyCapturesCurrentContext =
        collectVariableNames(blockStep).has("") ||
        containsContextDefaultLambda(blockStep);
      const capturesCurrentContext =
        Boolean(contextPrefix) &&
        (explicitlyCapturesCurrentContext ||
          resultUsesContextDefault(blockStep, stageScope));
      let blockEvaluationScope = stageScope;
      const blockEvaluationStageVariables = new Set(
        blockExpressionStageVariables,
      );
      if (capturesCurrentContext) {
        blockEvaluationScope = bindVariable(
          childScope(stageScope),
          "",
          [contextPrefix],
        );
        if (explicitlyCapturesCurrentContext) {
          blockEvaluationStageVariables.add("");
        }
      }
      const aliasPaths =
        i > 0 && isResultAliasStep(node.steps[i - 1])
          ? selectResultAliasProjectionStepPaths(
              node.steps[i - 1],
              step,
              stageScope,
              stageVariables.size > 0,
            )
          : null;
      if (aliasPaths) {
        paths.push(...aliasPaths);
        continue;
      }
      const hasBindings = blockStep.expressions.some((expr) => expr.type === "bind");
      if (hasBindings) {
        paths.push(
          ...walkContextExpression(
            blockStep,
            contextPrefix,
            blockEvaluationScope,
            blockEvaluationStageVariables,
            true,
          ),
        );
      }
      for (const expr of blockStep.expressions) {
        if (hasBindings && expr.type === "bind") continue;
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


        if (predicatePrefixes.length === 0) {
          paths.push(
            ...walkSourceLessFilterStages(
              blockStep.predicate,
              predicateScope,
            ),
          );
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
      if (
        contextPrefix &&
        ![...stageVariables].some((name) => referencedVariables.has(name)) &&
        !paths.slice(blockPathStart).some(
          (path) => path === contextPrefix || path.startsWith(`${contextPrefix}.`),
        )
      ) {
        paths.push(contextPrefix);
      }
    } else if (step.type === "function") {
      if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
        continue;
      }
      // Function call step (e.g., $lookup(obj, key) in $lookup(obj, key).field)
      // Function arguments in a path step are evaluated against the prior path context.
      const functionContextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const functionStep = step as FunctionNode;
      if (functionContextPrefix && functionStep.arguments.length === 0) {
        paths.push(functionContextPrefix);
      }
      const contextDefaultLambdaBinding =
        functionStep.procedure.type === "lambda"
          ? { lambda: functionStep.procedure, scope: stageScope }
          : functionStep.procedure.type === "variable"
            ? resolveLambda(stageScope, functionStep.procedure.value)
            : null;
      const contextDefaultLambda =
        functionContextPrefix &&
        contextDefaultLambdaBinding &&
        contextDefaultParameterIndex(contextDefaultLambdaBinding.lambda) >= 0 &&
        functionStep.arguments.length <
          contextDefaultLambdaBinding.lambda.arguments.length;
      const contextDefaultBuiltin =
        functionContextPrefix &&
        functionStep.procedure.type === "variable" &&
        builtinUsesContextDefault(
          functionStep.procedure.value,
          functionStep.arguments,
        );
      if (contextDefaultLambda || contextDefaultBuiltin) {
        const contextScope = bindVariable(
          childScope(stageScope),
          "",
          [functionContextPrefix],
        );
        paths.push(
          ...walkFunction(functionStep, contextScope),
        );
      } else {
        paths.push(
          ...(functionContextPrefix
            ? walkContextExpression(
                step,
                functionContextPrefix,
                stageScope,
                stageVariables,
              )
            : walkFunction(functionStep, stageScope)),
        );
      }
    } else if (step.type === "apply") {
      paths.push(...walkApply(step as ApplyNode, stageScope));
    }
  }

  // Handle group-by on the PathNode (node.group)
  if (node.group && !skipResultAliasGroupBy) {
    paths.push(...walkGroupBy(node, stageScope, stageVariables));
  }

  if (funcStepIndex >= 0 && funcStepIndex < node.steps.length - 1) {
    const functionStep = node.steps[funcStepIndex] as FunctionNode;
    const functionSuffixSteps = node.steps.slice(funcStepIndex + 1);
    const transformSourcePaths = transformOutputSelectionSourcePaths(
      functionStep,
      functionSuffixSteps,
      stageScope,
    );
    if (transformSourcePaths !== null) {
      paths.push(...transformSourcePaths);
      const suffix = buildPathString(functionSuffixSteps);
      const outputPaths = new Set(
        getFunctionResultBasePaths(functionStep, stageScope).map((base) =>
          appendPath(base, suffix),
        ),
      );
      return paths.filter((path) => !outputPaths.has(path));
    }
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
        ).map(resolveParentPathSegments),
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
        ).map(resolveParentPathSegments),
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
    const structuralContextPrefix = buildProjectionContextPath(prefixSteps) ?? "";
    const contextPrefix = hasPendingProjectionFocusReset(prefixSteps)
      ? parentPath(structuralContextPrefix)
      : structuralContextPrefix;
    const usesContextDefault = resultUsesContextDefault(
      resultAliasStep,
      scope,
    );
    const resultScope =
      contextPrefix && usesContextDefault
        ? bindVariable(childScope(scope), "", [contextPrefix])
        : scope;
    const objectAlias =
      resultAliasStep.type === "object"
        ? objectConstructorContextAlias(
            resultAliasStep as ObjectNode,
            prefixSteps,
            resultScope,
          )
        : resultAliasStep.type === "block"
          ? prefixObjectAlias(
              objectAliasForNode(resultAliasStep, resultScope),
              contextPrefix,
            )
          : objectAliasForNode(resultAliasStep, resultScope);
    const dynamicObjectAlias = dynamicObjectAliasForNode(
      resultAliasStep,
      resultScope,
    );
    const resultBasePaths =
      resultAliasStep.type === "array"
        ? arrayConstructorContextBasePaths(
            resultAliasStep as ArrayNode,
            contextPrefix,
            resultScope,
          )
        : resultAliasStep.type === "object"
          ? objectConstructorContextBasePaths(
              resultAliasStep as ObjectNode,
              contextPrefix,
              resultScope,
            )
          : resultAliasStep.type === "block"
            ? blockContextBasePaths(
                resultAliasStep as BlockNode,
                contextPrefix,
                resultScope,
              )
            : bindingAliasPaths(resultAliasStep, resultScope);
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
    let groupScope = resultScope;
    if (focusBinding) {
      groupScope = bindFocusObjectAliasScope(
        resultScope,
        focusBinding.name,
        objectAlias,
        dynamicObjectAlias,
        resultBasePaths,
        resultBasePaths,
      );
    }
    if (indexBinding) {
      if (groupScope === resultScope) groupScope = childScope(resultScope);
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

    const groupStageVariables = new Set(stageVariables);
    if (focusBinding) groupStageVariables.add(focusBinding.name);
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
  let stageScope = scope;
  const stageNonPathVariables = new Set(nonPathVariables);
  const activeStageVariables = new Set(stageVariables);

  for (const stage of stages) {
    if (stage.type === "position-binding") {
      const binding = stage as PositionBindingNode;
      stageScope = bindVariable(stageScope, binding.name, []);
      stageNonPathVariables.add(binding.name);
      activeStageVariables.add(binding.name);
      continue;
    }
    if (stage.type !== "filter") continue;

    const filterStage = stage as unknown as FilterStage;

    // EXPR-06: Numeric index guard -- skip array indexing
    if (isNumericIndex(filterStage.expr)) continue;

    // ADV-02: pure $variable in bracket position with no resolved data paths -> dynamic wildcard
    if (filterStage.expr.type === "variable") {
      const varNode = filterStage.expr as VariableNode;
      const resolved = resolveVariable(stageScope, varNode.value);
      if (stageNonPathVariables.has(varNode.value)) continue;
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
        stageScope,
        activeStageVariables,
      ),
    );
  }

  return paths;
}

function walkSourceLessFilterStages(
  stages: AstNode[],
  scope: ScopeTracker,
): string[] {
  const paths: string[] = [];
  let stageScope = bindVariable(childScope(scope), "", []);

  for (const stage of stages) {
    if (stage.type === "position-binding") {
      const binding = stage as PositionBindingNode;
      stageScope = bindVariable(stageScope, binding.name, []);
      continue;
    }
    if (stage.type !== "filter") continue;

    const expression = (stage as unknown as FilterStage).expr;
    if (isNumericIndex(expression)) continue;
    paths.push(
      ...walkNode(expression, stageScope).filter((path) =>
        path.startsWith(ROOT_PATH),
      ),
    );
  }

  return paths;
}

function walkSourceLessGroupEntries(
  groupNode: GroupByNode,
  scope: ScopeTracker,
): string[] {
  const contextScope = bindVariable(childScope(scope), "", []);
  return groupNode.entries.flatMap(([key, value]) =>
    [...walkNode(key, contextScope), ...walkNode(value, contextScope)].filter(
      (path) => path.startsWith(ROOT_PATH),
    ),
  );
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

  paths.push(
    ...walkSourceLessFilterStages(node.predicate ?? [], scope),
    ...(node.group ? walkSourceLessGroupEntries(node.group, scope) : []),
  );

  return paths;
}

/** Extract paths from both sides of a binary operator. */
function walkBinary(node: BinaryNode, scope: ScopeTracker): string[] {
  const paths = [...walkNode(node.lhs, scope), ...walkNode(node.rhs, scope)];
  if (node.value === "=" || node.value === "!=") {
    for (const operand of [node.lhs, node.rhs]) {
      const identityPaths = identityReferencePaths(operand, scope);
      if (identityPaths) {
        paths.push(...identityPaths.map((path) => appendPath(path, "**")));
      }
    }
  }
  return paths;
}

/** Extract paths from condition, then-branch, and optional else-branch. */
function walkCondition(node: ConditionNode, scope: ScopeTracker): string[] {
  return [
    ...walkNode(node.condition, scope),
    ...walkValueExpression(node.then, scope),
    ...(node.else ? walkValueExpression(node.else, scope) : []),
  ];
}

function walkValueExpression(node: AstNode, scope: ScopeTracker): string[] {
  return resolveCallableValues(node, scope).length > 0
    ? walkCallableSelection(node, scope)
    : walkNode(node, scope);
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
      const identityPaths = identityReferencePaths(bindNode.rhs, currentScope);
      const returnsCallable = resolveCallableValues(bindNode.rhs, currentScope).length > 0;
      const rhsPaths =
        identityPaths ??
        (returnsCallable
          ? walkCallableSelection(bindNode.rhs, currentScope)
          : walkNode(bindNode.rhs, currentScope));
      if (!identityPaths && bindNode.rhs.type !== "transform") paths.push(...rhsPaths);
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

      currentScope = bindCallableValue(
        currentScope,
        bindNode.lhs.value,
        bindNode.rhs,
        closureScope,
      );
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
    const resultBasePaths = bindingAliasPathsFromBlock(node, scope);
    paths.push(
      ...(objectAlias || dynamicObjectAlias
        ? walkAliasGroupEntries(
            node.group,
            objectAlias,
            dynamicObjectAlias,
            groupScope,
            suffixBasePaths,
          )
        : resultBasePaths.length > 0
          ? resultBasePaths.flatMap((basePath) =>
              walkContextGroupEntries(
                node.group!,
                basePath,
                groupScope,
                groupStageVariables,
              ),
            )
          : walkSourceLessGroupEntries(node.group, groupScope)),
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
      const resultBasePaths = bindingAliasPathsFromBlock(node, scope);
      if (resultBasePaths.length === 0) {
        paths.push(
          ...walkSourceLessFilterStages(
            node.predicate,
            predicateScope,
          ),
        );
      }
      for (const resultBasePath of resultBasePaths) {
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
      const identityPaths = identityReferencePaths(bindNode.rhs, currentScope);
      const rhsPaths = identityPaths ?? walkValueExpression(bindNode.rhs, currentScope);
      if (!identityPaths) paths.push(...rhsPaths);
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
      currentScope = bindCallableValue(
        currentScope,
        bindNode.lhs.value,
        bindNode.rhs,
        closureScope,
      );
    } else {
      paths.push(...walkValueExpression(expr, currentScope));
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
      if (resultBasePaths.length === 0) {
        paths.push(
          ...walkSourceLessFilterStages(
            node.predicate,
            predicateScope,
          ),
        );
      }
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
    const groupStageVariables = new Set(
      node.focusBinding ? [node.focusBinding.name] : [],
    );
    paths.push(
      ...(objectAlias || dynamicObjectAlias
        ? walkAliasGroupEntries(node.group, objectAlias, dynamicObjectAlias, groupScope)
        : resultBasePaths.length > 0
          ? resultBasePaths.flatMap((basePath) =>
              walkContextGroupEntries(
                node.group!,
                basePath,
                groupScope,
                groupStageVariables,
              ),
            )
          : walkSourceLessGroupEntries(node.group, groupScope)),
    );
  }
  return paths;
}

/** Extract value paths from an object constructor. */
function walkObject(node: ObjectNode, scope: ScopeTracker): string[] {
  const paths = node.entries.flatMap(([key, val]) => [
    ...walkValueExpression(key, scope),
    ...walkValueExpression(val, scope),
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
        ...(objectAlias || dynamicObjectAlias || resultBasePaths.length > 0
          ? selectAliasExpressionPaths(
              objectAlias,
              dynamicObjectAlias,
              (stage as unknown as FilterStage).expr,
              predicateScope,
            )
          : walkSourceLessFilterStages([stage], predicateScope)),
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
        : resultBasePaths.length > 0
          ? resultBasePaths.flatMap((basePath) =>
              walkContextGroupEntries(
                node.group!,
                basePath,
                groupScope,
                groupStageVariables,
              ),
            )
          : walkSourceLessGroupEntries(node.group, groupScope)),
    );
  }
  return paths;
}

function isPlaceholder(node: AstNode): boolean {
  return node.type === "operator" && (node as { value?: unknown }).value === "?";
}

/** Extract read effects from bound partial-application arguments. */
function walkPartial(node: PartialNode, scope: ScopeTracker): string[] {
  return [
    ...walkFunctionProcedureSelection(node.procedure, scope),
    ...node.arguments.flatMap((arg) =>
      isPlaceholder(arg) ? [] : walkNode(arg, scope),
    ),
    ...walkSourceLessFilterStages(node.predicate ?? [], scope),
    ...(node.group ? walkSourceLessGroupEntries(node.group, scope) : []),
  ];
}

function walkFunctionProcedureSelection(
  procedure: FunctionNode["procedure"],
  scope: ScopeTracker,
): string[] {
  if (procedure.type !== "condition") {
    return ["function", "path", "block"].includes(procedure.type) &&
      (resolveCallableValues(procedure, scope).length > 0 ||
        resolveBuiltinCallableNames(procedure, scope).length > 0)
      ? walkCallableSelection(procedure, scope)
      : [];
  }
  return [
    ...walkNode(procedure.condition, scope),
    ...(isFunctionProcedureNode(procedure.then)
      ? walkFunctionProcedureSelection(procedure.then, scope)
      : []),
    ...(procedure.else && isFunctionProcedureNode(procedure.else)
      ? walkFunctionProcedureSelection(procedure.else, scope)
      : []),
  ];
}

/**
 * Resolve a variable reference using the scope chain.
 * Built-in function names and the root reference ($) produce no paths.
 */
function walkVariable(node: VariableNode, scope: ScopeTracker): string[] {
  const capturedCurrentContext =
    node.value === "" ? resolveVariable(scope, "") : null;
  if (isRootReference(node) && capturedCurrentContext === null) {
    let rootScope = childScope(scope);
    const stageVariables = new Set<string>();
    const nonPathVariables = new Set<string>();
    if (node.focusBinding) {
      rootScope = bindVariable(rootScope, node.focusBinding.name, [ROOT_PATH]);
      stageVariables.add(node.focusBinding.name);
    }
    if (node.indexBinding) {
      rootScope = bindVariable(rootScope, node.indexBinding.name, []);
      nonPathVariables.add(node.indexBinding.name);
    }
    return [
      ...walkFilterStages(
        node.predicate ?? [],
        ROOT_PATH,
        rootScope,
        nonPathVariables,
        stageVariables,
      ),
      ...(node.group
        ? walkContextGroupEntries(
            node.group,
            ROOT_PATH,
            rootScope,
            stageVariables,
          )
        : []),
    ];
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
      if (variableBasePaths.length === 0) {
        paths.push(
          ...predicates.flatMap((stage) =>
            stage.type === "filter"
              ? walkNode((stage as unknown as FilterStage).expr, scope)
              : [],
          ),
        );
      }
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
  return [
    // Thunk lambdas are parser-generated wrappers, not user-defined functions.
    ...(node.thunk ? walkNode(node.body, scope) : []),
    ...walkSourceLessFilterStages(node.predicate ?? [], scope),
    ...(node.group ? walkSourceLessGroupEntries(node.group, scope) : []),
  ];
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

type ResolvedCallable =
  | { readonly kind: "lambda"; readonly binding: LambdaBinding }
  | { readonly kind: "transform"; readonly binding: TransformBinding }
  | {
      readonly kind: "partial";
      readonly binding: NonNullable<ReturnType<typeof resolvePartial>>;
    };

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
    bindingAliasPaths(bindNode.rhs, scope),
  );
  nextScope = bindSuffixBasePathsIfPresent(
    nextScope,
    bindNode.lhs.value,
    bindNode.rhs,
    closureScope,
  );
  nextScope = bindObjectAliasIfPresent(
    nextScope,
    bindNode.lhs.value,
    bindNode.rhs,
    closureScope,
  );
  nextScope = bindDynamicObjectAliasIfPresent(
    nextScope,
    bindNode.lhs.value,
    bindNode.rhs,
    closureScope,
  );
  return bindCallableValue(
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
    const objectAlias = mergeObjectAliases([
      capturedObjectAlias,
      currentObjectAlias,
    ]);
    if (objectAlias) {
      resultScope = bindObjectAlias(resultScope, name, objectAlias);
    }
    const dynamicObjectAlias = mergeDynamicObjectAliases([
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
            lambdaCallGraphReaches(
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
        lambdaCallGraphReaches(
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
      resultScope = bindCallableValue(
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
    const argPaths = arg ? extractBasePaths(arg, callScope) : [];
    resultScope = arg
      ? bindArgumentParameter(resultScope, parameter, argPaths, arg, callScope)
      : bindVariable(resultScope, parameter.value, argPaths);
    if (arg) {
      resultScope = bindCallableValue(
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
    const expression = getStaticEvalExpression(functionNode.arguments);
    if (expression) {
      return unwrapCallableContainerNode(
        expression,
        getStaticEvalScope(functionNode.arguments, scope),
        depth + 1,
      );
    }
  }
  return { node, scope };
}

function callableContainerProducerInputs(node: FunctionNode): AstNode[] {
  if (node.procedure.type !== "variable") return [];
  const funcName = node.procedure.value;
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
  return resolveCallableValues(node.procedure, scope).flatMap((callable) => {
    if (callable.kind !== "transform") return [];
    return transformUpdateMatches(
      callable.binding.transform.pattern,
      suffixSteps,
    ).flatMap(({ locationNames, updateSuffix }) => {
      if (updateSuffix.length === 0) return [];
      const input = node.arguments[0];
      const inputBases = input ? extractBasePaths(input, scope) : [];
      const matchContextPaths = inputBases.map((base) =>
        appendPath(base, locationNames.join(".")),
      );
      let updateScope = transformInvocationScope(callable.binding, scope);
      if (matchContextPaths.length > 0) {
        updateScope = bindVariable(updateScope, "", matchContextPaths);
      }
      return resolveCallableValues(
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
  return resolveCallableValues(node.procedure, scope).flatMap((callable) => {
    if (callable.kind !== "transform") return [];
    return transformUpdateMatches(
      callable.binding.transform.pattern,
      suffixSteps,
    ).flatMap(({ locationNames, updateSuffix }) => {
      if (updateSuffix.length === 0) return [];
      const input = node.arguments[0];
      const inputBases = input ? extractBasePaths(input, scope) : [];
      const matchContextPaths = inputBases.map((base) =>
        appendPath(base, locationNames.join(".")),
      );
      let updateScope = transformInvocationScope(callable.binding, scope);
      if (matchContextPaths.length > 0) {
        updateScope = bindVariable(updateScope, "", matchContextPaths);
      }
      return resolveBuiltinCallableNames(
        {
          type: "path",
          steps: [callable.binding.transform.update, ...updateSuffix],
        } as PathNode,
        updateScope,
      );
    });
  });
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
    callable.kind === "partial" && partialCanInvokeLambda(callable.binding)
      ? [callable.binding]
      : [],
  );

  return funcNames.flatMap((funcName) => {
    const dataArgPaths = higherOrderCallbackDataPaths(
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
              higherOrderCallbackCallArguments(
                funcName,
                dataArg,
                dataArg,
                node.arguments,
                node.position,
              ),
              scope,
            )
          : bindHigherOrderLambdaCallbackScope(
              funcName,
              binding,
              dataArgPaths,
              dataArg,
              scope,
            ),
    }));
    const partialBodies = higherOrderPartialLambdaCalls(
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
  return resolveLambdaFunctionCalls(
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
    : extractBasePaths(
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
  const groupScope = bindCallableValue(
    groupedNodeCallableScope(node, scope),
    "",
    groupInput,
    scope,
  );
  return group.entries.flatMap(([key, value]) => {
    const staticKey = staticObjectKey(key);
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
  const groupScope = bindCallableValue(
    groupedNodeCallableScope(node, scope),
    "",
    groupInput,
    scope,
  );
  return group.entries.flatMap(([key, value]) => {
    const staticKey = staticObjectKey(key);
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
      const appliedFunction = appliedFunctionFromApply(sourceNode as ApplyNode);
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
        ...transformUpdateCallableValues(
          functionNode,
          suffixSteps,
          sourceScope,
        ),
        ...higherOrderResultCallableValues(
          functionNode,
          sourceScope,
          suffixSteps,
        ),
        ...callableContainerProducerInputs(functionNode).flatMap((input) =>
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
        staticObjectKey(key) === (selector as NameNode).value
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
    const appliedFunction = appliedFunctionFromApply(apply);
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
    const expression = getStaticEvalExpression(functionNode.arguments);
    if (!expression) return [];
    return resolveCallableValues(
      expression,
      getStaticEvalScope(functionNode.arguments, scope),
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
      staticKey === null || staticObjectKey(key) === staticKey
        ? resolveCallableValues(value, objectScope)
        : [],
    );
  }
  const higherOrderResults = higherOrderResultCallableValues(
    functionNode,
    scope,
  );
  if (higherOrderResults.length > 0) return higherOrderResults;

  const producerResults = callableContainerProducerInputs(functionNode).flatMap(
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
      const appliedFunction = appliedFunctionFromApply(sourceNode as ApplyNode);
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
        ...transformUpdateBuiltinCallableNames(
          functionNode,
          suffixSteps,
          sourceScope,
        ),
        ...higherOrderResultBuiltinCallableNames(
          functionNode,
          sourceScope,
          suffixSteps,
        ),
        ...callableContainerProducerInputs(functionNode).flatMap((input) =>
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
        staticObjectKey(key) === (selector as NameNode).value
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
      appliedFunctionFromApply(apply) ??
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
      const expression = getStaticEvalExpression(functionNode.arguments);
      return expression
        ? resolveBuiltinCallableNames(
            expression,
            getStaticEvalScope(functionNode.arguments, scope),
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
        staticKey === null || staticObjectKey(key) === staticKey
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

function walkCallableSelection(node: AstNode, scope: ScopeTracker): string[] {
  if (node.type === "lambda" && (node as LambdaNode).thunk) {
    return walkCallableSelection((node as LambdaNode).body, scope);
  }
  if (node.type === "variable") {
    return ((node as VariableNode).predicate ?? []).flatMap((stage) =>
      stage.type === "filter" &&
      !isNumericIndex((stage as unknown as FilterStage).expr)
        ? walkNode((stage as unknown as FilterStage).expr, scope)
        : [],
    );
  }
  if (node.type === "lambda") return walkLambda(node as LambdaNode, scope);
  if (node.type === "transform") {
    const transform = node as TransformNode;
    return [
      ...walkSourceLessFilterStages(transform.predicate ?? [], scope),
      ...(transform.group
        ? walkSourceLessGroupEntries(transform.group, scope)
        : []),
    ];
  }
  if (node.type === "array") {
    return walkArray(node as ArrayNode, scope);
  }
  if (node.type === "object") {
    return walkObject(node as ObjectNode, scope);
  }
  if (node.type === "condition") {
    const condition = node as ConditionNode;
    return [
      ...walkNode(condition.condition, scope),
      ...walkCallableSelection(condition.then, scope),
      ...(condition.else ? walkCallableSelection(condition.else, scope) : []),
    ];
  }
  if (node.type === "block") {
    const block = node as BlockNode;
    const paths: string[] = [];
    let blockScope = scope;
    for (const [index, expression] of block.expressions.entries()) {
      const isLast = index === block.expressions.length - 1;
      if (isLast) {
        paths.push(...walkCallableSelection(expression, blockScope));
      } else if (expression.type === "bind") {
        const bindNode = expression as BindNode;
        paths.push(...walkCallableSelection(bindNode.rhs, blockScope));
        blockScope = bindCallableBlockValue(blockScope, bindNode);
      } else {
        paths.push(...walkNode(expression, blockScope));
      }
    }
    paths.push(
      ...walkSourceLessFilterStages(block.predicate ?? [], blockScope),
      ...(block.group
        ? walkSourceLessGroupEntries(block.group, blockScope)
        : []),
    );
    return paths;
  }
  if (node.type === "path") {
    const path = node as PathNode;
    const [first, ...suffixSteps] = path.steps;
    const producedByProjection =
      pathProjectionCallableValues(path, scope).length > 0 ||
      pathProjectionBuiltinCallableNames(path, scope).length > 0;
    const producedByGroup =
      groupedPathCallableValues(path, scope).length > 0 ||
      groupedPathBuiltinCallableNames(path, scope).length > 0;
    const producedByTransform =
      first?.type === "function" &&
      (transformUpdateCallableValues(
        first as FunctionNode,
        suffixSteps,
        scope,
      ).length > 0 ||
        transformUpdateBuiltinCallableNames(
          first as FunctionNode,
          suffixSteps,
          scope,
        ).length > 0);
    const producedByHigherOrder =
      first?.type === "function" &&
      (higherOrderResultCallableValues(
        first as FunctionNode,
        scope,
        suffixSteps,
      ).length > 0 ||
        higherOrderResultBuiltinCallableNames(
          first as FunctionNode,
          scope,
          suffixSteps,
        ).length > 0);
    const producedByCustomFunction =
      first?.type === "function" &&
      (customFunctionResultCallableValues(
        first as FunctionNode,
        scope,
        suffixSteps,
      ).length > 0 ||
        customFunctionResultBuiltinCallableNames(
          first as FunctionNode,
          scope,
          suffixSteps,
        ).length > 0);
    const producerPaths =
      producedByTransform || producedByHigherOrder || producedByCustomFunction
        ? walkFunction(first as FunctionNode, scope)
        : [];
    const projectionPaths =
      producedByProjection || producedByGroup ? walkPath(path, scope) : [];
    return [...producerPaths, ...projectionPaths, ...path.steps.flatMap((step, index) => {
      if (["array", "object", "block"].includes(step.type)) {
        return walkCallableSelection(step, scope);
      }
      if (step.type === "sort") {
        return walkSortTerms(
          step as SortNode,
          buildPathString(path.steps.slice(0, index)) ?? "",
          scope,
        );
      }
      return walkSourceLessFilterStages(
        (step as AstNode & { predicate?: AstNode[] }).predicate ?? [],
        scope,
      );
    })];
  }
  if (node.type === "function" && resolveCallableValues(node, scope).length > 0) {
    const functionNode = node as FunctionNode;
    if (
      functionNode.procedure.type === "variable" &&
      functionNode.procedure.value === "lookup"
    ) {
      return functionNode.arguments.flatMap((arg) =>
        resolveCallableValues(arg, scope).length > 0
          ? walkCallableSelection(arg, scope)
          : walkNode(arg, scope),
      );
    }
    return walkFunction(node as FunctionNode, scope);
  }
  return walkNode(node, scope);
}

function walkReturnedCallableCall(
  node: FunctionNode,
  scope: ScopeTracker,
): string[] {
  if (!["function", "block", "path"].includes(node.procedure.type)) return [];
  const producer = node.procedure;
  const paths = walkCallableSelection(producer, scope);
  const callables = resolveCallableValues(producer, scope);
  const builtinNames = resolveBuiltinCallableNames(producer, scope);
  if (callables.length === 0 && builtinNames.length === 0) {
    return [...paths, ...node.arguments.flatMap((arg) => walkNode(arg, scope))];
  }
  for (const callable of callables) {
    if (callable.kind === "transform") {
      paths.push(...walkTransformCall(callable.binding, node.arguments, scope));
    } else if (callable.kind === "lambda") {
      paths.push(...walkCustomFunctionCall(callable.binding, node.arguments, scope));
    } else {
      paths.push(...walkPartialCall(callable.binding, node.arguments, scope));
    }
  }
  for (const name of builtinNames) {
    paths.push(
      ...walkFunction(
        {
          ...node,
          procedure: { type: "variable", value: name, position: node.position },
        },
        scope,
      ),
    );
  }
  return paths;
}

function conditionalProcedureCalls(node: FunctionNode): FunctionNode[] {
  if (node.procedure.type !== "condition") return [];
  const condition = node.procedure;
  return [condition.then, condition.else].flatMap((procedure) =>
    procedure && isFunctionProcedureNode(procedure)
      ? [{ ...node, procedure }]
      : [],
  );
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

  if (node.procedure.type === "transform") {
    return withFunctionStages(
      walkTransformCall(
        { transform: node.procedure, scope },
        node.arguments,
        scope,
      ),
    );
  }

  if (node.procedure.type === "condition") {
    return withFunctionStages([
      ...walkNode(node.procedure.condition, scope),
      ...conditionalProcedureCalls(node).flatMap((call) =>
        walkFunction(call, scope),
      ),
    ]);
  }
  if (
    node.procedure.type === "function" ||
    node.procedure.type === "block" ||
    node.procedure.type === "path"
  ) {
    return withFunctionStages(walkReturnedCallableCall(node, scope));
  }

  const funcName = node.procedure.value;
  const storedBuiltinNames = !BUILTIN_FUNCTIONS.has(funcName)
    ? resolveBuiltinCallableNames(node.procedure, scope)
    : [];
  const capturedCurrent = resolveVariable(scope, "");
  const args =
    capturedCurrent !== null && builtinUsesContextDefault(funcName, node.arguments)
      ? [
          {
            type: "variable",
            value: "",
            position: node.position,
          } as VariableNode,
          ...node.arguments,
        ]
      : withImplicitRootFunctionArgument(
          funcName,
          node.arguments,
          node.position,
        );
  const paths: string[] = [];

  if (args.length === 0 && IMPLICIT_ROOT_SHALLOW_FUNCTIONS.has(funcName)) {
    paths.push("*");
  }
  if (args.length === 0 && IMPLICIT_ROOT_DEEP_FUNCTIONS.has(funcName)) {
    paths.push("**");
  }

  const explicitContextPaths = args[0]
    ? identityReferencePaths(args[0], scope)
    : null;
  if (
    args.length > 0 &&
    explicitContextPaths &&
    IMPLICIT_ROOT_SHALLOW_FUNCTIONS.has(funcName)
  ) {
    paths.push(...explicitContextPaths.map((path) => appendPath(path, "*")));
  }
  if (
    args.length > 0 &&
    explicitContextPaths &&
    IMPLICIT_ROOT_DEEP_FUNCTIONS.has(funcName)
  ) {
    paths.push(...explicitContextPaths.map((path) => appendPath(path, "**")));
  }
  if (funcName === "merge") {
    const mergeInputs =
      args[0]?.type === "array"
        ? (args[0] as ArrayNode).expressions
        : args[0]
          ? [args[0]]
          : [];
    for (const input of mergeInputs) {
      const identityPaths = identityReferencePaths(input, scope);
      if (identityPaths) {
        paths.push(...identityPaths.map((path) => appendPath(path, "*")));
      }
    }
  }

  // Step 1: Check if this is a known higher-order function
  const semantics = HIGHER_ORDER_SEMANTICS[funcName];
  if (semantics) {
    return withFunctionStages(
      walkHigherOrderCall({ ...node, arguments: args }, semantics, scope),
    );
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

  const transformBinding = resolveTransform(scope, funcName);
  if (transformBinding) {
    return withFunctionStages(walkTransformCall(transformBinding, args, scope));
  }

  const storedCallables = resolveCallableValues(node.procedure, scope);
  if (storedCallables.length > 0 || storedBuiltinNames.length > 0) {
    const storedPaths = walkCallableSelection(node.procedure, scope);
    for (const callable of storedCallables) {
      if (callable.kind === "transform") {
        storedPaths.push(...walkTransformCall(callable.binding, args, scope));
      } else if (callable.kind === "lambda") {
        storedPaths.push(...walkCustomFunctionCall(callable.binding, args, scope));
      } else {
        storedPaths.push(...walkPartialCall(callable.binding, args, scope));
      }
    }
    for (const name of storedBuiltinNames) {
      storedPaths.push(
        ...walkFunction(
          {
            ...node,
            procedure: { type: "variable", value: name, position: node.position },
            arguments: args,
            predicate: [],
            group: undefined,
          },
          scope,
        ),
      );
    }
    return withFunctionStages(storedPaths);
  }

  // Step 3: Non-higher-order built-in or unknown function -- pass-through all args
  for (const [argIndex, arg] of args.entries()) {
    const invokesCallableArgument =
      (argIndex === 1 && MATCHER_CALLBACK_FUNCTIONS.has(funcName)) ||
      (argIndex === 2 && funcName === "replace");
    const callableArguments =
      invokesCallableArgument
        ? resolveCallableValues(arg, scope)
        : [];
    if (callableArguments.length > 0) {
      paths.push(...walkCallableSelection(arg, scope));
      const generatedArgument: AstNode = {
        type: "value",
        value: null,
        position: node.position,
      };
      for (const callable of callableArguments) {
        if (callable.kind === "lambda") {
          paths.push(
            ...walkCustomFunctionCall(
              callable.binding,
              [generatedArgument],
              scope,
            ),
          );
        } else if (callable.kind === "partial") {
          paths.push(
            ...walkPartialCall(
              callable.binding,
              [generatedArgument],
              scope,
            ),
          );
        }
      }
      continue;
    }
    if (arg.type === "lambda") {
      // Walk lambda body with current scope (closure capture)
      const lambda = arg as LambdaNode;
      const lambdaScope = childScope(scope);
      paths.push(...walkNode(lambda.body, lambdaScope));
    } else {
      paths.push(...walkNode(arg, scope));
    }
  }

  if (funcName === "eval") {
    paths.push(...walkStaticEval(args, scope));
  }

  if (funcName === "lookup") {
    paths.push(...getLookupResultBasePaths(args, scope));
  }

  return withFunctionStages(paths);
}

function walkTransformCall(
  binding: TransformBinding,
  callArgs: AstNode[],
  callScope: ScopeTracker,
): string[] {
  const paths: string[] = [];
  const input = callArgs[0];

  for (const arg of callArgs) {
    const identityPaths = identityReferencePaths(arg, callScope);
    if (identityPaths) {
      paths.push(...identityPaths.filter((path) => path !== ROOT_PATH));
    } else {
      paths.push(...walkNode(arg, callScope));
    }
  }
  if (!input) return paths;

  const transformScope = transformInvocationScope(binding, callScope);
  const transformPaths = walkTransform(binding.transform, transformScope);
  const inputPaths =
    identityReferencePaths(input, callScope) ?? walkNode(input, callScope);
  const transformBasePaths = extractBasePaths(input, callScope);
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
  return bindForwardReferences(
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

function walkStaticEval(args: AstNode[], scope: ScopeTracker): string[] {
  const expression = getStaticEvalExpression(args);
  if (!expression) {
    return args[0]?.type === "string" ? [] : markAbsolute(["**"]);
  }

  const contextArg = args[1];
  if (!contextArg) return walkNode(expression, scope);

  return getResultBasePathsFromArg(contextArg, scope).flatMap((basePath) =>
    walkContextExpression(expression, basePath, scope),
  );
}

function getStaticEvalResultBasePaths(
  args: AstNode[],
  scope: ScopeTracker,
): string[] {
  const expression = getStaticEvalExpression(args);
  if (!expression) return [];

  if (getSuffixableResultBasePaths(expression, scope).length === 0) return [];
  const contextArg = args[1];
  if (!contextArg) return getSuffixableResultBasePaths(expression, scope);

  return getResultBasePathsFromArg(contextArg, scope).flatMap((basePath) =>
    walkContextExpression(expression, basePath, scope),
  );
}

function getStaticEvalExpression(args: AstNode[]): AstNode | null {
  const source = args[0];
  if (source?.type !== "string") return null;

  try {
    return parse((source as { value: string }).value);
  } catch {
    return null;
  }
}

function getStaticEvalScope(
  args: AstNode[],
  scope: ScopeTracker,
): ScopeTracker {
  const contextArg = args[1];
  return contextArg
    ? bindVariable(
        childScope(scope),
        "",
        getResultBasePathsFromArg(contextArg, scope),
      )
    : scope;
}

function getStaticEvalResultObjectAlias(
  args: AstNode[],
  scope: ScopeTracker,
): ObjectAlias | null {
  const expression = getStaticEvalExpression(args);
  if (!expression) return null;

  const alias = groupResultObjectAliasForNode(expression, scope);
  if (!alias) return null;
  const contextArg = args[1];
  if (!contextArg) return alias;

  return mergeObjectAliases(
    getResultBasePathsFromArg(contextArg, scope).map((basePath) =>
      prefixObjectAlias(alias, basePath),
    ),
  );
}

function getStaticEvalResultDynamicObjectAlias(
  args: AstNode[],
  scope: ScopeTracker,
): DynamicObjectAlias | null {
  const expression = getStaticEvalExpression(args);
  const alias = expression
    ? groupResultDynamicObjectAliasForNode(expression, scope)
    : null;
  if (!alias || !args[1]) return alias;
  return prefixDynamicObjectAlias(
    alias,
    getResultBasePathsFromArg(args[1], scope),
  );
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
  const resultBasePaths = getFunctionResultBasePaths(node, scope);
  if (resultBasePaths.length === 0) {
    return walkSourceLessFilterStages(
      node.predicate,
      predicateScope,
    );
  }

  return resultBasePaths.flatMap((basePath) =>
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

  const resultBasePaths = getFunctionResultBasePaths(node, scope);
  if (resultBasePaths.length === 0) {
    return walkSourceLessGroupEntries(node.group, groupScope);
  }

  return resultBasePaths.flatMap((basePath) =>
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

function flattenSimpleContextBlocks(steps: AstNode[]): AstNode[] {
  return steps.flatMap((step) => {
    if (step.type !== "block") return [step];

    const block = step as BlockNode;
    if (block.expressions.length !== 1 || block.expressions[0]?.type !== "path") {
      return [step];
    }

    const innerSteps = (block.expressions[0] as PathNode).steps;
    if (
      innerSteps.some(
        (innerStep) =>
          !["name", "wildcard", "descendant", "parent", "block"].includes(
            innerStep.type,
          ),
      )
    ) {
      return [step];
    }

    const flattened = flattenSimpleContextBlocks(innerSteps);
    const lastIndex = flattened.length - 1;
    if (lastIndex < 0 || (!block.focusBinding && !block.indexBinding)) {
      return flattened;
    }

    return flattened.map((innerStep, index) =>
      index === lastIndex
        ? {
            ...innerStep,
            ...(block.focusBinding ? { focusBinding: block.focusBinding } : {}),
            ...(block.indexBinding ? { indexBinding: block.indexBinding } : {}),
          }
        : innerStep,
    );
  });
}

function isTransparentPathBlock(step: AstNode): boolean {
  if (step.type !== "block") return false;

  const block = step as BlockNode;
  return (
    block.expressions.length === 1 &&
    block.expressions[0]?.type === "path" &&
    !block.group &&
    !block.predicate?.length &&
    !block.focusBinding &&
    !block.indexBinding
  );
}

function flattenTransparentPathBlocks(steps: AstNode[]): AstNode[] | null {
  let changed = false;
  const flattened: AstNode[] = [];

  for (const step of steps) {
    if (step.type !== "block") {
      flattened.push(step);
      continue;
    }

    if (!isTransparentPathBlock(step)) {
      flattened.push(step);
      continue;
    }

    const block = step as BlockNode;
    const inner = flattenTransparentPathBlocks(
      (block.expressions[0] as PathNode).steps,
    );
    flattened.push(...(inner ?? (block.expressions[0] as PathNode).steps));
    changed = true;
  }

  return changed ? flattened : null;
}

function buildProjectionContextPath(steps: AstNode[]): string | null {
  return buildPathString(flattenSimpleContextBlocks(steps));
}

function hasPendingProjectionFocusReset(steps: AstNode[]): boolean {
  return hasPendingFocusReset(flattenSimpleContextBlocks(steps));
}

function hasPendingFocusReset(steps: AstNode[]): boolean {
  let focusBindingName: string | null = null;

  for (const step of steps) {
    if (
      step.type === "variable" &&
      !["", "$"].includes((step as VariableNode).value)
    ) {
      if ((step as VariableNode).value !== focusBindingName) return false;
      focusBindingName = null;
      continue;
    }

    const isPathSegment = ["name", "wildcard", "descendant", "parent"].includes(
      step.type,
    );
    if (isPathSegment && focusBindingName !== null) focusBindingName = null;

    const focusBinding = (
      step as AstNode & { focusBinding?: { name: string } }
    ).focusBinding;
    if (isPathSegment && focusBinding) focusBindingName = focusBinding.name;
  }

  return focusBindingName !== null;
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
      paths.push(...walkNode(arg, scope));
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
    paths.push(...walkCallableSelection(args[callback.index], scope));

    if (usesImplicitRoot) paths.push("*");
    if (!usesImplicitRoot && (funcName === "each" || funcName === "sift") && dataArg) {
      const identityPaths = identityReferencePaths(dataArg, scope);
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
        bindingAliasPaths(input, scope),
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
      paths.push(...walkCallableSelection(producer, scope));
      const transformCalls = resolveTransformFunctionCalls(
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
        paths.push(...walkTransformCall(call.binding, call.arguments, scope));
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
      return callbackDataNodes.flatMap((node) => bindingAliasPaths(node, scope));
    }
  }
  if (funcName !== "each" && funcName !== "sift") return basePaths;

  if (dataArg?.type === "object") {
    return (dataArg as ObjectNode).entries.flatMap(([, value]) =>
      bindingAliasPaths(value, scope),
    );
  }
  const objectAlias = dataArg ? objectAliasForNode(dataArg, scope) : null;
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
        : callbackDataNodes.flatMap((node) => bindingAliasPaths(node, scope));
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
      getStaticEvalExpression(functionNode.arguments) !== null
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
        blockScope = bindCallableBlockValue(blockScope, expression as BindNode);
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
  if (objectAliasForNode(node, scope)?.size) return false;
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
        blockScope = bindCallableBlockValue(blockScope, expression as BindNode);
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
      const expression = getStaticEvalExpression(functionNode.arguments);
      if (expression) {
        return eachInputNeedsWildcardValues(
          expression,
          getStaticEvalScope(functionNode.arguments, scope),
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
        blockScope = bindCallableBlockValue(blockScope, bindNode);
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
                staticObjectKey(key) === (selector as NameNode).value
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
    const appliedFunction = appliedFunctionFromApply(dataArg as ApplyNode);
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
        lambdaCallScope(lambdaBinding, functionNode.arguments, scope),
        resolvingVariables,
      );
    }
    if (
      functionNode.procedure.type === "variable" &&
      functionNode.procedure.value === "eval"
    ) {
      const expression = getStaticEvalExpression(functionNode.arguments);
      if (expression) {
        return higherOrderCallbackDataNodes(
          funcName,
          expression,
          getStaticEvalScope(functionNode.arguments, scope),
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
          staticKey === null || staticObjectKey(key) === staticKey
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
      resolveBuiltinCallableNames(functionNode.procedure, scope).some((name) =>
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
        blockScope = bindCallableBlockValue(blockScope, expression as BindNode);
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
  return bindForwardReferences(
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
  lambdaScope = bindForwardReferences(
    lambdaScope,
    lambda,
    dataArgScope,
  );

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
    const callables = resolveCallableValues(arg, scope);
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
  return resolveCallableValues(
    binding.partial.procedure,
    binding.scope,
  ).some(
    (callable) =>
      callable.kind === "lambda" ||
      (callable.kind === "partial" && partialCanInvokeLambda(callable.binding)),
  );
}

interface ResolvedLambdaCall {
  readonly binding: LambdaBinding;
  readonly arguments: AstNode[];
}

function resolveLambdaFunctionCalls(
  procedure: FunctionNode["procedure"],
  callArgs: AstNode[],
  scope: ScopeTracker,
): ResolvedLambdaCall[] {
  return resolveCallableValues(procedure, scope).flatMap((callable) => {
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
    getPartialFunctionResultBasePaths(
      call.binding,
      call.arguments,
      scope,
    ),
  );
}

interface ResolvedPartialCall {
  readonly binding: NonNullable<ReturnType<typeof resolvePartial>>;
  readonly arguments: AstNode[];
}

function higherOrderPartialCalls(
  funcName: "map" | "each" | "reduce",
  args: AstNode[],
  scope: ScopeTracker,
): ResolvedPartialCall[] {
  const dataArg = args[0];
  const callbackArg = args[1];
  if (!dataArg || !callbackArg) return [];

  const partials = resolveCallableValues(callbackArg, scope).flatMap(
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
    const calls = resolveTransformFunctionCalls(
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
  lambdaScope = bindForwardReferences(
    lambdaScope,
    lambda,
    dataArgScope,
  );

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
    ? mergeObjectAliases(
        variant.contextBasePaths.map((basePath) =>
          prefixObjectAlias(parentResolved, basePath),
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
    return resolveCallableValues(arg, argScope).length > 0 ||
      resolveBuiltinCallableNames(arg, argScope).length > 0
      ? bindCallableValue(valueScope, param.value, arg, argScope)
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
    const identityPaths = identityReferencePaths(arg, argumentScope);
    const argPaths = identityPaths ?? walkNode(arg, argumentScope);
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
  lambdaScope = bindForwardReferences(
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
        walkContextExpression(lambda.body, contextPath, lambdaScope),
      )
    : resolveCallableValues(lambda.body, lambdaScope).length > 0
      ? walkCallableSelection(lambda.body, lambdaScope)
      : walkNode(lambda.body, lambdaScope);
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
        localScope = bindCallableBlockValue(localScope, expression as BindNode);
        localCallableScope = bindCallableBlockValue(
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
      ...resolveCallableValues(functionNode.procedure, callableScope).flatMap(
        (callable) => resolvedCallableNames(callable),
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
        ...getResultBasePathsFromArg(arg, scope).map((path) =>
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
      ...resolveCallableValues(functionNode.procedure, scope).flatMap(
        (callable) => resolvedCallableNames(callable),
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
  nextScope = bindSuffixBasePathsIfPresent(nextScope, param.value, arg, argScope);
  nextScope = bindObjectAliasIfPresent(nextScope, param.value, arg, argScope);
  nextScope = bindDynamicObjectAliasIfPresent(nextScope, param.value, arg, argScope);
  const callables = resolveCallableValues(arg, argScope);
  if (
    callables.length === 0 &&
    resolveBuiltinCallableNames(arg, argScope).length === 0
  ) {
    return nextScope;
  }
  nextScope = bindCallableValue(nextScope, param.value, arg, argScope);
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
  return [...callableProcedureVariableNames(binding.lambda.body)].some(
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

function applyPartialArgumentScopes(
  partial: PartialNode,
  callArgs: AstNode[],
  bindingScope: ScopeTracker,
  callScope: ScopeTracker,
): ScopeTracker[] {
  const scopes: ScopeTracker[] = [];
  let callArgIndex = 0;

  for (const partialArg of partial.arguments) {
    if (isPlaceholder(partialArg)) {
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
    scopedCallScope = bindArgumentParameter(
      scopedCallScope,
      variable,
      extractBasePaths(arg, argumentScope),
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
  const boundPaths = walkPartial(binding.partial, binding.scope);
  const callPaths = callArgs.flatMap((arg) => walkNode(arg, callScope));
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
  const resolvedCallables = resolveCallableValues(
    binding.partial.procedure,
    binding.scope,
  );
  const builtinNames = resolveBuiltinCallableNames(
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
      return walkTransformCall(callable.binding, appliedArgs, callScope);
    }
    return walkPartialCall(callable.binding, appliedArgs, callScope);
  });
  for (const name of builtinNames) {
    invocationPaths.push(
      ...walkFunction(
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
      : walkFunction(appliedFunction, binding.scope)),
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
  if (node.procedure.type === "transform") {
    return node.arguments[0]
      ? groupResultObjectAliasForNode(node.arguments[0], scope)
      : null;
  }
  if (node.procedure.type === "condition") {
    return mergeObjectAliases(
      conditionalProcedureCalls(node).map((call) =>
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
    const storedCallables = resolveCallableValues(node.procedure, scope);
    if (storedCallables.length > 0) {
      return mergeObjectAliases(
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
              ? groupResultObjectAliasForNode(node.arguments[0], scope)
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
    isFilteredCallableVariable(node.procedure)
  ) {
    return mergeObjectAliases(
      resolveCallableValues(node.procedure, scope).map((callable) => {
        if (callable.kind === "lambda") {
          return getCustomFunctionResultObjectAlias(
            callable.binding,
            node.arguments,
            scope,
          );
        }
        if (callable.kind === "transform") {
          return node.arguments[0]
            ? groupResultObjectAliasForNode(node.arguments[0], scope)
            : null;
        }
        return getFunctionResultObjectAlias(
          {
            ...node,
            procedure: callable.binding.partial.procedure,
            arguments: applyPartialArguments(
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
    const storedBuiltins = resolveBuiltinCallableNames(node.procedure, scope);
    if (storedBuiltins.length > 0) {
      return mergeObjectAliases(
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
          arguments: applyPartialArguments(partialBinding.partial, node.arguments),
        },
        partialBinding.scope,
      );
    }
    funcName = partialBinding.partial.procedure.value;
    args = applyPartialArguments(partialBinding.partial, node.arguments);
    argScope = partialBinding.scope;
  }
  args = withImplicitRootFunctionArgument(funcName, args, node.position, argScope);

  const lambdaBinding = resolveLambda(argScope, funcName);
  if (lambdaBinding) {
    return getCustomFunctionResultObjectAlias(lambdaBinding, args, argScope);
  }

  if (resolveTransform(argScope, funcName)) {
    return args[0] ? groupResultObjectAliasForNode(args[0], argScope) : null;
  }

  if (funcName === "eval") {
    return getStaticEvalResultObjectAlias(args, argScope);
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
    return mergeObjectAliases(
      args.map((arg) => groupResultObjectAliasForNode(arg, argScope)),
    );
  }
  return args.length > 0
    ? groupResultObjectAliasForNode(args[0], argScope)
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
      ? groupResultDynamicObjectAliasForNode(node.arguments[0], scope)
      : null;
  }
  if (node.procedure.type === "condition") {
    return mergeDynamicObjectAliases(
      conditionalProcedureCalls(node).map((call) =>
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
    const storedCallables = resolveCallableValues(node.procedure, scope);
    if (storedCallables.length > 0) {
      return mergeDynamicObjectAliases(
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
              ? groupResultDynamicObjectAliasForNode(node.arguments[0], scope)
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
    isFilteredCallableVariable(node.procedure)
  ) {
    return mergeDynamicObjectAliases(
      resolveCallableValues(node.procedure, scope).map((callable) => {
        if (callable.kind === "lambda") {
          return getCustomFunctionResultDynamicObjectAlias(
            callable.binding,
            node.arguments,
            scope,
          );
        }
        if (callable.kind === "transform") {
          return node.arguments[0]
            ? groupResultDynamicObjectAliasForNode(node.arguments[0], scope)
            : null;
        }
        return getFunctionResultDynamicObjectAlias(
          {
            ...node,
            procedure: callable.binding.partial.procedure,
            arguments: applyPartialArguments(
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
    const storedBuiltins = resolveBuiltinCallableNames(node.procedure, scope);
    if (storedBuiltins.length > 0) {
      return mergeDynamicObjectAliases(
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
          arguments: applyPartialArguments(partialBinding.partial, node.arguments),
        },
        partialBinding.scope,
      );
    }
    funcName = partialBinding.partial.procedure.value;
    args = applyPartialArguments(partialBinding.partial, node.arguments);
    argScope = partialBinding.scope;
  }
  args = withImplicitRootFunctionArgument(funcName, args, node.position, argScope);

  const lambdaBinding = resolveLambda(argScope, funcName);
  if (lambdaBinding) {
    return getCustomFunctionResultDynamicObjectAlias(lambdaBinding, args, argScope);
  }

  if (resolveTransform(argScope, funcName)) {
    return args[0]
      ? groupResultDynamicObjectAliasForNode(args[0], argScope)
      : null;
  }

  if (funcName === "eval") {
    return getStaticEvalResultDynamicObjectAlias(args, argScope);
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
      args.map((arg) => groupResultDynamicObjectAliasForNode(arg, argScope)),
    );
  }
  return args.length > 0
    ? groupResultDynamicObjectAliasForNode(args[0], argScope)
    : null;
}

function getPartialFunctionResultObjectAlias(
  binding: NonNullable<ReturnType<typeof resolvePartial>>,
  callArgs: AstNode[],
  callScope: ScopeTracker,
): ObjectAlias | null {
  const appliedArgs = applyPartialArguments(binding.partial, callArgs);
  const aliases = resolveCallableValues(
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
        ? groupResultObjectAliasForNode(appliedArgs[0], callScope)
        : null;
    }
    return getPartialFunctionResultObjectAlias(
      callable.binding,
      appliedArgs,
      callScope,
    );
  });
  for (const name of resolveBuiltinCallableNames(
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
  return mergeObjectAliases(aliases);
}

function getPartialFunctionResultDynamicObjectAlias(
  binding: NonNullable<ReturnType<typeof resolvePartial>>,
  callArgs: AstNode[],
  callScope: ScopeTracker,
): DynamicObjectAlias | null {
  const appliedArgs = applyPartialArguments(binding.partial, callArgs);
  const aliases = resolveCallableValues(
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
        ? groupResultDynamicObjectAliasForNode(appliedArgs[0], callScope)
        : null;
    }
    return getPartialFunctionResultDynamicObjectAlias(
      callable.binding,
      appliedArgs,
      callScope,
    );
  });
  for (const name of resolveBuiltinCallableNames(
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
  return mergeDynamicObjectAliases(aliases);
}

function getCustomFunctionResultObjectAlias(
  binding: LambdaBinding,
  callArgs: AstNode[],
  callScope: ScopeTracker,
  defaultsApplied = false,
): ObjectAlias | null {
  const { lambda, scope } = binding;
  if (!defaultsApplied) {
    const variants = lambdaContextDefaultArgumentVariants(lambda, callArgs);
    if (variants.length > 1 || variants[0] !== callArgs) {
      return mergeObjectAliases(
        variants.map((args) =>
          getCustomFunctionResultObjectAlias(binding, args, callScope, true),
        ),
      );
    }
  }
  let lambdaScope = childScope(scope);

  for (let i = 0; i < lambda.arguments.length; i++) {
    const param = lambda.arguments[i];
    const argPaths = i < callArgs.length ? extractBasePaths(callArgs[i], callScope) : [];
    lambdaScope =
      i < callArgs.length
        ? bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
        : bindVariable(lambdaScope, param.value, argPaths);
  }
  lambdaScope = bindForwardReferences(
    lambdaScope,
    lambda,
    binding.forwardScope ?? callScope,
    binding.name,
  );

  const alias = groupResultObjectAliasForNode(lambda.body, lambdaScope);
  const firstArgPaths = callArgs[0] ? extractBasePaths(callArgs[0], callScope) : [];
  return alias ? resolveCallbackObjectAliasParentPaths(alias, firstArgPaths) : null;
}

function getCustomFunctionResultDynamicObjectAlias(
  binding: LambdaBinding,
  callArgs: AstNode[],
  callScope: ScopeTracker,
  defaultsApplied = false,
): DynamicObjectAlias | null {
  const { lambda, scope } = binding;
  if (!defaultsApplied) {
    const variants = lambdaContextDefaultArgumentVariants(lambda, callArgs);
    if (variants.length > 1 || variants[0] !== callArgs) {
      return mergeDynamicObjectAliases(
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
    const argPaths = i < callArgs.length ? extractBasePaths(callArgs[i], callScope) : [];
    lambdaScope =
      i < callArgs.length
        ? bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
        : bindVariable(lambdaScope, param.value, argPaths);
  }
  lambdaScope = bindForwardReferences(
    lambdaScope,
    lambda,
    binding.forwardScope ?? callScope,
    binding.name,
  );

  const alias = groupResultDynamicObjectAliasForNode(lambda.body, lambdaScope);
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
  const callback = findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
  const builtinCallbacks = args[1]
    ? resolveBuiltinCallableNames(args[1], scope)
    : [];
  const partialCallbackAliases = higherOrderPartialCalls(
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
  const dataArgPaths = higherOrderCallbackDataPaths(
    funcName,
    dataArg,
    scope,
  );
  return mergeObjectAliases(
    [
      ...partialCallbackAliases,
      ...(callback?.bindings ?? []).map((binding) => {
        const lambdaScope = bindHigherOrderLambdaCallbackScope(
          funcName,
          binding,
          dataArgPaths,
          dataArg,
          scope,
        );
        const alias = groupResultObjectAliasForNode(
          binding.lambda.body,
          lambdaScope,
        );
        return alias
          ? resolveCallbackObjectAliasParentPaths(alias, dataArgPaths)
          : null;
      }),
      ...(callback
        ? higherOrderPartialLambdaCalls(funcName, callback, dataArg, scope).map((call) =>
            getCustomFunctionResultObjectAlias(
              call.binding,
              call.arguments,
              scope,
            ),
          )
        : []),
      ...builtinCallbacks.flatMap((name) =>
        higherOrderCallbackDataNodes(funcName, dataArg, scope).map((callbackDataArg) =>
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
  const callback = findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
  const builtinCallbacks = args[1]
    ? resolveBuiltinCallableNames(args[1], scope)
    : [];
  const partialCallbackAliases = higherOrderPartialCalls(
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
  const dataArgPaths = higherOrderCallbackDataPaths(
    funcName,
    dataArg,
    scope,
  );
  return mergeDynamicObjectAliases(
    [
      ...partialCallbackAliases,
      ...(callback?.bindings ?? []).map((binding) => {
        const lambdaScope = bindHigherOrderLambdaCallbackScope(
          funcName,
          binding,
          dataArgPaths,
          dataArg,
          scope,
        );
        const alias = groupResultDynamicObjectAliasForNode(
          binding.lambda.body,
          lambdaScope,
        );
        return alias
          ? resolveCallbackDynamicObjectAliasParentPaths(alias, dataArgPaths)
          : null;
      }),
      ...(callback
        ? higherOrderPartialLambdaCalls(funcName, callback, dataArg, scope).map((call) =>
            getCustomFunctionResultDynamicObjectAlias(
              call.binding,
              call.arguments,
              scope,
            ),
          )
        : []),
      ...builtinCallbacks.flatMap((name) =>
        higherOrderCallbackDataNodes(funcName, dataArg, scope).map((callbackDataArg) =>
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
  const callback = findHigherOrderCallback(args, scope);
  const resolvedCallback = findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
  const builtinCallbacks = args[1]
    ? resolveBuiltinCallableNames(args[1], scope)
    : [];
  const partialCallbackAliases = higherOrderPartialCalls(
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
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  const accumulatorPaths = accumulatorArg
    ? extractBasePaths(accumulatorArg, scope)
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

    bodyAlias = groupResultObjectAliasForNode(callback.lambda.body, lambdaScope);
  }
  return mergeObjectAliases([
    ...partialCallbackAliases,
    bodyAlias ? resolveCallbackObjectAliasParentPaths(bodyAlias, dataArgPaths) : null,
    ...(resolvedCallback && dataArg
      ? higherOrderPartialLambdaCalls(
          "reduce",
          resolvedCallback,
          dataArg,
          scope,
          args,
        ).map((call) =>
          getCustomFunctionResultObjectAlias(call.binding, call.arguments, scope),
        )
      : []),
    args[2] ? groupResultObjectAliasForNode(args[2], scope) : null,
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
  const callback = findHigherOrderCallback(args, scope);
  const resolvedCallback = findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
  const builtinCallbacks = args[1]
    ? resolveBuiltinCallableNames(args[1], scope)
    : [];
  const partialCallbackAliases = higherOrderPartialCalls(
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
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  const accumulatorPaths = accumulatorArg
    ? extractBasePaths(accumulatorArg, scope)
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

    callbackAlias = groupResultDynamicObjectAliasForNode(
      callback.lambda.body,
      lambdaScope,
    );
  }
  return mergeDynamicObjectAliases([
    ...partialCallbackAliases,
    callbackAlias
      ? resolveCallbackDynamicObjectAliasParentPaths(callbackAlias, dataArgPaths)
      : null,
    ...(resolvedCallback && dataArg
      ? higherOrderPartialLambdaCalls(
          "reduce",
          resolvedCallback,
          dataArg,
          scope,
          args,
        ).map((call) =>
          getCustomFunctionResultDynamicObjectAlias(call.binding, call.arguments, scope),
        )
      : []),
    args[2] ? groupResultDynamicObjectAliasForNode(args[2], scope) : null,
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
    return conditionalProcedureCalls(node).flatMap((call) =>
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
    const storedCallables = resolveCallableValues(node.procedure, scope);
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
    isFilteredCallableVariable(node.procedure)
  ) {
    return [
      ...resolveCallableValues(node.procedure, scope).flatMap((callable) => {
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
        return getFunctionResultBasePaths(
          {
            ...node,
            procedure: callable.binding.partial.procedure,
            arguments: applyPartialArguments(
              callable.binding.partial,
              node.arguments,
            ),
          },
          callable.binding.scope,
        );
      }),
      ...resolveBuiltinCallableNames(node.procedure, scope).flatMap((name) =>
        getFunctionResultBasePaths(
          {
            ...node,
            procedure: { type: "variable", value: name, position: node.position },
          },
          scope,
        ),
      ),
    ];
  }

  if (!BUILTIN_FUNCTIONS.has(node.procedure.value)) {
    const storedBuiltins = resolveBuiltinCallableNames(node.procedure, scope);
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
          arguments: applyPartialArguments(partialBinding.partial, node.arguments),
        },
        partialBinding.scope,
      );
    }
    funcName = partialBinding.partial.procedure.value;
    args = applyPartialArguments(partialBinding.partial, node.arguments);
    argScope = partialBinding.scope;
  }
  args = withImplicitRootFunctionArgument(funcName, args, node.position, argScope);

  if (
    args.length === 0 &&
    PATH_PRESERVING_RESULT_FUNCTIONS.has(funcName) &&
    builtinUsesContextDefault(funcName, args)
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

  if (funcName === "eval") {
    return getStaticEvalResultBasePaths(args, argScope);
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
  const appliedArgs = applyPartialArguments(binding.partial, callArgs);
  const scopedCall = scopePartialArguments(
    appliedArgs,
    applyPartialArgumentScopes(
      binding.partial,
      callArgs,
      binding.scope,
      callScope,
    ),
    callScope,
  );
  const paths = resolveCallableValues(
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
  for (const name of resolveBuiltinCallableNames(
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
    const variants = lambdaContextDefaultArgumentVariants(lambda, callArgs);
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
    const argPaths = i < callArgs.length ? extractBasePaths(callArgs[i], callScope) : [];
    lambdaScope =
      i < callArgs.length
        ? bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
        : bindVariable(lambdaScope, param.value, argPaths);
  }
  lambdaScope = bindForwardReferences(
    lambdaScope,
    lambda,
    binding.forwardScope ?? callScope,
    binding.name,
  );

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
  const callback = findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
  const builtinCallbacks = args[1]
    ? resolveBuiltinCallableNames(args[1], scope)
    : [];
  const partialCallbackPaths = higherOrderPartialResultBasePaths(
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
  const dataArgPaths = higherOrderCallbackDataPaths(
    funcName,
    dataArg,
    scope,
  );
  return [
    ...partialCallbackPaths,
    ...(callback?.bindings ?? []).flatMap((binding) => {
      const lambdaScope = bindHigherOrderLambdaCallbackScope(
        funcName,
        binding,
        dataArgPaths,
        dataArg,
        scope,
      );
      return resolveCallbackParentPaths(
        bindingAliasPaths(binding.lambda.body, lambdaScope),
        dataArgPaths,
      );
    }),
    ...(callback
      ? higherOrderPartialLambdaCalls(funcName, callback, dataArg, scope).flatMap((call) =>
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
  const callback = findHigherOrderCallback(args, scope);
  const resolvedCallback = findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
  const builtinCallbacks = args[1]
    ? resolveBuiltinCallableNames(args[1], scope)
    : [];
  const builtinPartialPaths = higherOrderPartialCalls(
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
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  const accumulatorPaths = accumulatorArg
    ? extractBasePaths(accumulatorArg, scope)
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

        const callbackBody =
          callback.lambda.body.type === "lambda" &&
          (callback.lambda.body as LambdaNode).thunk
            ? (callback.lambda.body as LambdaNode).body
            : callback.lambda.body;
        return resolveCallbackParentPaths(
          [
            ...bindingAliasPaths(callbackBody, lambdaScope),
            ...groupResultSuffixBasePaths(callbackBody, lambdaScope),
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
      ? higherOrderPartialLambdaCalls(
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
    return conditionalProcedureCalls(func).flatMap((call) =>
      getFunctionResultSuffixBasePaths(call, scope),
    );
  }
  if (
    func.procedure.type === "function" ||
    func.procedure.type === "block" ||
    func.procedure.type === "path" ||
    func.procedure.type === "partial" ||
    isFilteredCallableVariable(func.procedure)
  ) {
    return resolveCallableValues(func.procedure, scope).flatMap((callable) => {
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
          arguments: applyPartialArguments(callable.binding.partial, func.arguments),
        },
        callable.binding.scope,
      );
    });
  }

  if (!BUILTIN_FUNCTIONS.has(func.procedure.value)) {
    const storedBuiltins = resolveBuiltinCallableNames(func.procedure, scope);
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
    const appliedArgs = applyPartialArguments(
      partialBinding.partial,
      func.arguments,
    );
    const scopedCall = scopePartialArguments(
      appliedArgs,
      applyPartialArgumentScopes(
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
  args = withImplicitRootFunctionArgument(funcName, args, func.position, argScope);

  const lambdaBinding = resolveLambda(argScope, funcName);
  if (lambdaBinding) {
    return getCustomFunctionResultSuffixBasePaths(lambdaBinding, args, argScope);
  }

  if (resolveTransform(argScope, funcName)) {
    return args[0] ? groupResultSuffixBasePaths(args[0], argScope) : [];
  }

  if (funcName === "eval") {
    return getStaticEvalResultBasePaths(args, argScope);
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
      groupResultSuffixableBasePaths(arg, argScope),
    );
  }

  return args[0] ? groupResultSuffixBasePaths(args[0], argScope) : [];
}

function getResultSuffixBasePaths(node: AstNode, scope: ScopeTracker): string[] {
  if (node.type === "apply") {
    const func = appliedFunctionFromApply(node as ApplyNode);
    return func ? getFunctionResultSuffixBasePaths(func, scope) : [];
  }

  if (node.type === "block") {
    return getBlockResultSuffixBasePaths(node as BlockNode, scope);
  }

  if (node.type === "condition") {
    const condition = node as ConditionNode;
    return [
      ...groupResultSuffixableBasePaths(condition.then, scope),
      ...(condition.else
        ? groupResultSuffixableBasePaths(condition.else, scope)
        : []),
    ];
  }

  if (node.type === "path") {
    const pathNode = node as PathNode;
    if (pathNode.group) return [];
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
      groupResultSuffixBasePaths(expr, scope),
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

  return groupResultSuffixableBasePaths(accumulatorArg, scope);
}

function getReduceCallbackResultSuffixBasePaths(
  args: AstNode[],
  scope: ScopeTracker,
): string[] {
  const callback = findHigherOrderCallback(args, scope);
  const resolvedCallback = findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
  if (!callback && !resolvedCallback?.partials.length) return [];

  const dataArg = args[0];
  const accumulatorArg = args[2] ?? dataArg;
  const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];
  const accumulatorPaths = accumulatorArg
    ? extractBasePaths(accumulatorArg, scope)
    : dataArgPaths;
  const partialPaths =
    resolvedCallback && dataArg
      ? higherOrderPartialLambdaCalls(
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

  return [
    ...groupResultSuffixBasePaths(callback.lambda.body, lambdaScope),
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
    const variants = lambdaContextDefaultArgumentVariants(lambda, callArgs);
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
    const argPaths = i < callArgs.length ? extractBasePaths(callArgs[i], callScope) : [];
    lambdaScope =
      i < callArgs.length
        ? bindArgumentParameter(lambdaScope, param, argPaths, callArgs[i], callScope)
        : bindVariable(lambdaScope, param.value, argPaths);
  }
  lambdaScope = bindForwardReferences(
    lambdaScope,
    lambda,
    binding.forwardScope ?? callScope,
    binding.name,
  );

  return groupResultSuffixBasePaths(lambda.body, lambdaScope);
}

function getCallbackResultSuffixBasePaths(
  funcName: "map" | "each",
  args: AstNode[],
  scope: ScopeTracker,
): string[] {
  const callback = findResolvedHigherOrderLambdaCallbacks(args, scope, 1);
  const builtinCallbacks = args[1]
    ? resolveBuiltinCallableNames(args[1], scope)
    : [];
  if (!callback && builtinCallbacks.length === 0) return [];

  const dataArg = args[0];
  const dataArgPaths = higherOrderCallbackDataPaths(
    funcName,
    dataArg,
    scope,
  );
  return [
    ...(callback?.bindings ?? []).flatMap((binding) =>
      groupResultSuffixBasePaths(
        binding.lambda.body,
        bindHigherOrderLambdaCallbackScope(
          funcName,
          binding,
          dataArgPaths,
          dataArg,
          scope,
        ),
      ),
    ),
    ...(callback
      ? higherOrderPartialLambdaCalls(funcName, callback, dataArg, scope).flatMap((call) =>
          getCustomFunctionResultSuffixBasePaths(
            call.binding,
            call.arguments,
            scope,
          ),
        )
      : []),
    ...builtinCallbacks.flatMap((name) =>
      PATH_PRESERVING_RESULT_FUNCTIONS.has(name) &&
      !(dataArg && objectAliasForNode(dataArg, scope)) &&
      !(dataArg && dynamicObjectAliasForNode(dataArg, scope))
        ? dataArgPaths
        : higherOrderCallbackDataNodes(funcName, dataArg, scope).flatMap(
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

      currentScope = bindCallableValue(
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

  const objectAlias = groupResultObjectAliasForNode(objectArg, scope);
  const objectPaths =
    objectArg.type === "variable" && pathValueAliasBases.length === 0 && objectAlias
      ? selectObjectAliasPaths(objectAlias, selectorSteps)
      : null;
  if (objectPaths) paths.push(...objectPaths);

  const suffix = buildPathString(selectorSteps);
  const objectAliasBases = new Set(
    objectAlias ? [...objectAlias.values()].flatMap((basePaths) => [...basePaths]) : [],
  );
  const suffixBasePaths =
    objectArg.type === "variable"
      ? (resolveSuffixBasePaths(scope, (objectArg as VariableNode).value) ?? [])
      : groupResultSuffixBasePaths(objectArg, scope);
  if (objectArg.type !== "object" && suffixBasePaths.length > 0 && suffix) {
    paths.push(
      ...suffixBasePaths
        .filter((path) => !objectAliasBases.has(path))
        .map((path) =>
          staticSelector ? appendPath(path, staticSelector) : appendDynamicLookupMarker(path),
        ),
    );
  }

  const dynamicObjectAlias = groupResultDynamicObjectAliasForNode(
    objectArg,
    scope,
  );
  if (dynamicObjectAlias) {
    paths.push(...selectLookupDynamicObjectAliasPaths(dynamicObjectAlias, []));
  }

  if (!staticSelector && paths.length === 0 && !objectAlias && !dynamicObjectAlias) {
    const basePaths =
      identityReferencePaths(objectArg, scope) ??
      getResultBasePathsFromArg(objectArg, scope);
    paths.push(...basePaths.map(appendDynamicLookupMarker));
  }

  if (paths.length > 0) return paths;
  if (objectArg.type === "object" && (objectAlias || dynamicObjectAlias)) return [];

  const basePaths =
    identityReferencePaths(objectArg, scope) ??
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
  const objectAlias = groupResultObjectAliasForNode(objectArg, scope);
  const dynamicObjectAlias = groupResultDynamicObjectAliasForNode(
    objectArg,
    scope,
  );
  const objectAliasBases = new Set(
    objectAlias ? [...objectAlias.values()].flatMap((basePaths) => [...basePaths]) : [],
  );
  const suffixBasePaths =
    objectArg.type === "variable"
      ? (resolveSuffixBasePaths(scope, (objectArg as VariableNode).value) ?? [])
      : groupResultSuffixBasePaths(objectArg, scope);
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

      currentScope = bindCallableValue(
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
    const key = staticObjectKey(keyNode);
    const selector = selectorSteps[0];
    const selectorMatches =
      !key || selector?.type !== "name" || key === (selector as NameNode).value;
    if (!selectorMatches) return [];

    if (
      valueNode.type === "object" ||
      objectAliasForNode(valueNode, scope) ||
      dynamicObjectAliasForNode(valueNode, scope)
    ) {
      return [];
    }

    return bindingAliasPaths(valueNode, scope);
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
  const identityPaths = identityReferencePaths(node, scope);
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
  } else if (
    ["path", "block"].includes(node.rhs.type) &&
    (resolveCallableValues(node.rhs, scope).length > 0 ||
      resolveBuiltinCallableNames(node.rhs, scope).length > 0)
  ) {
    paths.push(
      ...walkFunction(
        {
          type: "function",
          value: "(",
          position: node.position,
          procedure: node.rhs as FunctionNode["procedure"],
          arguments: [node.lhs],
        },
        scope,
      ),
    );
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
    const transformNode = node.rhs as TransformNode;
    const transformPaths = walkTransform(transformNode, scope);
    const transformBasePaths = extractBasePaths(node.lhs, scope);
    if (transformBasePaths.includes(ROOT_PATH)) paths.push("**");
    const aliasContextPaths = transformApplyAliasContextPaths(
      transformNode,
      transformPaths,
      node.lhs,
      lhsPaths,
      scope,
    );
    if (aliasContextPaths) {
      paths.push(...aliasContextPaths);
      return paths;
    }
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
