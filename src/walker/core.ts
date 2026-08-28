import type { ArrayNode, AstNode, ApplyNode, BinaryNode, BindNode, BlockNode, ConditionNode, DescendantNode, FilterStage, FunctionNode, GroupByNode, LambdaNode, NameNode, NegateNode, ObjectNode, PartialNode, PathNode, TransformNode, VariableNode, WildcardNode } from "../types.js";
import { type ScopeTracker, childScope, bindVariable } from "../scope.js";
import { appendPath } from "./path-utils.js";
import type { CoreOperations, WalkerRuntime } from "./runtime.js";

export function createCoreOperations(runtime: WalkerRuntime): CoreOperations {
  const IN_PROGRESS = Symbol("walk-in-progress");
  const walkCache = new WeakMap<
    AstNode,
    WeakMap<ScopeTracker, string[] | typeof IN_PROGRESS>
  >();

  /**
   * Walk an AST node and extract all data paths as raw strings.
   * Dispatches on node.type using a switch statement.
   * Threads an immutable scope for variable resolution.
   * Unknown node types return empty array (skip silently).
   */
  function walkNode(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] {
    let scopeCache = walkCache.get(node);
    if (!scopeCache) {
      scopeCache = new WeakMap();
      walkCache.set(node, scopeCache);
    }
    const cached = scopeCache.get(scope);
    if (cached === IN_PROGRESS) return [];
    if (cached) return cached;

    scopeCache.set(scope, IN_PROGRESS);
    const paths = computeWalkNode(node, scope);
    scopeCache.set(scope, paths);
    return paths;
  }

  function computeWalkNode(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] {
    switch (node.type) {
      case "path":
        return runtime.paths.walkPath(node as PathNode, scope);
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
        return runtime.functions.walkFunction(node as FunctionNode, scope);
      case "lambda":
        return runtime.functions.walkLambda(node as LambdaNode, scope);
      case "apply":
        return runtime.functions.walkApply(node as ApplyNode, scope);
      case "partial":
        return runtime.functions.walkPartial(node as PartialNode, scope);
      case "string":
      case "number":
      case "value":
      case "regex":
        return walkLiteralPredicates(node, scope);
      case "variable":
        return runtime.functions.walkVariable(node as VariableNode, scope);
      case "parent":
        // ADV-01: parent operator produces "%" as a literal path segment
        return ["%"];
      case "transform":
        return runtime.transforms.walkTransform(node as TransformNode, scope);
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
      ...runtime.paths.walkSourceLessFilterStages(
        node.predicate ?? [],
        literalScope,
      ),
      ...(node.group
        ? runtime.paths.walkSourceLessGroupEntries(node.group, literalScope)
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
      ...runtime.paths.walkFilterStages(
        node.predicate ?? [],
        "*",
        stageScope,
        nonPathVariables,
        stageVariables,
      ),
      ...(node.group
        ? runtime.paths.walkContextGroupEntries(node.group, "*", stageScope, stageVariables)
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
      ...runtime.paths.walkFilterStages(
        node.predicate ?? [],
        "**",
        stageScope,
        nonPathVariables,
        stageVariables,
      ),
      ...(node.group
        ? runtime.paths.walkContextGroupEntries(node.group, "**", stageScope, stageVariables)
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

  /** Extract paths from both sides of a binary operator. */
  function walkBinary(node: BinaryNode, scope: ScopeTracker): string[] {
    const paths = [...walkNode(node.lhs, scope), ...walkNode(node.rhs, scope)];
    if (node.value === "=" || node.value === "!=") {
      for (const operand of [node.lhs, node.rhs]) {
        const identityPaths = runtime.functions.identityReferencePaths(operand, scope);
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
    return runtime.callables.resolveCallableValues(node, scope).length > 0
      ? runtime.functions.walkCallableSelection(node, scope)
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
        const identityPaths = runtime.functions.identityReferencePaths(bindNode.rhs, currentScope);
        const returnsCallable = runtime.callables.resolveCallableValues(bindNode.rhs, currentScope).length > 0;
        const rhsPaths =
          identityPaths ??
          (returnsCallable
            ? runtime.functions.walkCallableSelection(bindNode.rhs, currentScope)
            : walkNode(bindNode.rhs, currentScope));
        if (!identityPaths && bindNode.rhs.type !== "transform") paths.push(...rhsPaths);
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
        // Inner block: create a child scope so bindings don't leak
        const innerScope = childScope(currentScope);
        paths.push(...walkBlock(expr as BlockNode, innerScope));
      } else {
        paths.push(...walkNode(expr, currentScope));
      }
    }
  
    if (node.group) {
      const groupScope = runtime.aliases.bindStepFocusScope(node, currentScope);
      const groupStageVariables = new Set(
        node.focusBinding ? [node.focusBinding.name] : [],
      );
      const objectAlias = runtime.aliases.objectAliasFromBlock(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      const suffixBasePaths = runtime.results.getBlockResultSuffixBasePaths(node, scope);
      const resultBasePaths = runtime.aliases.bindingAliasPathsFromBlock(node, scope);
      paths.push(
        ...(objectAlias || dynamicObjectAlias
          ? runtime.paths.walkAliasGroupEntries(
              node.group,
              objectAlias,
              dynamicObjectAlias,
              groupScope,
              suffixBasePaths,
            )
          : resultBasePaths.length > 0
            ? resultBasePaths.flatMap((basePath) =>
                runtime.paths.walkContextGroupEntries(
                  node.group!,
                  basePath,
                  groupScope,
                  groupStageVariables,
                ),
              )
            : runtime.paths.walkSourceLessGroupEntries(node.group, groupScope)),
      );
    }
  
    if (node.predicate && node.predicate.length > 0) {
      const predicateScope = runtime.aliases.bindStepFocusScope(node, currentScope);
      const predicateStageVariables = new Set<string>();
      if (node.focusBinding) predicateStageVariables.add(node.focusBinding.name);
      const objectAlias = runtime.aliases.objectAliasFromBlock(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      if (objectAlias || dynamicObjectAlias) {
        paths.push(
          ...node.predicate.flatMap((stage) =>
            stage.type === "filter"
              ? runtime.aliases.selectAliasExpressionPaths(
                  objectAlias,
                  dynamicObjectAlias,
                  (stage as unknown as FilterStage).expr,
                  predicateScope,
                  runtime.results.getBlockResultSuffixBasePaths(node, scope),
                )
              : [],
          ),
        );
      } else {
        const resultBasePaths = runtime.aliases.bindingAliasPathsFromBlock(node, scope);
        if (resultBasePaths.length === 0) {
          paths.push(
            ...runtime.paths.walkSourceLessFilterStages(
              node.predicate,
              predicateScope,
            ),
          );
        }
        for (const resultBasePath of resultBasePaths) {
          paths.push(
            ...runtime.paths.walkFilterStages(
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
        const identityPaths = runtime.functions.identityReferencePaths(bindNode.rhs, currentScope);
        const rhsPaths = identityPaths ?? walkValueExpression(bindNode.rhs, currentScope);
        if (!identityPaths) paths.push(...rhsPaths);
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
      } else {
        paths.push(...walkValueExpression(expr, currentScope));
      }
    }
    if (node.predicate && node.predicate.length > 0) {
      let predicateScope = currentScope;
      const predicateStageVariables = new Set<string>();
      const predicateNonPathVariables = new Set<string>();
      const resultBasePaths = runtime.aliases.bindingAliasPaths(node, scope);
  
      if (node.focusBinding) {
        predicateScope = runtime.aliases.bindFocusObjectAliasScope(
          predicateScope,
          node.focusBinding.name,
          runtime.aliases.objectAliasForNode(node, scope),
          runtime.aliases.dynamicObjectAliasForNode(node, scope),
          resultBasePaths,
          runtime.results.getResultSuffixBasePaths(node, scope),
        );
        predicateStageVariables.add(node.focusBinding.name);
      }
      if (node.indexBinding) {
        if (predicateScope === currentScope) predicateScope = childScope(predicateScope);
        predicateScope = bindVariable(predicateScope, node.indexBinding.name, []);
        predicateNonPathVariables.add(node.indexBinding.name);
      }
  
      const objectAlias = runtime.aliases.objectAliasForNode(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      if (objectAlias || dynamicObjectAlias) {
        paths.push(
          ...node.predicate.flatMap((stage) =>
            stage.type === "filter"
              ? runtime.aliases.selectAliasExpressionPaths(
                  objectAlias,
                  dynamicObjectAlias,
                  (stage as unknown as FilterStage).expr,
                  predicateScope,
                  runtime.results.getResultSuffixBasePaths(node, scope),
                )
              : [],
          ),
        );
      } else {
        if (resultBasePaths.length === 0) {
          paths.push(
            ...runtime.paths.walkSourceLessFilterStages(
              node.predicate,
              predicateScope,
            ),
          );
        }
        for (const resultBasePath of resultBasePaths) {
          paths.push(
            ...runtime.paths.walkFilterStages(
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
      const groupScope = runtime.aliases.bindStepFocusScope(node, currentScope);
      const objectAlias = runtime.aliases.objectAliasForNode(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      const resultBasePaths = runtime.aliases.bindingAliasPaths(node, scope);
      const groupStageVariables = new Set(
        node.focusBinding ? [node.focusBinding.name] : [],
      );
      paths.push(
        ...(objectAlias || dynamicObjectAlias
          ? runtime.paths.walkAliasGroupEntries(node.group, objectAlias, dynamicObjectAlias, groupScope)
          : resultBasePaths.length > 0
            ? resultBasePaths.flatMap((basePath) =>
                runtime.paths.walkContextGroupEntries(
                  node.group!,
                  basePath,
                  groupScope,
                  groupStageVariables,
                ),
              )
            : runtime.paths.walkSourceLessGroupEntries(node.group, groupScope)),
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
      const objectAlias = runtime.aliases.objectAliasFromObject(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      const resultBasePaths = node.entries.flatMap(([, value]) =>
        runtime.aliases.bindingAliasPaths(value, scope),
      );
      let predicateScope = scope;
  
      if (node.focusBinding) {
        predicateScope = runtime.aliases.bindFocusObjectAliasScope(
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
            ? runtime.aliases.selectAliasExpressionPaths(
                objectAlias,
                dynamicObjectAlias,
                (stage as unknown as FilterStage).expr,
                predicateScope,
              )
            : runtime.paths.walkSourceLessFilterStages([stage], predicateScope)),
        );
      }
    }
    if (node.group) {
      const objectAlias = runtime.aliases.objectAliasFromObject(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      const resultBasePaths = node.entries.flatMap(([, value]) =>
        runtime.aliases.bindingAliasPaths(value, scope),
      );
      let groupScope = scope;
      const groupStageVariables = new Set<string>();
  
      if (node.focusBinding) {
        groupScope = runtime.aliases.bindFocusObjectAliasScope(
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
          ? runtime.paths.walkAliasGroupEntries(node.group, objectAlias, dynamicObjectAlias, groupScope)
          : resultBasePaths.length > 0
            ? resultBasePaths.flatMap((basePath) =>
                runtime.paths.walkContextGroupEntries(
                  node.group!,
                  basePath,
                  groupScope,
                  groupStageVariables,
                ),
              )
            : runtime.paths.walkSourceLessGroupEntries(node.group, groupScope)),
      );
    }
    return paths;
  }

  return {
    walkNode,
    bindBroadStepScope,
    walkArray,
    walkObject,
  };
}
