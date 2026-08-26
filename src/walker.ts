import type { AstNode } from "./types.js";
import { createScope, type ScopeTracker } from "./scope.js";
import { walkNode as walkInternalNode } from "./walker/index.js";

/**
 * Walk an AST node and extract all data paths as raw strings.
 * Threads an immutable scope through the internal walker module.
 */
export function walkNode(
  node: AstNode,
  scope: ScopeTracker = createScope(),
): string[] {
  return walkInternalNode(node, scope);
}
