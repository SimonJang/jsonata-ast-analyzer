import type {
  AstNode,
  ContextBindingNode,
  GroupByNode,
  LambdaNode,
  PositionBindingNode,
  SourceAstMetadata,
  VariableNode,
} from "./types.js";

type RawAstNode = Record<string, unknown>;

function sourceOf(node: RawAstNode): SourceAstMetadata {
  const source: SourceAstMetadata = { type: String(node.type) };
  if ("value" in node) source.value = node.value;
  if (typeof node.position === "number") source.position = node.position;
  return source;
}

function positionOf(node: RawAstNode): number {
  return typeof node.position === "number" ? node.position : 0;
}

function rawList(value: unknown): RawAstNode[] {
  return Array.isArray(value) ? (value as RawAstNode[]) : [];
}

function normalizePairs(value: unknown): [AstNode, AstNode][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): [AstNode, AstNode][] => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    return [[normalizeAst(entry[0] as RawAstNode), normalizeAst(entry[1] as RawAstNode)]];
  });
}

function contextBinding(name: unknown, position: number): ContextBindingNode | undefined {
  if (typeof name !== "string") return undefined;
  return {
    type: "context-binding",
    name,
    position,
    source: { type: "focus", value: name, position },
  };
}

function positionBinding(name: unknown, position: number): PositionBindingNode | undefined {
  if (typeof name !== "string") return undefined;
  return {
    type: "position-binding",
    name,
    position,
    source: { type: "index", value: name, position },
  };
}

function normalizeGroup(group: unknown): GroupByNode | undefined {
  if (!group || typeof group !== "object") return undefined;
  const node = group as RawAstNode;
  return {
    type: "group",
    entries: normalizePairs(node.lhs),
    position: typeof node.position === "number" ? node.position : undefined,
    source: { type: "group", position: typeof node.position === "number" ? node.position : undefined },
  };
}

function normalizeVariable(node: RawAstNode): VariableNode {
  return {
    type: "variable",
    value: String(node.value ?? ""),
    position: positionOf(node),
    predicate: rawList(node.predicate).map(normalizeAst),
    focusBinding: contextBinding(node.focus, positionOf(node)),
    group: normalizeGroup(node.group),
    source: sourceOf(node),
  };
}

/**
 * Convert the upstream jsonata parser AST into analyzer-owned node kinds.
 *
 * The walker should reason about analyzer concepts ("array", "object",
 * "negate", "group") instead of overloaded parser tokens such as `unary`.
 */
export function normalizeAst(node: RawAstNode): AstNode {
  switch (node.type) {
    case "path":
      return {
        type: "path",
        steps: rawList(node.steps).map(normalizeAst),
        keepSingletonArray: node.keepSingletonArray as boolean | undefined,
        keepArray: node.keepArray as boolean | undefined,
        group: normalizeGroup(node.group),
        source: sourceOf(node),
      };
    case "name":
      return {
        type: "name",
        value: String(node.value ?? ""),
        position: positionOf(node),
        stages: rawList(node.stages).map(normalizeAst),
        keepArray: node.keepArray as boolean | undefined,
        tuple: node.tuple as boolean | undefined,
        focusBinding: contextBinding(node.focus, positionOf(node)),
        indexBinding: positionBinding(node.index, positionOf(node)),
        source: sourceOf(node),
      };
    case "wildcard":
      return {
        type: "wildcard",
        value: "*",
        position: positionOf(node),
        source: sourceOf(node),
      };
    case "descendant":
      return {
        type: "descendant",
        value: "**",
        position: positionOf(node),
        source: sourceOf(node),
      };
    case "binary":
      return {
        type: "binary",
        value: String(node.value ?? ""),
        position: positionOf(node),
        lhs: normalizeAst(node.lhs as RawAstNode),
        rhs: normalizeAst(node.rhs as RawAstNode),
        source: sourceOf(node),
      };
    case "condition":
      return {
        type: "condition",
        position: positionOf(node),
        condition: normalizeAst(node.condition as RawAstNode),
        then: normalizeAst(node.then as RawAstNode),
        else: node.else ? normalizeAst(node.else as RawAstNode) : undefined,
        source: sourceOf(node),
      };
    case "block":
      return {
        type: "block",
        position: positionOf(node),
        expressions: rawList(node.expressions).map(normalizeAst),
        group: normalizeGroup(node.group),
        predicate: rawList(node.predicate).map(normalizeAst),
        source: sourceOf(node),
      };
    case "unary":
      if (node.value === "[") {
        return {
          type: "array",
          position: positionOf(node),
          expressions: rawList(node.expressions).map(normalizeAst),
          source: sourceOf(node),
        };
      }
      if (node.value === "{") {
        return {
          type: "object",
          position: positionOf(node),
          entries: normalizePairs(node.lhs),
          source: sourceOf(node),
        };
      }
      return {
        type: "negate",
        position: positionOf(node),
        expression: node.expression ? normalizeAst(node.expression as RawAstNode) : undefined,
        source: sourceOf(node),
      };
    case "string":
      return {
        type: "string",
        value: String(node.value ?? ""),
        position: positionOf(node),
        source: sourceOf(node),
      };
    case "number":
      return {
        type: "number",
        value: Number(node.value),
        position: positionOf(node),
        source: sourceOf(node),
      };
    case "value":
      return {
        type: "value",
        value: node.value as boolean | null,
        position: positionOf(node),
        source: sourceOf(node),
      };
    case "variable":
      return normalizeVariable(node);
    case "regex":
      return {
        type: "regex",
        value: node.value as RegExp,
        position: positionOf(node),
        source: sourceOf(node),
      };
    case "bind":
      return {
        type: "bind",
        value: ":=",
        position: positionOf(node),
        lhs: normalizeVariable(node.lhs as RawAstNode),
        rhs: normalizeAst(node.rhs as RawAstNode),
        source: sourceOf(node),
      };
    case "function":
      return {
        type: "function",
        value: "(",
        position: positionOf(node),
        procedure:
          (node.procedure as RawAstNode | undefined)?.type === "lambda"
            ? (normalizeAst(node.procedure as RawAstNode) as LambdaNode)
            : normalizeVariable(node.procedure as RawAstNode),
        arguments: rawList(node.arguments).map(normalizeAst),
        group: normalizeGroup(node.group),
        source: sourceOf(node),
      };
    case "lambda":
      return {
        type: "lambda",
        arguments: rawList(node.arguments).map(normalizeVariable),
        position: positionOf(node),
        body: normalizeAst(node.body as RawAstNode),
        signature: node.signature as { definition: string } | undefined,
        thunk: node.thunk as boolean | undefined,
        source: sourceOf(node),
      };
    case "apply":
      return {
        type: "apply",
        value: "~>",
        position: positionOf(node),
        lhs: normalizeAst(node.lhs as RawAstNode),
        rhs: normalizeAst(node.rhs as RawAstNode),
        source: sourceOf(node),
      };
    case "filter":
      return {
        type: "filter",
        expr: normalizeAst(node.expr as RawAstNode),
        position: typeof node.position === "number" ? node.position : undefined,
        source: sourceOf(node),
      };
    case "sort":
      return {
        type: "sort",
        terms: rawList(node.terms).map((term) => ({
          descending: Boolean(term.descending),
          expression: normalizeAst(term.expression as RawAstNode),
        })),
        position: typeof node.position === "number" ? node.position : undefined,
        source: sourceOf(node),
      };
    case "transform":
      return {
        type: "transform",
        pattern: normalizeAst(node.pattern as RawAstNode),
        update: normalizeAst(node.update as RawAstNode),
        delete: node.delete ? normalizeAst(node.delete as RawAstNode) : undefined,
        position: typeof node.position === "number" ? node.position : undefined,
        source: sourceOf(node),
      };
    case "parent":
      return {
        type: "parent",
        slot: node.slot as { label: string; level: number; index: number },
        position: typeof node.position === "number" ? node.position : undefined,
        source: sourceOf(node),
      };
    case "partial":
      return {
        type: "partial",
        value: "(",
        position: positionOf(node),
        procedure: normalizeVariable(node.procedure as RawAstNode),
        arguments: rawList(node.arguments).map(normalizeAst),
        source: sourceOf(node),
      };
    default:
      return {
        ...node,
        type: String(node.type),
        source: sourceOf(node),
      } as AstNode;
  }
}
