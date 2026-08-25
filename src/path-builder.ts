import type { AstNode, NameNode, VariableNode } from "./types.js";

/**
 * Build a dot-notation path string from an array of AST step nodes.
 * Returns null if no valid segments found.
 *
 * Handles: name -> "fieldName", wildcard -> "*", descendant -> "**"
 * Skips: unknown step types (future-proofing for filter/sort stages)
 */
export function buildPathString(steps: AstNode[]): string | null {
  const segments: string[] = [];
  let focusResetDepth: number | null = null;
  let focusBindingName: string | null = null;
  for (const step of steps) {
    if (
      step.type === "variable" &&
      !["", "$"].includes((step as VariableNode).value)
    ) {
      if ((step as VariableNode).value === focusBindingName) {
        focusResetDepth = null;
        focusBindingName = null;
        continue;
      }
      return null;
    }

    const isPathSegment = ["name", "wildcard", "descendant", "parent"].includes(
      step.type,
    );
    if (isPathSegment && focusResetDepth !== null) {
      segments.length = focusResetDepth;
      focusResetDepth = null;
      focusBindingName = null;
    }

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

    const focusBinding = (
      step as AstNode & { focusBinding?: { name: string } }
    ).focusBinding;
    if (isPathSegment && focusBinding) {
      focusBindingName = focusBinding.name;
      focusResetDepth = Math.max(0, segments.length - 1);
    }
  }
  return segments.length > 0 ? segments.join(".") : null;
}
