import type { AstNode, NameNode } from "./types.js";

/**
 * Build a dot-notation path string from an array of AST step nodes.
 * Returns null if no valid segments found.
 *
 * Handles: name -> "fieldName", wildcard -> "*", descendant -> "**"
 * Skips: unknown step types (future-proofing for filter/sort stages)
 */
export function buildPathString(steps: AstNode[]): string | null {
  const segments: string[] = [];
  for (const step of steps) {
    switch (step.type) {
      case "name":
        segments.push((step as NameNode).value);
        break;
      case "wildcard":
        segments.push("*");
        break;
      case "descendant":
        segments.push("**");
        break;
      case "parent":
        segments.push("%");
        break;
      default:
        // Non-path step (e.g., filter/sort in Phase 3)
        // Skip silently -- don't break the path
        break;
    }
  }
  return segments.length > 0 ? segments.join(".") : null;
}
