import type {
  AstNode,
  ApplyNode,
  BinaryNode,
  BindNode,
  BlockNode,
  ConditionNode,
  FilterStage,
  FunctionNode,
  GroupByNode,
  LambdaNode,
  NameNode,
  PathNode,
  SortNode,
  TransformNode,
  UnaryNode,
  VariableNode,
} from "./types.js";
import { buildPathString } from "./path-builder.js";
import {
  type ScopeTracker,
  createScope,
  childScope,
  bindVariable,
  bindLambda,
  resolveLambda,
  resolveVariable,
} from "./scope.js";
import { BUILTIN_FUNCTIONS, HIGHER_ORDER_SEMANTICS } from "./builtins.js";

/**
 * Walk an AST node and extract all data paths as raw strings.
 * Dispatches on node.type using a switch statement.
 * Threads an immutable scope for variable resolution.
 * Unknown node types return empty array (skip silently).
 */
export function walkNode(
  node: AstNode,
  scope: ScopeTracker = createScope(),
): string[] {
  switch (node.type) {
    case "path":
      return walkPath(node as PathNode, scope);
    case "name":
      return [(node as NameNode).value];
    case "wildcard":
      return ["*"];
    case "descendant":
      return ["**"];
    case "binary":
      return walkBinary(node as BinaryNode, scope);
    case "condition":
      return walkCondition(node as ConditionNode, scope);
    case "block":
      return walkBlock(node as BlockNode, scope);
    case "unary":
      return walkUnary(node as UnaryNode, scope);
    case "bind":
      return walkBind(node as BindNode, scope);
    case "function":
      return walkFunction(node as FunctionNode, scope);
    case "lambda":
      return walkLambda(node as LambdaNode, scope);
    case "apply":
      return walkApply(node as ApplyNode, scope);
    case "string":
    case "number":
    case "value":
    case "regex":
      return []; // literals produce no paths
    case "variable":
      return walkVariable(node as VariableNode, scope);
    case "parent":
      // ADV-01: parent operator produces "%" as a literal path segment
      return ["%"];
    case "transform":
      return walkTransform(node as TransformNode, scope);
    default:
      // Unknown node type -- skip silently (over-approximate: don't crash)
      return [];
  }
}

/**
 * Prefix each path with a context string.
 * Used by context-relative operators (filter, sort, group-by, transform).
 * Empty prefix or empty paths are handled gracefully.
 */
function prefixPaths(prefix: string, paths: string[]): string[] {
  if (!prefix) return paths;
  return paths.map((p) => (p ? `${prefix}.${p}` : prefix));
}

/**
 * Extract paths from a path node's steps, handling variable steps,
 * filter stages on name steps, sort steps, and group-by expressions.
 */
function walkPath(node: PathNode, scope: ScopeTracker): string[] {
  // Check if any step is a variable (e.g., $x.name)
  const varStepIndex = node.steps.findIndex((s) => s.type === "variable");

  if (varStepIndex >= 0) {
    const varStep = node.steps[varStepIndex] as VariableNode;
    const resolved = resolveVariable(scope, varStep.value);

    if (resolved && resolved.length > 0) {
      const paths: string[] = [];

      // Inspect predicates on the resolved VariableNode for ADV-02 wildcard emission
      const predicates = varStep.predicate;
      if (predicates && predicates.length > 0) {
        for (const resolvedPath of resolved) {
          paths.push(...walkFilterStages(predicates, resolvedPath, scope, varStep.focus));
        }
      }

      // Build suffix from remaining steps after the variable
      const suffixSteps = node.steps.slice(varStepIndex + 1);
      const suffix = buildPathString(suffixSteps);

      // Concatenate resolved paths with suffix
      paths.push(...resolved.map((p) => (suffix ? `${p}.${suffix}` : p)));

      // Walk sort terms in remaining steps, prefixed with resolved paths
      for (const remainStep of suffixSteps) {
        if (remainStep.type === "sort") {
          for (const resolvedPath of resolved) {
            paths.push(...walkSortTerms(remainStep as SortNode, resolvedPath, scope));
          }
        }
      }

      return paths;
    }
    // Unresolvable variable in path: drop the entire path (silent skip)
    return [];
  }

  // Build the base path first (existing behavior).
  // When a path terminates with a block step (e.g., items.(expr)), suppress
  // the base path -- the block is a pure projection whose inner expressions
  // fully describe the accessed paths once prefixed.
  const paths: string[] = [];
  const lastStep = node.steps[node.steps.length - 1];
  const suppressBase = lastStep?.type === "block";
  const basePath = buildPathString(node.steps);
  const funcStepIndex = node.steps.findIndex((s) => s.type === "function");
  if (basePath && funcStepIndex >= 0) {
    // basePath is relative to the function result (e.g., "quantity" from $lookup(...).quantity)
    // Prefix it with the first argument path to produce the chained data path (e.g., "inventory.quantity")
    const funcStep = node.steps[funcStepIndex] as FunctionNode;
    if (funcStep.arguments.length > 0) {
      const firstArgPaths = walkNode(funcStep.arguments[0], scope);
      if (firstArgPaths.length > 0) {
        paths.push(...prefixPaths(firstArgPaths[0], [basePath]));
      }
      // Don't push bare basePath -- it's not a standalone data path
    } else {
      paths.push(basePath);
    }
  } else if (basePath && !suppressBase) {
    paths.push(basePath);
  }

  // Iterate steps and handle filter stages on name steps, sort steps
  for (let i = 0; i < node.steps.length; i++) {
    const step = node.steps[i];

    if (step.type === "name") {
      const nameStep = step as NameNode;
      if (nameStep.stages && nameStep.stages.length > 0) {
        const contextPrefix = buildPathString(node.steps.slice(0, i + 1)) ?? "";
        paths.push(...walkFilterStages(nameStep.stages!, contextPrefix, scope, nameStep.focus));
      }
    } else if (step.type === "sort") {
      const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      paths.push(...walkSortTerms(step as SortNode, contextPrefix, scope));
    } else if (step.type === "unary" && (step as UnaryNode).value === "{") {
      // Object constructor step in path: orders.items.{"key": val}
      // Walk value expressions and prefix with path up to this step
      const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const unaryStep = step as UnaryNode;
      if (unaryStep.lhs) {
        for (const [_key, val] of unaryStep.lhs) {
          const valPaths = walkNode(val, scope);
          paths.push(...prefixPaths(contextPrefix, valPaths));
        }
      }
    } else if (step.type === "block") {
      // Block expression step in path: orders.items.(expr)
      // Walk all expressions and prefix with path up to this step
      const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
      const blockStep = step as BlockNode;
      for (const expr of blockStep.expressions) {
        const exprPaths = walkNode(expr, scope);
        paths.push(...prefixPaths(contextPrefix, exprPaths));
      }
    } else if (step.type === "function") {
      // Function call step (e.g., $lookup(obj, key) in $lookup(obj, key).field)
      // Walk the function call to extract argument paths
      paths.push(...walkFunction(step as FunctionNode, scope));
    }
  }

  // Handle group-by on the PathNode (node.group)
  if (node.group) {
    paths.push(...walkGroupBy(node, scope));
  }

  return paths;
}

/**
 * Walk sort terms on a sort step, extracting and context-prefixing paths.
 * Context prefix uses steps BEFORE the sort step (slice(0, i), NOT slice(0, i+1))
 * because the sort step itself is not a path segment.
 */
function walkSortTerms(
  sortNode: SortNode,
  contextPrefix: string,
  scope: ScopeTracker,
): string[] {
  const paths: string[] = [];
  for (const term of sortNode.terms) {
    const termPaths = walkNode(term.expression, scope);
    paths.push(...prefixPaths(contextPrefix, termPaths));
  }
  return paths;
}

/**
 * Walk group-by expression on a PathNode, extracting key and value paths.
 * Both key and value expressions are prefixed with the base path of the
 * PathNode (computed from all steps, with sort steps skipped by buildPathString).
 */
function walkGroupBy(node: PathNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];
  const groupBasePath = buildPathString(node.steps) ?? "";
  const groupNode = node.group as unknown as GroupByNode;
  if (groupNode.lhs) {
    for (const pair of groupNode.lhs) {
      const [keyExpr, valExpr] = pair;
      if (keyExpr) {
        paths.push(...prefixPaths(groupBasePath, walkNode(keyExpr, scope)));
      }
      if (valExpr) {
        paths.push(...prefixPaths(groupBasePath, walkNode(valExpr, scope)));
      }
    }
  }
  return paths;
}

/**
 * Walk filter stages on a name step, extracting and context-prefixing paths.
 * Numeric index stages are skipped (EXPR-06). Focus variables (@$v) are
 * bound in a child scope before walking filter expressions.
 */
function walkFilterStages(
  stages: AstNode[],
  contextPrefix: string,
  scope: ScopeTracker,
  focus?: string,
): string[] {
  const paths: string[] = [];

  // Create child scope for filter context
  let filterScope = childScope(scope);

  // Bind focus variable if present (@$v)
  if (focus) {
    filterScope = bindVariable(
      filterScope,
      focus,
      contextPrefix ? [contextPrefix] : [],
    );
  }

  for (const stage of stages) {
    if (stage.type !== "filter") continue;

    const filterStage = stage as unknown as FilterStage;

    // EXPR-06: Numeric index guard -- skip array indexing
    if (isNumericIndex(filterStage.expr)) continue;

    // ADV-02: pure $variable in bracket position with no resolved data paths -> dynamic wildcard
    if (filterStage.expr.type === "variable") {
      const varNode = filterStage.expr as VariableNode;
      const resolved = resolveVariable(filterScope, varNode.value);
      if (!resolved || resolved.length === 0) {
        paths.push(`${contextPrefix}[*]`);
        continue; // [*] replaces predicate walk -- do not also walk the predicate
      }
    }

    // Two-pass scope-aware prefixing:
    // 1. Walk with empty scope (no variables) -> bare field names only
    // 2. Walk with focus-only scope (focus binding, no parent vars) -> bare + focus-resolved
    // Bare field names (from empty walk) need context prefixing.
    // Focus-variable-resolved paths (in focus walk but not empty) are already
    // absolute from focus binding to contextPrefix -- emit as-is.
    // External-variable-resolved paths are NOT emitted here -- they were
    // already captured at the variable binding site.
    const emptyScope = childScope(createScope());
    const localPaths = walkNode(filterStage.expr, emptyScope);

    // Prefix local field paths (bare field names need context)
    paths.push(...prefixPaths(contextPrefix, localPaths));

    // If focus variable present, also emit focus-resolved paths (not in empty walk)
    if (focus) {
      let focusOnlyScope = childScope(createScope());
      focusOnlyScope = bindVariable(
        focusOnlyScope,
        focus,
        contextPrefix ? [contextPrefix] : [],
      );
      const focusPaths = walkNode(filterStage.expr, focusOnlyScope);
      const localSet = new Set(localPaths);
      for (const fp of focusPaths) {
        if (!localSet.has(fp)) {
          paths.push(fp); // focus-resolved, already absolute
        }
      }
    }
  }

  return paths;
}

/**
 * Check if an expression represents a numeric array index.
 * Handles both positive (items[0]) and negative (items[-1]) literals.
 */
function isNumericIndex(expr: AstNode): boolean {
  if (expr.type === "number") return true;
  if (
    expr.type === "unary" &&
    (expr as UnaryNode).value === "-" &&
    (expr as UnaryNode).expression?.type === "number"
  ) {
    return true;
  }
  return false;
}

/**
 * Handle transform operator: | pattern | update, delete |
 * Pattern is walked for base paths.
 * Update values are walked via walkNode (reusing walkUnary for "{" nodes)
 * and prefixed with the pattern path.
 * Delete clause contains string literals only -- no paths extracted.
 */
function walkTransform(node: TransformNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];

  // Walk pattern for base paths
  const patternPaths = walkNode(node.pattern, scope);
  paths.push(...patternPaths);

  // Walk update and prefix results with pattern path
  if (node.update) {
    const patternPrefix = patternPaths.length > 0 ? patternPaths[0] : "";
    const updatePaths = walkNode(node.update, scope);
    paths.push(...prefixPaths(patternPrefix, updatePaths));
  }

  // Delete clause: string literals only, no paths extracted
  // (intentionally not walked)

  return paths;
}

/** Extract paths from both sides of a binary operator. */
function walkBinary(node: BinaryNode, scope: ScopeTracker): string[] {
  return [...walkNode(node.lhs, scope), ...walkNode(node.rhs, scope)];
}

/** Extract paths from condition, then-branch, and optional else-branch. */
function walkCondition(node: ConditionNode, scope: ScopeTracker): string[] {
  return [
    ...walkNode(node.condition, scope),
    ...walkNode(node.then, scope),
    ...(node.else ? walkNode(node.else, scope) : []),
  ];
}

/**
 * Process block expressions sequentially, accumulating scope bindings.
 * Each bind node adds to the running scope before subsequent expressions
 * are processed. Inner blocks use a child scope to prevent leaking.
 * Lambda RHS nodes are stored in scope for custom function call tracing.
 */
function walkBlock(node: BlockNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];
  let currentScope = scope;

  for (const expr of node.expressions) {
    if (expr.type === "bind") {
      const bindNode = expr as BindNode;
      const rhsPaths = walkNode(bindNode.rhs, currentScope);
      paths.push(...rhsPaths);
      currentScope = bindVariable(
        currentScope,
        bindNode.lhs.value,
        rhsPaths,
      );

      // If the RHS is a lambda, store the lambda node for SCOPE-05 tracing
      if (bindNode.rhs.type === "lambda") {
        currentScope = bindLambda(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs as LambdaNode,
        );
      }
    } else if (expr.type === "block") {
      // Inner block: create a child scope so bindings don't leak
      const innerScope = childScope(currentScope);
      paths.push(...walkBlock(expr as BlockNode, innerScope));
    } else {
      paths.push(...walkNode(expr, currentScope));
    }
  }
  return paths;
}

/**
 * Handle a standalone bind node (outside of a block).
 * Walks the RHS to extract data paths.
 */
function walkBind(node: BindNode, scope: ScopeTracker): string[] {
  return walkNode(node.rhs, scope);
}

/** Extract paths from unary expressions (negation, array/object constructors). */
function walkUnary(node: UnaryNode, scope: ScopeTracker): string[] {
  switch (node.value) {
    case "-":
      // Negation: -expr -> walk the expression
      return node.expression ? walkNode(node.expression, scope) : [];
    case "[": {
      // Array constructor with sequential scope accumulation
      // (mirrors walkBlock pattern: bind expressions update scope for subsequent elements)
      const paths: string[] = [];
      let currentScope = scope;
      for (const expr of node.expressions ?? []) {
        if (expr.type === "bind") {
          const bindNode = expr as BindNode;
          const rhsPaths = walkNode(bindNode.rhs, currentScope);
          paths.push(...rhsPaths);
          currentScope = bindVariable(currentScope, bindNode.lhs.value, rhsPaths);
        } else {
          paths.push(...walkNode(expr, currentScope));
        }
      }
      return paths;
    }
    case "{":
      // Object constructor: {"key": value} -> walk values only
      return (node.lhs ?? []).flatMap(([_key, val]) => walkNode(val, scope));
    default:
      return [];
  }
}

/**
 * Resolve a variable reference using the scope chain.
 * Built-in function names and the root reference ($) produce no paths.
 */
function walkVariable(node: VariableNode, scope: ScopeTracker): string[] {
  // Root reference ($) produces no paths
  if (node.value === "") {
    return [];
  }

  // Check scope first (scope bindings shadow built-ins)
  const resolved = resolveVariable(scope, node.value);
  if (resolved) {
    const paths = [...resolved];

    // Inspect predicates on the standalone VariableNode (mirrors walkPath variable branch)
    const predicates = node.predicate;
    if (predicates && predicates.length > 0) {
      for (const resolvedPath of resolved) {
        paths.push(...walkFilterStages(predicates, resolvedPath, scope, node.focus));
      }
    }

    // Handle group-by on variable node (mirrors walkGroupBy for PathNode)
    if (node.group) {
      const groupNode = node.group as unknown as GroupByNode;
      const groupBasePath = resolved.length > 0 ? resolved[0] : "";
      if (groupNode.lhs) {
        for (const pair of groupNode.lhs) {
          const [keyExpr, valExpr] = pair;
          if (keyExpr) {
            paths.push(...prefixPaths(groupBasePath, walkNode(keyExpr, scope)));
          }
          if (valExpr) {
            paths.push(...prefixPaths(groupBasePath, walkNode(valExpr, scope)));
          }
        }
      }
    }

    return paths;
  }

  // Built-in function names produce no paths
  if (BUILTIN_FUNCTIONS.has(node.value)) {
    return [];
  }

  // Unresolvable variable: silent skip
  return [];
}

/**
 * Handle a lambda node encountered during walking.
 *
 * A real lambda definition (user-written `function($x) { ... }`) is just a
 * value -- it doesn't execute, so no paths are extracted.
 *
 * However, JSONata's parser generates "thunk" lambdas (with `thunk: true`
 * and no arguments) to wrap certain expressions like nested higher-order
 * function calls. These thunks must be unwrapped: walk their body with
 * the current scope to extract paths.
 */
function walkLambda(node: LambdaNode, scope: ScopeTracker): string[] {
  // Thunk lambdas are parser-generated wrappers, not user-defined functions
  if (node.thunk) {
    return walkNode(node.body, scope);
  }
  return [];
}

/**
 * Extract paths from function calls with lambda-aware resolution.
 *
 * Handles three cases:
 * 1. Higher-order built-in ($map, $filter, etc.) -- bind lambda params to data arg paths
 * 2. Custom function call ($fn bound to lambda in scope) -- trace args into lambda body
 * 3. Non-higher-order / unknown function -- pass-through all arguments
 */
function walkFunction(node: FunctionNode, scope: ScopeTracker): string[] {
  const funcName = node.procedure.value;
  const args = node.arguments;
  const paths: string[] = [];

  // Step 1: Check if this is a known higher-order function
  const semantics = HIGHER_ORDER_SEMANTICS[funcName];
  if (semantics) {
    return walkHigherOrderCall(node, semantics, scope);
  }

  // Step 2: Check if this is a custom function call (lambda bound in scope)
  const lambdaNode = resolveLambda(scope, funcName);
  if (lambdaNode) {
    return walkCustomFunctionCall(lambdaNode, args, scope);
  }

  // Step 3: Non-higher-order built-in or unknown function -- pass-through all args
  for (const arg of args) {
    if (arg.type === "lambda") {
      // Walk lambda body with current scope (closure capture)
      const lambda = arg as LambdaNode;
      const lambdaScope = childScope(scope);
      paths.push(...walkNode(lambda.body, lambdaScope));
    } else {
      paths.push(...walkNode(arg, scope));
    }
  }

  return paths;
}

/**
 * Filter a set of paths to keep only "base" paths -- paths where no other
 * path in the set is a proper dot-prefix. This strips predicate-derived
 * suffix paths from variable-resolved path sets.
 *
 * Example: ["items", "items.active"] -> ["items"]
 * Example: ["orders.items", "orders.items.price"] -> ["orders.items"]
 */
function filterToBasePaths(paths: string[]): string[] {
  return paths.filter(
    (p) => !paths.some((other) => other !== p && p.startsWith(other + ".")),
  );
}

/**
 * Extract only the collection-identity (base) paths from a data argument node,
 * excluding filter predicate paths. Used specifically for HOF lambda parameter
 * binding to prevent predicate paths from leaking into element bindings.
 *
 * For PathNode: uses buildPathString to get the structural base path (skips filter stages)
 * For ApplyNode: recursively extracts from the lhs (chained apply base identity)
 * For VariableNode: resolves and filters to base paths only
 * For NameNode: returns the name value directly
 * Default: falls back to walkNode (no filter stages to strip)
 */
function extractBasePaths(node: AstNode, scope: ScopeTracker): string[] {
  if (node.type === "path") {
    const pathNode = node as PathNode;
    // Check for variable steps (e.g., $v.children) -- must resolve variable
    const varStepIndex = pathNode.steps.findIndex((s) => s.type === "variable");
    if (varStepIndex >= 0) {
      const varStep = pathNode.steps[varStepIndex] as VariableNode;
      const resolved = resolveVariable(scope, varStep.value);
      if (resolved && resolved.length > 0) {
        const basePaths = filterToBasePaths([...resolved]);
        const suffixSteps = pathNode.steps.slice(varStepIndex + 1);
        const suffix = buildPathString(suffixSteps);
        return basePaths.map((p) => (suffix ? `${p}.${suffix}` : p));
      }
      return [];
    }
    const basePath = buildPathString(pathNode.steps);
    return basePath ? [basePath] : [];
  }
  if (node.type === "apply") {
    // Chained apply base identity comes from the leftmost operand
    return extractBasePaths((node as ApplyNode).lhs, scope);
  }
  if (node.type === "variable") {
    const varNode = node as VariableNode;
    const resolved = resolveVariable(scope, varNode.value);
    if (resolved && resolved.length > 0) {
      // Filter to only root paths -- strip predicate-derived suffix paths
      return filterToBasePaths([...resolved]);
    }
    return [];
  }
  if (node.type === "name") {
    return [(node as NameNode).value];
  }
  // For other node types, walkNode is fine (no filter stages to strip)
  return walkNode(node, scope);
}

/**
 * Handle calls to higher-order built-in functions ($map, $filter, $reduce, etc.).
 *
 * Extracts paths from the data argument, then walks the lambda body with
 * parameter bindings according to the function's semantic role mapping.
 *
 * IMPORTANT: The full walkNode paths (including predicates) are emitted via
 * the for-loop for non-lambda args. Only the BINDING paths to lambda parameters
 * are restricted to base paths via extractBasePaths.
 */
function walkHigherOrderCall(
  node: FunctionNode,
  semantics: Record<number, string>,
  scope: ScopeTracker,
): string[] {
  const args = node.arguments;
  const paths: string[] = [];

  // Extract paths from all non-lambda arguments (they're data reads)
  // This emits ALL paths including filter predicates (correct -- they are data reads)
  for (const arg of args) {
    if (arg.type !== "lambda") {
      paths.push(...walkNode(arg, scope));
    }
  }

  // Find the lambda argument
  const lambdaArg = args.find((a) => a.type === "lambda") as
    | LambdaNode
    | undefined;

  if (lambdaArg) {
    // Get the data argument (first non-lambda arg) BASE paths for binding
    // Uses extractBasePaths to exclude filter predicate paths from binding
    const dataArg = args.find((a) => a.type !== "lambda");
    const dataArgPaths = dataArg ? extractBasePaths(dataArg, scope) : [];

    // Walk lambda body with parameter bindings
    paths.push(
      ...walkLambdaWithBindings(lambdaArg, dataArgPaths, semantics, scope),
    );
  }

  return paths;
}

/**
 * Walk a lambda body in the context of a higher-order function call.
 * Binds lambda parameters to data argument paths based on semantic roles.
 *
 * Roles:
 * - "element"/"value"/"left"/"right" -> bound to data arg's element paths
 * - "index"/"key" -> non-data-path (bind to empty)
 * - "array"/"accumulator" -> bound to full collection paths
 */
function walkLambdaWithBindings(
  lambda: LambdaNode,
  dataArgPaths: string[],
  semantics: Record<number, string>,
  parentScope: ScopeTracker,
): string[] {
  let lambdaScope = childScope(parentScope);

  // Bind each lambda parameter based on its semantic role
  for (let i = 0; i < lambda.arguments.length; i++) {
    const param = lambda.arguments[i];
    const role = semantics[i];

    if (!role) continue; // more params than semantics knows about

    switch (role) {
      case "element":
      case "value":
      case "left":
      case "right":
        // Bound to element of the data argument
        lambdaScope = bindVariable(lambdaScope, param.value, dataArgPaths);
        break;
      case "index":
      case "key":
        // Non-data-path: bind to empty (produces no paths when referenced)
        lambdaScope = bindVariable(lambdaScope, param.value, []);
        break;
      case "array":
      case "accumulator":
        // Bound to the full collection/accumulator
        lambdaScope = bindVariable(lambdaScope, param.value, dataArgPaths);
        break;
    }
  }

  return walkNode(lambda.body, lambdaScope);
}

/**
 * Handle custom function calls where the procedure resolves to a lambda in scope.
 * Binds call-site argument paths to lambda parameters and walks the body.
 *
 * Example: `($fn := function($x) { $x.name }; $fn(account))`
 * -> $x bound to ["account"], body yields ["account.name"]
 * -> combined with call-site arg paths: ["account", "account.name"]
 */
function walkCustomFunctionCall(
  lambda: LambdaNode,
  callArgs: AstNode[],
  scope: ScopeTracker,
): string[] {
  const paths: string[] = [];

  // Extract paths from all call-site arguments
  const argPathSets: string[][] = [];
  for (const arg of callArgs) {
    const argPaths = walkNode(arg, scope);
    paths.push(...argPaths);
    argPathSets.push(argPaths);
  }

  // Create a scope binding each lambda parameter to its corresponding arg paths
  let lambdaScope = childScope(scope);
  for (let i = 0; i < lambda.arguments.length; i++) {
    const param = lambda.arguments[i];
    const argPaths = i < argPathSets.length ? argPathSets[i] : [];
    lambdaScope = bindVariable(lambdaScope, param.value, argPaths);
  }

  // Walk the lambda body with parameter bindings
  paths.push(...walkNode(lambda.body, lambdaScope));

  return paths;
}

/**
 * Handle the apply operator (~>).
 * `lhs ~> rhs` where rhs is typically a function call.
 * The lhs becomes the first argument to the function on the rhs.
 *
 * Example: `items ~> $map(function($v) { $v.name })`
 * is equivalent to `$map(items, function($v) { $v.name })`
 */
function walkApply(node: ApplyNode, scope: ScopeTracker): string[] {
  const paths: string[] = [];

  // Extract paths from the lhs (it's a data read)
  const lhsPaths = walkNode(node.lhs, scope);
  paths.push(...lhsPaths);

  // The rhs is typically a FunctionNode. Prepend lhs as first argument.
  if (node.rhs.type === "function") {
    const funcNode = node.rhs as FunctionNode;
    // Create a synthetic function node with lhs prepended to arguments
    const augmentedFunc: FunctionNode = {
      ...funcNode,
      arguments: [node.lhs, ...funcNode.arguments],
    };
    // walkFunction will re-walk the lhs arg, but dedup in extractPaths handles it
    paths.push(...walkFunction(augmentedFunc, scope));
  } else if (node.rhs.type === "lambda") {
    // Inline lambda application: bind first parameter to lhs paths
    const lambda = node.rhs as LambdaNode;
    let lambdaScope = childScope(scope);
    if (lambda.arguments.length > 0) {
      lambdaScope = bindVariable(lambdaScope, lambda.arguments[0].value, lhsPaths);
    }
    paths.push(...walkNode(lambda.body, lambdaScope));
  } else {
    // Fallback: unusual RHS (e.g., variable reference)
    paths.push(...walkNode(node.rhs, scope));
  }

  return paths;
}
