import type { ArrayNode, AstNode, ApplyNode, BinaryNode, BindNode, BlockNode, ConditionNode, DescendantNode, FilterStage, FunctionNode, GroupByNode, LambdaNode, NameNode, NegateNode, ObjectNode, PartialNode, PathNode, SortNode, SortTerm, TransformNode, VariableNode, WildcardNode } from "../types.js";
import { type ScopeTracker, childScope, bindVariable, bindValue, bindObjectAlias, bindDynamicObjectAlias, bindSuffixBasePaths, resolveObjectAlias, resolveDynamicObjectAlias, resolveValue, resolveVariable } from "../scope.js";
import { appendPath, collectVariableNames, markAbsolute } from "./path-utils.js";
import type { CoreOperations, WalkerRuntime } from "./runtime.js";

export function createCoreOperations(runtime: WalkerRuntime): CoreOperations {
  const constructorAssignments = new WeakMap<AstNode, readonly BindNode[]>();
  const assignmentScopes = new WeakMap<AstNode, WeakMap<ScopeTracker, WeakMap<ScopeTracker, ScopeTracker>>>();
  const assignmentReads = new WeakMap<AstNode, boolean>();
  const projectedValues = new WeakMap<AstNode, { value: AstNode; prefix: AstNode[] }>();
  const iteratedReadCache = new WeakMap<AstNode, WeakMap<ScopeTracker, string[]>>();

  function collectConstructorAssignments(node: AstNode): readonly BindNode[] {
    if (node.type === "bind") return collectConstructorAssignments((node as BindNode).rhs);
    const cached = constructorAssignments.get(node);
    if (cached) return cached;
    if (node.type === "path") {
      const steps = (node as PathNode).steps;
      if (steps.some((step) => {
        const tuple = step as AstNode & { tuple?: boolean; focusBinding?: unknown; indexBinding?: unknown };
        return tuple.tuple || tuple.focusBinding || tuple.indexBinding;
      })) {
        const assignments = [...(steps[0]?.type === "array" ? collectConstructorAssignments(steps[0]) : [])];
        const sources = new Map<string, AstNode>();
        let hasTuples = false;
        let previousSort = false;
        let tuple: ObjectNode | undefined;
        const appendEffects = (expression: AstNode): void => {
          const source = tuple;
          if (!source) return;
          assignments.push(...[
            ...collectConstructorAssignments(expression),
            ...(expression.type === "bind" ? [expression as BindNode] : []),
          ].map((assignment) => projectAssignment(assignment, [source])));
        };
        for (const [index, step] of steps.entries()) {
          const staged = step as NameNode & { predicate?: AstNode[] };
          if (index === 0 && step.type === "array" && (step as ArrayNode).initialPathPredicate) continue;
          if (step.type === "sort" && hasTuples) {
            if (!previousSort) {
              const prefix = steps.slice(0, index);
              tuple = { type: "object", position: 0, entries: ["@", ...sources.keys()].map((name) => [
                { type: "string", value: name, position: 0 },
                name === "@" ? { type: "path", steps: prefix } : sources.get(name)!,
              ]) };
            }
            // Multi-item sorts expose raw tuples to their predicates and a following sort.
            if (previousSort) for (const term of (step as SortNode).terms) appendEffects(term.expression);
            for (const stage of staged.predicate ?? []) if (stage.type === "filter") appendEffects((stage as unknown as FilterStage).expr);
          }
          previousSort = step.type === "sort" && hasTuples;
          if (staged.focusBinding) sources.set(staged.focusBinding.name, {
            type: "path", steps: [...steps.slice(0, index), { ...step, focusBinding: undefined, indexBinding: undefined } as AstNode],
          });
          if (staged.indexBinding) sources.set(staged.indexBinding.name, { type: "variable", value: "\0tuple-index", position: 0 });
          const stages = staged.stages ?? staged.predicate ?? [];
          for (const stage of stages) if (stage.type === "position-binding") sources.set((stage as AstNode & { name: string }).name, { type: "variable", value: "\0tuple-index", position: 0 });
          hasTuples ||= Boolean(staged.tuple || staged.focusBinding || staged.indexBinding || stages.some((stage) => stage.type === "position-binding"));
        }
        if (previousSort && (node as PathNode).group) {
          appendEffects({ type: "object", position: 0, entries: (node as PathNode).group!.entries });
        }
        constructorAssignments.set(node, assignments);
        return assignments;
      }
      const assignments = steps.flatMap((step, index) => collectConstructorAssignments(step).map((assignment) =>
        projectAssignment(assignment, steps.slice(0, index))));
      appendStageAssignments(node, assignments);
      constructorAssignments.set(node, assignments);
      return assignments;
    }
    let expressions: AstNode[];
    switch (node.type) {
      case "array": expressions = (node as ArrayNode).expressions; break;
      case "sort": expressions = (node as SortNode).terms.map((term) => term.expression); break;
      case "object": expressions = (node as ObjectNode).entries.flatMap(([key, value]) => [key, value]); break;
      case "function": expressions = [(node as FunctionNode).procedure, ...(node as FunctionNode).arguments]; break;
      case "condition": expressions = [(node as ConditionNode).condition, (node as ConditionNode).then, (node as ConditionNode).else]
        .filter((value): value is AstNode => Boolean(value)); break;
      case "binary": expressions = [(node as BinaryNode).lhs, (node as BinaryNode).rhs]; break;
      case "apply": expressions = [(node as ApplyNode).lhs, (node as ApplyNode).rhs]; break;
      case "negate": expressions = (node as NegateNode).expression ? [(node as NegateNode).expression!] : []; break;
      default: expressions = [];
    }
    const assignments = expressions.flatMap((expression, index) => {
      const effects = [
        ...collectConstructorAssignments(expression),
        ...(expression.type === "bind" ? [expression as BindNode] : []),
      ];
      const optional = node.type === "condition" && index > 0 ||
        node.type === "binary" && ["and", "or"].includes((node as BinaryNode).value) && index === 1;
      return optional ? effects.map((assignment): BindNode => ({
        ...assignment,
        rhs: {
          type: "condition", position: assignment.position,
          condition: { type: "value", value: true, position: assignment.position },
          then: assignment.rhs, else: { ...assignment.lhs },
        },
      })) : effects;
    });
    appendStageAssignments(node, assignments);
    constructorAssignments.set(node, assignments);
    return assignments;
  }

  function projectAssignment(assignment: BindNode, prefix: AstNode[]): BindNode {
    if (prefix.length === 0) return assignment;
    const key = "__assignment_value";
    const previous = projectedValues.get(assignment.rhs);
    const rhs = previous?.value ?? assignment.rhs;
    prefix = [...prefix, ...(previous?.prefix ?? [])];
    const dataPath = rhs.type === "path" && !(rhs as PathNode).group &&
      (rhs as PathNode).steps.every((step) => ["name", "variable", "wildcard", "descendant", "parent"].includes(step.type)) &&
      (rhs as PathNode).steps[0]?.type !== "variable";
    const direct = ["object", "array", "block", "name", "wildcard", "descendant", "parent"].includes(rhs.type);
    const projection: AstNode[] = dataPath ? (rhs as PathNode).steps : direct ? [rhs] : [
      { type: "object", position: assignment.position, entries: [[
        { type: "string", value: key, position: assignment.position }, rhs,
      ]] } as ObjectNode,
      { type: "name", value: key, position: assignment.position },
    ];
    // No matching items leave the caller's binding unchanged.
    const value: ConditionNode = {
      type: "condition", position: assignment.position,
      condition: { type: "value", value: true, position: assignment.position },
      then: { type: "path", steps: [...prefix, ...projection] }, else: { ...assignment.lhs },
    };
    projectedValues.set(value, { value: rhs, prefix });
    return { ...assignment, rhs: value };
  }

  function appendStageAssignments(node: AstNode, assignments: BindNode[]): void {
    const staged = node as AstNode & { stages?: AstNode[]; predicate?: AstNode[]; group?: GroupByNode; tuple?: boolean; focusBinding?: unknown; indexBinding?: unknown };
    if (staged.tuple || staged.focusBinding || staged.indexBinding) return;
    const stages = staged.stages ?? staged.predicate ?? [];
    if (!staged.group && !stages.some((stage) => stage.type === "filter")) return;
    const source = { ...node, stages: undefined, predicate: undefined, group: undefined } as AstNode;
    const prefix = source.type === "path" ? (source as PathNode).steps : [source];
    for (const stage of stages) {
      if (stage.type !== "filter") continue;
      const expression = (stage as unknown as FilterStage).expr;
      const effects = [
        ...collectConstructorAssignments(expression),
        ...(expression.type === "bind" ? [expression as BindNode] : []),
      ];
      assignments.push(...effects.map((assignment) => projectAssignment(assignment, prefix)));
    }
    if (staged.group) {
      const object: ObjectNode = { type: "object", position: 0, entries: staged.group.entries };
      assignments.push(...collectConstructorAssignments(object).map((assignment) => projectAssignment(assignment, prefix)));
    }
  }

  function sortEvaluationTerms(node: SortNode): SortTerm[] {
    if (collectConstructorAssignments(node).length === 0) return node.terms;
    // Later keys and post-sort predicates can observe writes from earlier keys.
    const predicates = (node.predicate ?? []).filter((stage) => stage.type === "filter")
      .map((stage) => runtime.functions.asBooleanExpression((stage as unknown as FilterStage).expr));
    const expressions = [
      ...node.terms.map((term) => term.expression),
      ...predicates,
    ];
    if (expressions.length < 2) return node.terms;
    // Sorting zero or one item skips key evaluation, retaining the old bindings.
    return [...node.terms, ...predicates.map((expression) => ({ descending: false, expression })), {
      descending: false,
      expression: { type: "block", position: node.position ?? 0, expressions },
    }];
  }

  function bindArrayAssignmentEffects(
    node: AstNode,
    scope: ScopeTracker,
    evaluationScope = scope,
  ): ScopeTracker {
    const assignments = collectConstructorAssignments(node);
    if (assignments.length === 0) return scope;
    let scopeCache = assignmentScopes.get(node);
    if (!scopeCache) {
      scopeCache = new WeakMap();
      assignmentScopes.set(node, scopeCache);
    }
    let evaluationCache = scopeCache.get(scope);
    if (!evaluationCache) {
      evaluationCache = new WeakMap();
      scopeCache.set(scope, evaluationCache);
    }
    const cached = evaluationCache.get(evaluationScope);
    if (cached) return cached;
    const choices = new Map<string, AstNode>();
    const writeCounts = new Map<string, number>();
    for (const assignment of assignments) {
      writeCounts.set(assignment.lhs.value, (writeCounts.get(assignment.lhs.value) ?? 0) + 1);
      const previous = choices.get(assignment.lhs.value);
      // Concurrent writes can finish in either order. Retain both values using
      // the existing branch alias and callable merging semantics.
      choices.set(assignment.lhs.value, previous ? {
        type: "condition", position: assignment.position,
        condition: { type: "value", value: true, position: assignment.position },
        then: previous, else: assignment.rhs,
      } : assignment.rhs);
    }
    const bindCaptured = (target: ScopeTracker, name: string, value: AstNode, source: ScopeTracker): ScopeTracker =>
      bindValue(runtime.higherOrder.bindArgumentParameter(
        target, { type: "variable", value: name, position: 0 },
        [...new Set(runtime.aliases.bindingAliasPaths(value, source))], value, source,
      ), name, value, source);
    const selfReads = new Set([...choices].filter(([name, value]) =>
      writeCounts.get(name)! > 1 && collectVariableNames(value).has(name)).map(([name]) => name));
    if (choices.size === 1 && selfReads.size === 0) {
      const [name, value] = choices.entries().next().value!;
      const result = bindCaptured(scope, name, value, evaluationScope);
      evaluationCache.set(evaluationScope, result);
      return result;
    }
    const reference = (name: string): VariableNode => ({ type: "variable", value: name, position: 0 });
    const resolved = new Map<string, ScopeTracker>();
    const resolveAssignment = (name: string, active = new Set<string>()): ScopeTracker => {
      if (active.has(name)) return evaluationScope;
      const cached = resolved.get(name);
      if (cached) return cached;
      const value = choices.get(name)!;
      const dependencies = new Set<string>();
      const pending = [{ node: value, scope: evaluationScope }];
      const visited = new Set<AstNode>();
      // Previously declared callbacks can read variables assigned by a sibling.
      for (const entry of pending) {
        if (visited.has(entry.node)) continue;
        visited.add(entry.node);
        for (const variable of collectVariableNames(entry.node)) {
          if (choices.has(variable)) {
            if (variable !== name) dependencies.add(variable);
          } else {
            const captured = resolveValue(entry.scope, variable);
            if (captured) pending.push(captured);
          }
        }
      }
      let valueScope = evaluationScope;
      for (const dependency of dependencies) {
        const assigned = resolveAssignment(dependency, new Set([...active, name]));
        if (assigned === evaluationScope) continue;
        const before = `\0assignment-before-${dependency}`;
        const after = `\0assignment-after-${dependency}`;
        valueScope = bindCaptured(valueScope, before, reference(dependency), evaluationScope);
        valueScope = bindCaptured(valueScope, after, reference(dependency), assigned);
        valueScope = bindCaptured(valueScope, dependency, {
          type: "condition", position: 0,
          condition: { type: "value", value: true, position: 0 },
          then: reference(before), else: reference(after),
        }, valueScope);
      }
      if (selfReads.has(name)) {
        const original = reference(name);
        const originalPaths = runtime.aliases.bindingAliasPaths(original, evaluationScope);
        const originalSuffix = runtime.aliases.groupResultSuffixBasePaths(original, evaluationScope);
        const callable = runtime.callables.resolveCallableValues(value, valueScope).length > 0 ||
          runtime.callables.resolveBuiltinCallableNames(value, valueScope).length > 0;
        const before = `\0assignment-self-before-${name}`;
        if (callable) valueScope = bindCaptured(valueScope, before, original, evaluationScope);
        for (let index = 1; index < writeCounts.get(name)!; index++) {
          if (callable) {
            const after = `\0assignment-self-after-${name}-${index}`;
            valueScope = bindCaptured(valueScope, after, value, valueScope);
            valueScope = bindCaptured(valueScope, name, {
              type: "condition", position: 0,
              condition: { type: "value", value: true, position: 0 },
              then: reference(before), else: reference(after),
            }, valueScope);
            continue;
          }
          const paths = runtime.aliases.bindingAliasPaths(value, valueScope);
          const suffix = runtime.aliases.groupResultSuffixBasePaths(value, valueScope);
          const object = runtime.aliases.mergeObjectAliases([
            resolveObjectAlias(evaluationScope, name), runtime.aliases.groupResultObjectAliasForNode(value, valueScope),
          ]);
          const dynamic = runtime.aliases.mergeDynamicObjectAliases([
            resolveDynamicObjectAlias(evaluationScope, name), runtime.aliases.groupResultDynamicObjectAliasForNode(value, valueScope),
          ]);
          valueScope = bindVariable(valueScope, name, [...new Set([...originalPaths, ...paths])]);
          if (object) valueScope = bindObjectAlias(valueScope, name, object);
          if (dynamic) valueScope = bindDynamicObjectAlias(valueScope, name, dynamic);
          valueScope = bindSuffixBasePaths(valueScope, name, [...new Set([...originalSuffix, ...suffix])]);
        }
      }
      const result = bindCaptured(evaluationScope, name, value, valueScope);
      resolved.set(name, result);
      return result;
    };
    let nextScope = scope;
    for (const name of choices.keys()) {
      nextScope = bindCaptured(nextScope, name, reference(name), resolveAssignment(name));
    }
    evaluationCache.set(evaluationScope, nextScope);
    return nextScope;
  }

  function constructorEvaluationScopes(node: AstNode, scope: ScopeTracker): ScopeTracker[] {
    const assignments = collectConstructorAssignments(node);
    if (assignments.length === 0) return [scope];
    let reads = assignmentReads.get(node);
    if (reads === undefined) {
      const names = new Set(assignments.map((assignment) => assignment.lhs.value));
      const mayRead = (value: unknown): boolean => {
        if (!value || typeof value !== "object") return false;
        const expression = value as AstNode;
        if (expression.type === "bind") return mayRead((expression as BindNode).rhs);
        if (expression.type === "variable") return names.has((expression as VariableNode).value);
        // Calls can observe captured variables or evaluate a program string.
        if (expression.type === "function" || expression.type === "apply") return true;
        return Object.entries(value).some(([key, child]) => key !== "source" && mayRead(child));
      };
      reads = mayRead(node);
      assignmentReads.set(node, reads);
    }
    if (!reads) return [scope];
    const concurrent = bindArrayAssignmentEffects(node, scope);
    return concurrent === scope ? [scope] : [scope, concurrent];
  }

  /**
   * Walk an AST node and extract all data paths as raw strings.
   * Dispatches on node.type using a switch statement.
   * Threads an immutable scope for variable resolution.
   * Unknown node types return empty array (skip silently).
   */
  function walkNode(node: AstNode, scope: ScopeTracker): string[] {
    const paths = walkNodeReads(node, scope);
    const assignments = collectConstructorAssignments(node);
    if (assignments.length === 0) return paths;
    let scopeCache = iteratedReadCache.get(node);
    if (!scopeCache) {
      scopeCache = new WeakMap();
      iteratedReadCache.set(node, scopeCache);
    }
    const cached = scopeCache.get(scope);
    if (cached) return [...paths, ...cached];
    scopeCache.set(scope, []);
    const projectedAssignments = new Map<string, AstNode[]>();
    for (const assignment of assignments) {
      const projected = projectedValues.get(assignment.rhs);
      if (!projected || projected.value.type === "transform" || projected.value.type === "lambda" && !(projected.value as LambdaNode).thunk) continue;
      const values = projectedAssignments.get(assignment.lhs.value) ?? [];
      values.push(projected.value);
      projectedAssignments.set(assignment.lhs.value, values);
    }
    const descendants: string[] = [];
    for (const assignment of assignments) {
      const projected = projectedValues.get(assignment.rhs);
      if (!projected) continue;
      if (projected.value.type === "transform" || projected.value.type === "lambda" && !(projected.value as LambdaNode).thunk) continue;
      const pending = [{ node: projected.value, scope }];
      const visited = new Set<AstNode>();
      let readsBinding = false;
      for (const entry of pending) {
        if (visited.has(entry.node)) continue;
        visited.add(entry.node);
        const names = collectVariableNames(entry.node);
        if (names.has(assignment.lhs.value)) {
          readsBinding = true;
          break;
        }
        for (const name of names) {
          // A later row can feed a peer assignment's result back into this binding.
          for (const value of projectedAssignments.get(name) ?? []) pending.push({ node: value, scope });
          const captured = resolveValue(entry.scope, name);
          if (captured) pending.push(captured);
        }
      }
      if (readsBinding) descendants.push(
        ...runtime.functions.deepValueReadPaths(assignment.lhs, scope),
        ...runtime.functions.deepValueReadPaths(assignment.rhs, scope),
      );
    }
    const dependencies = markAbsolute([...new Set(descendants)]);
    scopeCache.set(scope, dependencies);
    return [...paths, ...dependencies];
  }

  function walkNodeReads(
    node: AstNode,
    scope: ScopeTracker,
  ): string[] {
    // Ordinary evaluation applies producer predicates and groups before the
    // containing path creates its focus/index tuple bindings.
    const tupleNode = node as AstNode & { focusBinding?: { name: string }; indexBinding?: { name: string } };
    if (node.type !== "path" && node.source && !node.source.tupleStages &&
        [tupleNode.focusBinding?.name, tupleNode.indexBinding?.name].some((name) =>
          name !== undefined && resolveVariable(scope, name) !== null,
        )) {
      node = { ...node, focusBinding: undefined, indexBinding: undefined } as AstNode;
    }
    const group = (node as AstNode & { group?: GroupByNode }).group;
    if (group) {
      const source = { ...node, group: undefined } as AstNode;
      if (runtime.callables.resolveCallableValues(source, scope).length > 0 ||
          runtime.callables.resolveBuiltinCallableNames(source, scope).length > 0) {
        return [...walkNode(source, scope), ...runtime.paths.walkGroupBy(node, scope)];
      }
    }
    const predicate = (node as AstNode & { predicate?: AstNode[] }).predicate;
    const predicateNode = node as AstNode & { focusBinding?: { name: string }; indexBinding?: { name: string } };
    const earlyProducerPredicate = node.source && !node.source.tupleStages;
    if (node.type !== "path" && predicate?.length &&
        (earlyProducerPredicate || !predicateNode.focusBinding && !predicateNode.indexBinding)) {
      const source = { ...node, predicate: undefined } as AstNode;
      const value = earlyProducerPredicate
        ? { ...source, focusBinding: undefined, indexBinding: undefined } as AstNode : source;
      if (runtime.callables.resolveCallableValues(value, scope).length > 0 ||
          runtime.callables.resolveBuiltinCallableNames(value, scope).length > 0) {
        const predicateScope = earlyProducerPredicate ? runtime.aliases.bindStepFocusScope(source, scope) : scope;
        return [...walkNode(source, scope), ...runtime.paths.walkValueFilterStages(predicate, value, predicateScope)];
      }
    }
    switch (node.type) {
      case "path":
        return runtime.paths.walkPath(node as PathNode, scope);
      case "name":
        return [(node as NameNode).value];
      case "wildcard":
        return walkWildcard(node as WildcardNode, scope);
      case "descendant":
        return walkDescendant(node as DescendantNode, scope);
      case "binary":
        return walkBinary(node as BinaryNode, scope);
      case "condition":
        return walkCondition(node as ConditionNode, scope);
      case "block":
        return walkBlock(node as BlockNode, scope);
      case "negate":
        return walkNegate(node as NegateNode, scope);
      case "array":
        return walkArray(node as ArrayNode, scope);
      case "object":
        return walkObject(node as ObjectNode, scope);
      case "bind":
        return walkBind(node as BindNode, scope);
      case "function":
        return runtime.functions.walkFunction(node as FunctionNode, scope);
      case "lambda":
        return runtime.functions.walkLambda(node as LambdaNode, scope);
      case "apply":
        return runtime.functions.walkApply(node as ApplyNode, scope);
      case "partial":
        return runtime.functions.walkPartial(node as PartialNode, scope);
      case "string":
      case "number":
      case "value":
      case "regex":
        return walkLiteralPredicates(node, scope);
      case "variable":
        return runtime.functions.walkVariable(node as VariableNode, scope);
      case "parent":
        // ADV-01: parent operator produces "%" as a literal path segment
        return ["%"];
      case "transform":
        return runtime.transforms.walkTransform(node as TransformNode, scope);
      default:
        // Unknown node type -- skip silently (over-approximate: don't crash)
        return [];
    }
  }

  function walkLiteralPredicates(
    node: AstNode & {
      predicate?: AstNode[];
      group?: GroupByNode;
      focusBinding?: { name: string };
      indexBinding?: { name: string };
    },
    scope: ScopeTracker,
  ): string[] {
    let literalScope = scope;
    if (node.focusBinding) {
      literalScope = bindVariable(childScope(literalScope), node.focusBinding.name, []);
    }
    if (node.indexBinding) {
      if (literalScope === scope) literalScope = childScope(literalScope);
      literalScope = bindVariable(literalScope, node.indexBinding.name, []);
    }
    return [
      ...runtime.paths.walkSourceLessFilterStages(
        node.predicate ?? [],
        literalScope,
      ),
      ...(node.group
        ? runtime.paths.walkSourceLessGroupEntries(node.group, literalScope)
        : []),
    ];
  }

  function walkWildcard(node: WildcardNode, scope: ScopeTracker): string[] {
    const { stageScope, stageVariables, nonPathVariables } = bindBroadStepScope(
      node,
      "*",
      scope,
    );
    return [
      "*",
      ...runtime.paths.walkFilterStages(
        node.predicate ?? [],
        "*",
        stageScope,
        nonPathVariables,
        stageVariables,
      ),
      ...(node.group
        ? runtime.paths.walkContextGroupEntries(node.group, "*", stageScope, stageVariables)
        : []),
    ];
  }

  function walkDescendant(node: DescendantNode, scope: ScopeTracker): string[] {
    const { stageScope, stageVariables, nonPathVariables } = bindBroadStepScope(
      node,
      "**",
      scope,
    );
    return [
      "**",
      ...runtime.paths.walkFilterStages(
        node.predicate ?? [],
        "**",
        stageScope,
        nonPathVariables,
        stageVariables,
      ),
      ...(node.group
        ? runtime.paths.walkContextGroupEntries(node.group, "**", stageScope, stageVariables)
        : []),
    ];
  }

  function bindBroadStepScope(
    node: WildcardNode | DescendantNode,
    basePath: string,
    scope: ScopeTracker,
  ): {
    stageScope: ScopeTracker;
    stageVariables: Set<string>;
    nonPathVariables: Set<string>;
  } {
    let stageScope = scope;
    const stageVariables = new Set<string>();
    const nonPathVariables = new Set<string>();
    if (node.focusBinding) {
      stageScope = bindVariable(childScope(stageScope), node.focusBinding.name, [basePath]);
      stageVariables.add(node.focusBinding.name);
    }
    if (node.indexBinding) {
      if (stageScope === scope) stageScope = childScope(stageScope);
      stageScope = bindVariable(stageScope, node.indexBinding.name, []);
      stageVariables.add(node.indexBinding.name);
      nonPathVariables.add(node.indexBinding.name);
    }
    return { stageScope, stageVariables, nonPathVariables };
  }

  /** Extract paths from both sides of a binary operator. */
  function walkBinary(node: BinaryNode, scope: ScopeTracker): string[] {
    const booleanOperands = node.value === "and" || node.value === "or";
    const rightScope = bindArrayAssignmentEffects(node.lhs, scope);
    const operands = [{ node: node.lhs, scope }, { node: node.rhs, scope: rightScope }];
    const paths = operands.flatMap(({ node: operand, scope: operandScope }) =>
      walkNode(booleanOperands ? runtime.functions.asBooleanExpression(operand) : operand, operandScope),
    );
    if (node.value === "=" || node.value === "!=") {
      const scalarComparison = [node.lhs, node.rhs].some((operand) =>
        ["string", "number", "value"].includes(operand.type),
      );
      for (const { node: operand, scope: operandScope } of operands) {
        const identityPaths = runtime.functions.identityReferencePaths(operand, operandScope);
        if (identityPaths) {
          paths.push(...identityPaths.map((path) => appendPath(path, "**")));
        } else if (!scalarComparison) {
          paths.push(...runtime.functions.deepValueReadPaths(operand, operandScope));
        }
      }
    } else if (node.value === "&") {
      paths.push(...runtime.functions.deepValueReadPaths(node.lhs, scope));
      paths.push(...runtime.functions.deepValueReadPaths(node.rhs, rightScope));
    }
    return paths;
  }

  /** Extract paths from condition, then-branch, and optional else-branch. */
  function walkCondition(node: ConditionNode, scope: ScopeTracker): string[] {
    const branchScope = bindArrayAssignmentEffects(node.condition, scope);
    return [
      ...walkNode(runtime.functions.asBooleanExpression(node.condition), scope),
      ...walkValueExpression(node.then, branchScope),
      ...(node.else ? walkValueExpression(node.else, branchScope) : []),
    ];
  }

  function walkValueExpression(node: AstNode, scope: ScopeTracker): string[] {
    return runtime.callables.resolveCallableValues(node, scope).length > 0
      ? runtime.functions.walkCallableSelection(node, scope)
      : walkNode(node, scope);
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
      const expressionScope = currentScope;
      if (expr.type === "bind") {
        const bindNode = expr as BindNode;
        const closureScope = currentScope;
        const identityPaths = runtime.functions.identityReferencePaths(bindNode.rhs, currentScope);
        const returnsCallable = runtime.callables.resolveCallableValues(bindNode.rhs, currentScope).length > 0;
        const rhsPaths =
          identityPaths ??
          (returnsCallable
            ? runtime.functions.walkCallableSelection(bindNode.rhs, currentScope)
            : walkNode(bindNode.rhs, currentScope));
        if (!identityPaths && bindNode.rhs.type !== "transform") paths.push(...rhsPaths);
        currentScope = bindVariable(
          currentScope,
          bindNode.lhs.value,
          runtime.aliases.bindingAliasPaths(bindNode.rhs, currentScope),
        );
        currentScope = runtime.aliases.bindSuffixBasePathsIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = runtime.aliases.bindObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = runtime.aliases.bindDynamicObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
  
        currentScope = runtime.functions.bindCallableValue(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
      } else if (expr.type === "block") {
        // Inner block: create a child scope so bindings don't leak
        const innerScope = childScope(currentScope);
        paths.push(...walkNode(expr, innerScope));
      } else {
        paths.push(...walkNode(expr, currentScope));
      }
      currentScope = bindArrayAssignmentEffects(expr, currentScope, expressionScope);
    }
  
    if (node.group) {
      const groupScope = runtime.aliases.bindStepFocusScope(node, currentScope);
      const groupStageVariables = new Set(
        node.focusBinding ? [node.focusBinding.name] : [],
      );
      const objectAlias = runtime.aliases.objectAliasFromBlock(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      const suffixBasePaths = runtime.results.getBlockResultSuffixBasePaths(node, scope);
      const resultBasePaths = runtime.aliases.bindingAliasPathsFromBlock(node, scope);
      paths.push(
        ...(objectAlias || dynamicObjectAlias
          ? runtime.paths.walkAliasGroupEntries(
              node.group,
              objectAlias,
              dynamicObjectAlias,
              groupScope,
              suffixBasePaths,
            )
          : resultBasePaths.length > 0
            ? resultBasePaths.flatMap((basePath) =>
                runtime.paths.walkContextGroupEntries(
                  node.group!,
                  basePath,
                  groupScope,
                  groupStageVariables,
                ),
              )
            : runtime.paths.walkSourceLessGroupEntries(node.group, groupScope)),
      );
    }
  
    if (node.predicate && node.predicate.length > 0) {
      const predicateScope = runtime.aliases.bindStepFocusScope(node, currentScope);
      const predicateStageVariables = new Set<string>();
      if (node.focusBinding) predicateStageVariables.add(node.focusBinding.name);
      const objectAlias = runtime.aliases.objectAliasFromBlock(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      if (objectAlias || dynamicObjectAlias) {
        paths.push(
          ...runtime.aliases.walkAliasFilterStages(
            node.predicate, objectAlias, dynamicObjectAlias, predicateScope,
            runtime.results.getBlockResultSuffixBasePaths(node, scope),
          ),
        );
      } else {
        const resultBasePaths = runtime.aliases.bindingAliasPathsFromBlock(node, scope);
        if (resultBasePaths.length === 0) {
          paths.push(
            ...runtime.paths.walkSourceLessFilterStages(
              node.predicate,
              predicateScope,
            ),
          );
        }
        for (const resultBasePath of resultBasePaths) {
          paths.push(
            ...runtime.paths.walkFilterStages(
              node.predicate,
              resultBasePath,
              predicateScope,
              new Set(),
              predicateStageVariables,
            ),
          );
        }
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

  /** Extract paths from negation. */
  function walkNegate(node: NegateNode, scope: ScopeTracker): string[] {
    return node.expression ? walkNode(node.expression, scope) : [];
  }

  /** Extract paths from array constructor entries. */
  function walkArray(node: ArrayNode, scope: ScopeTracker): string[] {
    const paths: string[] = [];
    const concurrentScope = bindArrayAssignmentEffects(node, scope);
    let currentScope = scope;
    for (const expr of node.expressions) {
      // Array entries start concurrently. A sibling may read the entry binding
      // before an assignment completes, or the updated binding after awaiting.
      if (currentScope !== scope) paths.push(...walkValueExpression(expr, scope));
      if (expr.type === "bind") {
        const bindNode = expr as BindNode;
        const closureScope = currentScope;
        const identityPaths = runtime.functions.identityReferencePaths(bindNode.rhs, currentScope);
        const rhsPaths = identityPaths ?? walkValueExpression(bindNode.rhs, currentScope);
        if (!identityPaths) paths.push(...rhsPaths);
        currentScope = bindVariable(
          currentScope,
          bindNode.lhs.value,
          runtime.aliases.bindingAliasPaths(bindNode.rhs, currentScope),
        );
        currentScope = runtime.aliases.bindSuffixBasePathsIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = runtime.aliases.bindObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = runtime.aliases.bindDynamicObjectAliasIfPresent(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
        currentScope = runtime.functions.bindCallableValue(
          currentScope,
          bindNode.lhs.value,
          bindNode.rhs,
          closureScope,
        );
      } else {
        paths.push(...walkValueExpression(expr, currentScope));
      }
    }
    if (concurrentScope !== scope) {
      const seen = new Set(paths);
      for (const expression of node.expressions) {
        for (const path of walkValueExpression(expression, concurrentScope)) {
          if (!seen.has(path)) paths.push(path);
          seen.add(path);
        }
      }
    }
    if (node.predicate && node.predicate.length > 0) {
      let predicateScope = currentScope;
      const predicateStageVariables = new Set<string>();
      const predicateNonPathVariables = new Set<string>();
      const resultBasePaths = runtime.aliases.bindingAliasPaths(node, scope);
  
      if (node.focusBinding) {
        predicateScope = runtime.aliases.bindFocusObjectAliasScope(
          predicateScope,
          node.focusBinding.name,
          runtime.aliases.objectAliasForNode(node, scope),
          runtime.aliases.dynamicObjectAliasForNode(node, scope),
          resultBasePaths,
          runtime.results.getResultSuffixBasePaths(node, scope),
        );
        predicateStageVariables.add(node.focusBinding.name);
      }
      if (node.indexBinding) {
        if (predicateScope === currentScope) predicateScope = childScope(predicateScope);
        predicateScope = bindVariable(predicateScope, node.indexBinding.name, []);
        predicateNonPathVariables.add(node.indexBinding.name);
      }
  
      const objectAlias = runtime.aliases.objectAliasForNode(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      if (objectAlias || dynamicObjectAlias) {
        paths.push(
          ...node.predicate.flatMap((stage) =>
            stage.type === "filter"
              ? runtime.aliases.selectAliasExpressionPaths(
                  objectAlias,
                  dynamicObjectAlias,
                  runtime.functions.asBooleanExpression((stage as unknown as FilterStage).expr),
                  predicateScope,
                  runtime.results.getResultSuffixBasePaths(node, scope),
                )
              : [],
          ),
        );
      } else {
        if (resultBasePaths.length === 0) {
          paths.push(
            ...runtime.paths.walkSourceLessFilterStages(
              node.predicate,
              predicateScope,
            ),
          );
        }
        for (const resultBasePath of resultBasePaths) {
          paths.push(
            ...runtime.paths.walkFilterStages(
              node.predicate,
              resultBasePath,
              predicateScope,
              predicateNonPathVariables,
              predicateStageVariables,
            ),
          );
        }
      }
    }
    if (node.group) {
      const groupScope = runtime.aliases.bindStepFocusScope(node, currentScope);
      const objectAlias = runtime.aliases.objectAliasForNode(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      const resultBasePaths = runtime.aliases.bindingAliasPaths(node, scope);
      const groupStageVariables = new Set(
        node.focusBinding ? [node.focusBinding.name] : [],
      );
      paths.push(
        ...(objectAlias || dynamicObjectAlias
          ? runtime.paths.walkAliasGroupEntries(node.group, objectAlias, dynamicObjectAlias, groupScope)
          : resultBasePaths.length > 0
            ? resultBasePaths.flatMap((basePath) =>
                runtime.paths.walkContextGroupEntries(
                  node.group!,
                  basePath,
                  groupScope,
                  groupStageVariables,
                ),
              )
            : runtime.paths.walkSourceLessGroupEntries(node.group, groupScope)),
      );
    }
    return paths;
  }

  /** Extract value paths from an object constructor. */
  function walkObject(node: ObjectNode, scope: ScopeTracker): string[] {
    const paths = node.entries.flatMap(([key, val]) => [
      ...walkValueExpression(key, scope),
      ...walkValueExpression(val, scope),
    ]);
    const concurrentScope = constructorEvaluationScopes(node, scope)[1];
    if (concurrentScope) {
      for (const [, value] of node.entries) paths.push(...walkValueExpression(value, concurrentScope));
    }
    if (node.predicate && node.predicate.length > 0) {
      const objectAlias = runtime.aliases.objectAliasFromObject(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      const resultBasePaths = node.entries.flatMap(([, value]) =>
        runtime.aliases.bindingAliasPaths(value, scope),
      );
      let predicateScope = scope;
  
      if (node.focusBinding) {
        predicateScope = runtime.aliases.bindFocusObjectAliasScope(
          predicateScope,
          node.focusBinding.name,
          objectAlias,
          dynamicObjectAlias,
          resultBasePaths,
          [],
        );
      }
      if (node.indexBinding) {
        if (predicateScope === scope) predicateScope = childScope(predicateScope);
        predicateScope = bindVariable(predicateScope, node.indexBinding.name, []);
      }
  
      paths.push(...runtime.aliases.walkAliasFilterStages(
        node.predicate, objectAlias, dynamicObjectAlias, predicateScope,
      ));
    }
    if (node.group) {
      const objectAlias = runtime.aliases.objectAliasFromObject(node, scope);
      const dynamicObjectAlias = runtime.aliases.dynamicObjectAliasForNode(node, scope);
      const resultBasePaths = node.entries.flatMap(([, value]) =>
        runtime.aliases.bindingAliasPaths(value, scope),
      );
      let groupScope = scope;
  
      if (node.focusBinding) {
        groupScope = runtime.aliases.bindFocusObjectAliasScope(
          groupScope,
          node.focusBinding.name,
          objectAlias,
          dynamicObjectAlias,
          resultBasePaths,
          [],
        );
      }
      if (node.indexBinding) {
        if (groupScope === scope) groupScope = childScope(groupScope);
        groupScope = bindVariable(groupScope, node.indexBinding.name, []);
      }
  
      paths.push(
        ...runtime.paths.walkAliasGroupEntries(node.group, objectAlias, dynamicObjectAlias, groupScope),
      );
    }
    return paths;
  }

  return {
    walkNode,
    bindBroadStepScope,
    walkArray,
    bindArrayAssignmentEffects,
    sortEvaluationTerms,
    constructorEvaluationScopes,
    walkObject,
  };
}
