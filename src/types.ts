// Confidence — how certain the path is at analysis time.
// Priority order: "partial" > "dynamic" > "static"
export type Confidence = "static" | "dynamic" | "partial";

// PathResult — the public output type.
export interface PathResult {
  path: string;
  confidence: Confidence;
}

export interface SourceAstMetadata {
  type: string;
  value?: unknown;
  position?: number;
}

interface AnalyzerNode {
  source?: SourceAstMetadata;
}

export interface ContextBindingNode extends AnalyzerNode {
  type: "context-binding";
  name: string;
  position?: number;
}

export interface PositionBindingNode extends AnalyzerNode {
  type: "position-binding";
  name: string;
  position?: number;
}

// --- AST Node Types (discriminated union on `type` field) ---

export interface PathNode extends AnalyzerNode {
  type: "path";
  steps: AstNode[];
  keepSingletonArray?: boolean;
  keepArray?: boolean;
  group?: GroupByNode; // group-by expression
}

export interface NameNode extends AnalyzerNode {
  type: "name";
  value: string;
  position: number;
  stages?: AstNode[]; // filter/sort/index stages (Phase 3)
  keepArray?: boolean;
  tuple?: boolean;
  focusBinding?: ContextBindingNode; // context variable from @$v
  indexBinding?: PositionBindingNode; // positional variable from #$i
}

export interface WildcardNode extends AnalyzerNode {
  type: "wildcard";
  value: "*";
  position: number;
}

export interface DescendantNode extends AnalyzerNode {
  type: "descendant";
  value: "**";
  position: number;
}

export interface BinaryNode extends AnalyzerNode {
  type: "binary";
  value: string; // "+", "-", "*", "/", "%", ">", "<", ">=", "<=", "=", "!=", "and", "or", "&", "in", ".."
  position: number;
  lhs: AstNode;
  rhs: AstNode;
}

export interface ConditionNode extends AnalyzerNode {
  type: "condition";
  position: number;
  condition: AstNode;
  then: AstNode;
  else?: AstNode;
}

export interface BlockNode extends AnalyzerNode {
  type: "block";
  position: number;
  expressions: AstNode[];
  group?: GroupByNode;
  predicate?: AstNode[];
}

export interface NegateNode extends AnalyzerNode {
  type: "negate";
  position: number;
  expression?: AstNode;
}

export interface ArrayNode extends AnalyzerNode {
  type: "array";
  position: number;
  expressions: AstNode[];
  predicate?: AstNode[];
}

export interface ObjectNode extends AnalyzerNode {
  type: "object";
  position: number;
  entries: [AstNode, AstNode][];
}

export interface StringNode extends AnalyzerNode {
  type: "string";
  value: string;
  position: number;
}

export interface NumberNode extends AnalyzerNode {
  type: "number";
  value: number;
  position: number;
}

export interface ValueNode extends AnalyzerNode {
  type: "value";
  value: boolean | null; // true, false, null
  position: number;
}

export interface VariableNode extends AnalyzerNode {
  type: "variable";
  value: string; // variable name WITHOUT $ prefix
  position: number;
  predicate?: AstNode[]; // filter stages (same structure as NameNode.stages but different property name)
  focusBinding?: ContextBindingNode; // context variable from @$v
  group?: GroupByNode; // group-by expression (mirrors PathNode.group)
}

export interface RegexNode extends AnalyzerNode {
  type: "regex";
  value: RegExp;
  position: number;
}

export interface BindNode extends AnalyzerNode {
  type: "bind";
  value: ":=";
  position: number;
  lhs: VariableNode; // the variable being assigned
  rhs: AstNode; // the value expression
}

export interface FunctionNode extends AnalyzerNode {
  type: "function";
  value: "(";
  position: number;
  procedure: VariableNode | LambdaNode; // function name or inline lambda
  arguments: AstNode[]; // call arguments
  group?: GroupByNode;
}

export interface LambdaNode extends AnalyzerNode {
  type: "lambda";
  arguments: VariableNode[]; // parameter names (without $)
  position: number;
  body: AstNode; // lambda body expression
  signature?: { definition: string }; // optional type signature
  thunk?: boolean; // parser-generated wrapper lambda (no args, wraps nested calls)
}

export interface ApplyNode extends AnalyzerNode {
  type: "apply";
  value: "~>";
  position: number;
  lhs: AstNode; // input (becomes first argument)
  rhs: AstNode; // function call (typically FunctionNode)
}

/** Filter stage on a NameNode -- appears in NameNode.stages array. */
export interface FilterStage extends AnalyzerNode {
  type: "filter";
  expr: AstNode;
  position?: number;
}

/** Sort term within a SortNode -- has direction flag and expression. */
export interface SortTerm {
  descending: boolean;
  expression: AstNode;
}

/** Sort step in PathNode.steps -- appears as a separate step (NOT a stage on NameNode). */
export interface SortNode extends AnalyzerNode {
  type: "sort";
  terms: SortTerm[];
  position?: number;
}

/** Transform node -- top-level node type for the JSONata transform operator (|...|...|). */
export interface TransformNode extends AnalyzerNode {
  type: "transform";
  pattern: AstNode;
  update: AstNode;
  delete?: AstNode;
  position?: number;
}

/** Parent operator node -- appears as a step in PathNode.steps or as a filter stage expr. */
export interface ParentNode extends AnalyzerNode {
  type: "parent";
  slot: { label: string; level: number; index: number };
  position?: number;
}

/** Group-by structure on PathNode.group. Contains array of [key, value] expression pairs. */
export interface GroupByNode extends AnalyzerNode {
  type: "group";
  entries: [AstNode, AstNode][];
  position?: number;
}

export interface PartialNode extends AnalyzerNode {
  type: "partial";
  value: "(";
  position: number;
  procedure: VariableNode;
  arguments: AstNode[];
}

// Catch-all for node types not yet handled (parent, partial, error).
// The walker returns empty paths for these — skip silently per
// over-approximation principle.
export interface GenericNode extends AnalyzerNode {
  type: string;
  [key: string]: unknown;
}

export type AstNode =
  | PathNode
  | NameNode
  | WildcardNode
  | DescendantNode
  | BinaryNode
  | ConditionNode
  | BlockNode
  | NegateNode
  | ArrayNode
  | ObjectNode
  | StringNode
  | NumberNode
  | ValueNode
  | VariableNode
  | RegexNode
  | BindNode
  | FunctionNode
  | LambdaNode
  | ApplyNode
  | SortNode
  | TransformNode
  | ParentNode   // explicit union member before GenericNode
  | GroupByNode
  | PartialNode
  | ContextBindingNode
  | PositionBindingNode
  | GenericNode;
