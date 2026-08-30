import type { ArrayNode, AstNode, ApplyNode, BlockNode, DescendantNode, FilterStage, FunctionNode, GroupByNode, LambdaNode, NameNode, ObjectNode, ParentNode, PathNode, PositionBindingNode, SortNode, VariableNode, WildcardNode } from "../types.js";
import { buildPathString } from "../path-builder.js";
import { type ScopeTracker, createScope, childScope, bindVariable, resolveLambda, resolveVariable, resolveSuffixBasePaths, resolveObjectAlias, resolveDynamicObjectAlias, type DynamicObjectAlias, type ObjectAlias } from "../scope.js";
import { ROOT_PATH, UNRESOLVED_PATH } from "./constants.js";
import { prefixPaths, prefixProjectionPaths, appendPath, resolveParentPathSegments, isRootReference, markAbsolute, parentPath, collectVariableNames, isNumericIndex, isTransparentPathBlock, flattenTransparentPathBlocks, buildProjectionContextPath, hasPendingProjectionFocusReset } from "./path-utils.js";
import type { PathOperations, WalkerRuntime } from "./runtime.js";

export function createPathOperations(runtime: WalkerRuntime): PathOperations {
  const contextDefaultLambdaCache = new WeakMap<AstNode, boolean>();
  const builtinContextDefaultCallCache = new WeakMap<AstNode, boolean>();
  const contextDefaultCallCache = new WeakMap<AstNode, WeakMap<object, boolean>>();
  function walkContextExpression(
    expr: AstNode,
    contextPrefix: string,
    scope: ScopeTracker,
    stageVariables: ReadonlySet<string> = new Set(),
    keepBarePathsRootRelative = false,
  ): string[] {
    const localPaths = runtime.core.walkNode(expr, childScope(createScope()));
    const localSet = new Set(localPaths);
  
    const variables = collectVariableNames(expr);
    const usesCurrentContext =
      variables.has("") ||
      containsContextDefaultLambda(expr) ||
      containsContextDefaultCall(expr, scope) ||
      containsBuiltinContextDefaultCall(expr) ||
      runtime.functions.resultUsesContextDefault(expr, scope);
    if (usesCurrentContext && contextPrefix) {
      const contextScope = bindVariable(childScope(scope), "", [contextPrefix]);
      const contextPaths = runtime.core.walkNode(expr, contextScope);
      if (keepBarePathsRootRelative && stageVariables.size > 0) {
        return contextPaths;
      }
      return contextPaths.flatMap((path) =>
        localSet.has(path) ? prefixPaths(contextPrefix, [path]) : [path],
      );
    }
  
    const hasStageVariable = [...variables].some((name) => stageVariables.has(name));
    if (keepBarePathsRootRelative && stageVariables.size > 0) {
      return hasStageVariable ? runtime.core.walkNode(expr, scope) : [...localPaths];
    }
  
    const paths = prefixPaths(contextPrefix, localPaths);
    for (const scopedPath of runtime.core.walkNode(expr, scope)) {
      if (!localSet.has(scopedPath)) paths.push(scopedPath);
    }
  
    return paths;
  }

  function walkContextCallableSelection(
    expr: AstNode,
    contextPrefix: string,
    scope: ScopeTracker,
  ): string[] {
    const localPaths = runtime.functions.walkCallableSelection(expr, childScope(createScope()));
    const localSet = new Set(localPaths);
    const usesCurrentContext = collectVariableNames(expr).has("");
  
    if (usesCurrentContext && contextPrefix) {
      const contextScope = bindVariable(childScope(scope), "", [contextPrefix]);
      return runtime.functions.walkCallableSelection(expr, contextScope).flatMap((path) =>
        localSet.has(path) ? prefixPaths(contextPrefix, [path]) : [path],
      );
    }
  
    const paths = prefixPaths(contextPrefix, localPaths);
    for (const scopedPath of runtime.functions.walkCallableSelection(expr, scope)) {
      if (!localSet.has(scopedPath)) paths.push(scopedPath);
    }
    return paths;
  }

  function containsContextDefaultLambda(node: AstNode): boolean {
    const cached = contextDefaultLambdaCache.get(node);
    if (cached !== undefined) return cached;
    contextDefaultLambdaCache.set(node, false);

    if (
      node.type === "lambda" &&
      runtime.higherOrder.contextDefaultParameterIndex(node as LambdaNode) >= 0
    ) {
      contextDefaultLambdaCache.set(node, true);
      return true;
    }
  
    for (const [key, value] of Object.entries(node)) {
      if (key === "source") continue;
      if (Array.isArray(value)) {
        if (
          value.some(
            (item) =>
              item &&
              typeof item === "object" &&
              containsContextDefaultLambda(item as AstNode),
          )
        ) {
          contextDefaultLambdaCache.set(node, true);
          return true;
        }
      } else if (
        value &&
        typeof value === "object" &&
        containsContextDefaultLambda(value as AstNode)
      ) {
        contextDefaultLambdaCache.set(node, true);
        return true;
      }
    }
    return false;
  }

  function containsContextDefaultCall(
    node: AstNode,
    scope: ScopeTracker,
  ): boolean {
    let environmentCache = contextDefaultCallCache.get(node);
    const cached = environmentCache?.get(scope.callableEnvironment);
    if (cached !== undefined) return cached;
    if (!environmentCache) {
      environmentCache = new WeakMap();
      contextDefaultCallCache.set(node, environmentCache);
    }
    environmentCache.set(scope.callableEnvironment, false);

    if (node.type === "function") {
      const functionNode = node as FunctionNode;
      const binding =
        functionNode.procedure.type === "lambda"
          ? { lambda: functionNode.procedure, scope }
          : functionNode.procedure.type === "variable"
            ? resolveLambda(scope, functionNode.procedure.value)
            : null;
      if (
        binding &&
        runtime.higherOrder.contextDefaultParameterIndex(binding.lambda) >= 0 &&
        functionNode.arguments.length < binding.lambda.arguments.length
      ) {
        environmentCache.set(scope.callableEnvironment, true);
        return true;
      }
    }
  
    for (const [key, value] of Object.entries(node)) {
      if (key === "source") continue;
      if (Array.isArray(value)) {
        if (
          value.some(
            (item) =>
              item &&
              typeof item === "object" &&
              containsContextDefaultCall(item as AstNode, scope),
          )
        ) {
          environmentCache.set(scope.callableEnvironment, true);
          return true;
        }
      } else if (
        value &&
        typeof value === "object" &&
        containsContextDefaultCall(value as AstNode, scope)
      ) {
        environmentCache.set(scope.callableEnvironment, true);
        return true;
      }
    }
    return false;
  }

  function containsBuiltinContextDefaultCall(node: AstNode): boolean {
    const cached = builtinContextDefaultCallCache.get(node);
    if (cached !== undefined) return cached;
    builtinContextDefaultCallCache.set(node, false);

    if (
      node.type === "function" &&
      (node as FunctionNode).procedure.type === "variable" &&
      runtime.functions.builtinUsesContextDefault(
        ((node as FunctionNode).procedure as VariableNode).value,
        (node as FunctionNode).arguments,
      )
    ) {
      builtinContextDefaultCallCache.set(node, true);
      return true;
    }
  
    for (const [key, value] of Object.entries(node)) {
      if (key === "source") continue;
      if (Array.isArray(value)) {
        if (
          value.some(
            (item) =>
              item &&
              typeof item === "object" &&
              containsBuiltinContextDefaultCall(item as AstNode),
          )
        ) {
          builtinContextDefaultCallCache.set(node, true);
          return true;
        }
      } else if (
        value &&
        typeof value === "object" &&
        containsBuiltinContextDefaultCall(value as AstNode)
      ) {
        builtinContextDefaultCallCache.set(node, true);
        return true;
      }
    }
    return false;
  }

  /**
   * Extract paths from a path node's steps, handling variable steps,
   * filter stages on name steps, sort steps, and group-by expressions.
   */
  function walkPath(node: PathNode, scope: ScopeTracker): string[] {
    if (node.steps.length === 0) return [];

    if (
      !node.group &&
      node.steps.every(
        (step) =>
          step.type === "name" &&
          !(step as NameNode).stages?.length &&
          !(step as NameNode).focusBinding &&
          !(step as NameNode).indexBinding,
      )
    ) {
      return [node.steps.map((step) => (step as NameNode).value).join(".")];
    }
  
    const transparentBlockCount = node.steps.filter(isTransparentPathBlock).length;
    const transparentSteps = flattenTransparentPathBlocks(node.steps);
    if (
      isTransparentPathBlock(node.steps[0]) &&
      transparentBlockCount >= 2 &&
      transparentSteps
    ) {
      return walkPath({ ...node, steps: transparentSteps }, scope);
    }
  
    const storedCallableFunctionIndex = node.steps.findIndex(
      (step, index) =>
        index > 0 && step.type === "function" &&
        (step as FunctionNode).procedure.type === "path",
    );
    if (storedCallableFunctionIndex > 0) {
      const functionStep = node.steps[storedCallableFunctionIndex] as FunctionNode;
      const procedure = {
        ...(functionStep.procedure as PathNode),
        steps: [
          ...node.steps.slice(0, storedCallableFunctionIndex),
          ...(functionStep.procedure as PathNode).steps,
        ],
      } as PathNode;
      if (runtime.callables.resolveCallableValues(procedure, scope).length > 0) {
        return walkPath(
          {
            ...node,
            steps: [
              { ...functionStep, procedure },
              ...node.steps.slice(storedCallableFunctionIndex + 1),
            ],
          },
          scope,
        );
      }
    }
  
    let stageScope = childScope(scope);
    const stageVariables = new Set<string>();
    const nonPathVariables = new Set<string>();
  
    const firstStep = node.steps[0];
    const capturedCurrentPaths =
      firstStep.type === "variable" && (firstStep as VariableNode).value === ""
        ? resolveVariable(scope, "")
        : null;
    if (capturedCurrentPaths && capturedCurrentPaths.length > 0) {
      const currentStep = firstStep as VariableNode;
      const suffixSteps = node.steps.slice(1);
      const suffix = buildPathString(suffixSteps);
      const paths = capturedCurrentPaths.map((path) => appendPath(path, suffix));
      for (const capturedPath of capturedCurrentPaths) {
        paths.push(
          ...walkFilterStages(
            currentStep.predicate ?? [],
            capturedPath,
            scope,
          ),
          ...walkResolvedVariableSuffixFilterStages(
            suffixSteps,
            capturedPath,
            scope,
            new Set(),
          ),
          ...runtime.aliases.walkResultBaseSuffixProjectionSteps(
            [capturedPath],
            suffixSteps,
            scope,
          ).map(resolveParentPathSegments),
          ...runtime.aliases.walkResultBaseSuffixFunctionSteps(
            [capturedPath],
            suffixSteps,
            scope,
          ),
        );
      }
      return paths;
    }
    if (capturedCurrentPaths !== null) return [];
  
    if (isRootReference(node.steps[0])) {
      const rootStep = node.steps[0] as VariableNode;
      let rootScope = childScope(scope);
      if (rootStep.focusBinding) {
        rootScope = bindVariable(rootScope, rootStep.focusBinding.name, [ROOT_PATH]);
        stageVariables.add(rootStep.focusBinding.name);
      }
      if (rootStep.indexBinding) {
        rootScope = bindVariable(rootScope, rootStep.indexBinding.name, []);
        nonPathVariables.add(rootStep.indexBinding.name);
      }
      const stagePaths = walkFilterStages(
        rootStep.predicate ?? [],
        ROOT_PATH,
        rootScope,
        nonPathVariables,
        stageVariables,
      );
      const rootPaths = walkPath(
        { ...node, steps: node.steps.slice(1) },
        rootScope,
      );
      return [
        ...stagePaths,
        ...(rootPaths.length > 0 ? markAbsolute(rootPaths) : [ROOT_PATH]),
      ];
    }
  
    const rootContextStepIndex = node.steps.findIndex(
      (step, index) =>
        index > 0 &&
        step.type === "variable" &&
        (step as VariableNode).value === "$",
    );
    if (rootContextStepIndex >= 0) {
      const rootStep = node.steps[rootContextStepIndex] as VariableNode;
      let rootScope = childScope(scope);
      const rootStageVariables = new Set<string>();
      const rootNonPathVariables = new Set<string>();
      if (rootStep.focusBinding) {
        rootScope = bindVariable(rootScope, rootStep.focusBinding.name, [ROOT_PATH]);
        rootStageVariables.add(rootStep.focusBinding.name);
      }
      if (rootStep.indexBinding) {
        rootScope = bindVariable(rootScope, rootStep.indexBinding.name, []);
        rootNonPathVariables.add(rootStep.indexBinding.name);
      }
      const prefixPaths = walkPath(
        { ...node, steps: node.steps.slice(0, rootContextStepIndex), group: undefined },
        scope,
      );
      const suffixPaths = walkPath(
        { ...node, steps: node.steps.slice(rootContextStepIndex + 1) },
        rootScope,
      );
      return [
        ...prefixPaths,
        ...walkFilterStages(
          rootStep.predicate ?? [],
          ROOT_PATH,
          rootScope,
          rootNonPathVariables,
          rootStageVariables,
        ),
        ...(suffixPaths.length > 0 ? markAbsolute(suffixPaths) : [ROOT_PATH]),
      ];
    }
  
    const initialLookupStep = node.steps[0];
    if (
      initialLookupStep?.type === "function" &&
      (initialLookupStep as FunctionNode).procedure.type === "variable" &&
      ((initialLookupStep as FunctionNode).procedure as VariableNode).value === "lookup" &&
      (initialLookupStep as FunctionNode).arguments.length === 1
    ) {
      const lookup = initialLookupStep as FunctionNode;
      return walkPath(
        {
          ...node,
          steps: [
            {
              ...lookup,
              arguments: runtime.functions.withImplicitRootFunctionArgument(
                "lookup",
                lookup.arguments,
                lookup.position,
              ),
            },
            ...node.steps.slice(1),
          ],
        },
        scope,
      );
    }
  
    const contextDefaultLookupIndex = node.steps.findIndex(
      (step, index) =>
        index > 0 &&
        step.type === "function" &&
        (step as FunctionNode).procedure.type === "variable" &&
        ((step as FunctionNode).procedure as VariableNode).value === "lookup" &&
        (step as FunctionNode).arguments.length === 1,
    );
    if (contextDefaultLookupIndex >= 0) {
      const lookup = node.steps[contextDefaultLookupIndex] as FunctionNode;
      const apply: ApplyNode = {
        type: "apply",
        value: "~>",
        position: lookup.position,
        lhs: {
          ...node,
          steps: node.steps.slice(0, contextDefaultLookupIndex),
          group: undefined,
        },
        rhs: lookup,
      };
      const suffixSteps = node.steps.slice(contextDefaultLookupIndex + 1);
      return suffixSteps.length === 0 && !node.group
        ? runtime.functions.walkApply(apply, scope)
        : walkPath({ ...node, steps: [apply, ...suffixSteps] }, scope);
    }
  
    // Check if any step is an externally scoped variable (e.g., $x.name).
    // Variables introduced by earlier path-stage @/# bindings are handled by the
    // normal path walker below after those bindings are in scope.
    const varStepIndex = runtime.aliases.firstUnboundPathVariableIndex(node.steps);
  
    if (varStepIndex >= 0) {
      const varStep = node.steps[varStepIndex] as VariableNode;
      const objectAlias = resolveObjectAlias(scope, varStep.value);
      const dynamicObjectAlias = resolveDynamicObjectAlias(scope, varStep.value);
      if (objectAlias || dynamicObjectAlias) {
        const suffixBaseBinding = resolveSuffixBasePaths(scope, varStep.value) ?? [];
        const unmatchedSuffixBaseBinding = runtime.aliases.unmatchedAliasSuffixBasePaths(
          objectAlias,
          suffixBaseBinding,
        );
        const aliasScope = varStep.focusBinding
          ? runtime.aliases.bindFocusObjectAliasScope(
              scope,
              varStep.focusBinding.name,
              objectAlias,
              dynamicObjectAlias,
              resolveVariable(scope, varStep.value) ?? [],
              suffixBaseBinding,
            )
          : scope;
        const suffixSteps = node.steps.slice(varStepIndex + 1);
        const objectPaths = runtime.aliases.selectVariableObjectAliasPaths(
          objectAlias,
          dynamicObjectAlias,
          suffixSteps,
          aliasScope,
          unmatchedSuffixBaseBinding,
          Boolean(varStep.focusBinding),
        );
        const variableStagePaths = [
          ...(varStep.predicate ?? []).flatMap((stage) =>
            stage.type === "filter"
              ? runtime.aliases.selectAliasExpressionPaths(
                  objectAlias,
                  dynamicObjectAlias,
                  (stage as unknown as FilterStage).expr,
                  aliasScope,
                  unmatchedSuffixBaseBinding,
                )
              : [],
          ),
          ...(varStep.group
            ? walkAliasGroupEntries(
                varStep.group,
                objectAlias,
                dynamicObjectAlias,
                aliasScope,
                unmatchedSuffixBaseBinding,
              )
            : []),
        ];
        const suffixStagePaths = runtime.aliases.walkAliasSuffixFilterStages(
          suffixSteps,
          objectAlias,
          dynamicObjectAlias,
          aliasScope,
          suffixBaseBinding,
          Boolean(varStep.focusBinding),
        );
        const suffixSortPaths = runtime.aliases.walkAliasSuffixSortTerms(
          suffixSteps,
          objectAlias,
          dynamicObjectAlias,
          aliasScope,
          unmatchedSuffixBaseBinding,
          Boolean(varStep.focusBinding),
        );
        const suffixProjectionPaths = runtime.aliases.walkAliasSuffixProjectionSteps(
          suffixSteps,
          objectAlias,
          dynamicObjectAlias,
          aliasScope,
          suffixBaseBinding,
          Boolean(varStep.focusBinding),
        );
        const suffixFunctionPaths = runtime.aliases.walkAliasSuffixFunctionSteps(
          suffixSteps,
          objectAlias,
          dynamicObjectAlias,
          aliasScope,
          suffixBaseBinding,
        );
        const suffix = buildPathString(suffixSteps);
        const suffixBasePaths =
          suffix && unmatchedSuffixBaseBinding.length > 0
            ? unmatchedSuffixBaseBinding.map((path) => appendPath(path, suffix))
            : [];
        const selectedObjectPaths = objectPaths ?? [];
        const suffixBaseRoots = new Set(unmatchedSuffixBaseBinding);
        const groupBasePaths = [
          ...selectedObjectPaths.filter((path) => !suffixBaseRoots.has(path)),
          ...suffixBasePaths,
        ];
        const suffixGroupPaths = node.group
          ? suffixSteps.every((step) => step.type === "sort")
            ? walkAliasGroupEntries(
                node.group,
                objectAlias,
                dynamicObjectAlias,
                aliasScope,
                unmatchedSuffixBaseBinding,
              )
            : runtime.aliases.walkAliasSuffixGroupEntries(
                node.group,
                groupBasePaths,
                objectAlias,
                dynamicObjectAlias,
                aliasScope,
                suffixBaseBinding,
                Boolean(varStep.focusBinding),
              )
          : [];
        return [
          ...variableStagePaths,
          ...suffixStagePaths,
          ...suffixSortPaths,
          ...suffixProjectionPaths,
          ...suffixFunctionPaths,
          ...suffixGroupPaths,
          ...selectedObjectPaths,
          ...suffixBasePaths,
        ];
      }
  
      const resolved = resolveVariable(scope, varStep.value);
  
      if (resolved && resolved.length > 0) {
        const paths: string[] = [];
        const resolvedSuffixBases = [
          ...(resolveSuffixBasePaths(scope, varStep.value) ?? []),
        ];
        const suffixContextPaths =
          resolvedSuffixBases.length > 0 ? resolvedSuffixBases : [...resolved];
  
        // Inspect predicates on the resolved VariableNode for ADV-02 wildcard emission
        const predicates = varStep.predicate;
        if (predicates && predicates.length > 0) {
          for (const resolvedPath of suffixContextPaths) {
            let predicateScope = scope;
            const predicateStageVariables = new Set<string>();
            const predicateNonPathVariables = new Set<string>();
            if (varStep.focusBinding) {
              predicateScope = bindVariable(
                childScope(scope),
                varStep.focusBinding.name,
                [resolvedPath],
              );
              predicateStageVariables.add(varStep.focusBinding.name);
            }
            if (varStep.indexBinding) {
              if (predicateScope === scope) predicateScope = childScope(predicateScope);
              predicateScope = bindVariable(predicateScope, varStep.indexBinding.name, []);
              predicateNonPathVariables.add(varStep.indexBinding.name);
            }
            paths.push(
              ...walkFilterStages(
                predicates,
                resolvedPath,
                predicateScope,
                predicateNonPathVariables,
                predicateStageVariables,
              ),
            );
          }
        }
  
        // Build suffix from remaining steps after the variable
        const suffixSteps = node.steps.slice(varStepIndex + 1);
        const suffix = buildPathString(suffixSteps);
        let handledFocusProjection = false;
        const suffixScopeFor = (resolvedPath: string) => {
          let suffixScope = scope;
          const suffixStageVariables = new Set([varStep.value]);
  
          if (varStep.focusBinding) {
            suffixScope = bindVariable(
              childScope(scope),
              varStep.focusBinding.name,
              [resolvedPath],
            );
            suffixStageVariables.add(varStep.focusBinding.name);
          }
          if (varStep.indexBinding) {
            if (suffixScope === scope) suffixScope = childScope(suffixScope);
            suffixScope = bindVariable(suffixScope, varStep.indexBinding.name, []);
          }
  
          return { suffixScope, suffixStageVariables };
        };
  
        if (varStep.focusBinding) {
          const projectionStepIndex = suffixSteps.findIndex(runtime.aliases.isResultAliasStep);
          if (projectionStepIndex >= 0) {
            handledFocusProjection = true;
            for (const resolvedPath of resolved) {
              const focusScope = bindVariable(
                childScope(scope),
                varStep.focusBinding.name,
                [resolvedPath],
              );
              const projectionPaths = runtime.aliases.selectResultAliasStepPaths(
                suffixSteps[projectionStepIndex],
                suffixSteps.slice(projectionStepIndex + 1),
                focusScope,
              );
              if (projectionPaths) paths.push(...projectionPaths);
            }
          }
        }
  
        // Concatenate resolved paths with suffix
        if (!handledFocusProjection) {
          paths.push(...suffixContextPaths.map((p) => appendPath(p, suffix)));
        }
  
        for (const resolvedPath of suffixContextPaths) {
          const { suffixScope, suffixStageVariables } = suffixScopeFor(resolvedPath);
          paths.push(
            ...walkResolvedVariableSuffixFilterStages(
              suffixSteps,
              resolvedPath,
              suffixScope,
              suffixStageVariables,
            ),
          );
        }
  
        for (const resolvedPath of suffixContextPaths) {
          const { suffixScope, suffixStageVariables } = suffixScopeFor(resolvedPath);
          paths.push(
            ...walkResolvedVariableSuffixSortTerms(
              suffixSteps,
              resolvedPath,
              suffixScope,
              suffixStageVariables,
            ),
          );
        }
  
        for (const resolvedPath of suffixContextPaths) {
          const { suffixScope } = suffixScopeFor(resolvedPath);
          paths.push(
            ...runtime.aliases.walkResultBaseSuffixProjectionSteps(
              [resolvedPath],
              suffixSteps,
              suffixScope,
            ).map(resolveParentPathSegments),
          );
        }
  
        for (const resolvedPath of suffixContextPaths) {
          const { suffixScope } = suffixScopeFor(resolvedPath);
          paths.push(
            ...runtime.aliases.walkResultBaseSuffixFunctionSteps([resolvedPath], suffixSteps, suffixScope),
          );
        }
  
        if (node.group) {
          for (const resolvedPath of suffixContextPaths) {
            const suffixBase = buildPathString(suffixSteps) ?? "";
            const { suffixScope, suffixStageVariables } = suffixScopeFor(resolvedPath);
            paths.push(
              ...walkContextGroupEntries(
                node.group,
                appendPath(resolvedPath, suffixBase),
                suffixScope,
                suffixStageVariables,
              ).map(resolveParentPathSegments),
            );
          }
        }
  
        return paths;
      }
      // The variable itself is not an input alias, but later path stages can
      // still contain independent root reads (for example an object projection
      // from an opaque scalar function result). Analyze those stages against an
      // unknown base instead of dropping the complete path expression.
      const unresolvedSuffixSteps = node.steps.slice(varStepIndex + 1);
      return [
        ...walkFilterStages(
          varStep.predicate ?? [],
          UNRESOLVED_PATH,
          scope,
        ),
        ...walkResolvedVariableSuffixFilterStages(
          unresolvedSuffixSteps,
          UNRESOLVED_PATH,
          scope,
          new Set(),
        ),
        ...walkResolvedVariableSuffixSortTerms(
          unresolvedSuffixSteps,
          UNRESOLVED_PATH,
          scope,
          new Set(),
        ),
        ...runtime.aliases
          .walkResultBaseSuffixProjectionSteps(
            [UNRESOLVED_PATH],
            unresolvedSuffixSteps,
            scope,
          )
          .map(resolveParentPathSegments),
        ...runtime.aliases.walkResultBaseSuffixFunctionSteps(
          [UNRESOLVED_PATH],
          unresolvedSuffixSteps,
          scope,
        ),
        ...(node.group
          ? walkContextGroupEntries(
              node.group,
              UNRESOLVED_PATH,
              scope,
            ).map(resolveParentPathSegments)
          : []),
      ];
    }
  
    // Build the base path first (existing behavior).
    // When a path terminates with a block step (e.g., items.(expr)), suppress
    // the base path -- the block is a pure projection whose inner expressions
    // fully describe the accessed paths once prefixed.
    const paths: string[] = [];
    const lastStep = node.steps[node.steps.length - 1];
    const suppressBase = lastStep?.type === "block" || lastStep?.type === "function";
    const basePath = buildPathString(node.steps);
    const resultAliasStepIndex = node.steps.findIndex(
      (step, index) => index < node.steps.length - 1 && runtime.aliases.isResultAliasStep(step),
    );
    const funcStepIndex = node.steps.findIndex((s) => s.type === "function");
    let skipFunctionResultSuffixStages = false;
    let resultAliasSuffixStageStart = -1;
    let skipResultAliasGroupBy = false;
    let localVariableSuffixStart = -1;
    const referencedVariables = collectVariableNames(node);
    if (
      (resultAliasStepIndex === 0 &&
        (node.steps[0]?.type === "function" ||
          (node.steps[0]?.type === "block" &&
            !runtime.aliases.objectAliasForNode(node.steps[0], scope) &&
            !runtime.aliases.dynamicObjectAliasForNode(node.steps[0], scope)))) ||
      (basePath && resultAliasStepIndex >= 0)
    ) {
      if (resultAliasStepIndex === 0) {
        const resultStep = node.steps[resultAliasStepIndex];
        const suffixSteps = node.steps.slice(resultAliasStepIndex + 1);
        const contextPrefix = buildPathString(node.steps.slice(0, resultAliasStepIndex)) ?? "";
        const hasResultAlias = Boolean(
          runtime.aliases.objectAliasForNode(resultStep, scope) ||
            runtime.aliases.dynamicObjectAliasForNode(resultStep, scope),
        );
        const resultPaths = runtime.aliases.selectResultAliasStepPaths(
          resultStep,
          suffixSteps,
          scope,
        );
        if (resultPaths) paths.push(...prefixProjectionPaths(contextPrefix, resultPaths));
        const aliasSuffixStagePaths = runtime.aliases.walkResultAliasSuffixStages(
          resultStep,
          suffixSteps,
          node.group,
          scope,
        );
        if (hasResultAlias) {
          paths.push(...aliasSuffixStagePaths);
          resultAliasSuffixStageStart = resultAliasStepIndex;
          skipResultAliasGroupBy = Boolean(node.group);
        }
        if (!hasResultAlias) {
          const resultBasePaths = runtime.aliases.pathResultAliasContextBasePaths(
            { ...node, steps: [resultStep], group: undefined },
            scope,
          );
          const resultBaseSuffixStagePaths = runtime.aliases.walkResultBaseSuffixStages(
            resultBasePaths,
            suffixSteps,
            node.group,
            scope,
          );
          if (resultBaseSuffixStagePaths.length > 0) {
            paths.push(...resultBaseSuffixStagePaths);
            resultAliasSuffixStageStart = resultAliasStepIndex;
            skipResultAliasGroupBy = Boolean(node.group);
          }
        }
        if (resultStep.type === "function" && !hasResultAlias) {
          const resultBasePaths = runtime.results.getFunctionResultBasePaths(
            resultStep as FunctionNode,
            scope,
          );
          for (const resultBasePath of resultBasePaths) {
            paths.push(
              ...walkResolvedVariableSuffixFilterStages(
                node.steps.slice(resultAliasStepIndex + 1),
                resultBasePath,
                scope,
                new Set(),
              ),
            );
          }
          skipFunctionResultSuffixStages = resultBasePaths.length > 0;
        }
      }
    } else if (basePath && funcStepIndex >= 0 && funcStepIndex < node.steps.length - 1) {
      // basePath is relative to the function result (e.g., "quantity" from $lookup(...).quantity)
      // Prefix it with the first argument path to produce the chained data path (e.g., "inventory.quantity")
      const funcStep = node.steps[funcStepIndex] as FunctionNode;
      const functionSuffixSteps = node.steps.slice(funcStepIndex + 1);
      const suffixIsTransformOutput = runtime.transforms.transformWritesSuffix(
        funcStep,
        functionSuffixSteps,
        scope,
      );
      const resultBasePaths = runtime.results.getFunctionResultBasePaths(funcStep, scope);
      if (resultBasePaths.length > 0) {
        for (const resultBasePath of resultBasePaths) {
          if (!suffixIsTransformOutput) {
            paths.push(...prefixPaths(resultBasePath, [basePath]));
          }
          paths.push(
            ...walkResolvedVariableSuffixFilterStages(
              functionSuffixSteps,
              resultBasePath,
              scope,
              new Set(),
            ),
          );
        }
        skipFunctionResultSuffixStages = true;
        // Don't push bare basePath -- it's not a standalone data path
      }
    } else if (basePath && !suppressBase) {
      paths.push(basePath);
    }
  
    // Iterate steps and handle filter stages on name steps, sort steps
    for (let i = 0; i < node.steps.length; i++) {
      if (localVariableSuffixStart >= 0 && i > localVariableSuffixStart) continue;
      const step = node.steps[i];
      const contextPrefix = buildPathString(node.steps.slice(0, i + 1)) ?? "";
  
      if (
        i < node.steps.length - 1 &&
        runtime.aliases.isResultAliasStep(step) &&
        !(i > 0 && runtime.aliases.isResultAliasStep(node.steps[i - 1])) &&
        !(resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart)
      ) {
        const projectionPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
        const usesContextDefault = runtime.functions.resultUsesContextDefault(step, stageScope);
        const resultAliasScope =
          projectionPrefix &&
          (collectVariableNames(step).has("") || usesContextDefault)
            ? bindVariable(childScope(stageScope), "", [projectionPrefix])
            : stageScope;
        const resultPaths = runtime.aliases.selectResultAliasStepPaths(
          step,
          node.steps.slice(i + 1),
          resultAliasScope,
          !(step.type === "block" && projectionPrefix),
        );
        if (resultPaths) {
          paths.push(
            ...(stageVariables.size > 0
              ? resultPaths
              : prefixProjectionPaths(projectionPrefix, resultPaths)),
          );
        }
        if (resultAliasSuffixStageStart < 0) {
          const suffixSteps = node.steps.slice(i + 1);
          const suffixGroupNode = suffixSteps.some((suffixStep) => suffixStep.type === "sort")
            ? undefined
            : node.group;
          const aliasSuffixStagePaths = runtime.aliases.walkResultAliasSuffixStages(
            step,
            suffixSteps,
            suffixGroupNode,
            resultAliasScope,
          );
          if (aliasSuffixStagePaths.length > 0) {
            paths.push(
              ...(stageVariables.size > 0
                ? aliasSuffixStagePaths
                : prefixProjectionPaths(projectionPrefix, aliasSuffixStagePaths)),
            );
            resultAliasSuffixStageStart = i;
            skipResultAliasGroupBy = Boolean(suffixGroupNode);
          }
        }
      }
  
      if (step.type === "name") {
        const nameStep = step as NameNode;
        if (nameStep.focusBinding) {
          stageScope = bindVariable(
            stageScope,
            nameStep.focusBinding.name,
            contextPrefix ? [contextPrefix] : [],
          );
          stageVariables.add(nameStep.focusBinding.name);
          if (!referencedVariables.has(nameStep.focusBinding.name) && contextPrefix) {
            paths.push(contextPrefix);
          }
        }
        if (nameStep.indexBinding) {
          stageScope = bindVariable(stageScope, nameStep.indexBinding.name, []);
          nonPathVariables.add(nameStep.indexBinding.name);
        }
        if (
          nameStep.stages &&
          nameStep.stages.length > 0 &&
          !(skipFunctionResultSuffixStages && i > funcStepIndex) &&
          !(resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart)
        ) {
          paths.push(
            ...walkFilterStages(
              nameStep.stages!,
              nameStep.focusBinding ? parentPath(contextPrefix) : contextPrefix,
              stageScope,
              nonPathVariables,
              stageVariables,
            ),
          );
        }
      } else if (step.type === "variable" && (step as VariableNode).value === "") {
        const contextStep = step as VariableNode;
        if (contextStep.focusBinding) {
          stageScope = bindVariable(
            stageScope,
            contextStep.focusBinding.name,
            contextPrefix ? [contextPrefix] : [],
          );
          stageVariables.add(contextStep.focusBinding.name);
        }
        if (contextStep.indexBinding) {
          stageScope = bindVariable(stageScope, contextStep.indexBinding.name, []);
          nonPathVariables.add(contextStep.indexBinding.name);
        }
        paths.push(
          ...walkFilterStages(
            contextStep.predicate ?? [],
            contextPrefix,
            stageScope,
            nonPathVariables,
            stageVariables,
          ),
        );
      } else if (step.type === "variable") {
        if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
          continue;
        }
        const variableStep = step as VariableNode;
        const resolved = resolveVariable(stageScope, variableStep.value);
        if (resolved && resolved.length > 0) {
          const suffixSteps = node.steps.slice(i + 1);
          const suffix = buildPathString(suffixSteps);
          paths.push(...resolved.map((path) => appendPath(path, suffix)));
          for (const resolvedPath of resolved) {
            paths.push(
              ...walkResolvedVariableSuffixFilterStages(
                suffixSteps,
                resolvedPath,
                stageScope,
                stageVariables,
              ),
              ...walkResolvedVariableSuffixSortTerms(
                suffixSteps,
                resolvedPath,
                stageScope,
                stageVariables,
              ),
              ...runtime.aliases.walkResultBaseSuffixProjectionSteps(
                [resolvedPath],
                suffixSteps,
                stageScope,
              ).map(resolveParentPathSegments),
              ...runtime.aliases.walkResultBaseSuffixFunctionSteps(
                [resolvedPath],
                suffixSteps,
                stageScope,
              ),
            );
            if (node.group) {
              paths.push(
                ...walkContextGroupEntries(
                  node.group,
                  appendPath(resolvedPath, suffix),
                  stageScope,
                  stageVariables,
                ),
              );
            }
          }
          if (node.group) skipResultAliasGroupBy = true;
          localVariableSuffixStart = i;
        }
      } else if (step.type === "wildcard") {
        const wildcardStep = step as WildcardNode;
        const wildcardBindings = runtime.core.bindBroadStepScope(
          wildcardStep,
          contextPrefix,
          stageScope,
        );
        stageScope = wildcardBindings.stageScope;
        wildcardBindings.stageVariables.forEach((name) => stageVariables.add(name));
        wildcardBindings.nonPathVariables.forEach((name) =>
          nonPathVariables.add(name),
        );
        if (wildcardStep.predicate && wildcardStep.predicate.length > 0) {
          paths.push(
            ...walkFilterStages(
              wildcardStep.predicate,
              contextPrefix,
              stageScope,
              nonPathVariables,
              stageVariables,
            ),
          );
        }
      } else if (step.type === "descendant") {
        const descendantStep = step as DescendantNode;
        const descendantBindings = runtime.core.bindBroadStepScope(
          descendantStep,
          contextPrefix,
          stageScope,
        );
        stageScope = descendantBindings.stageScope;
        descendantBindings.stageVariables.forEach((name) =>
          stageVariables.add(name),
        );
        descendantBindings.nonPathVariables.forEach((name) =>
          nonPathVariables.add(name),
        );
        if (descendantStep.predicate && descendantStep.predicate.length > 0) {
          paths.push(
            ...walkFilterStages(
              descendantStep.predicate,
              contextPrefix,
              stageScope,
              nonPathVariables,
              stageVariables,
            ),
          );
        }
      } else if (step.type === "parent") {
        const parentStep = step as ParentNode;
        if (parentStep.predicate && parentStep.predicate.length > 0) {
          paths.push(
            ...walkFilterStages(
              parentStep.predicate,
              contextPrefix,
              stageScope,
              nonPathVariables,
              stageVariables,
            ),
          );
        }
      } else if (["string", "number", "value", "regex"].includes(step.type)) {
        const literalStep = step as AstNode & {
          predicate?: AstNode[];
          group?: GroupByNode;
          focusBinding?: { name: string };
          indexBinding?: { name: string };
        };
        if (literalStep.focusBinding) {
          stageScope = bindVariable(
            stageScope,
            literalStep.focusBinding.name,
            [],
          );
          stageVariables.add(literalStep.focusBinding.name);
        }
        if (literalStep.indexBinding) {
          stageScope = bindVariable(stageScope, literalStep.indexBinding.name, []);
          stageVariables.add(literalStep.indexBinding.name);
          nonPathVariables.add(literalStep.indexBinding.name);
        }
        paths.push(
          ...walkSourceLessFilterStages(
            literalStep.predicate ?? [],
            stageScope,
          ),
          ...(literalStep.group
            ? walkSourceLessGroupEntries(literalStep.group, stageScope)
            : []),
        );
      } else if (
        step.type === "partial" ||
        step.type === "lambda" ||
        step.type === "transform"
      ) {
        paths.push(...runtime.core.walkNode(step, stageScope));
      } else if (step.type === "sort") {
        if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
          continue;
        }
        const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
        const aliasStep = node.steps[i - 1];
        const aliasUsesContextDefault = aliasStep
          ? runtime.functions.resultUsesContextDefault(aliasStep, stageScope)
          : false;
        const sortAliasScope =
          contextPrefix && aliasUsesContextDefault
            ? bindVariable(childScope(stageScope), "", [contextPrefix])
            : stageScope;
        const sortStep = step as SortNode;
        if (sortStep.indexBinding) {
          stageScope = bindVariable(stageScope, sortStep.indexBinding.name, []);
          nonPathVariables.add(sortStep.indexBinding.name);
        }
        paths.push(
          ...walkSortTerms(
            sortStep,
            contextPrefix,
            sortAliasScope,
            stageVariables,
            aliasStep && runtime.aliases.isResultAliasStep(aliasStep) ? aliasStep : undefined,
          ),
        );
        paths.push(
          ...walkFilterStages(
            sortStep.predicate ?? [],
            contextPrefix,
            stageScope,
            nonPathVariables,
            stageVariables,
          ),
        );
      } else if (step.type === "object") {
        if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
          continue;
        }
        // Object constructor step in path: orders.items.{"key": val}
        // Walk value expressions and prefix with path up to this step
        const prefixSteps = node.steps.slice(0, i);
        const contextPrefix = buildProjectionContextPath(prefixSteps) ?? "";
        const keepBarePathsRootRelative = hasPendingProjectionFocusReset(prefixSteps);
        const objectStep = step as ObjectNode;
        const aliasPaths =
          i > 0 && runtime.aliases.isResultAliasStep(node.steps[i - 1])
            ? runtime.aliases.selectResultAliasProjectionStepPaths(node.steps[i - 1], step, stageScope)
            : null;
        if (aliasPaths) {
          paths.push(...aliasPaths);
          continue;
        }
        for (const [key, val] of objectStep.entries) {
          paths.push(
            ...walkContextExpression(
              key,
              contextPrefix,
              stageScope,
              stageVariables,
              keepBarePathsRootRelative,
            ),
          );
          paths.push(
            ...walkContextExpression(
              val,
              contextPrefix,
              stageScope,
              stageVariables,
              keepBarePathsRootRelative,
            ),
          );
        }
        if (objectStep.predicate && objectStep.predicate.length > 0) {
          const objectAlias = runtime.aliases.objectConstructorContextAlias(
            objectStep,
            prefixSteps,
            stageScope,
          );
          const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(objectStep, stageScope);
          const resultBasePaths = runtime.aliases.objectConstructorContextBasePaths(
            objectStep,
            contextPrefix,
            stageScope,
          );
          let predicateScope = stageScope;
  
          if (objectStep.focusBinding) {
            predicateScope = runtime.aliases.bindFocusObjectAliasScope(
              predicateScope,
              objectStep.focusBinding.name,
              objectAlias,
              dynamicObjectAlias,
              resultBasePaths,
              [],
            );
          }
          if (objectStep.indexBinding) {
            if (predicateScope === stageScope) predicateScope = childScope(predicateScope);
            predicateScope = bindVariable(
              predicateScope,
              objectStep.indexBinding.name,
              [],
            );
          }
  
          for (const stage of objectStep.predicate) {
            if (stage.type !== "filter") continue;
            paths.push(
              ...runtime.aliases.selectAliasExpressionPaths(
                objectAlias,
                dynamicObjectAlias,
                (stage as unknown as FilterStage).expr,
                predicateScope,
              ),
            );
          }
        }
      } else if (step.type === "array") {
        if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
          continue;
        }
        const contextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
        const arrayStep = step as ArrayNode;
        const aliasPaths =
          i > 0 && runtime.aliases.isResultAliasStep(node.steps[i - 1])
            ? runtime.aliases.selectResultAliasProjectionStepPaths(node.steps[i - 1], step, stageScope)
            : null;
        if (aliasPaths) {
          paths.push(...aliasPaths);
          continue;
        }
        for (const expr of arrayStep.expressions) {
          paths.push(
            ...walkContextExpression(expr, contextPrefix, stageScope, stageVariables, true),
          );
        }
        if (arrayStep.predicate && arrayStep.predicate.length > 0) {
          const resultBasePaths = runtime.aliases.arrayConstructorContextBasePaths(
            arrayStep,
            contextPrefix,
            stageScope,
          );
          let predicateScope = stageScope;
          const predicateStageVariables = new Set(stageVariables);
          const predicateNonPathVariables = new Set(nonPathVariables);
  
          if (arrayStep.focusBinding) {
            predicateScope = runtime.aliases.bindFocusObjectAliasScope(
              predicateScope,
              arrayStep.focusBinding.name,
              runtime.aliases.objectAliasForNode(arrayStep, stageScope),
              runtime.aliases.dynamicObjectAliasForNode(arrayStep, stageScope),
              resultBasePaths,
              resultBasePaths,
            );
            predicateStageVariables.add(arrayStep.focusBinding.name);
          }
          if (arrayStep.indexBinding) {
            if (predicateScope === stageScope) predicateScope = childScope(predicateScope);
            predicateScope = bindVariable(
              predicateScope,
              arrayStep.indexBinding.name,
              [],
            );
            predicateNonPathVariables.add(arrayStep.indexBinding.name);
          }
  
          if (resultBasePaths.length === 0) {
            paths.push(
              ...walkSourceLessFilterStages(
                arrayStep.predicate,
                predicateScope,
              ),
            );
          }
  
          for (const resultBasePath of resultBasePaths) {
            paths.push(
              ...walkFilterStages(
                arrayStep.predicate,
                resultBasePath,
                predicateScope,
                predicateNonPathVariables,
                predicateStageVariables,
              ),
            );
          }
        }
      } else if (step.type === "block") {
        if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
          continue;
        }
        // Block expression step in path: orders.items.(expr)
        // Walk all expressions and prefix with path up to this step
        const prefixSteps = node.steps.slice(0, i);
        const structuralContextPrefix = buildProjectionContextPath(prefixSteps) ?? "";
        const contextPrefix = hasPendingProjectionFocusReset(prefixSteps)
          ? parentPath(structuralContextPrefix)
          : structuralContextPrefix;
        const blockStep = step as BlockNode;
        const blockPathStart = paths.length;
        if (blockStep.expressions.length === 0 && contextPrefix) {
          paths.push(contextPrefix);
        }
        const blockBasePaths = runtime.aliases.blockContextBasePaths(
          blockStep,
          contextPrefix,
          stageScope,
        );
        const blockObjectAlias = runtime.aliases.prefixObjectAlias(
          runtime.aliases.objectAliasForNode(blockStep, stageScope),
          contextPrefix,
        );
        const blockDynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(blockStep, stageScope);
        const blockSuffixBasePaths = blockBasePaths;
        const blockExpressionStageVariables = new Set(stageVariables);
        if (blockStep.focusBinding) {
          stageScope = runtime.aliases.bindFocusObjectAliasScope(
            stageScope,
            blockStep.focusBinding.name,
            blockObjectAlias,
            blockDynamicObjectAlias,
            blockBasePaths,
            blockSuffixBasePaths,
          );
          stageVariables.add(blockStep.focusBinding.name);
        }
        if (blockStep.indexBinding) {
          stageScope = bindVariable(stageScope, blockStep.indexBinding.name, []);
          nonPathVariables.add(blockStep.indexBinding.name);
        }
        const explicitlyCapturesCurrentContext =
          collectVariableNames(blockStep).has("") ||
          containsContextDefaultLambda(blockStep);
        const capturesCurrentContext =
          Boolean(contextPrefix) &&
          (explicitlyCapturesCurrentContext ||
            runtime.functions.resultUsesContextDefault(blockStep, stageScope));
        let blockEvaluationScope = stageScope;
        const blockEvaluationStageVariables = new Set(
          blockExpressionStageVariables,
        );
        if (capturesCurrentContext) {
          blockEvaluationScope = bindVariable(
            childScope(stageScope),
            "",
            [contextPrefix],
          );
          if (explicitlyCapturesCurrentContext) {
            blockEvaluationStageVariables.add("");
          }
        }
        const aliasPaths =
          i > 0 && runtime.aliases.isResultAliasStep(node.steps[i - 1])
            ? runtime.aliases.selectResultAliasProjectionStepPaths(
                node.steps[i - 1],
                step,
                stageScope,
                stageVariables.size > 0,
              )
            : null;
        if (aliasPaths) {
          paths.push(...aliasPaths);
          continue;
        }
        const hasBindings = blockStep.expressions.some((expr) => expr.type === "bind");
        if (hasBindings) {
          paths.push(
            ...walkContextExpression(
              blockStep,
              contextPrefix,
              blockEvaluationScope,
              blockEvaluationStageVariables,
              true,
            ),
          );
        }
        for (const expr of blockStep.expressions) {
          if (hasBindings && expr.type === "bind") continue;
          paths.push(
            ...walkContextExpression(
              expr,
              contextPrefix,
              stageScope,
              blockExpressionStageVariables,
              true,
            ),
          );
        }
        if (blockStep.predicate && blockStep.predicate.length > 0) {
          const predicatePrefixes =
            blockBasePaths.length > 0
              ? blockBasePaths
              : contextPrefix
                ? [contextPrefix]
                : [];
          let predicateScope = stageScope;
          const predicateStageVariables = new Set(stageVariables);
          const predicateNonPathVariables = new Set(nonPathVariables);
  
          if (blockStep.focusBinding || blockStep.indexBinding) {
            predicateScope = childScope(stageScope);
          }
          if (blockStep.focusBinding) {
            predicateScope = runtime.aliases.bindFocusObjectAliasScope(
              stageScope,
              blockStep.focusBinding.name,
              blockObjectAlias,
              blockDynamicObjectAlias,
              blockBasePaths,
              blockSuffixBasePaths,
            );
            predicateStageVariables.add(blockStep.focusBinding.name);
          }
          if (blockStep.indexBinding) {
            predicateScope = bindVariable(
              predicateScope,
              blockStep.indexBinding.name,
              [],
            );
            predicateNonPathVariables.add(blockStep.indexBinding.name);
          }
  
  
          if (predicatePrefixes.length === 0) {
            paths.push(
              ...walkSourceLessFilterStages(
                blockStep.predicate,
                predicateScope,
              ),
            );
          }
  
          for (const prefix of predicatePrefixes) {
            if (blockObjectAlias || blockDynamicObjectAlias) {
              for (const stage of blockStep.predicate) {
                if (stage.type !== "filter") continue;
                paths.push(
                  ...runtime.aliases.selectAliasExpressionPaths(
                    blockObjectAlias,
                    blockDynamicObjectAlias,
                    (stage as unknown as FilterStage).expr,
                    predicateScope,
                  ),
                );
              }
            } else {
              paths.push(
                ...walkFilterStages(
                  blockStep.predicate,
                  prefix,
                  predicateScope,
                  predicateNonPathVariables,
                  predicateStageVariables,
                ),
              );
            }
          }
        }
        if (
          contextPrefix &&
          ![...stageVariables].some((name) => referencedVariables.has(name)) &&
          !paths.slice(blockPathStart).some(
            (path) => path === contextPrefix || path.startsWith(`${contextPrefix}.`),
          )
        ) {
          paths.push(contextPrefix);
        }
      } else if (step.type === "function") {
        if (resultAliasSuffixStageStart >= 0 && i > resultAliasSuffixStageStart) {
          continue;
        }
        // Function call step (e.g., $lookup(obj, key) in $lookup(obj, key).field)
        // Function arguments in a path step are evaluated against the prior path context.
        const functionContextPrefix = buildPathString(node.steps.slice(0, i)) ?? "";
        const functionStep = step as FunctionNode;
        if (functionContextPrefix && functionStep.arguments.length === 0) {
          paths.push(functionContextPrefix);
        }
        const contextDefaultLambdaBinding =
          functionStep.procedure.type === "lambda"
            ? { lambda: functionStep.procedure, scope: stageScope }
            : functionStep.procedure.type === "variable"
              ? resolveLambda(stageScope, functionStep.procedure.value)
              : null;
        const contextDefaultLambda =
          functionContextPrefix &&
          contextDefaultLambdaBinding &&
          runtime.higherOrder.contextDefaultParameterIndex(contextDefaultLambdaBinding.lambda) >= 0 &&
          functionStep.arguments.length <
            contextDefaultLambdaBinding.lambda.arguments.length;
        const contextDefaultBuiltin =
          functionContextPrefix &&
          functionStep.procedure.type === "variable" &&
          runtime.functions.builtinUsesContextDefault(
            functionStep.procedure.value,
            functionStep.arguments,
          );
        if (contextDefaultLambda || contextDefaultBuiltin) {
          const contextScope = bindVariable(
            childScope(stageScope),
            "",
            [functionContextPrefix],
          );
          paths.push(
            ...runtime.functions.walkFunction(functionStep, contextScope),
          );
        } else {
          paths.push(
            ...(functionContextPrefix
              ? walkContextExpression(
                  step,
                  functionContextPrefix,
                  stageScope,
                  stageVariables,
                )
              : runtime.functions.walkFunction(functionStep, stageScope)),
          );
        }
      } else if (step.type === "apply") {
        paths.push(...runtime.functions.walkApply(step as ApplyNode, stageScope));
      }
    }
  
    // Handle group-by on the PathNode (node.group)
    if (node.group && !skipResultAliasGroupBy) {
      paths.push(...walkGroupBy(node, stageScope, stageVariables));
    }
  
    if (funcStepIndex >= 0 && funcStepIndex < node.steps.length - 1) {
      const functionStep = node.steps[funcStepIndex] as FunctionNode;
      const functionSuffixSteps = node.steps.slice(funcStepIndex + 1);
      const transformSourcePaths = runtime.transforms.transformOutputSelectionSourcePaths(
        functionStep,
        functionSuffixSteps,
        stageScope,
      );
      if (transformSourcePaths !== null) {
        paths.push(...transformSourcePaths);
        const suffix = buildPathString(functionSuffixSteps);
        const outputPaths = new Set(
          runtime.results.getFunctionResultBasePaths(functionStep, stageScope).map((base) =>
            appendPath(base, suffix),
          ),
        );
        return paths.filter((path) => !outputPaths.has(path));
      }
    }
  
    return paths;
  }

  function walkResolvedVariableSuffixFilterStages(
    suffixSteps: AstNode[],
    resolvedPath: string,
    scope: ScopeTracker,
    stageVariables: ReadonlySet<string>,
  ): string[] {
    const paths: string[] = [];
    let suffixScope = scope;
    const suffixStageVariables = new Set(stageVariables);
    const nonPathVariables = new Set<string>();
  
    for (let i = 0; i < suffixSteps.length; i++) {
      const step = suffixSteps[i];
      if (step.type !== "name") continue;
  
      const nameStep = step as NameNode;
      const contextSuffix = buildPathString(suffixSteps.slice(0, i + 1)) ?? "";
      const contextPrefix = appendPath(resolvedPath, contextSuffix);
  
      if (nameStep.focusBinding) {
        suffixScope = bindVariable(
          suffixScope,
          nameStep.focusBinding.name,
          contextPrefix ? [contextPrefix] : [],
        );
        suffixStageVariables.add(nameStep.focusBinding.name);
      }
      if (nameStep.indexBinding) {
        suffixScope = bindVariable(suffixScope, nameStep.indexBinding.name, []);
        nonPathVariables.add(nameStep.indexBinding.name);
      }
      if (nameStep.stages && nameStep.stages.length > 0) {
        paths.push(
          ...walkFilterStages(
            nameStep.stages,
            contextPrefix,
            suffixScope,
            nonPathVariables,
            suffixStageVariables,
          ).map(resolveParentPathSegments),
        );
      }
    }
  
    return paths;
  }

  function walkResolvedVariableSuffixSortTerms(
    suffixSteps: AstNode[],
    resolvedPath: string,
    scope: ScopeTracker,
    stageVariables: ReadonlySet<string>,
  ): string[] {
    const paths: string[] = [];
    let suffixScope = scope;
    const suffixStageVariables = new Set(stageVariables);
  
    for (let i = 0; i < suffixSteps.length; i++) {
      const step = suffixSteps[i];
  
      if (step.type === "name") {
        const nameStep = step as NameNode;
        const contextSuffix = buildPathString(suffixSteps.slice(0, i + 1)) ?? "";
        const contextPrefix = appendPath(resolvedPath, contextSuffix);
  
        if (nameStep.focusBinding) {
          suffixScope = bindVariable(
            suffixScope,
            nameStep.focusBinding.name,
            contextPrefix ? [contextPrefix] : [],
          );
          suffixStageVariables.add(nameStep.focusBinding.name);
        }
        if (nameStep.indexBinding) {
          suffixScope = bindVariable(suffixScope, nameStep.indexBinding.name, []);
        }
      } else if (step.type === "sort") {
        const contextSuffix = buildPathString(suffixSteps.slice(0, i)) ?? "";
        const contextPrefix = appendPath(resolvedPath, contextSuffix);
        paths.push(
          ...walkSortTerms(
            step as SortNode,
            contextPrefix,
            suffixScope,
            suffixStageVariables,
          ).map(resolveParentPathSegments),
        );
      }
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
    stageVariables: ReadonlySet<string> = new Set(),
    aliasStep?: AstNode,
  ): string[] {
    const paths: string[] = [];
    for (const term of sortNode.terms) {
      const aliasPaths =
        aliasStep
          ? term.expression.type === "path"
            ? runtime.aliases.selectResultAliasStepPaths(
                aliasStep,
                (term.expression as PathNode).steps,
                scope,
                !(aliasStep.type === "block" && contextPrefix),
              )
            : runtime.aliases.selectResultAliasExpressionPaths(aliasStep, term.expression, scope)
          : null;
      paths.push(
        ...(aliasPaths
          ? prefixProjectionPaths(contextPrefix, aliasPaths)
          : walkContextExpression(
              term.expression,
              contextPrefix,
              scope,
              stageVariables,
            )),
      );
    }
    return paths;
  }

  /**
   * Walk group-by expression on a PathNode, extracting key and value paths.
   * Both key and value expressions are prefixed with the base path of the
   * PathNode (computed from all steps, with sort steps skipped by buildPathString).
   */
  function walkGroupBy(
    node: PathNode,
    scope: ScopeTracker,
    stageVariables: ReadonlySet<string> = new Set(),
  ): string[] {
    const groupNode = node.group;
    if (!groupNode) return [];
  
    const resultAliasStepIndex = node.steps.findIndex(runtime.aliases.isResultAliasStep);
    if (resultAliasStepIndex >= 0) {
      const resultAliasStep = node.steps[resultAliasStepIndex];
      const prefixSteps = node.steps.slice(0, resultAliasStepIndex);
      const structuralContextPrefix = buildProjectionContextPath(prefixSteps) ?? "";
      const contextPrefix = hasPendingProjectionFocusReset(prefixSteps)
        ? parentPath(structuralContextPrefix)
        : structuralContextPrefix;
      const usesContextDefault = runtime.functions.resultUsesContextDefault(
        resultAliasStep,
        scope,
      );
      const resultScope =
        contextPrefix && usesContextDefault
          ? bindVariable(childScope(scope), "", [contextPrefix])
          : scope;
      const objectAlias =
        resultAliasStep.type === "object"
          ? runtime.aliases.objectConstructorContextAlias(
              resultAliasStep as ObjectNode,
              prefixSteps,
              resultScope,
            )
          : resultAliasStep.type === "block"
            ? runtime.aliases.prefixObjectAlias(
                runtime.aliases.objectAliasForNode(resultAliasStep, resultScope),
                contextPrefix,
              )
            : runtime.aliases.objectAliasForNode(resultAliasStep, resultScope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(
        resultAliasStep,
        resultScope,
      );
      const resultBasePaths =
        resultAliasStep.type === "array"
          ? runtime.aliases.arrayConstructorContextBasePaths(
              resultAliasStep as ArrayNode,
              contextPrefix,
              resultScope,
            )
          : resultAliasStep.type === "object"
            ? runtime.aliases.objectConstructorContextBasePaths(
                resultAliasStep as ObjectNode,
                contextPrefix,
                resultScope,
              )
            : resultAliasStep.type === "block"
              ? runtime.aliases.blockContextBasePaths(
                  resultAliasStep as BlockNode,
                  contextPrefix,
                  resultScope,
                )
              : runtime.aliases.bindingAliasPaths(resultAliasStep, resultScope);
      const focusStep =
        resultAliasStep.type === "apply"
          ? runtime.functions.appliedFunctionFromApply(resultAliasStep as ApplyNode)
          : resultAliasStep.type === "block" ||
              resultAliasStep.type === "array" ||
              resultAliasStep.type === "object" ||
              resultAliasStep.type === "function"
            ? (resultAliasStep as BlockNode | ArrayNode | ObjectNode | FunctionNode)
            : null;
      const focusBinding = focusStep?.focusBinding;
      const indexBinding = focusStep?.indexBinding;
      let groupScope = resultScope;
      if (focusBinding) {
        groupScope = runtime.aliases.bindFocusObjectAliasScope(
          resultScope,
          focusBinding.name,
          objectAlias,
          dynamicObjectAlias,
          resultBasePaths,
          resultBasePaths,
        );
      }
      if (indexBinding) {
        if (groupScope === resultScope) groupScope = childScope(resultScope);
        groupScope = bindVariable(groupScope, indexBinding.name, []);
      }
      if (objectAlias || dynamicObjectAlias) {
        return walkAliasGroupEntries(
          groupNode,
          objectAlias,
          dynamicObjectAlias,
          groupScope,
        );
      }
  
      const groupStageVariables = new Set(stageVariables);
      if (focusBinding) groupStageVariables.add(focusBinding.name);
      if (resultBasePaths.length > 0) {
        return resultBasePaths.flatMap((basePath) =>
          walkContextGroupEntries(groupNode, basePath, groupScope, groupStageVariables),
        );
      }
    }
  
    const groupBasePath = buildPathString(node.steps) ?? "";
    return walkContextGroupEntries(groupNode, groupBasePath, scope, stageVariables);
  }

  function walkContextGroupEntries(
    groupNode: GroupByNode,
    groupBasePath: string,
    scope: ScopeTracker,
    stageVariables: ReadonlySet<string> = new Set(),
  ): string[] {
    return groupNode.entries.flatMap(([keyExpr, valExpr]) => [
      ...walkContextExpression(keyExpr, groupBasePath, scope, stageVariables),
      ...walkContextExpression(valExpr, groupBasePath, scope, stageVariables),
    ]);
  }

  function walkAliasGroupEntries(
    groupNode: GroupByNode,
    objectAlias: ObjectAlias | null,
    dynamicObjectAlias: DynamicObjectAlias | null,
    scope: ScopeTracker,
    suffixBasePaths: readonly string[] = [],
  ): string[] {
    return groupNode.entries.flatMap(([keyExpr, valExpr]) => [
      ...runtime.aliases.selectAliasExpressionPaths(
        objectAlias,
        dynamicObjectAlias,
        keyExpr,
        scope,
        suffixBasePaths,
      ),
      ...runtime.aliases.selectAliasExpressionPaths(
        objectAlias,
        dynamicObjectAlias,
        valExpr,
        scope,
        suffixBasePaths,
      ),
    ]);
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
    nonPathVariables: ReadonlySet<string> = new Set(),
    stageVariables: ReadonlySet<string> = new Set(),
  ): string[] {
    const paths: string[] = [];
    let stageScope = scope;
    const stageNonPathVariables = new Set(nonPathVariables);
    const activeStageVariables = new Set(stageVariables);
  
    for (const stage of stages) {
      if (stage.type === "position-binding") {
        const binding = stage as PositionBindingNode;
        stageScope = bindVariable(stageScope, binding.name, []);
        stageNonPathVariables.add(binding.name);
        activeStageVariables.add(binding.name);
        continue;
      }
      if (stage.type !== "filter") continue;
  
      const filterStage = stage as unknown as FilterStage;
  
      // EXPR-06: Numeric index guard -- skip array indexing
      if (isNumericIndex(filterStage.expr)) continue;
  
      // ADV-02: pure $variable in bracket position with no resolved data paths -> dynamic wildcard
      if (filterStage.expr.type === "variable") {
        const varNode = filterStage.expr as VariableNode;
        const resolved = resolveVariable(stageScope, varNode.value);
        if (stageNonPathVariables.has(varNode.value)) continue;
        if (!resolved) {
          paths.push(`${contextPrefix}[*]`);
          continue; // [*] replaces predicate walk -- do not also walk the predicate
        }
        if (resolved.length === 0) continue;
      }
  
      paths.push(
        ...walkContextExpression(
          filterStage.expr,
          contextPrefix,
          stageScope,
          activeStageVariables,
        ),
      );
    }
  
    return paths;
  }

  function walkSourceLessFilterStages(
    stages: AstNode[],
    scope: ScopeTracker,
  ): string[] {
    const paths: string[] = [];
    let stageScope = bindVariable(childScope(scope), "", []);
  
    for (const stage of stages) {
      if (stage.type === "position-binding") {
        const binding = stage as PositionBindingNode;
        stageScope = bindVariable(stageScope, binding.name, []);
        continue;
      }
      if (stage.type !== "filter") continue;
  
      const expression = (stage as unknown as FilterStage).expr;
      if (isNumericIndex(expression)) continue;
      paths.push(
        ...runtime.core.walkNode(expression, stageScope).filter((path) =>
          path.startsWith(ROOT_PATH),
        ),
      );
    }
  
    return paths;
  }

  function walkSourceLessGroupEntries(
    groupNode: GroupByNode,
    scope: ScopeTracker,
  ): string[] {
    const contextScope = bindVariable(childScope(scope), "", []);
    return groupNode.entries.flatMap(([key, value]) =>
      [...runtime.core.walkNode(key, contextScope), ...runtime.core.walkNode(value, contextScope)].filter(
        (path) => path.startsWith(ROOT_PATH),
      ),
    );
  }

  return {
    walkContextExpression,
    walkContextCallableSelection,
    walkPath,
    walkResolvedVariableSuffixFilterStages,
    walkResolvedVariableSuffixSortTerms,
    walkSortTerms,
    walkContextGroupEntries,
    walkAliasGroupEntries,
    walkFilterStages,
    walkSourceLessFilterStages,
    walkSourceLessGroupEntries,
  };
}
