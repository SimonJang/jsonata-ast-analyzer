import type {
  AstNode,
  BinaryNode,
  BindNode,
  BlockNode,
  ConditionNode,
  FunctionNode,
  NameNode,
  PathNode,
  UnaryNode,
  VariableNode,
} from "./types.js";
import { buildPathString } from "./path-builder.js";
import type { ScopeTracker } from "./scope.js";
import {
  createScope,
  childScope,
  bindVariable,
  resolveVariable,
} from "./scope.js";
import { BUILTIN_FUNCTIONS } from "./builtins.js";

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
    case "unary":
      return walkUnary(node as UnaryNode, scope);
    case "bind":
      return walkBind(node as BindNode, scope);
    case "function":
      return walkFunction(node as FunctionNode, scope);
    case "string":
    case "number":
    case "value":
    case "regex":
      return []; // literals produce no paths
    case "variable":
      return walkVariable(node as VariableNode, scope);
    default:
      // Unknown node type -- skip silently (over-approximate: don't crash)
      return [];
  }
}

/**
 * Extract paths from a path node's steps, handling variable steps
 * and focus/index properties on name steps.
 */
function walkPath(node: PathNode, scope: ScopeTracker): string[] {
  // Check if any step is a variable (e.g., $x.name)
  const varStepIndex = node.steps.findIndex((s) => s.type === "variable");

  if (varStepIndex >= 0) {
    const varStep = node.steps[varStepIndex] as VariableNode;
    const resolved = resolveVariable(scope, varStep.value);

    if (resolved && resolved.length > 0) {
      // Build suffix from remaining steps after the variable
      const suffixSteps = node.steps.slice(varStepIndex + 1);
      const suffix = buildPathString(suffixSteps);

      // Concatenate resolved paths with suffix
      return resolved.map((p) => (suffix ? `${p}.${suffix}` : p));
    }
    // Unresolvable variable in path: drop the entire path (silent skip)
    return [];
  }

  // No variable steps: build the path from name/wildcard/descendant steps
  // Also handle focus/index on name steps (bind context/positional vars to scope)
  const path = buildPathString(node.steps);
  return path ? [path] : [];
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
 */
function walkBlock(node: BlockNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];
  let currentScope = scope;

  for (const expr of node.expressions) {
    if (expr.type === "bind") {
      const bindNode = expr as BindNode;
      const rhsPaths = walkNode(bindNode.rhs, currentScope);
      paths.push(...rhsPaths);
      currentScope = bindVariable(
        currentScope,
        bindNode.lhs.value,
        rhsPaths,
      );
    } else if (expr.type === "block") {
      // Inner block: create a child scope so bindings don't leak
      const innerScope = childScope(currentScope);
      paths.push(...walkBlock(expr as BlockNode, innerScope));
    } else {
      paths.push(...walkNode(expr, currentScope));
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

/** Extract paths from unary expressions (negation, array/object constructors). */
function walkUnary(node: UnaryNode, scope: ScopeTracker): string[] {
  switch (node.value) {
    case "-":
      // Negation: -expr -> walk the expression
      return node.expression ? walkNode(node.expression, scope) : [];
    case "[":
      // Array constructor: [a, b, c] -> walk all expressions
      return (node.expressions ?? []).flatMap((e) => walkNode(e, scope));
    case "{":
      // Object constructor: {"key": value} -> walk values only
      return (node.lhs ?? []).flatMap(([_key, val]) => walkNode(val, scope));
    default:
      return [];
  }
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
    return [...resolved];
  }

  // Built-in function names produce no paths
  if (BUILTIN_FUNCTIONS.has(node.value)) {
    return [];
  }

  // Unresolvable variable: silent skip
  return [];
}

/**
 * Extract paths from function arguments (pass-through).
 * For this plan, all function arguments are walked to extract data paths.
 * The function name itself produces no paths.
 */
function walkFunction(node: FunctionNode, scope: ScopeTracker): string[] {
  return node.arguments.flatMap((arg) => walkNode(arg, scope));
}
