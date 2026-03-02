import type {
  AstNode,
  BinaryNode,
  BlockNode,
  ConditionNode,
  NameNode,
  PathNode,
  UnaryNode,
} from "./types.js";
import { buildPathString } from "./path-builder.js";

/**
 * Walk an AST node and extract all data paths as raw strings.
 * Dispatches on node.type using a switch statement.
 * Unknown node types return empty array (skip silently).
 */
export function walkNode(node: AstNode): string[] {
  switch (node.type) {
    case "path":
      return walkPath(node as PathNode);
    case "name":
      return [(node as NameNode).value];
    case "wildcard":
      return ["*"];
    case "descendant":
      return ["**"];
    case "binary":
      return walkBinary(node as BinaryNode);
    case "condition":
      return walkCondition(node as ConditionNode);
    case "block":
      return (node as BlockNode).expressions.flatMap(walkNode);
    case "unary":
      return walkUnary(node as UnaryNode);
    case "string":
    case "number":
    case "value":
    case "regex":
      return []; // literals produce no paths
    case "variable":
      return []; // Phase 1: variables are opaque (Phase 2 traces them)
    default:
      // Unknown node type -- skip silently (over-approximate: don't crash)
      return [];
  }
}

/** Extract the single dot-notation path from a path node's steps. */
function walkPath(node: PathNode): string[] {
  const path = buildPathString(node.steps);
  return path ? [path] : [];
}

/** Extract paths from both sides of a binary operator. */
function walkBinary(node: BinaryNode): string[] {
  return [...walkNode(node.lhs), ...walkNode(node.rhs)];
}

/** Extract paths from condition, then-branch, and optional else-branch. */
function walkCondition(node: ConditionNode): string[] {
  return [
    ...walkNode(node.condition),
    ...walkNode(node.then),
    ...(node.else ? walkNode(node.else) : []),
  ];
}

/** Extract paths from unary expressions (negation, array/object constructors). */
function walkUnary(node: UnaryNode): string[] {
  switch (node.value) {
    case "-":
      // Negation: -expr -> walk the expression
      return node.expression ? walkNode(node.expression) : [];
    case "[":
      // Array constructor: [a, b, c] -> walk all expressions
      return (node.expressions ?? []).flatMap(walkNode);
    case "{":
      // Object constructor: {"key": value} -> walk values only
      return (node.lhs ?? []).flatMap(([_key, val]) => walkNode(val));
    default:
      return [];
  }
}
