import type { AstNode, BlockNode, NegateNode, PathNode, VariableNode } from "../types.js";
import { buildPathString } from "../path-builder.js";
import { ROOT_PATH } from "./constants.js";

/**
 * Prefix each path with a context string.
 * Used by context-relative operators (filter, sort, group-by, transform).
 * Empty prefix or empty paths are handled gracefully.
 */
export function prefixPaths(prefix: string, paths: string[]): string[] {
  if (!prefix) return paths;
  if (prefix.startsWith(ROOT_PATH)) {
    return paths.map((p) => (p.startsWith(ROOT_PATH) ? p : appendPath(prefix, p)));
  }
  if (paths.some((p) => p.startsWith(ROOT_PATH))) {
    return paths.map((p) => (p.startsWith(ROOT_PATH) ? p : appendPath(prefix, p)));
  }
  return paths.map((p) => (p ? `${prefix}.${p}` : p));
}

export function prefixProjectionPaths(prefix: string, paths: string[]): string[] {
  if (!prefix) return paths;
  return paths.map((path) =>
    path.startsWith(ROOT_PATH) || path === prefix || path.startsWith(`${prefix}.`)
      ? path
      : appendPath(prefix, path),
  );
}

export function appendPath(base: string, suffix: string | null): string {
  if (!suffix) return base;
  return base ? `${base}.${suffix}` : suffix;
}

export function prefixTransformContextPaths(prefix: string, paths: string[]): string[] {
  return paths.flatMap((path) => {
    if (!path.startsWith(ROOT_PATH)) {
      return prefixPaths(prefix, [path]).map(resolveParentPathSegments);
    }

    const localPath = path.replace(/^\0\.?/, "");
    return [resolveParentPathSegments(appendPath(prefix, localPath || null))];
  });
}

export function resolveParentPathSegments(path: string): string {
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

export function isRootReference(node: AstNode | undefined): boolean {
  return node?.type === "variable" && ["", "$"].includes((node as VariableNode).value);
}

export function markAbsolute(paths: string[]): string[] {
  return paths.map((path) => (path.startsWith(ROOT_PATH) ? path : appendPath(ROOT_PATH, path)));
}

export function parentPath(path: string): string {
  if (!path || path === ROOT_PATH) return "";
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(0, index) : "";
}

export function isParentRelativePath(path: string): boolean {
  return path === "%" || path.startsWith("%.");
}

export function stripParentRelativePath(path: string): string {
  return path === "%" ? "" : path.slice(2);
}

const variableNamesCache = new WeakMap<AstNode, ReadonlySet<string>>();

export function collectVariableNames(node: AstNode, names?: Set<string>): Set<string> {
  if (!names) {
    const cached = variableNamesCache.get(node);
    if (cached) return cached as Set<string>;

    const collected = collectVariableNamesInto(node, new Set<string>());
    variableNamesCache.set(node, collected);
    return collected;
  }

  return collectVariableNamesInto(node, names);
}

function collectVariableNamesInto(node: AstNode, names: Set<string>): Set<string> {
  const cached = variableNamesCache.get(node);
  if (cached) {
    for (const name of cached) names.add(name);
    return names;
  }

  const localNames = new Set<string>();
  if (node.type === "variable") {
    localNames.add((node as VariableNode).value);
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "source") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") {
          collectVariableNamesInto(item as AstNode, localNames);
        }
      }
    } else if (value && typeof value === "object") {
      collectVariableNamesInto(value as AstNode, localNames);
    }
  }

  variableNamesCache.set(node, localNames);
  for (const name of localNames) names.add(name);
  return names;
}

/**
 * Check if an expression represents a numeric array index.
 * Handles both positive (items[0]) and negative (items[-1]) literals.
 */
export function isNumericIndex(expr: AstNode): boolean {
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
 * Filter a set of paths to keep only "base" paths -- paths where no other
 * path in the set is a proper dot-prefix. This strips predicate-derived
 * suffix paths from variable-resolved path sets.
 *
 * Example: ["items", "items.active"] -> ["items"]
 * Example: ["orders.items", "orders.items.price"] -> ["orders.items"]
 */
export function filterToBasePaths(paths: string[]): string[] {
  return paths.filter(
    (p) => !paths.some((other) => other !== p && p.startsWith(other + ".")),
  );
}

export function flattenSimpleContextBlocks(steps: AstNode[]): AstNode[] {
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

export function isTransparentPathBlock(step: AstNode): boolean {
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

export function flattenTransparentPathBlocks(steps: AstNode[]): AstNode[] | null {
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

export function buildProjectionContextPath(steps: AstNode[]): string | null {
  return buildPathString(flattenSimpleContextBlocks(steps));
}

export function hasPendingProjectionFocusReset(steps: AstNode[]): boolean {
  return hasPendingFocusReset(flattenSimpleContextBlocks(steps));
}

export function hasPendingFocusReset(steps: AstNode[]): boolean {
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
