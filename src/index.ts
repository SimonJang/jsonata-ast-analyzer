import { parse } from "./parser.js";
import { walkNode } from "./walker.js";
import { createScope } from "./scope.js";
import type { PathResult } from "./types.js";

export type { PathResult } from "./types.js";

/**
 * Extract all data paths read from the input object by a JSONata expression.
 *
 * @param expression - A JSONata expression string
 * @returns Deduplicated array of PathResult objects
 * @throws On invalid JSONata input (parser error propagates unmodified)
 */
export function extractPaths(expression: string): PathResult[] {
  const ast = parse(expression);
  const scope = createScope();
  const rawPaths = walkNode(ast, scope);
  const unique = [...new Set(rawPaths)];
  return unique.map((path) => ({ path }));
}
