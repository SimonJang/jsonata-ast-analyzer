// PathResult — the public output type. Starts with just `path` string;
// Phase 4 will add confidence annotations without breaking the contract.
export interface PathResult {
  path: string;
}

// --- AST Node Types (discriminated union on `type` field) ---

export interface PathNode {
  type: "path";
  steps: AstNode[];
  keepSingletonArray?: boolean;
  keepArray?: boolean;
  group?: AstNode; // group-by expression
}

export interface NameNode {
  type: "name";
  value: string;
  position: number;
  stages?: AstNode[]; // filter/sort/index stages (Phase 3)
  keepArray?: boolean;
  tuple?: boolean;
  focus?: string; // context variable name from @$v (without $)
  index?: string; // positional variable name from #$i (without $)
}

export interface WildcardNode {
  type: "wildcard";
  value: "*";
  position: number;
}

export interface DescendantNode {
  type: "descendant";
  value: "**";
  position: number;
}

export interface BinaryNode {
  type: "binary";
  value: string; // "+", "-", "*", "/", "%", ">", "<", ">=", "<=", "=", "!=", "and", "or", "&", "in", ".."
  position: number;
  lhs: AstNode;
  rhs: AstNode;
}

export interface ConditionNode {
  type: "condition";
  position: number;
  condition: AstNode;
  then: AstNode;
  else?: AstNode;
}

export interface BlockNode {
  type: "block";
  position: number;
  expressions: AstNode[];
}

export interface UnaryNode {
  type: "unary";
  value: string; // "-" (negate), "[" (array constructor), "{" (object constructor)
  position: number;
  expression?: AstNode; // for negation: -price
  expressions?: AstNode[]; // for array constructor: [a, b, c]
  lhs?: [AstNode, AstNode][]; // for object constructor: {"key": value} pairs
}

export interface StringNode {
  type: "string";
  value: string;
  position: number;
}

export interface NumberNode {
  type: "number";
  value: number;
  position: number;
}

export interface ValueNode {
  type: "value";
  value: boolean | null; // true, false, null
  position: number;
}

export interface VariableNode {
  type: "variable";
  value: string; // variable name WITHOUT $ prefix
  position: number;
}

export interface RegexNode {
  type: "regex";
  value: RegExp;
  position: number;
}

export interface BindNode {
  type: "bind";
  value: ":=";
  position: number;
  lhs: VariableNode; // the variable being assigned
  rhs: AstNode; // the value expression
}

export interface FunctionNode {
  type: "function";
  value: "(";
  position: number;
  procedure: VariableNode; // function name (without $)
  arguments: AstNode[]; // call arguments
}

export interface LambdaNode {
  type: "lambda";
  arguments: VariableNode[]; // parameter names (without $)
  position: number;
  body: AstNode; // lambda body expression
  signature?: { definition: string }; // optional type signature
}

export interface ApplyNode {
  type: "apply";
  value: "~>";
  position: number;
  lhs: AstNode; // input (becomes first argument)
  rhs: AstNode; // function call (typically FunctionNode)
}

// Catch-all for node types not yet handled (filter, sort, transform,
// parent, partial, error).
// The walker returns empty paths for these — skip silently per
// over-approximation principle.
export interface GenericNode {
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
  | UnaryNode
  | StringNode
  | NumberNode
  | ValueNode
  | VariableNode
  | RegexNode
  | BindNode
  | FunctionNode
  | LambdaNode
  | ApplyNode
  | GenericNode;
