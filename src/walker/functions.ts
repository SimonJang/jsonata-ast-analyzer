import type { ArrayNode, AstNode, ApplyNode, BindNode, BlockNode, ConditionNode, FilterStage, FunctionNode, LambdaNode, ObjectNode, PartialNode, PathNode, SortNode, TransformNode, VariableNode } from "../types.js";
import { buildPathString } from "../path-builder.js";
import { parse } from "../parser.js";
import { type ScopeTracker, childScope, bindVariable, bindLambda, bindLambdaReference, bindPartial, bindTransform, bindValue, resolveLambda, resolvePartial, resolveTransform, resolveValue, resolveVariable, resolveSuffixBasePaths, resolveObjectAlias, resolveDynamicObjectAlias, type DynamicObjectAlias, type ObjectAlias } from "../scope.js";
import { BUILTIN_FUNCTIONS, HIGHER_ORDER_SEMANTICS } from "../builtins.js";
import { ROOT_PATH, IMPLICIT_ROOT_SHALLOW_FUNCTIONS, IMPLICIT_ROOT_DEEP_FUNCTIONS, MATCHER_CALLBACK_FUNCTIONS, CONTEXT_DEFAULT_BUILTINS } from "./constants.js";
import { prefixPaths, appendPath, isRootReference, markAbsolute, isNumericIndex } from "./path-utils.js";
import type { FunctionOperations, WalkerOptions, WalkerRuntime } from "./runtime.js";
import { createSelectionOperations } from "./selection.js";

interface ScopedMatcherCall {
  node: FunctionNode;
  scope: ScopeTracker;
}

const DEFAULT_OPTIONS: WalkerOptions = { opaqueFunctions: new Set() };
const EVAL_CONTEXT = "\0eval-context";

export function createFunctionOperations(
  runtime: WalkerRuntime,
  options: WalkerOptions = DEFAULT_OPTIONS,
): FunctionOperations {
  const selection = createSelectionOperations(runtime);
  function bindCallableValue(
    scope: ScopeTracker,
    name: string,
    value: AstNode,
    closureScope: ScopeTracker,
  ): ScopeTracker {
    const valueScope = bindValue(scope, name, value, closureScope);
    if (value.type === "lambda") {
      return bindLambda(valueScope, name, value as LambdaNode, closureScope);
    }
    if (value.type === "partial") {
      return bindPartial(valueScope, name, value as PartialNode, closureScope);
    }
    if (value.type === "transform") {
      return bindTransform(valueScope, name, value as TransformNode, closureScope);
    }
    if (value.type === "apply") {
      const composition = runtime.callables.compositionLambda(value as ApplyNode, closureScope);
      if (composition) return bindLambda(valueScope, name, composition, closureScope);
    }
    return valueScope;
  }

  function builtinUsesContextDefault(funcName: string, args: AstNode[]): boolean {
    if (!CONTEXT_DEFAULT_BUILTINS.has(funcName)) return false;
    if (args.length === 0) return true;
  
    switch (funcName) {
      case "substring":
        return args[0]?.type !== "string";
      case "substringBefore":
      case "substringAfter":
      case "contains":
      case "split":
      case "parseInteger":
        return args.length < 2;
      case "replace":
        return args.length < 3;
      case "pad":
        return args[0]?.type === "number";
      case "formatNumber":
        return args.length < 3 && args[0]?.type !== "number";
      case "formatInteger":
      case "fromMillis":
        return args[0]?.type !== "number";
      case "match":
        return args[0]?.type !== "string";
      case "power":
        return args.length < 2;
      case "lookup":
      case "each":
      case "sift":
        return args.length === 1;
      default:
        return false;
    }
  }

  function functionUsesContextDefault(
    node: FunctionNode,
    scope: ScopeTracker,
  ): boolean {
    const builtins = runtime.callables.resolveBuiltinCallableNames(node.procedure, scope);
    const lambdas = runtime.callables.resolveCallableValues(node.procedure, scope).flatMap(
      (callable) => (callable.kind === "lambda" ? [callable.binding.lambda] : []),
    );
    return (
      (builtins.length > 0 &&
        builtins.every((name) => builtinUsesContextDefault(name, node.arguments))) ||
      (lambdas.length > 0 &&
        lambdas.every(
          (lambda) =>
            runtime.higherOrder.contextDefaultParameterIndex(lambda) >= 0 &&
            node.arguments.length < lambda.arguments.length,
        ))
    );
  }

  function resultUsesContextDefault(node: AstNode, scope: ScopeTracker): boolean {
    if (node.type === "function") {
      return functionUsesContextDefault(node as FunctionNode, scope);
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      const branches = [condition.then, condition.else].filter(
        (branch): branch is AstNode => Boolean(branch),
      );
      return (
        branches.length > 0 &&
        branches.every((branch) => resultUsesContextDefault(branch, scope))
      );
    }
    if (node.type === "path") {
      const path = node as PathNode;
      const firstStep = path.steps[0] as AstNode & { focusBinding?: unknown };
      if (path.steps.length === 1 && !path.group && firstStep?.focusBinding) return true;
      return firstStep ? resultUsesContextDefault(firstStep, scope) : false;
    }
    if (node.type === "block") {
      const block = node as BlockNode;
      let blockScope = scope;
      for (const [index, expression] of block.expressions.entries()) {
        if (index === block.expressions.length - 1) {
          return resultUsesContextDefault(expression, blockScope);
        }
        if (expression.type === "bind") {
          blockScope = runtime.callables.bindCallableBlockValue(blockScope, expression as BindNode);
        }
      }
    }
    return false;
  }

  function withImplicitRootFunctionArgument(
    funcName: string,
    args: AstNode[],
    position: number,
    scope?: ScopeTracker,
  ): AstNode[] {
    const defaultValue = args.length === 0 && ["spread", "clone"].includes(funcName);
    if (!defaultValue && (!["lookup", "each", "sift"].includes(funcName) || args.length !== 1)) {
      return args;
    }
  
    return [
      {
        type: "variable",
        value: scope && resolveVariable(scope, "") !== null ? "" : "$",
        position,
      } as VariableNode,
      ...args,
    ];
  }

  function identityReferencePaths(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] | null {
    if (!isRootReference(node)) return null;
    if ((node as VariableNode).value === "") {
      const capturedCurrent = resolveVariable(scope, "");
      if (capturedCurrent !== null) return [...capturedCurrent];
    }
    return [ROOT_PATH];
  }

  function deepValueReadPaths(node: AstNode, scope: ScopeTracker): string[] {
    // Resolve plain leaf selections with the path walker so mixed aliases and
    // parent steps use the same context as their ordinary reads.
    const plainSelection = node.type === "name" || (node.type === "path" &&
      !(node as PathNode).group && (node as PathNode).steps.every((step) => {
        const stages = step as AstNode & { stages?: AstNode[]; predicate?: AstNode[] };
        return ["name", "variable", "parent", "wildcard", "descendant"].includes(step.type) &&
          !stages.stages?.length && !stages.predicate?.length;
      }));
    const aliasValue = (node.type === "variable" &&
      (resolveObjectAlias(scope, (node as VariableNode).value) ||
       resolveDynamicObjectAlias(scope, (node as VariableNode).value))) ||
      (node.type === "path" &&
        (runtime.aliases.objectAliasForNode(node, scope) ||
         runtime.aliases.dynamicObjectAliasForNode(node, scope)));
    const paths = aliasValue ? selection.getSelectedResultPaths(node, scope) : identityReferencePaths(node, scope) ?? (plainSelection
      ? runtime.core.walkNode(node, scope)
      : selection.getSelectedResultPaths(node, scope));
    return paths.map((path) => appendPath(path, "**"));
  }

  function enumeratedObjectBasePaths(node: AstNode, scope: ScopeTracker): string[] {
    if ((node as AstNode & { group?: unknown }).group) return [];
    if (node.type === "variable") {
      return runtime.results.getResultSuffixBasePaths(node, scope);
    }
    if (node.type === "object") return [];
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [condition.then, condition.else].flatMap((branch) => branch
        ? enumeratedObjectBasePaths(branch, scope) : []);
    }
    if (node.type === "array" || node.type === "block") {
      let nestedScope = scope;
      let paths: string[] = [];
      for (const expression of (node as ArrayNode | BlockNode).expressions) {
        const binding = expression.type === "bind" ? expression as BindNode : null;
        const valuePaths = enumeratedObjectBasePaths(binding?.rhs ?? expression, nestedScope);
        if (node.type === "array") paths.push(...valuePaths);
        else paths = valuePaths;
        if (binding) nestedScope = runtime.callables.bindCallableBlockValue(nestedScope, binding);
      }
      return paths;
    }
    if (["name", "wildcard", "descendant", "parent"].includes(node.type)) {
      return runtime.core.walkNode(node, scope);
    }
    return runtime.aliases.groupResultSuffixBasePaths(node, scope);
  }

  function appliedFunctionFromApply(node: ApplyNode): FunctionNode | null {
    if (node.rhs.type === "partial") {
      const partial = node.rhs as PartialNode;
      return {
        type: "function",
        value: "(",
        position: partial.position,
        procedure: partial.procedure,
        arguments: runtime.higherOrder.applyPartialArguments(partial, [node.lhs]),
      };
    }
    if (node.rhs.type === "function") {
      const func = node.rhs as FunctionNode;
      return { ...func, arguments: [node.lhs, ...func.arguments] };
    }
    if (node.rhs.type === "variable" || node.rhs.type === "transform") {
      const procedure = node.rhs as VariableNode | TransformNode;
      return {
        type: "function",
        value: "(",
        position: procedure.position ?? 0,
        procedure,
        arguments: [node.lhs],
      };
    }
    return null;
  }

  /** Reuse boolean's value-consumption rules for control-flow truthiness. */
  function asBooleanExpression(node: AstNode): FunctionNode {
    const position = (node as AstNode & { position?: number }).position ?? 0;
    return {
      type: "function",
      value: "(",
      position,
      internalTruthiness: true,
      procedure: {
        type: "variable", value: "boolean", position, resolvedBuiltin: true,
      },
      arguments: [node],
    };
  }

  function isPlaceholder(node: AstNode): boolean {
    return node.type === "operator" && (node as { value?: unknown }).value === "?";
  }

  /** Extract read effects from bound partial-application arguments. */
  function walkPartial(node: PartialNode, scope: ScopeTracker): string[] {
    const capturedCurrent = resolveVariable(scope, "");
    return [
      ...walkFunctionProcedureSelection(node.procedure, scope),
      ...node.arguments.flatMap((arg) =>
        isPlaceholder(arg)
          ? []
          : capturedCurrent && capturedCurrent.length > 0
            ? capturedCurrent.flatMap((contextPrefix) =>
                runtime.paths.walkContextExpression(arg, contextPrefix, scope),
              )
            : runtime.core.walkNode(arg, scope),
      ),
      ...runtime.paths.walkSourceLessFilterStages(node.predicate ?? [], scope),
      ...(node.group ? runtime.paths.walkSourceLessGroupEntries(node.group, scope) : []),
    ];
  }

  function walkFunctionProcedureSelection(
    procedure: FunctionNode["procedure"],
    scope: ScopeTracker,
  ): string[] {
    if (procedure.type !== "condition") {
      return ["function", "path", "block"].includes(procedure.type) &&
        (runtime.callables.resolveCallableValues(procedure, scope).length > 0 ||
          runtime.callables.resolveBuiltinCallableNames(procedure, scope).length > 0)
        ? walkCallableSelection(procedure, scope)
        : [];
    }
    return [
      ...runtime.core.walkNode(asBooleanExpression(procedure.condition), scope),
      ...(runtime.callables.isFunctionProcedureNode(procedure.then)
        ? walkFunctionProcedureSelection(procedure.then, scope)
        : []),
      ...(procedure.else && runtime.callables.isFunctionProcedureNode(procedure.else)
        ? walkFunctionProcedureSelection(procedure.else, scope)
        : []),
    ];
  }

  /**
   * Resolve a variable reference using the scope chain.
   * Built-in function names and the root reference ($) produce no paths.
   */
  function walkVariable(node: VariableNode, scope: ScopeTracker): string[] {
    const capturedCurrentContext =
      node.value === "" ? resolveVariable(scope, "") : null;
    if (isRootReference(node) && capturedCurrentContext === null) {
      let rootScope = childScope(scope);
      const stageVariables = new Set<string>();
      const nonPathVariables = new Set<string>();
      if (node.focusBinding) {
        rootScope = bindVariable(rootScope, node.focusBinding.name, [ROOT_PATH]);
        stageVariables.add(node.focusBinding.name);
      }
      if (node.indexBinding) {
        rootScope = bindVariable(rootScope, node.indexBinding.name, []);
        nonPathVariables.add(node.indexBinding.name);
      }
      return [
        ...runtime.paths.walkFilterStages(
          node.predicate ?? [],
          ROOT_PATH,
          rootScope,
          nonPathVariables,
          stageVariables,
        ),
        ...(node.group
          ? runtime.paths.walkContextGroupEntries(
              node.group,
              ROOT_PATH,
              rootScope,
              stageVariables,
            )
          : []),
      ];
    }
  
    // Check scope first (scope bindings shadow built-ins)
    const resolved = resolveVariable(scope, node.value);
    if (resolved) {
      const suffixBasePaths = [...(resolveSuffixBasePaths(scope, node.value) ?? [])];
      const variableBasePaths =
        suffixBasePaths.length > 0 ? suffixBasePaths : [...resolved];
      const paths = [...variableBasePaths];
  
      // Inspect predicates on the standalone VariableNode (mirrors walkPath variable branch)
      const predicates = node.predicate;
      if (predicates && predicates.length > 0) {
        const objectAlias = resolveObjectAlias(scope, node.value);
        const dynamicObjectAlias = resolveDynamicObjectAlias(scope, node.value);
        if (variableBasePaths.length === 0) {
          paths.push(
            ...predicates.flatMap((stage) =>
              stage.type === "filter"
                ? runtime.core.walkNode(asBooleanExpression((stage as unknown as FilterStage).expr), scope)
                : [],
            ),
          );
        }
        for (const resolvedPath of variableBasePaths) {
          let predicateScope = scope;
          const predicateStageVariables = new Set<string>();
          const predicateNonPathVariables = new Set<string>();
          if (node.focusBinding) {
            predicateScope = runtime.aliases.bindFocusObjectAliasScope(
              scope,
              node.focusBinding.name,
              objectAlias,
              dynamicObjectAlias,
              [resolvedPath],
              runtime.results.getResultSuffixBasePaths(node, scope),
            );
            predicateStageVariables.add(node.focusBinding.name);
          }
          if (node.indexBinding) {
            if (predicateScope === scope) predicateScope = childScope(predicateScope);
            predicateScope = bindVariable(predicateScope, node.indexBinding.name, []);
            predicateNonPathVariables.add(node.indexBinding.name);
          }
          paths.push(
            ...runtime.paths.walkFilterStages(
              predicates,
              resolvedPath,
              predicateScope,
              predicateNonPathVariables,
              predicateStageVariables,
            ),
          );
        }
      }
  
      // Handle group-by on variable node (mirrors walkGroupBy for PathNode)
      if (node.group) {
        const groupNode = node.group;
        const objectAlias = resolveObjectAlias(scope, node.value);
        const dynamicObjectAlias = resolveDynamicObjectAlias(scope, node.value);
        let groupScope = scope;
        const groupStageVariables = new Set<string>();
        if (node.focusBinding) {
          groupScope = runtime.aliases.bindFocusObjectAliasScope(
            scope,
            node.focusBinding.name,
            objectAlias,
            dynamicObjectAlias,
            variableBasePaths,
            runtime.results.getResultSuffixBasePaths(node, scope),
          );
          groupStageVariables.add(node.focusBinding.name);
        }
        if (node.indexBinding) {
          if (groupScope === scope) groupScope = childScope(scope);
          groupScope = bindVariable(groupScope, node.indexBinding.name, []);
        }
        paths.push(
          ...(objectAlias || dynamicObjectAlias
            ? runtime.paths.walkAliasGroupEntries(
                groupNode,
                objectAlias,
                dynamicObjectAlias,
                groupScope,
                suffixBasePaths,
              )
            : variableBasePaths.flatMap((basePath) =>
                runtime.paths.walkContextGroupEntries(
                  groupNode,
                  basePath,
                  groupScope,
                  groupStageVariables,
                ),
              )),
        );
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
    return [
      // Thunk lambdas are parser-generated wrappers, not user-defined functions.
      ...(node.thunk ? runtime.core.walkNode(node.body, scope) : []),
      ...runtime.paths.walkSourceLessFilterStages(node.predicate ?? [], scope),
      ...(node.group ? runtime.paths.walkSourceLessGroupEntries(node.group, scope) : []),
    ];
  }

  function walkCallableSelection(node: AstNode, scope: ScopeTracker): string[] {
    if ((node.type === "name" || node.type === "path" &&
         (node as PathNode).steps[0]?.type === "name") && resolveValue(scope, "") &&
        (runtime.callables.resolveCallableValues(node, scope).length > 0 ||
         runtime.callables.resolveBuiltinCallableNames(node, scope).length > 0)) {
      return walkCallableSelection(runtime.functions.explicitContextExpression(node, ""), scope);
    }
    if (node.type === "lambda" && (node as LambdaNode).thunk) {
      return walkCallableSelection((node as LambdaNode).body, scope);
    }
    if (node.type === "variable") {
      return ((node as VariableNode).predicate ?? []).flatMap((stage) =>
        stage.type === "filter" &&
        !isNumericIndex((stage as unknown as FilterStage).expr)
          ? runtime.core.walkNode(asBooleanExpression((stage as unknown as FilterStage).expr), scope)
          : [],
      );
    }
    if (node.type === "lambda") return walkLambda(node as LambdaNode, scope);
    if (node.type === "transform") {
      const transform = node as TransformNode;
      return [
        ...runtime.paths.walkSourceLessFilterStages(transform.predicate ?? [], scope),
        ...(transform.group
          ? runtime.paths.walkSourceLessGroupEntries(transform.group, scope)
          : []),
      ];
    }
    if (node.type === "array") {
      return runtime.core.walkArray(node as ArrayNode, scope);
    }
    if (node.type === "object") {
      return runtime.core.walkObject(node as ObjectNode, scope);
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [
        ...runtime.core.walkNode(asBooleanExpression(condition.condition), scope),
        ...walkCallableSelection(condition.then, scope),
        ...(condition.else ? walkCallableSelection(condition.else, scope) : []),
      ];
    }
    if (node.type === "block") {
      const block = node as BlockNode;
      const paths: string[] = [];
      let blockScope = scope;
      for (const [index, expression] of block.expressions.entries()) {
        const isLast = index === block.expressions.length - 1;
        if (isLast) {
          paths.push(...walkCallableSelection(expression, blockScope));
        } else if (expression.type === "bind") {
          const bindNode = expression as BindNode;
          paths.push(...walkCallableSelection(bindNode.rhs, blockScope));
          blockScope = runtime.callables.bindCallableBlockValue(blockScope, bindNode);
        } else {
          paths.push(...runtime.core.walkNode(expression, blockScope));
        }
      }
      paths.push(
        ...runtime.paths.walkSourceLessFilterStages(block.predicate ?? [], blockScope),
        ...(block.group
          ? runtime.paths.walkSourceLessGroupEntries(block.group, blockScope)
          : []),
      );
      return paths;
    }
    if (node.type === "path") {
      const path = node as PathNode;
      if (path.steps.some((step) => (step as AstNode & { focusBinding?: unknown }).focusBinding) &&
          path.steps.some((step) => step.type === "sort")) {
        return runtime.paths.walkPath(path, scope);
      }
      const first = path.steps[0];
      const producedByProjection =
        runtime.callables.pathProjectionCallableValues(path, scope).length > 0 ||
        runtime.callables.pathProjectionBuiltinCallableNames(path, scope).length > 0;
      const producedByGroup =
        runtime.callables.groupedPathCallableValues(path, scope).length > 0 ||
        runtime.callables.groupedPathBuiltinCallableNames(path, scope).length > 0;
      const groupSource = { ...path, group: undefined } as PathNode;
      const groupedCallableSource =
        producedByGroup &&
        (runtime.callables.resolveCallableValues(groupSource, scope).length > 0 ||
          runtime.callables.resolveBuiltinCallableNames(groupSource, scope).length > 0);
      const producerPaths =
        first?.type === "function"
          ? walkFunction(first as FunctionNode, scope)
          : [];
      const projectionPaths = producedByProjection ||
        (producedByGroup && !groupedCallableSource)
        ? runtime.paths.walkPath(path, scope)
        : groupedCallableSource && path.group
          ? runtime.paths.walkSourceLessGroupEntries(
              path.group,
              runtime.callables.groupedPathCallableScope(path, scope),
            )
          : [];
      return [...producerPaths, ...projectionPaths, ...path.steps.flatMap((step, index) => {
        if (["array", "object", "block"].includes(step.type)) {
          return walkCallableSelection(step, scope);
        }
        if (step.type === "sort") {
          const prefixSteps = path.steps.slice(0, index);
          if (prefixSteps.length === 0) return runtime.paths.walkSortTerms(step as SortNode, "", scope);
          const prefix: AstNode = prefixSteps.length === 1 ? prefixSteps[0]
            : { ...path, steps: prefixSteps, group: undefined };
          const sortScope = runtime.higherOrder.bindArgumentParameter(
            childScope(scope), { type: "variable", value: "", position: 0 },
            runtime.aliases.bindingAliasPaths(prefix, scope), prefix, scope,
          );
          return (step as SortNode).terms.flatMap((term) =>
            runtime.core.walkNode(explicitContextExpression(term.expression, ""), sortScope));
        }
        return runtime.paths.walkSourceLessFilterStages(
          (step as AstNode & { predicate?: AstNode[] }).predicate ?? [],
          scope,
        );
      })];
    }
    if (node.type === "function" && runtime.callables.resolveCallableValues(node, scope).length > 0) {
      const functionNode = node as FunctionNode;
      if (
        functionNode.procedure.type === "variable" &&
        functionNode.procedure.value === "lookup"
      ) {
        return functionNode.arguments.flatMap((arg) =>
          runtime.callables.resolveCallableValues(arg, scope).length > 0
            ? walkCallableSelection(arg, scope)
            : runtime.core.walkNode(arg, scope),
        );
      }
      return walkFunction(node as FunctionNode, scope);
    }
    return runtime.core.walkNode(node, scope);
  }

  function walkReturnedCallableCall(
    node: FunctionNode,
    scope: ScopeTracker,
  ): string[] {
    // walkFunction dispatches here only for a function, block, or path procedure.
    const producer = node.procedure;
    const paths = walkCallableSelection(producer, scope);
    const callables = runtime.callables.resolveCallableValues(producer, scope);
    const builtinNames = runtime.callables.resolveBuiltinCallableNames(producer, scope);
    if (callables.length === 0 && builtinNames.length === 0) {
      return [...paths, ...walkHostArguments(node.arguments, scope, node.position)];
    }
    for (const callable of callables) {
      if (callable.kind === "transform") {
        paths.push(...runtime.transforms.walkTransformCall(callable.binding, node.arguments, scope));
      } else if (callable.kind === "lambda") {
        paths.push(...runtime.higherOrder.walkCustomFunctionCall(callable.binding, node.arguments, scope));
      } else {
        paths.push(...runtime.higherOrder.walkPartialCall(callable.binding, node.arguments, scope));
      }
    }
    for (const name of builtinNames) {
      paths.push(
        ...walkFunction(
          {
            ...node,
            procedure: { type: "variable", value: name, position: node.position, resolvedBuiltin: true },
          },
          scope,
        ),
      );
    }
    if (isUnknownHostProcedure(producer, scope)) {
      paths.push(...walkHostArguments(node.arguments, scope, node.position));
    }
    return paths;
  }

  function conditionalProcedureCalls(node: FunctionNode): FunctionNode[] {
    if (node.procedure.type !== "condition") return [];
    const condition = node.procedure;
    return [condition.then, condition.else].flatMap((procedure) =>
      procedure && runtime.callables.isFunctionProcedureNode(procedure)
        ? [{ ...node, procedure }]
        : [],
    );
  }

  /**
   * Extract paths from function calls with lambda-aware resolution.
   *
   * Handles three cases:
   * 1. Locally bound callable -- trace the actual call arguments into its body
   * 2. Higher-order built-in ($map, $filter, etc.) -- bind lambda params to data arg paths
   * 3. Non-higher-order / unknown function -- pass-through all arguments
   */
  function walkFunction(node: FunctionNode, scope: ScopeTracker): string[] {
    const withFunctionStages = (readPaths: string[]) => [
      ...readPaths,
      ...walkFunctionPredicates(node, scope),
      ...walkFunctionGroupBy(node, scope),
    ];
  
    if (node.procedure.type === "lambda") {
      return withFunctionStages(
        runtime.higherOrder.walkCustomFunctionCall(
          { lambda: node.procedure, scope },
          node.arguments,
          scope,
        ),
      );
    }
  
    if (node.procedure.type === "transform") {
      return withFunctionStages(
        runtime.transforms.walkTransformCall(
          { transform: node.procedure, scope },
          node.arguments,
          scope,
        ),
      );
    }
  
    if (node.procedure.type === "condition") {
      return withFunctionStages([
        ...runtime.core.walkNode(asBooleanExpression(node.procedure.condition), scope),
        ...conditionalProcedureCalls(node).flatMap((call) =>
          walkFunction(call, scope),
        ),
      ]);
    }
    if (
      node.procedure.type === "function" ||
      node.procedure.type === "block" ||
      node.procedure.type === "path"
    ) {
      return withFunctionStages(walkReturnedCallableCall(node, scope));
    }
  
    const funcName = node.procedure.value;
    const builtinProcedure = node.procedure.type === "variable" && node.procedure.resolvedBuiltin;
    const storedBuiltinNames = builtinProcedure ? [] : runtime.callables.resolveBuiltinCallableNames(
      node.procedure, scope,
    ).filter((name) => name !== funcName || resolveValue(scope, funcName) !== null);
    const capturedCurrent = resolveVariable(scope, "");
    const args =
      capturedCurrent !== null && builtinUsesContextDefault(funcName, node.arguments)
        ? [
            {
              type: "variable",
              value: "",
              position: node.position,
            } as VariableNode,
            ...node.arguments,
          ]
        : withImplicitRootFunctionArgument(
            funcName,
            node.arguments,
            node.position,
          );
    const paths: string[] = [];

    const lambdaBinding = builtinProcedure ? null : resolveLambda(scope, funcName);
    const partialBinding = builtinProcedure ? null : resolvePartial(scope, funcName);
    const transformBinding = builtinProcedure ? null : resolveTransform(scope, funcName);
    const storedCallables = runtime.callables.resolveCallableValues(
      node.procedure,
      scope,
    );
    const walkStoredCallablePaths = (): string[] => {
      const storedPaths = walkCallableSelection(node.procedure, scope);
      for (const callable of storedCallables) {
        if (callable.kind === "transform") {
          storedPaths.push(...runtime.transforms.walkTransformCall(callable.binding, node.arguments, scope));
        } else if (callable.kind === "lambda") {
          storedPaths.push(...runtime.higherOrder.walkCustomFunctionCall(callable.binding, node.arguments, scope));
        } else {
          storedPaths.push(...runtime.higherOrder.walkPartialCall(callable.binding, node.arguments, scope));
        }
      }
      for (const name of storedBuiltinNames) {
        storedPaths.push(
          ...walkFunction(
            {
              ...node,
              procedure: { type: "variable", value: name, position: node.position, resolvedBuiltin: true },
              arguments: node.arguments,
              predicate: [],
              group: undefined,
            },
            scope,
          ),
        );
      }
      return storedPaths;
    };
    // Local bindings take precedence over built-in names and argument defaults.
    if (lambdaBinding) {
      return withFunctionStages(runtime.higherOrder.walkCustomFunctionCall(lambdaBinding, node.arguments, scope));
    }

    if (partialBinding) {
      return withFunctionStages(runtime.higherOrder.walkPartialCall(partialBinding, node.arguments, scope));
    }

    if (transformBinding) {
      return withFunctionStages(runtime.transforms.walkTransformCall(transformBinding, node.arguments, scope));
    }

    if (storedCallables.length > 0 || storedBuiltinNames.length > 0) {
      return withFunctionStages([
        ...walkStoredCallablePaths(),
        ...(isUnknownHostProcedure(node.procedure, scope)
          ? walkHostArguments(node.arguments, scope, node.position) : []),
      ]);
    }

    if ((!node.internalTruthiness && options.opaqueFunctions.has(funcName)) ||
        isUnknownHostProcedure(node.procedure, scope)) {
      return withFunctionStages(walkHostArguments(args, scope, node.position));
    }

    if (args.length === 0 && IMPLICIT_ROOT_SHALLOW_FUNCTIONS.has(funcName)) {
      paths.push("*");
    }
    if (args.length === 0 && IMPLICIT_ROOT_DEEP_FUNCTIONS.has(funcName)) {
      paths.push("**");
    }
  
    const explicitContextPaths = args[0]
      ? identityReferencePaths(args[0], scope)
      : null;
    if (
      args.length > 0 &&
      explicitContextPaths &&
      IMPLICIT_ROOT_SHALLOW_FUNCTIONS.has(funcName)
    ) {
      paths.push(...enumeratedObjectBasePaths(args[0], scope).map((path) => appendPath(path, "*")));
    }
    if (
      args.length > 0 &&
      explicitContextPaths &&
      IMPLICIT_ROOT_DEEP_FUNCTIONS.has(funcName)
    ) {
      paths.push(...deepValueReadPaths(args[0], scope));
    }
    if (funcName === "merge") {
      const mergeInputs =
        args[0]?.type === "array"
          ? (args[0] as ArrayNode).expressions
          : args[0]
            ? [args[0]]
            : [];
      for (const input of mergeInputs) {
        const identityPaths = identityReferencePaths(input, scope);
        if (identityPaths) {
          paths.push(...enumeratedObjectBasePaths(input, scope).map((path) => appendPath(path, "*")));
        }
      }
    }
  
    // Resolve higher-order built-in semantics after local callable dispatch.
    const semantics = HIGHER_ORDER_SEMANTICS[funcName];
    if (semantics) {
      return withFunctionStages(
        runtime.higherOrder.walkHigherOrderCall({ ...node, arguments: args }, semantics, scope),
      );
    }
  
    if (funcName === "replace" && args[2] && isUnknownHostProcedure(args[2], scope)) {
      for (const input of getMatcherCallNodes(args, scope)) {
        paths.push(...deepValueReadPaths(input.node, input.scope));
      }
    }

    // Step 3: Non-higher-order built-in or unknown function -- pass-through all args
    for (const [argIndex, arg] of args.entries()) {
      const invokesCallableArgument =
        (argIndex === 1 && MATCHER_CALLBACK_FUNCTIONS.has(funcName)) ||
        (argIndex === 2 && funcName === "replace");
      const callableArguments =
        invokesCallableArgument
          ? runtime.callables.resolveCallableValues(arg, scope)
          : [];
      const builtinArguments = invokesCallableArgument
        ? runtime.callables.resolveBuiltinCallableNames(arg, scope) : [];
      if (callableArguments.length > 0 || builtinArguments.length > 0) {
        paths.push(...walkCallableSelection(arg, scope));
        const matchInputs = argIndex === 2 && funcName === "replace"
          ? getMatcherCallNodes(args, scope) : [];
        const generatedArgument: AstNode = {
          type: "value",
          value: null,
          position: node.position,
        };
        const inputs = matchInputs.length > 0 ? matchInputs : [{ node: generatedArgument, scope }];
        for (const callable of callableArguments) {
          for (const input of inputs) {
            if (callable.kind === "lambda") {
              paths.push(...runtime.higherOrder.walkCustomFunctionCall(
                callable.binding, [input.node], scope, false, [input.scope],
              ));
            } else if (callable.kind === "partial") {
              const scoped = runtime.higherOrder.scopePartialArguments([input.node], [input.scope], scope);
              paths.push(...runtime.higherOrder.walkPartialCall(callable.binding, scoped.arguments, scoped.scope));
            }
          }
        }
        for (const name of builtinArguments) {
          for (const input of inputs) {
            paths.push(...walkFunction({
              type: "function", value: "(", position: node.position,
              procedure: { type: "variable", value: name, position: node.position, resolvedBuiltin: true },
              arguments: [input.node],
            }, input.scope));
          }
        }
        if (argIndex === 1 && MATCHER_CALLBACK_FUNCTIONS.has(funcName) && funcName !== "contains") {
          paths.push(...walkMatcherContinuations({
            type: "function", value: "(", position: node.position,
            procedure: arg as FunctionNode["procedure"], arguments: [generatedArgument],
          }, scope));
        }
        continue;
      }
      if (arg.type === "lambda") {
        if (funcName === "boolean" || funcName === "not") {
          paths.push(...runtime.core.walkNode(arg, scope));
          continue;
        }
        // Walk lambda body with current scope (closure capture)
        const lambda = arg as LambdaNode;
        const lambdaScope = childScope(scope);
        paths.push(...runtime.core.walkNode(lambda.body, lambdaScope));
      } else {
        paths.push(...runtime.core.walkNode(arg, scope));
      }
    }

    const consumesNamedDeepValue = !explicitContextPaths && IMPLICIT_ROOT_DEEP_FUNCTIONS.has(funcName);
    if (args[0] && (funcName === "distinct" || consumesNamedDeepValue)) {
      paths.push(...deepValueReadPaths(args[0], scope));
    }
    if (args[0] && ((!explicitContextPaths && IMPLICIT_ROOT_SHALLOW_FUNCTIONS.has(funcName)) || funcName === "merge")) {
      paths.push(...enumeratedObjectBasePaths(args[0], scope).map((path) => appendPath(path, "*")));
    }
    if (funcName === "formatNumber" && args[2]) {
      paths.push(...enumeratedObjectBasePaths(args[2], scope).map((path) => appendPath(path, "*")));
    }
  
    if (funcName === "eval") {
      paths.push(...walkStaticEval(args, scope));
    }
  
    if (funcName === "lookup") {
      paths.push(...runtime.results.getLookupResultBasePaths(args, scope));
    }
  
    return withFunctionStages(paths);
  }

  function walkHostArguments(args: AstNode[], scope: ScopeTracker, position: number): string[] {
    const descendants: string[] = [];
    const paths = args.flatMap((arg) => {
      const callable = runtime.callables.isFunctionProcedureNode(arg) && (
        runtime.callables.resolveCallableValues(arg, scope).length > 0 ||
        runtime.callables.resolveBuiltinCallableNames(arg, scope).length > 0
      );
      if (!callable) {
        descendants.push(...deepValueReadPaths(arg, scope));
        return runtime.core.walkNode(arg, scope);
      }
      const call: FunctionNode = {
        type: "function", value: "(", position,
        procedure: arg as FunctionNode["procedure"],
        arguments: [{ type: "value", value: null, position }],
      };
      descendants.push(...deepValueReadPaths(call, scope));
      return [
        ...walkCallableSelection(arg, scope),
        ...walkFunction(call, scope),
      ];
    });
    return [...paths, ...descendants];
  }

  function isUnknownHostProcedure(
    node: AstNode, scope: ScopeTracker, visited = new Set<AstNode>(), selectors: AstNode[] = [],
  ): boolean {
    if (visited.has(node)) return false;
    const nextVisited = new Set([...visited, node]);
    if (node.type === "block") {
      const expressions = (node as BlockNode).expressions;
      let blockScope = childScope(scope);
      for (const [index, expression] of expressions.entries()) {
        if (index === expressions.length - 1) {
          return isUnknownHostProcedure(expression, blockScope, nextVisited, selectors);
        }
        const expressionScope = blockScope;
        if (expression.type === "bind") {
          blockScope = runtime.callables.bindCallableBlockValue(blockScope, expression as BindNode);
        }
        blockScope = runtime.core.bindArrayAssignmentEffects(expression, blockScope, expressionScope);
      }
      return false;
    }
    if (node.type === "bind") return isUnknownHostProcedure((node as BindNode).rhs, scope, nextVisited, selectors);
    if (node.type === "lambda" && (node as LambdaNode).thunk) {
      return isUnknownHostProcedure((node as LambdaNode).body, scope, nextVisited, selectors);
    }
    const group = (node as FunctionNode).group;
    if (group && selectors.length > 0) {
      const [first, ...suffix] = selectors;
      const key = first.type === "name" ? String(first.value) : null;
      const groupScope = runtime.aliases.groupResultScope(node, scope);
      return group.entries.some(([entryKey, value]) =>
        (key === null || runtime.aliases.staticObjectKey(entryKey) === null || runtime.aliases.staticObjectKey(entryKey) === key) &&
        isUnknownHostProcedure(value, groupScope, nextVisited, suffix));
    }
    if (node.type === "path") {
      const steps = (node as PathNode).steps;
      let projection = -1;
      for (let index = 1; index < steps.length; index++) {
        if (["object", "array", "block", "lambda"].includes(steps[index].type)) projection = index;
      }
      if (projection > 0) {
        return isUnknownHostProcedure(steps[projection], scope, nextVisited, [...steps.slice(projection + 1), ...selectors]);
      }
      const [first, ...suffix] = steps;
      return Boolean(first && isUnknownHostProcedure(first, scope, nextVisited, [...suffix, ...selectors]));
    }
    if (["name", "wildcard", "descendant", "parent"].includes(node.type)) {
      const context = resolveValue(scope, "");
      return context ? isUnknownHostProcedure(context.node, context.scope, nextVisited, [node, ...selectors]) : true;
    }
    if (node.type === "function") {
      const procedure = (node as FunctionNode).procedure;
      if (runtime.callables.resolveBuiltinCallableNames(procedure, scope).some((name) => options.opaqueFunctions.has(name)) ||
          isUnknownHostProcedure(procedure, scope, nextVisited)) return true;
      if (runtime.callables.customFunctionResultBodies(node as FunctionNode, scope).some((body) =>
        isUnknownHostProcedure(body.node, body.scope, nextVisited, selectors))) return true;
      if (runtime.callables.resolveBuiltinCallableNames(procedure, scope).includes("eval")) {
        const args = (node as FunctionNode).arguments;
        const expression = getStaticEvalExpression(args, scope);
        if (expression && isUnknownHostProcedure(expression, getStaticEvalScope(args, scope), nextVisited, selectors)) return true;
      }
    }
    if (node.type === "function" &&
        runtime.callables.resolveBuiltinCallableNames((node as FunctionNode).procedure, scope).includes("lookup")) {
      const call = node as FunctionNode;
      const [object, key] = call.arguments;
      const selector: AstNode = key?.type === "string"
        ? { type: "name", value: String(key.value), position: call.position }
        : { type: "wildcard", value: "*", position: call.position };
      return Boolean(object && isUnknownHostProcedure(object, scope, nextVisited, [selector, ...selectors]));
    }
    if (node.type === "object" && selectors.length > 0) {
      const [first, ...suffix] = selectors;
      const key = first.type === "name" ? String(first.value) : null;
      return (node as ObjectNode).entries.some(([entryKey, value]) =>
        (key === null || runtime.aliases.staticObjectKey(entryKey) === null || runtime.aliases.staticObjectKey(entryKey) === key) &&
        isUnknownHostProcedure(value, scope, nextVisited, suffix));
    }
    if (node.type === "condition") {
      const condition = node as ConditionNode;
      return [condition.then, condition.else].some((branch) => branch &&
        isUnknownHostProcedure(branch, scope, nextVisited, selectors));
    }
    if (node.type === "array") {
      return (node as ArrayNode).expressions.some((item) =>
        isUnknownHostProcedure(item, scope, nextVisited, selectors));
    }
    if (node.type !== "variable") return false;
    const name = (node as VariableNode).value;
    if ((node as VariableNode).resolvedBuiltin) return false;
    const binding = resolveValue(scope, name);
    if (binding) {
      return isUnknownHostProcedure(binding.node, binding.scope, nextVisited, selectors);
    }
    return selectors.length === 0 && !resolveLambda(scope, name) && !resolvePartial(scope, name) && !resolveTransform(scope, name) &&
      name !== "" && name !== "$" &&
      !BUILTIN_FUNCTIONS.has(name) && resolveVariable(scope, name) === null;
  }

  function walkMatcherContinuations(initialCall: FunctionNode, scope: ScopeTracker): string[] {
    return matcherCalls(initialCall, scope).slice(1).flatMap((call) => walkFunction(call.node, call.scope));
  }

  function matcherCalls(initialCall: FunctionNode, scope: ScopeTracker): ScopedMatcherCall[] {
    const calls = [{ node: initialCall, scope, visited: new Set<AstNode>() }];
    // Resolve each closure directly rather than nesting all preceding calls into its selector.
    for (let index = 0; index < calls.length; index++) {
      const call = calls[index];
      const next: PathNode = {
        type: "path",
        steps: [call.node, { type: "name", value: "next", position: call.node.position }],
      };
      for (const callable of runtime.callables.resolveCallableValues(next, call.scope)) {
        const source = callable.kind === "lambda" ? callable.binding.lambda
          : callable.kind === "partial" ? callable.binding.partial : callable.binding.transform;
        if (call.visited.has(source)) continue;
        const name = "\0matcher-continuation";
        let nextScope = childScope(callable.binding.scope);
        if (callable.kind === "lambda") {
          nextScope = bindLambdaReference(nextScope, name, callable.binding, callable.binding.forwardScope ?? call.scope);
        } else if (callable.kind === "partial") {
          nextScope = bindPartial(nextScope, name, callable.binding.partial, callable.binding.scope);
        } else {
          nextScope = bindTransform(nextScope, name, callable.binding.transform, callable.binding.scope);
        }
        calls.push({
          node: {
            type: "function", value: "(", position: call.node.position,
            procedure: { type: "variable", value: name, position: call.node.position }, arguments: [],
          },
          scope: nextScope, visited: new Set([...call.visited, source]),
        });
      }
    }
    return calls;
  }

  function getMatcherCallNodes(args: AstNode[], scope: ScopeTracker): ScopedMatcherCall[] {
    if (!args[0] || !args[1] || !runtime.callables.isFunctionProcedureNode(args[1])) return [];
    const initialCall: FunctionNode = {
      type: "function", value: "(", position: 0,
      procedure: args[1], arguments: [args[0]],
    };
    return matcherCalls(initialCall, scope);
  }

  function matchResultNode(call: FunctionNode): ObjectNode {
    return {
      type: "object", position: call.position,
      entries: [["match", "match"], ["index", "start"], ["groups", "groups"]].map(([key, source]) => [
        { type: "string", value: key, position: call.position },
        { type: "path", steps: [call, { type: "name", value: source, position: call.position }] },
      ]),
    };
  }

  function getMatchResultObjectAlias(args: AstNode[], scope: ScopeTracker): ObjectAlias | null {
    return runtime.aliases.mergeObjectAliases(getMatcherCallNodes(args, scope).map((call) =>
      runtime.aliases.groupResultObjectAliasForNode(matchResultNode(call.node), call.scope)));
  }

  function getMatchResultBasePaths(args: AstNode[], scope: ScopeTracker): string[] {
    return getMatcherCallNodes(args, scope).flatMap((call) =>
      selection.getSelectedResultPaths(matchResultNode(call.node), call.scope));
  }

  function walkStaticEval(args: AstNode[], scope: ScopeTracker): string[] {
    const expression = getStaticEvalExpression(args, scope);
    if (!expression) {
      return args[0]?.type === "string" ? [] : markAbsolute(["**"]);
    }
  
    const evalScope = getStaticEvalScope(args, scope);
    if (
      runtime.callables.resolveCallableValues(expression, evalScope).length > 0 ||
      runtime.callables.resolveBuiltinCallableNames(expression, evalScope).length > 0
    ) {
      return walkCallableSelection(expression, evalScope);
    }

    return runtime.core.walkNode(expression, evalScope);
  }

  function getStaticEvalResultBasePaths(
    args: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const expression = getStaticEvalExpression(args, scope);
    if (!expression) return [];
  
    return selection.getSelectedResultPaths(expression, getStaticEvalScope(args, scope));
  }

  function getStaticEvalResultSuffixBasePaths(
    args: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const expression = getStaticEvalExpression(args, scope);
    return expression
      ? runtime.results.getResultSuffixBasePaths(expression, getStaticEvalScope(args, scope))
      : [];
  }

  function hasCapturedEvalContext(scope?: ScopeTracker): boolean {
    return Boolean(scope && (resolveVariable(scope, "") !== null || resolveValue(scope, "") !== null));
  }

  function getStaticEvalExpression(args: AstNode[], scope?: ScopeTracker): AstNode | null {
    const source = args[0];
    if (source?.type !== "string") return null;
  
    try {
      const expression = parse((source as { value: string }).value);
      return args[1] || hasCapturedEvalContext(scope) ? explicitContextExpression(expression) : expression;
    } catch {
      return null;
    }
  }

  function explicitContextExpression(node: AstNode, contextName = EVAL_CONTEXT): AstNode {
    const rewrite = (value: unknown, pathStep = false): unknown => {
      if (Array.isArray(value)) return value.map((entry) => rewrite(entry, pathStep));
      if (!value || typeof value !== "object" || value instanceof RegExp) return value;
      const record = value as Record<string, unknown>;
      // Transform bodies receive their input when the transform is invoked.
      if (record.type === "transform") return value;
      const current: VariableNode = { type: "variable", value: contextName, position: 0 };
      if (record.type === "path") {
        const steps = record.steps as AstNode[];
        const first = rewrite(steps[0], true) as AstNode;
        return {
          ...record,
          steps: [
            ...(["name", "wildcard", "descendant"].includes(first?.type) ? [current] : []),
            first,
            ...steps.slice(1),
          ],
        };
      }
      const rewritten = Object.fromEntries(Object.entries(record).map(([key, entry]) => [
        key,
        ["source", "predicate", "stages", "group"].includes(key) ? entry : rewrite(entry),
      ]));
      // Bare input paths and explicit $ paths must use the same context
      // binding, including aliases for fields in constructed objects.
      if (rewritten.type === "variable" && rewritten.value === "") {
        return { ...rewritten, value: contextName };
      }
      if (!pathStep && ["name", "wildcard", "descendant"].includes(String(rewritten.type))) {
        return { type: "path", steps: [current, rewritten] };
      }
      return rewritten;
    };
    return rewrite(node) as AstNode;
  }

  function getStaticEvalScope(
    args: AstNode[],
    scope: ScopeTracker,
    preserveValues = false,
  ): ScopeTracker {
    if (!args[1] && !hasCapturedEvalContext(scope)) return scope;
    const contextArg = args[1] ?? { type: "variable", value: "", position: 0 } as VariableNode;
    const paths = runtime.higherOrder.functionArgumentResultPaths(contextArg, scope);
    const currentScope = runtime.higherOrder.bindArgumentParameter(
      childScope(scope), { type: "variable", value: "", position: 0 },
      paths, contextArg, scope,
    );
    const evalScope = runtime.higherOrder.bindArgumentParameter(
      currentScope, { type: "variable", value: EVAL_CONTEXT, position: 0 },
      paths, contextArg, scope,
    );
    return preserveValues
      ? bindValue(bindValue(evalScope, "", contextArg, scope), EVAL_CONTEXT, contextArg, scope)
      : evalScope;
  }

  function getStaticEvalResultObjectAlias(
    args: AstNode[],
    scope: ScopeTracker,
  ): ObjectAlias | null {
    const expression = getStaticEvalExpression(args, scope);
    if (!expression) return null;
  
    return runtime.aliases.groupResultObjectAliasForNode(expression, getStaticEvalScope(args, scope));
  }

  function getStaticEvalResultDynamicObjectAlias(
    args: AstNode[],
    scope: ScopeTracker,
  ): DynamicObjectAlias | null {
    const expression = getStaticEvalExpression(args, scope);
    return expression
      ? runtime.aliases.groupResultDynamicObjectAliasForNode(expression, getStaticEvalScope(args, scope))
      : null;
  }

  function walkFunctionPredicates(node: FunctionNode, scope: ScopeTracker): string[] {
    if (!node.predicate || node.predicate.length === 0) return [];
    const source = { ...node, predicate: undefined } as FunctionNode;
    const earlyProducerPredicate = node.source && !node.source.tupleStages;
    const value = earlyProducerPredicate
      ? { ...source, focusBinding: undefined, indexBinding: undefined } as FunctionNode : source;
    if ((earlyProducerPredicate || !node.focusBinding && !node.indexBinding) &&
        (runtime.callables.resolveCallableValues(value, scope).length > 0 ||
         runtime.callables.resolveBuiltinCallableNames(value, scope).length > 0)) {
      const incomingBinding = [node.focusBinding?.name, node.indexBinding?.name].some((name) =>
        name !== undefined && resolveVariable(scope, name) !== null,
      );
      const predicateScope = earlyProducerPredicate && !incomingBinding
        ? runtime.aliases.bindStepFocusScope(source, scope) : scope;
      return runtime.paths.walkValueFilterStages(node.predicate, value, predicateScope);
    }
  
    const predicateScope = runtime.aliases.bindStepFocusScope(node, scope);
    const predicateStageVariables = new Set(
      node.focusBinding ? [node.focusBinding.name] : [],
    );
    const predicateNonPathVariables = new Set(
      node.indexBinding ? [node.indexBinding.name] : [],
    );
    const objectAlias = runtime.results.getFunctionResultObjectAlias(node, scope);
    const dynamicObjectAlias = runtime.results.getFunctionResultDynamicObjectAlias(node, scope);
  
    if (objectAlias || dynamicObjectAlias) {
      const suffixBasePaths = runtime.results.getFunctionResultSuffixBasePaths(node, scope);
      return runtime.aliases.walkAliasFilterStages(
        node.predicate, objectAlias, dynamicObjectAlias, predicateScope, suffixBasePaths,
      );
    }
    const resultBasePaths = runtime.results.getFunctionResultBasePaths(node, scope);
    if (resultBasePaths.length === 0) {
      return runtime.paths.walkSourceLessFilterStages(
        node.predicate,
        predicateScope,
      );
    }
  
    return resultBasePaths.flatMap((basePath) =>
      runtime.paths.walkFilterStages(
        node.predicate!,
        basePath,
        predicateScope,
        predicateNonPathVariables,
        predicateStageVariables,
      ),
    );
  }

  function walkFunctionGroupBy(node: FunctionNode, scope: ScopeTracker): string[] {
    if (!node.group) return [];
    const source = { ...node, group: undefined } as FunctionNode;
    if (runtime.callables.resolveCallableValues(source, scope).length > 0 ||
        runtime.callables.resolveBuiltinCallableNames(source, scope).length > 0) {
      return runtime.paths.walkGroupBy(node, scope);
    }
  
    const groupScope = runtime.aliases.bindStepFocusScope(node, scope);
    const groupStageVariables = new Set(
      node.focusBinding ? [node.focusBinding.name] : [],
    );
    const objectAlias = runtime.results.getFunctionResultObjectAlias(node, scope);
    const dynamicObjectAlias = runtime.results.getFunctionResultDynamicObjectAlias(node, scope);
  
    if (objectAlias || dynamicObjectAlias) {
      return runtime.paths.walkAliasGroupEntries(
        node.group,
        objectAlias,
        dynamicObjectAlias,
        groupScope,
        runtime.results.getFunctionResultSuffixBasePaths(node, scope),
      );
    }
  
    const resultBasePaths = runtime.results.getFunctionResultBasePaths(node, scope);
    if (resultBasePaths.length === 0) {
      return runtime.paths.walkSourceLessGroupEntries(node.group, groupScope);
    }
  
    return resultBasePaths.flatMap((basePath) =>
      runtime.paths.walkContextGroupEntries(node.group!, basePath, groupScope, groupStageVariables),
    );
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
    const lhsPaths = runtime.core.walkNode(node.lhs, scope);
    paths.push(...lhsPaths);
  
    const appliedFunction = node.rhs.type === "transform"
      ? null : appliedFunctionFromApply(node);
    if (appliedFunction) {
      // walkFunction will re-walk the lhs arg, but dedup in extractPaths handles it
      paths.push(...walkFunction(appliedFunction, scope));
    } else if (
      ["path", "block"].includes(node.rhs.type) &&
      (runtime.callables.resolveCallableValues(node.rhs, scope).length > 0 ||
        runtime.callables.resolveBuiltinCallableNames(node.rhs, scope).length > 0)
    ) {
      paths.push(
        ...walkFunction(
          {
            type: "function",
            value: "(",
            position: node.position,
            procedure: node.rhs as FunctionNode["procedure"],
            arguments: [node.lhs],
          },
          scope,
        ),
      );
    } else if (node.rhs.type === "path") {
      const pathNode = node.rhs as PathNode;
      if (pathNode.steps[0]?.type === "function") {
        const funcNode = pathNode.steps[0] as FunctionNode;
        paths.push(
          ...runtime.paths.walkPath(
            {
              ...pathNode,
              steps: [
                { ...funcNode, arguments: [node.lhs, ...funcNode.arguments] },
                ...pathNode.steps.slice(1),
              ],
            },
            scope,
          ),
        );
      } else {
        paths.push(...runtime.core.walkNode(node.rhs, scope));
      }
    } else if (node.rhs.type === "lambda") {
      // Inline lambda application: bind first parameter to lhs base paths
      const lambda = node.rhs as LambdaNode;
      let lambdaScope = childScope(scope);
      let callbackBasePaths: string[] = [];
      if (lambda.arguments.length > 0) {
        const lhsBasePaths = runtime.higherOrder.extractBasePaths(node.lhs, scope);
        callbackBasePaths = lhsBasePaths.length > 0 ? lhsBasePaths : lhsPaths;
        lambdaScope = runtime.higherOrder.bindArgumentParameter(
          lambdaScope,
          lambda.arguments[0],
          callbackBasePaths,
          node.lhs,
          scope,
        );
      }
      paths.push(
        ...runtime.higherOrder.resolveCallbackParentPaths(runtime.core.walkNode(lambda.body, lambdaScope), callbackBasePaths),
      );
    } else if (node.rhs.type === "transform") {
      const transformNode = node.rhs as TransformNode;
      const transformPaths = runtime.transforms.walkTransform(transformNode, scope);
      const transformBasePaths = runtime.higherOrder.extractBasePaths(node.lhs, scope);
      paths.push(...deepValueReadPaths(node.lhs, scope));
      const aliasContextPaths = runtime.transforms.transformApplyAliasContextPaths(
        transformNode,
        transformPaths,
        node.lhs,
        lhsPaths,
        scope,
      );
      if (aliasContextPaths) {
        paths.push(...aliasContextPaths);
        return paths;
      }
      const transformPrefixes =
        transformBasePaths.length > 0 ? transformBasePaths : [lhsPaths[0] ?? ""];
      paths.push(
        ...transformPrefixes.flatMap((prefix) => prefixPaths(prefix, transformPaths)),
      );
    } else {
      // Fallback: unusual RHS (e.g., variable reference)
      paths.push(...runtime.core.walkNode(node.rhs, scope));
    }
  
    return paths;
  }

  return {
    bindCallableValue,
    builtinUsesContextDefault,
    resultUsesContextDefault,
    withImplicitRootFunctionArgument,
    identityReferencePaths,
    deepValueReadPaths,
    asBooleanExpression,
    appliedFunctionFromApply,
    explicitContextExpression,
    isPlaceholder,
    walkPartial,
    walkVariable,
    walkLambda,
    walkCallableSelection,
    conditionalProcedureCalls,
    walkFunction,
    isUnknownHostProcedure,
    getMatchResultObjectAlias,
    getMatchResultBasePaths,
    getStaticEvalResultBasePaths,
    getStaticEvalResultSuffixBasePaths,
    getStaticEvalExpression,
    getStaticEvalScope,
    getStaticEvalResultObjectAlias,
    getStaticEvalResultDynamicObjectAlias,
    walkApply,
  };
}
