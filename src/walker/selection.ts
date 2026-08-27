import type {
  ApplyNode,
  ArrayNode,
  AstNode,
  BindNode,
  BlockNode,
  ConditionNode,
  FunctionNode,
  LambdaNode,
  ObjectNode,
  PathNode,
} from "../types.js";
import {
  bindVariable,
  childScope,
  type ScopeTracker,
} from "../scope.js";
import type { SelectionOperations, WalkerRuntime } from "./runtime.js";

export function createSelectionOperations(
  runtime: WalkerRuntime,
): SelectionOperations {
  function bindValue(
    scope: ScopeTracker,
    node: BindNode,
  ): ScopeTracker {
    const closureScope = scope;
    let nextScope = bindVariable(
      scope,
      node.lhs.value,
      runtime.aliases.bindingAliasPaths(node.rhs, scope),
    );
    nextScope = runtime.aliases.bindSuffixBasePathsIfPresent(
      nextScope,
      node.lhs.value,
      node.rhs,
      closureScope,
    );
    nextScope = runtime.aliases.bindObjectAliasIfPresent(
      nextScope,
      node.lhs.value,
      node.rhs,
      closureScope,
    );
    nextScope = runtime.aliases.bindDynamicObjectAliasIfPresent(
      nextScope,
      node.lhs.value,
      node.rhs,
      closureScope,
    );
    return runtime.functions.bindCallableValue(
      nextScope,
      node.lhs.value,
      node.rhs,
      closureScope,
    );
  }

  function getBlockSelectedResultPaths(
    node: BlockNode,
    scope: ScopeTracker,
  ): string[] {
    let currentScope = scope;
    let selectedPaths: string[] = [];
    for (const expression of node.expressions) {
      if (expression.type === "bind") {
        const bindNode = expression as BindNode;
        selectedPaths = getSelectedResultPaths(
          bindNode.rhs,
          currentScope,
        );
        currentScope = bindValue(currentScope, bindNode);
      } else if (expression.type === "block") {
        selectedPaths = getBlockSelectedResultPaths(
          expression as BlockNode,
          childScope(currentScope),
        );
      } else {
        selectedPaths = getSelectedResultPaths(expression, currentScope);
      }
    }
    return selectedPaths;
  }

  function getArraySelectedResultPaths(
    node: ArrayNode,
    scope: ScopeTracker,
  ): string[] {
    let currentScope = scope;
    const selectedPaths: string[] = [];
    for (const expression of node.expressions) {
      if (expression.type === "bind") {
        currentScope = bindValue(currentScope, expression as BindNode);
      } else {
        selectedPaths.push(...getSelectedResultPaths(expression, currentScope));
      }
    }
    return selectedPaths;
  }

  function getSelectedResultPaths(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] {
    const group = (node as AstNode & {
      group?: { entries: [AstNode, AstNode][] };
    }).group;
    if (group) {
      const basePaths = runtime.results.getResultBasePathsFromArg(
        { ...node, group: undefined } as AstNode,
        scope,
      );
      const contextScope = bindVariable(childScope(scope), "", basePaths);
      return group.entries.flatMap(([, value]) =>
        getSelectedResultPaths(value, contextScope),
      );
    }

    switch (node.type) {
      case "condition": {
        const condition = node as ConditionNode;
        return [
          ...getSelectedResultPaths(condition.then, scope),
          ...(condition.else
            ? getSelectedResultPaths(condition.else, scope)
            : []),
        ];
      }
      case "block":
        return getBlockSelectedResultPaths(node as BlockNode, scope);
      case "array":
        return getArraySelectedResultPaths(node as ArrayNode, scope);
      case "object":
        return (node as ObjectNode).entries.flatMap(([, value]) =>
          getSelectedResultPaths(value, scope),
        );
      case "bind":
        return getSelectedResultPaths((node as BindNode).rhs, scope);
      case "function":
        return runtime.results.getFunctionResultBasePaths(
          node as FunctionNode,
          scope,
        );
      case "apply": {
        const apply = node as ApplyNode;
        if (apply.rhs.type === "transform") {
          return runtime.results.getResultBasePathsFromArg(apply.lhs, scope);
        }
        const applied = runtime.functions.appliedFunctionFromApply(apply);
        return applied
          ? runtime.results.getFunctionResultBasePaths(applied, scope)
          : [];
      }
      case "lambda":
        return (node as LambdaNode).thunk
          ? getSelectedResultPaths((node as LambdaNode).body, scope)
          : [];
      case "name":
        return runtime.aliases.bindingAliasPaths(node, scope);
      case "path": {
        const path = node as PathNode;
        const objectAlias = runtime.aliases.objectAliasForNode(path, scope);
        if (objectAlias) {
          return [...objectAlias.values()].flatMap((paths) => [...paths]);
        }
        return runtime.aliases.bindingAliasPaths(path, scope);
      }
      case "variable":
      case "wildcard":
      case "descendant":
      case "parent":
        return runtime.results.getResultBasePathsFromArg(node, scope);
      default:
        return [];
    }
  }

  return { getSelectedResultPaths };
}
