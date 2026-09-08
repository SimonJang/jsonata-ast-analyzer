import type { ArrayNode, AstNode, ApplyNode, BindNode, BlockNode, DescendantNode, ExternalFunctionAccessMode, ExternalFunctionContract, FunctionNode, GroupByNode, LambdaNode, ObjectNode, PartialNode, PathNode, SortNode, TransformNode, VariableNode, WildcardNode } from "../types.js";
import type { DynamicObjectAlias, LambdaBinding, ObjectAlias, PartialBinding, ScopeTracker, TransformBinding } from "../scope.js";

export interface ResolvedTransformCall {
  readonly binding: TransformBinding;
  readonly arguments: AstNode[];
}

export type ResolvedCallable =
  | { readonly kind: "lambda"; readonly binding: LambdaBinding }
  | { readonly kind: "transform"; readonly binding: TransformBinding }
  | { readonly kind: "partial"; readonly binding: PartialBinding };

export interface ResolvedLambdaCall {
  readonly binding: LambdaBinding;
  readonly arguments: AstNode[];
}

export interface ResolvedPartialCall {
  readonly binding: PartialBinding;
  readonly arguments: AstNode[];
}

export interface ResolvedHigherOrderLambdaCallbacks {
  readonly index: number;
  readonly bindings: LambdaBinding[];
  readonly partials: PartialBinding[];
}

export interface CoreOperations {
  walkNode(node: AstNode, scope: ScopeTracker): string[];
  bindBroadStepScope(node: WildcardNode | DescendantNode, basePath: string, scope: ScopeTracker): {
      stageScope: ScopeTracker;
      stageVariables: Set<string>;
      nonPathVariables: Set<string>;
  };
  walkArray(node: ArrayNode, scope: ScopeTracker): string[];
  walkObject(node: ObjectNode, scope: ScopeTracker): string[];
}

export interface PathOperations {
  walkContextExpression(expr: AstNode, contextPrefix: string, scope: ScopeTracker, stageVariables?: ReadonlySet<string>, keepBarePathsRootRelative?: boolean): string[];
  walkContextCallableSelection(expr: AstNode, contextPrefix: string, scope: ScopeTracker): string[];
  walkPath(node: PathNode, scope: ScopeTracker): string[];
  walkResolvedVariableSuffixFilterStages(suffixSteps: AstNode[], resolvedPath: string, scope: ScopeTracker, stageVariables: ReadonlySet<string>): string[];
  walkResolvedVariableSuffixSortTerms(suffixSteps: AstNode[], resolvedPath: string, scope: ScopeTracker, stageVariables: ReadonlySet<string>): string[];
  walkSortTerms(sortNode: SortNode, contextPrefix: string, scope: ScopeTracker, stageVariables?: ReadonlySet<string>, aliasStep?: AstNode): string[];
  walkContextGroupEntries(groupNode: GroupByNode, groupBasePath: string, scope: ScopeTracker, stageVariables?: ReadonlySet<string>): string[];
  walkAliasGroupEntries(groupNode: GroupByNode, objectAlias: ObjectAlias | null, dynamicObjectAlias: DynamicObjectAlias | null, scope: ScopeTracker, suffixBasePaths?: readonly string[]): string[];
  walkFilterStages(stages: AstNode[], contextPrefix: string, scope: ScopeTracker, nonPathVariables?: ReadonlySet<string>, stageVariables?: ReadonlySet<string>): string[];
  walkSourceLessFilterStages(stages: AstNode[], scope: ScopeTracker): string[];
  walkSourceLessGroupEntries(groupNode: GroupByNode, scope: ScopeTracker): string[];
}

export interface AliasOperations {
  bindingAliasPaths(node: AstNode, scope: ScopeTracker): string[];
  staticObjectKey(node: AstNode): string | null;
  objectAliasFromObject(node: ObjectNode, scope: ScopeTracker): ObjectAlias | null;
  mergeObjectAliases(aliases: Array<ObjectAlias | null>): ObjectAlias | null;
  objectAliasForNode(node: AstNode, scope: ScopeTracker): ObjectAlias | null;
  objectAliasFromBlock(node: BlockNode, scope: ScopeTracker): ObjectAlias | null;
  selectObjectAliasPaths(alias: ObjectAlias, suffixSteps: AstNode[]): string[] | null;
  mergeDynamicObjectAliases(aliases: Array<DynamicObjectAlias | null>): DynamicObjectAlias | null;
  selectLookupDynamicObjectAliasPaths(alias: DynamicObjectAlias, suffixSteps: AstNode[]): string[];
  selectLookupDynamicObjectResultAlias(alias: DynamicObjectAlias, selectorSteps: AstNode[]): DynamicObjectAlias | null;
  selectLookupDynamicObjectResultObjectAlias(alias: DynamicObjectAlias, selectorSteps: AstNode[]): ObjectAlias | null;
  selectVariableObjectAliasPaths(objectAlias: ObjectAlias | null, dynamicObjectAlias: DynamicObjectAlias | null, suffixSteps: AstNode[], scope: ScopeTracker, suffixBasePaths?: readonly string[], preserveUnmappedLocalPaths?: boolean): string[] | null;
  selectAliasSuffixContextPaths(suffixSteps: AstNode[], objectAlias: ObjectAlias | null, dynamicObjectAlias: DynamicObjectAlias | null, scope: ScopeTracker, suffixBasePaths?: readonly string[]): string[];
  walkAliasSuffixFilterStages(suffixSteps: AstNode[], objectAlias: ObjectAlias | null, dynamicObjectAlias: DynamicObjectAlias | null, scope: ScopeTracker, suffixBasePaths?: readonly string[], preserveUnmappedLocalPaths?: boolean): string[];
  walkAliasSuffixSortTerms(suffixSteps: AstNode[], objectAlias: ObjectAlias | null, dynamicObjectAlias: DynamicObjectAlias | null, scope: ScopeTracker, suffixBasePaths?: readonly string[], preserveUnmappedLocalPaths?: boolean): string[];
  walkAliasSuffixProjectionSteps(suffixSteps: AstNode[], objectAlias: ObjectAlias | null, dynamicObjectAlias: DynamicObjectAlias | null, scope: ScopeTracker, suffixBasePaths?: readonly string[], preserveUnmappedLocalPaths?: boolean): string[];
  walkAliasSuffixFunctionSteps(suffixSteps: AstNode[], objectAlias: ObjectAlias | null, dynamicObjectAlias: DynamicObjectAlias | null, scope: ScopeTracker, suffixBasePaths?: readonly string[]): string[];
  walkAliasSuffixGroupEntries(groupNode: GroupByNode, groupBasePaths: readonly string[], objectAlias: ObjectAlias | null, dynamicObjectAlias: DynamicObjectAlias | null, scope: ScopeTracker, suffixBasePaths?: readonly string[], preserveUnmappedLocalPaths?: boolean): string[];
  dynamicObjectAliasForNode(node: AstNode, scope: ScopeTracker): DynamicObjectAlias | null;
  groupResultObjectAliasForNode(node: AstNode, scope: ScopeTracker): ObjectAlias | null;
  groupResultDynamicObjectAliasForNode(node: AstNode, scope: ScopeTracker): DynamicObjectAlias | null;
  groupResultSuffixBasePaths(node: AstNode, scope: ScopeTracker): string[];
  groupResultSuffixableBasePaths(node: AstNode, scope: ScopeTracker): string[];
  bindObjectAliasIfPresent(scope: ScopeTracker, name: string, node: AstNode, aliasScope: ScopeTracker): ScopeTracker;
  bindDynamicObjectAliasIfPresent(scope: ScopeTracker, name: string, node: AstNode, aliasScope: ScopeTracker): ScopeTracker;
  bindFocusObjectAliasScope(scope: ScopeTracker, name: string, objectAlias: ObjectAlias | null, dynamicObjectAlias: DynamicObjectAlias | null, basePaths: readonly string[], suffixBasePaths: readonly string[]): ScopeTracker;
  bindStepFocusScope(step: AstNode, scope: ScopeTracker): ScopeTracker;
  bindSuffixBasePathsIfPresent(scope: ScopeTracker, name: string, node: AstNode, aliasScope: ScopeTracker): ScopeTracker;
  isResultAliasStep(step: AstNode): boolean;
  firstUnboundPathVariableIndex(steps: AstNode[]): number;
  selectResultAliasStepPaths(step: AstNode, suffixSteps: AstNode[], scope: ScopeTracker, includeStepReadPaths?: boolean, preserveUnmappedLocalPaths?: boolean): string[] | null;
  walkResultAliasSuffixStages(step: AstNode, suffixSteps: AstNode[], groupNode: GroupByNode | undefined, scope: ScopeTracker): string[];
  walkResultBaseSuffixStages(basePaths: readonly string[], suffixSteps: AstNode[], groupNode: GroupByNode | undefined, scope: ScopeTracker): string[];
  walkResultBaseSuffixProjectionSteps(basePaths: readonly string[], suffixSteps: AstNode[], scope: ScopeTracker): string[];
  walkResultBaseSuffixFunctionSteps(basePaths: readonly string[], suffixSteps: AstNode[], scope: ScopeTracker): string[];
  selectResultAliasExpressionPaths(step: AstNode, expression: AstNode, scope: ScopeTracker): string[] | null;
  arrayConstructorContextBasePaths(node: ArrayNode, contextPrefix: string, scope: ScopeTracker): string[];
  objectConstructorContextBasePaths(node: ObjectNode, contextPrefix: string, scope: ScopeTracker): string[];
  objectConstructorContextAlias(node: ObjectNode, prefixSteps: AstNode[], scope: ScopeTracker): ObjectAlias | null;
  blockContextBasePaths(node: BlockNode, contextPrefix: string, scope: ScopeTracker): string[];
  pathResultAliasContextBasePaths(node: PathNode, scope: ScopeTracker): string[];
  hasResultAliasObjectSuffixSelection(node: PathNode, scope: ScopeTracker): boolean;
  hasVariableBeforeResultAlias(node: PathNode, resultAliasStepIndex?: number): boolean;
  prefixObjectAlias(alias: ObjectAlias | null, contextPrefix: string): ObjectAlias | null;
  unmatchedAliasSuffixBasePaths(objectAlias: ObjectAlias | null, suffixBasePaths: readonly string[]): string[];
  selectResultAliasProjectionStepPaths(step: AstNode, projectionStep: AstNode, scope: ScopeTracker, preserveUnmappedLocalPaths?: boolean): string[] | null;
  projectionStepExpressions(step: AstNode): AstNode[] | null;
  selectAliasExpressionPaths(objectAlias: ObjectAlias | null, dynamicObject: DynamicObjectAlias | null, expression: AstNode, scope: ScopeTracker, suffixBasePaths?: readonly string[], preserveUnmappedLocalPaths?: boolean, skipLocalPaths?: boolean): string[];
  bindingAliasPathsFromBlock(node: BlockNode, scope: ScopeTracker): string[];
}

export interface CallableOperations {
  isFunctionProcedureNode(node: AstNode): node is FunctionNode["procedure"];
  isFilteredCallableVariable(node: AstNode): boolean;
  resolvedCallableNames(callable: ResolvedCallable, depth?: number): string[];
  bindCallableBlockValue(scope: ScopeTracker, bindNode: BindNode): ScopeTracker;
  callableProcedureVariableNames(node: AstNode, names?: Set<string>): Set<string>;
  bindForwardReferences(scope: ScopeTracker, lambda: LambdaNode, callScope: ScopeTracker, currentFunctionName?: string): ScopeTracker;
  lambdaCallScope(binding: LambdaBinding, callArgs: AstNode[], callScope: ScopeTracker): ScopeTracker;
  compositionLambda(node: ApplyNode, scope: ScopeTracker): LambdaNode | null;
  customFunctionResultCallableValues(node: FunctionNode, scope: ScopeTracker, suffixSteps?: AstNode[]): ResolvedCallable[];
  customFunctionResultBuiltinCallableNames(node: FunctionNode, scope: ScopeTracker, suffixSteps?: AstNode[]): string[];
  higherOrderResultCallableValues(node: FunctionNode, scope: ScopeTracker, suffixSteps?: AstNode[]): ResolvedCallable[];
  higherOrderResultBuiltinCallableNames(node: FunctionNode, scope: ScopeTracker, suffixSteps?: AstNode[]): string[];
  pathProjectionCallableValues(path: PathNode, scope: ScopeTracker): ResolvedCallable[];
  pathProjectionBuiltinCallableNames(path: PathNode, scope: ScopeTracker): string[];
  groupedPathCallableScope(path: PathNode, scope: ScopeTracker): ScopeTracker;
  groupedPathCallableValues(path: PathNode, scope: ScopeTracker, suffixSteps?: AstNode[]): ResolvedCallable[];
  groupedPathBuiltinCallableNames(path: PathNode, scope: ScopeTracker, suffixSteps?: AstNode[]): string[];
  resolveCallableValues(node: AstNode, scope: ScopeTracker): ResolvedCallable[];
  resolveBuiltinCallableNames(node: AstNode, scope: ScopeTracker): string[];
}

export interface FunctionOperations {
  bindCallableValue(scope: ScopeTracker, name: string, value: AstNode, closureScope: ScopeTracker): ScopeTracker;
  builtinUsesContextDefault(funcName: string, args: AstNode[]): boolean;
  resultUsesContextDefault(node: AstNode, scope: ScopeTracker): boolean;
  withImplicitRootFunctionArgument(funcName: string, args: AstNode[], position: number, scope?: ScopeTracker): AstNode[];
  identityReferencePaths(node: AstNode, scope: ScopeTracker): string[] | null;
  appliedFunctionFromApply(node: ApplyNode): FunctionNode | null;
  isPlaceholder(node: AstNode): boolean;
  walkPartial(node: PartialNode, scope: ScopeTracker): string[];
  walkVariable(node: VariableNode, scope: ScopeTracker): string[];
  walkLambda(node: LambdaNode, scope: ScopeTracker): string[];
  walkCallableSelection(node: AstNode, scope: ScopeTracker): string[];
  conditionalProcedureCalls(node: FunctionNode): FunctionNode[];
  walkFunction(node: FunctionNode, scope: ScopeTracker): string[];
  getStaticEvalResultBasePaths(args: AstNode[], scope: ScopeTracker): string[];
  getStaticEvalExpression(args: AstNode[]): AstNode | null;
  getStaticEvalScope(args: AstNode[], scope: ScopeTracker): ScopeTracker;
  getStaticEvalResultObjectAlias(args: AstNode[], scope: ScopeTracker): ObjectAlias | null;
  getStaticEvalResultDynamicObjectAlias(args: AstNode[], scope: ScopeTracker): DynamicObjectAlias | null;
  walkApply(node: ApplyNode, scope: ScopeTracker): string[];
}

export interface HigherOrderOperations {
  extractBasePaths(node: AstNode, scope: ScopeTracker): string[];
  walkHigherOrderCall(node: FunctionNode, semantics: Record<number, string>, scope: ScopeTracker): string[];
  higherOrderCallbackDataPaths(funcName: string, dataArg: AstNode | undefined, scope: ScopeTracker, usesImplicitRoot?: boolean): string[];
  higherOrderCallbackDataNodes(funcName: "map" | "each", dataArg: AstNode | undefined, scope: ScopeTracker, resolvingVariables?: Set<string>): AstNode[];
  bindHigherOrderLambdaCallbackScope(funcName: "map" | "each", binding: LambdaBinding, dataArgPaths: string[], dataArg: AstNode | undefined, dataArgScope: ScopeTracker): ScopeTracker;
  findHigherOrderCallback(args: AstNode[], scope: ScopeTracker): {
      index: number;
      lambda: LambdaNode;
      scope: ScopeTracker;
  } | null;
  findResolvedHigherOrderLambdaCallbacks(args: AstNode[], scope: ScopeTracker, callbackIndex?: number): {
      index: number;
      bindings: LambdaBinding[];
      partials: PartialBinding[];
  } | null;
  partialCanInvokeLambda(binding: PartialBinding): boolean;
  resolveLambdaFunctionCalls(procedure: FunctionNode["procedure"], callArgs: AstNode[], scope: ScopeTracker): ResolvedLambdaCall[];
  higherOrderPartialLambdaCalls(funcName: "map" | "each" | "reduce", callback: ResolvedHigherOrderLambdaCallbacks, dataArg: AstNode | undefined, scope: ScopeTracker, higherOrderArgs?: AstNode[]): ResolvedLambdaCall[];
  higherOrderPartialResultBasePaths(funcName: "map" | "each", args: AstNode[], scope: ScopeTracker): string[];
  higherOrderPartialCalls(funcName: "map" | "each" | "reduce", args: AstNode[], scope: ScopeTracker): ResolvedPartialCall[];
  higherOrderCallbackCallArguments(funcName: string, valueArg: AstNode, collectionArg: AstNode, higherOrderArgs: AstNode[], position: number): AstNode[];
  findHigherOrderTransformCallback(args: AstNode[], scope: ScopeTracker): {
      index: number;
  } | null;
  resolveCallbackParentPaths(paths: string[], dataArgPaths: readonly string[]): string[];
  resolveCallbackObjectAliasParentPaths(alias: ObjectAlias, dataArgPaths: readonly string[]): ObjectAlias;
  resolveCallbackDynamicObjectAliasParentPaths(alias: DynamicObjectAlias, dataArgPaths: readonly string[]): DynamicObjectAlias;
  prefixDynamicObjectAlias(alias: DynamicObjectAlias, contextBasePaths: readonly string[]): DynamicObjectAlias;
  resolveDynamicVariantPaths(paths: string[], variant: DynamicObjectAlias["variants"][number]): string[];
  resolveDynamicVariantObjectAlias(alias: ObjectAlias, variant: DynamicObjectAlias["variants"][number]): ObjectAlias;
  resolveDynamicVariantDynamicObjectAlias(alias: DynamicObjectAlias, variant: DynamicObjectAlias["variants"][number]): DynamicObjectAlias;
  bindHigherOrderParameter(scope: ScopeTracker, funcName: string, param: VariableNode, role: string, argPaths: readonly string[], arg: AstNode | undefined, argScope: ScopeTracker): ScopeTracker;
  contextDefaultParameterIndex(lambda: LambdaNode): number;
  lambdaContextDefaultArgumentVariants(lambda: LambdaNode, callArgs: AstNode[]): AstNode[][];
  walkCustomFunctionCall(binding: LambdaBinding, callArgs: AstNode[], callScope: ScopeTracker, defaultsApplied?: boolean, argumentScopes?: ScopeTracker[]): string[];
  lambdaCallGraphReaches(functionName: string, targetName: string, scope: ScopeTracker, visited: Set<string>): boolean;
  bindArgumentParameter(scope: ScopeTracker, param: VariableNode, argPaths: readonly string[], arg: AstNode, argScope: ScopeTracker): ScopeTracker;
  applyPartialArguments(partial: PartialNode, callArgs: AstNode[]): AstNode[];
  applyPartialArgumentScopes(partial: PartialNode, callArgs: AstNode[], bindingScope: ScopeTracker, callScope: ScopeTracker): ScopeTracker[];
  scopePartialArguments(args: AstNode[], argumentScopes: ScopeTracker[], callScope: ScopeTracker): {
      arguments: AstNode[];
      scope: ScopeTracker;
  };
  walkPartialCall(binding: PartialBinding, callArgs: AstNode[], callScope: ScopeTracker): string[];
}

export interface TransformOperations {
  resolveTransformFunctionCalls(functionNode: FunctionNode, scope: ScopeTracker, requireAllCallables?: boolean): ResolvedTransformCall[];
  transformWritesSuffix(functionNode: FunctionNode, suffixSteps: AstNode[], scope: ScopeTracker): boolean;
  transformOutputSelectionSourcePaths(functionNode: FunctionNode, suffixSteps: AstNode[], scope: ScopeTracker): string[] | null;
  transformApplyAliasContextPaths(transformNode: TransformNode, transformPaths: string[], lhs: AstNode, lhsPaths: readonly string[], scope: ScopeTracker): string[] | null;
  walkTransform(node: TransformNode, scope: ScopeTracker): string[];
  transformUpdateCallableValues(node: FunctionNode, suffixSteps: AstNode[], scope: ScopeTracker): ResolvedCallable[];
  transformUpdateBuiltinCallableNames(node: FunctionNode, suffixSteps: AstNode[], scope: ScopeTracker): string[];
  walkTransformCall(binding: TransformBinding, callArgs: AstNode[], callScope: ScopeTracker): string[];
}

export interface ResultOperations {
  getFunctionResultObjectAlias(node: FunctionNode, scope: ScopeTracker): ObjectAlias | null;
  getFunctionResultDynamicObjectAlias(node: FunctionNode, scope: ScopeTracker): DynamicObjectAlias | null;
  getFunctionResultBasePaths(node: FunctionNode, scope: ScopeTracker): string[];
  getPartialFunctionResultBasePaths(binding: PartialBinding, callArgs: AstNode[], callScope: ScopeTracker): string[];
  getFunctionResultSuffixBasePaths(node: AstNode, scope: ScopeTracker): string[];
  getResultSuffixBasePaths(node: AstNode, scope: ScopeTracker): string[];
  getBlockResultSuffixBasePaths(node: BlockNode, scope: ScopeTracker): string[];
  getSuffixableResultBasePaths(node: AstNode, scope: ScopeTracker): string[];
  getLookupResultBasePaths(args: AstNode[], scope: ScopeTracker): string[];
  getResultBasePathsFromArg(node: AstNode, scope: ScopeTracker): string[];
}

export interface SelectionOperations {
  getSelectedResultPaths(node: AstNode, scope: ScopeTracker): string[];
}

export interface WalkerOptions {
  readonly opaqueFunctions: ReadonlySet<string>;
  readonly externalFunctions: ReadonlyMap<string, ExternalFunctionContract>;
  readonly recordExternalSubtreeAccesses: (paths: readonly string[]) => void;
}

export function externalFunctionContract(
  options: WalkerOptions,
  name: string,
): ExternalFunctionContract | null {
  return (
    options.externalFunctions.get(name) ??
    (options.opaqueFunctions.has(name) ? { arguments: "value" } : null)
  );
}

export function externalArgumentAccessMode(
  contract: ExternalFunctionContract,
  argumentIndex: number,
): ExternalFunctionAccessMode {
  const configured = contract.arguments;
  if (typeof configured === "string" || configured === undefined) {
    return configured ?? "value";
  }
  return configured[argumentIndex] ?? "value";
}

export interface WalkerRuntime {
  core: CoreOperations;
  paths: PathOperations;
  aliases: AliasOperations;
  callables: CallableOperations;
  functions: FunctionOperations;
  higherOrder: HigherOrderOperations;
  transforms: TransformOperations;
  results: ResultOperations;
}
