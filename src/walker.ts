import type { AstNode, PathNode, UnaryNode } from "./types.js";
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
      return [node.value as string]; // standalone name = single-step path
    case "wildcard":
      return ["*"];
    case "descendant":
      return ["**"];
    case "binary":
      return [
        ...walkNode((node as { lhs: AstNode }).lhs),
        ...walkNode((node as { rhs: AstNode }).rhs),
      ];
    case "condition":
      return [
        ...walkNode((node as { condition: AstNode }).condition),
        ...walkNode((node as { then: AstNode }).then),
        ...((node as { else?: AstNode }).else
          ? walkNode((node as { else: AstNode }).else)
          : []),
      ];
    case "block":
      return (node as { expressions: AstNode[] }).expressions.flatMap(
        (expr: AstNode) => walkNode(expr),
      );
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

function walkPath(node: PathNode): string[] {
  const path = buildPathString(node.steps);
  return path ? [path] : [];
}

function walkUnary(node: UnaryNode): string[] {
  switch (node.value) {
    case "-":
      // Negation: -expr -> walk the expression
      return node.expression ? walkNode(node.expression) : [];
    case "[":
      // Array constructor: [a, b, c] -> walk all expressions
      return (node.expressions ?? []).flatMap((expr: AstNode) =>
        walkNode(expr),
      );
    case "{":
      // Object constructor: {"key": value} -> walk values (keys are string literals)
      return (node.lhs ?? []).flatMap(([_key, val]: [AstNode, AstNode]) =>
        walkNode(val),
      );
    default:
      return [];
  }
}
