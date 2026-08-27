import type { ArrayNode, AstNode, ApplyNode, BindNode, BlockNode, ConditionNode, FilterStage, FunctionNode, LambdaNode, ObjectNode, PartialNode, PathNode, SortNode, TransformNode, VariableNode } from "../types.js";
import { buildPathString } from "../path-builder.js";
import { parse } from "../parser.js";
import { type ScopeTracker, childScope, bindVariable, bindLambda, bindPartial, bindTransform, bindValue, resolveLambda, resolvePartial, resolveTransform, resolveVariable, resolveSuffixBasePaths, resolveObjectAlias, resolveDynamicObjectAlias, type DynamicObjectAlias, type ObjectAlias } from "../scope.js";
import { BUILTIN_FUNCTIONS, HIGHER_ORDER_SEMANTICS } from "../builtins.js";
import { ROOT_PATH, IMPLICIT_ROOT_SHALLOW_FUNCTIONS, IMPLICIT_ROOT_DEEP_FUNCTIONS, MATCHER_CALLBACK_FUNCTIONS, CONTEXT_DEFAULT_BUILTINS } from "./constants.js";
import { prefixPaths, appendPath, isRootReference, markAbsolute, isNumericIndex } from "./path-utils.js";
import type { FunctionOperations, WalkerOptions, WalkerRuntime } from "./runtime.js";

const DEFAULT_OPTIONS: WalkerOptions = { opaqueFunctions: new Set() };

export function createFunctionOperations(
  runtime: WalkerRuntime,
  options: WalkerOptions = DEFAULT_OPTIONS,
): FunctionOperations {
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
      const firstStep = (node as PathNode).steps[0];
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
    if (!["lookup", "each", "sift"].includes(funcName) || args.length !== 1) {
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
    if (node.rhs.type === "variable") {
      const procedure = node.rhs as VariableNode;
      return {
        type: "function",
        value: "(",
        position: procedure.position,
        procedure,
        arguments: [node.lhs],
      };
    }
    return null;
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
      ...runtime.core.walkNode(procedure.condition, scope),
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
                ? runtime.core.walkNode((stage as unknown as FilterStage).expr, scope)
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
              suffixBasePaths.length > 0 ? suffixBasePaths : [resolvedPath],
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
            suffixBasePaths.length > 0 ? suffixBasePaths : variableBasePaths,
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
    if (node.type === "lambda" && (node as LambdaNode).thunk) {
      return walkCallableSelection((node as LambdaNode).body, scope);
    }
    if (node.type === "variable") {
      return ((node as VariableNode).predicate ?? []).flatMap((stage) =>
        stage.type === "filter" &&
        !isNumericIndex((stage as unknown as FilterStage).expr)
          ? runtime.core.walkNode((stage as unknown as FilterStage).expr, scope)
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
        ...runtime.core.walkNode(condition.condition, scope),
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
      const [first, ...suffixSteps] = path.steps;
      const producedByProjection =
        runtime.callables.pathProjectionCallableValues(path, scope).length > 0 ||
        runtime.callables.pathProjectionBuiltinCallableNames(path, scope).length > 0;
      const producedByGroup =
        runtime.callables.groupedPathCallableValues(path, scope).length > 0 ||
        runtime.callables.groupedPathBuiltinCallableNames(path, scope).length > 0;
      const producedByTransform =
        first?.type === "function" &&
        (runtime.transforms.transformUpdateCallableValues(
          first as FunctionNode,
          suffixSteps,
          scope,
        ).length > 0 ||
          runtime.transforms.transformUpdateBuiltinCallableNames(
            first as FunctionNode,
            suffixSteps,
            scope,
          ).length > 0);
      const producedByHigherOrder =
        first?.type === "function" &&
        (runtime.callables.higherOrderResultCallableValues(
          first as FunctionNode,
          scope,
          suffixSteps,
        ).length > 0 ||
          runtime.callables.higherOrderResultBuiltinCallableNames(
            first as FunctionNode,
            scope,
            suffixSteps,
          ).length > 0);
      const producedByCustomFunction =
        first?.type === "function" &&
        (runtime.callables.customFunctionResultCallableValues(
          first as FunctionNode,
          scope,
          suffixSteps,
        ).length > 0 ||
          runtime.callables.customFunctionResultBuiltinCallableNames(
            first as FunctionNode,
            scope,
            suffixSteps,
          ).length > 0);
      const groupSource = { ...path, group: undefined } as PathNode;
      const groupedCallableSource =
        producedByGroup &&
        (runtime.callables.resolveCallableValues(groupSource, scope).length > 0 ||
          runtime.callables.resolveBuiltinCallableNames(groupSource, scope).length > 0);
      const producerPaths =
        producedByTransform || producedByHigherOrder || producedByCustomFunction
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
          return runtime.paths.walkSortTerms(
            step as SortNode,
            buildPathString(path.steps.slice(0, index)) ?? "",
            scope,
          );
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
    if (!["function", "block", "path"].includes(node.procedure.type)) return [];
    const producer = node.procedure;
    const paths = walkCallableSelection(producer, scope);
    const callables = runtime.callables.resolveCallableValues(producer, scope);
    const builtinNames = callables.length === 0
      ? runtime.callables.resolveBuiltinCallableNames(producer, scope)
      : [];
    if (callables.length === 0 && builtinNames.length === 0) {
      return [...paths, ...node.arguments.flatMap((arg) => runtime.core.walkNode(arg, scope))];
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
            procedure: { type: "variable", value: name, position: node.position },
          },
          scope,
        ),
      );
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
   * 1. Higher-order built-in ($map, $filter, etc.) -- bind lambda params to data arg paths
   * 2. Custom function call ($fn bound to lambda in scope) -- trace args into lambda body
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
        ...runtime.core.walkNode(node.procedure.condition, scope),
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
    const storedBuiltinNames = !BUILTIN_FUNCTIONS.has(funcName)
      ? runtime.callables.resolveBuiltinCallableNames(node.procedure, scope)
      : [];
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

    const lambdaBinding = resolveLambda(scope, funcName);
    const partialBinding = resolvePartial(scope, funcName);
    const transformBinding = resolveTransform(scope, funcName);
    const storedCallables = runtime.callables.resolveCallableValues(
      node.procedure,
      scope,
    );
    const walkStoredCallablePaths = (): string[] => {
      const storedPaths = walkCallableSelection(node.procedure, scope);
      for (const callable of storedCallables) {
        if (callable.kind === "transform") {
          storedPaths.push(...runtime.transforms.walkTransformCall(callable.binding, args, scope));
        } else if (callable.kind === "lambda") {
          storedPaths.push(...runtime.higherOrder.walkCustomFunctionCall(callable.binding, args, scope));
        } else {
          storedPaths.push(...runtime.higherOrder.walkPartialCall(callable.binding, args, scope));
        }
      }
      for (const name of storedBuiltinNames) {
        storedPaths.push(
          ...walkFunction(
            {
              ...node,
              procedure: { type: "variable", value: name, position: node.position },
              arguments: args,
              predicate: [],
              group: undefined,
            },
            scope,
          ),
        );
      }
      return storedPaths;
    };
    if (options.opaqueFunctions.has(funcName)) {
      if (lambdaBinding) {
        return withFunctionStages(
          runtime.higherOrder.walkCustomFunctionCall(lambdaBinding, args, scope),
        );
      }
      if (partialBinding) {
        return withFunctionStages(
          runtime.higherOrder.walkPartialCall(partialBinding, args, scope),
        );
      }
      if (transformBinding) {
        return withFunctionStages(
          runtime.transforms.walkTransformCall(transformBinding, args, scope),
        );
      }
      if (storedCallables.length > 0 || storedBuiltinNames.length > 0) {
        return withFunctionStages(walkStoredCallablePaths());
      }
      return withFunctionStages(
        args.flatMap((argument) => runtime.core.walkNode(argument, scope)),
      );
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
      paths.push(...explicitContextPaths.map((path) => appendPath(path, "*")));
    }
    if (
      args.length > 0 &&
      explicitContextPaths &&
      IMPLICIT_ROOT_DEEP_FUNCTIONS.has(funcName)
    ) {
      paths.push(...explicitContextPaths.map((path) => appendPath(path, "**")));
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
          paths.push(...identityPaths.map((path) => appendPath(path, "*")));
        }
      }
    }
  
    // Step 1: Check if this is a known higher-order function
    const semantics = HIGHER_ORDER_SEMANTICS[funcName];
    if (semantics) {
      return withFunctionStages(
        runtime.higherOrder.walkHigherOrderCall({ ...node, arguments: args }, semantics, scope),
      );
    }
  
    // Step 2: Check if this is a custom function call (lambda bound in scope)
    if (lambdaBinding) {
      return withFunctionStages(runtime.higherOrder.walkCustomFunctionCall(lambdaBinding, args, scope));
    }
  
    if (partialBinding) {
      return withFunctionStages(runtime.higherOrder.walkPartialCall(partialBinding, args, scope));
    }
  
    if (transformBinding) {
      return withFunctionStages(runtime.transforms.walkTransformCall(transformBinding, args, scope));
    }
  
    if (storedCallables.length > 0 || storedBuiltinNames.length > 0) {
      return withFunctionStages(walkStoredCallablePaths());
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
      if (callableArguments.length > 0) {
        paths.push(...walkCallableSelection(arg, scope));
        const generatedArgument: AstNode = {
          type: "value",
          value: null,
          position: node.position,
        };
        for (const callable of callableArguments) {
          if (callable.kind === "lambda") {
            paths.push(
              ...runtime.higherOrder.walkCustomFunctionCall(
                callable.binding,
                [generatedArgument],
                scope,
              ),
            );
          } else if (callable.kind === "partial") {
            paths.push(
              ...runtime.higherOrder.walkPartialCall(
                callable.binding,
                [generatedArgument],
                scope,
              ),
            );
          }
        }
        continue;
      }
      if (arg.type === "lambda") {
        // Walk lambda body with current scope (closure capture)
        const lambda = arg as LambdaNode;
        const lambdaScope = childScope(scope);
        paths.push(...runtime.core.walkNode(lambda.body, lambdaScope));
      } else {
        paths.push(...runtime.core.walkNode(arg, scope));
      }
    }
  
    if (funcName === "eval") {
      paths.push(...walkStaticEval(args, scope));
    }
  
    if (funcName === "lookup") {
      paths.push(...runtime.results.getLookupResultBasePaths(args, scope));
    }
  
    return withFunctionStages(paths);
  }

  function walkStaticEval(args: AstNode[], scope: ScopeTracker): string[] {
    const expression = getStaticEvalExpression(args);
    if (!expression) {
      return args[0]?.type === "string" ? [] : markAbsolute(["**"]);
    }
  
    const evalScope = getStaticEvalScope(args, scope);
    if (
      runtime.callables.resolveCallableValues(expression, evalScope).length > 0 ||
      runtime.callables.resolveBuiltinCallableNames(expression, evalScope).length > 0
    ) {
      const contextArg = args[1];
      return contextArg
        ? runtime.results.getResultBasePathsFromArg(contextArg, scope).flatMap((basePath) =>
            runtime.paths.walkContextCallableSelection(expression, basePath, scope),
          )
        : walkCallableSelection(expression, scope);
    }
  
    const contextArg = args[1];
    if (!contextArg) return runtime.core.walkNode(expression, scope);
  
    return runtime.results.getResultBasePathsFromArg(contextArg, scope).flatMap((basePath) =>
      runtime.paths.walkContextExpression(expression, basePath, scope),
    );
  }

  function getStaticEvalResultBasePaths(
    args: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const expression = getStaticEvalExpression(args);
    if (!expression) return [];
  
    if (runtime.results.getSuffixableResultBasePaths(expression, scope).length === 0) return [];
    const contextArg = args[1];
    if (!contextArg) return runtime.results.getSuffixableResultBasePaths(expression, scope);
  
    return runtime.results.getResultBasePathsFromArg(contextArg, scope).flatMap((basePath) =>
      runtime.paths.walkContextExpression(expression, basePath, scope),
    );
  }

  function getStaticEvalExpression(args: AstNode[]): AstNode | null {
    const source = args[0];
    if (source?.type !== "string") return null;
  
    try {
      return parse((source as { value: string }).value);
    } catch {
      return null;
    }
  }

  function getStaticEvalScope(
    args: AstNode[],
    scope: ScopeTracker,
  ): ScopeTracker {
    const contextArg = args[1];
    return contextArg
      ? bindVariable(
          childScope(scope),
          "",
          runtime.results.getResultBasePathsFromArg(contextArg, scope),
        )
      : scope;
  }

  function getStaticEvalResultObjectAlias(
    args: AstNode[],
    scope: ScopeTracker,
  ): ObjectAlias | null {
    const expression = getStaticEvalExpression(args);
    if (!expression) return null;
  
    const alias = runtime.aliases.groupResultObjectAliasForNode(expression, scope);
    if (!alias) return null;
    const contextArg = args[1];
    if (!contextArg) return alias;
  
    return runtime.aliases.mergeObjectAliases(
      runtime.results.getResultBasePathsFromArg(contextArg, scope).map((basePath) =>
        runtime.aliases.prefixObjectAlias(alias, basePath),
      ),
    );
  }

  function getStaticEvalResultDynamicObjectAlias(
    args: AstNode[],
    scope: ScopeTracker,
  ): DynamicObjectAlias | null {
    const expression = getStaticEvalExpression(args);
    const alias = expression
      ? runtime.aliases.groupResultDynamicObjectAliasForNode(expression, scope)
      : null;
    if (!alias || !args[1]) return alias;
    return runtime.higherOrder.prefixDynamicObjectAlias(
      alias,
      runtime.results.getResultBasePathsFromArg(args[1], scope),
    );
  }

  function walkFunctionPredicates(node: FunctionNode, scope: ScopeTracker): string[] {
    if (!node.predicate || node.predicate.length === 0) return [];
  
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
      return node.predicate.flatMap((stage) =>
        stage.type === "filter"
          ? runtime.aliases.selectAliasExpressionPaths(
              objectAlias,
              dynamicObjectAlias,
              (stage as unknown as FilterStage).expr,
              predicateScope,
              suffixBasePaths,
            )
          : [],
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
  
    const appliedFunction = appliedFunctionFromApply(node);
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
      if (transformBasePaths.includes(ROOT_PATH)) paths.push("**");
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
    appliedFunctionFromApply,
    isPlaceholder,
    walkPartial,
    walkVariable,
    walkLambda,
    walkCallableSelection,
    conditionalProcedureCalls,
    walkFunction,
    getStaticEvalResultBasePaths,
    getStaticEvalExpression,
    getStaticEvalScope,
    getStaticEvalResultObjectAlias,
    getStaticEvalResultDynamicObjectAlias,
    walkApply,
  };
}
