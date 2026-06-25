import type { LambdaNode, ObjectNode, PartialNode } from "./types.js";

export interface LambdaBinding {
  readonly lambda: LambdaNode;
  readonly scope: ScopeTracker;
}

export interface PartialBinding {
  readonly partial: PartialNode;
  readonly scope: ScopeTracker;
}

export type ObjectAlias = ReadonlyMap<string, readonly string[]>;

export interface DynamicObjectAliasVariant {
  readonly node: ObjectNode;
  readonly scope: ScopeTracker;
}

export interface DynamicObjectAlias {
  readonly variants: readonly DynamicObjectAliasVariant[];
}

/**
 * Immutable scope chain for variable resolution.
 * Each scope level has its own bindings and a parent pointer.
 * Lookups walk up the chain until found or exhausted.
 *
 * The optional `lambdas` map stores lambda node references
 * for custom function call tracing (SCOPE-05).
 */
export interface ScopeTracker {
  readonly bindings: ReadonlyMap<string, readonly string[]>;
  readonly lambdas: ReadonlyMap<string, LambdaBinding>;
  readonly partials: ReadonlyMap<string, PartialBinding>;
  readonly objectAliases: ReadonlyMap<string, ObjectAlias>;
  readonly dynamicObjectAliases: ReadonlyMap<string, DynamicObjectAlias>;
  readonly suffixBaseBindings: ReadonlyMap<string, readonly string[]>;
  readonly parent: ScopeTracker | null;
}

const EMPTY_SCOPE: ScopeTracker = {
  bindings: new Map(),
  lambdas: new Map(),
  partials: new Map(),
  objectAliases: new Map(),
  dynamicObjectAliases: new Map(),
  suffixBaseBindings: new Map(),
  parent: null,
};

/** Create a new root scope (no parent). */
export function createScope(): ScopeTracker {
  return EMPTY_SCOPE;
}

/** Create a child scope inheriting from parent. */
export function childScope(parent: ScopeTracker): ScopeTracker {
  return {
    bindings: new Map(),
    lambdas: new Map(),
    partials: new Map(),
    objectAliases: new Map(),
    dynamicObjectAliases: new Map(),
    suffixBaseBindings: new Map(),
    parent,
  };
}

/**
 * Bind a variable name to resolved paths in the current scope level.
 * Returns a NEW scope (immutable -- does not modify input).
 * Last-write-wins: replaces any existing binding at this scope level.
 */
export function bindVariable(
  scope: ScopeTracker,
  name: string,
  paths: readonly string[],
): ScopeTracker {
  const newBindings = new Map(scope.bindings);
  const newLambdas = new Map(scope.lambdas);
  const newPartials = new Map(scope.partials);
  const newObjectAliases = new Map(scope.objectAliases);
  const newDynamicObjectAliases = new Map(scope.dynamicObjectAliases);
  const newSuffixBaseBindings = new Map(scope.suffixBaseBindings);
  newBindings.set(name, paths);
  newLambdas.delete(name);
  newPartials.delete(name);
  newObjectAliases.delete(name);
  newDynamicObjectAliases.delete(name);
  newSuffixBaseBindings.delete(name);
  return {
    bindings: newBindings,
    lambdas: newLambdas,
    partials: newPartials,
    objectAliases: newObjectAliases,
    dynamicObjectAliases: newDynamicObjectAliases,
    suffixBaseBindings: newSuffixBaseBindings,
    parent: scope.parent,
  };
}

export function bindSuffixBasePaths(
  scope: ScopeTracker,
  name: string,
  paths: readonly string[],
): ScopeTracker {
  if (paths.length === 0) return scope;

  const newSuffixBaseBindings = new Map(scope.suffixBaseBindings);
  newSuffixBaseBindings.set(name, paths);
  return {
    bindings: scope.bindings,
    lambdas: scope.lambdas,
    partials: scope.partials,
    objectAliases: scope.objectAliases,
    dynamicObjectAliases: scope.dynamicObjectAliases,
    suffixBaseBindings: newSuffixBaseBindings,
    parent: scope.parent,
  };
}

export function bindObjectAlias(
  scope: ScopeTracker,
  name: string,
  alias: ObjectAlias,
): ScopeTracker {
  const newObjectAliases = new Map(scope.objectAliases);
  const newDynamicObjectAliases = new Map(scope.dynamicObjectAliases);
  newObjectAliases.set(name, alias);
  newDynamicObjectAliases.delete(name);
  return {
    bindings: scope.bindings,
    lambdas: scope.lambdas,
    partials: scope.partials,
    objectAliases: newObjectAliases,
    dynamicObjectAliases: newDynamicObjectAliases,
    suffixBaseBindings: scope.suffixBaseBindings,
    parent: scope.parent,
  };
}

export function bindDynamicObjectAlias(
  scope: ScopeTracker,
  name: string,
  alias: DynamicObjectAlias,
): ScopeTracker {
  const newDynamicObjectAliases = new Map(scope.dynamicObjectAliases);
  newDynamicObjectAliases.set(name, alias);
  return {
    bindings: scope.bindings,
    lambdas: scope.lambdas,
    partials: scope.partials,
    objectAliases: scope.objectAliases,
    dynamicObjectAliases: newDynamicObjectAliases,
    suffixBaseBindings: scope.suffixBaseBindings,
    parent: scope.parent,
  };
}

/**
 * Store a lambda node reference in scope for custom function tracing.
 * When `$fn := function($x) { ... }` is encountered, the lambda node
 * is stored so that `$fn(arg)` can resolve parameter bindings.
 */
export function bindLambda(
  scope: ScopeTracker,
  name: string,
  lambda: LambdaNode,
  closureScope: ScopeTracker = scope,
): ScopeTracker {
  const newLambdas = new Map(scope.lambdas);
  newLambdas.set(name, { lambda, scope: closureScope });
  return {
    bindings: scope.bindings,
    lambdas: newLambdas,
    partials: scope.partials,
    objectAliases: scope.objectAliases,
    dynamicObjectAliases: scope.dynamicObjectAliases,
    suffixBaseBindings: scope.suffixBaseBindings,
    parent: scope.parent,
  };
}

export function bindPartial(
  scope: ScopeTracker,
  name: string,
  partial: PartialNode,
  closureScope: ScopeTracker = scope,
): ScopeTracker {
  const newPartials = new Map(scope.partials);
  newPartials.set(name, { partial, scope: closureScope });
  return {
    bindings: scope.bindings,
    lambdas: scope.lambdas,
    partials: newPartials,
    objectAliases: scope.objectAliases,
    dynamicObjectAliases: scope.dynamicObjectAliases,
    suffixBaseBindings: scope.suffixBaseBindings,
    parent: scope.parent,
  };
}

/**
 * Look up a lambda node by variable name, walking up the scope chain.
 * Returns the LambdaNode or null if the variable is not bound to a lambda.
 */
export function resolveLambda(
  scope: ScopeTracker,
  name: string,
): LambdaBinding | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.lambdas.has(name)) {
      return current.lambdas.get(name)!;
    }
    current = current.parent;
  }
  return null;
}

export function resolvePartial(
  scope: ScopeTracker,
  name: string,
): PartialBinding | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.partials.has(name)) {
      return current.partials.get(name)!;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Resolve a variable name by walking up the scope chain.
 * Returns the bound paths or null if unresolvable.
 */
export function resolveVariable(
  scope: ScopeTracker,
  name: string,
): readonly string[] | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.bindings.has(name)) {
      return current.bindings.get(name)!;
    }
    current = current.parent;
  }
  return null; // unresolvable
}

export function resolveSuffixBasePaths(
  scope: ScopeTracker,
  name: string,
): readonly string[] | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.suffixBaseBindings.has(name)) {
      return current.suffixBaseBindings.get(name)!;
    }
    current = current.parent;
  }
  return null;
}

export function resolveObjectAlias(
  scope: ScopeTracker,
  name: string,
): ObjectAlias | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.objectAliases.has(name)) {
      return current.objectAliases.get(name)!;
    }
    current = current.parent;
  }
  return null;
}

export function resolveDynamicObjectAlias(
  scope: ScopeTracker,
  name: string,
): DynamicObjectAlias | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.dynamicObjectAliases.has(name)) {
      return current.dynamicObjectAliases.get(name)!;
    }
    current = current.parent;
  }
  return null;
}
