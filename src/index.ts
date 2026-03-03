import { parse } from "./parser.js";
import { walkNode } from "./walker.js";
import { createScope } from "./scope.js";
import type { PathResult, Confidence } from "./types.js";

export type { PathResult } from "./types.js";
export type { Confidence } from "./types.js";

/**
 * Derive confidence level from a path string.
 * Priority order: "partial" > "dynamic" > "static"
 *
 * - "partial": path contains "%" as a whole dot-separated segment (parent operator)
 * - "dynamic": path contains "[*]" anywhere (unresolvable bracket-filter variable)
 * - "static": fully resolvable at analysis time (all other paths)
 *
 * Note: explicit wildcards like "item.*" and "**.price" are "static" — they are
 * author-written and fully known at analysis time (not dynamically computed).
 *
 * Known edge case: a backtick-escaped field literally named "%" (e.g., `items.`%``) would
 * produce a false "partial" classification. This is accepted per project precedent for
 * pragmatic tradeoffs on vanishingly rare inputs.
 */
export function deriveConfidence(path: string): Confidence {
  // Split on "." to check for "%" as a WHOLE segment (not substring of a field name)
  const segments = path.split(".");
  if (segments.includes("%")) return "partial";
  // Check for bracket-wildcard marker injected by walker for dynamic filter paths
  if (path.includes("[*]")) return "dynamic";
  return "static";
}

/**
 * Extract all data paths read from the input object by a JSONata expression.
 *
 * @param expression - A JSONata expression string
 * @returns Deduplicated array of PathResult objects with confidence annotations
 * @throws On invalid JSONata input (parser error propagates unmodified)
 */
export function extractPaths(expression: string): PathResult[] {
  const ast = parse(expression);
  const scope = createScope();
  const rawPaths = walkNode(ast, scope);
  const unique = [...new Set(rawPaths)];
  return unique.map((path) => ({ path, confidence: deriveConfidence(path) }));
}
