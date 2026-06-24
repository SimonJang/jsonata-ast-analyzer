import jsonata from "jsonata";
import type { AstNode } from "./types.js";
import { normalizeAst } from "./normalizer.js";

/**
 * Parse a JSONata expression string and return the AST as a typed AstNode.
 *
 * Throws on invalid JSONata input — the jsonata parser's error propagates
 * unmodified to the caller. Note: jsonata errors are NOT Error instances;
 * they are plain objects with code, position, message, token, stack.
 */
export function parse(expression: string): AstNode {
  const expr = jsonata(expression);
  return normalizeAst(expr.ast() as unknown as Record<string, unknown>);
}
