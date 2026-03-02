import type { LambdaNode } from "./types.js";

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
  readonly lambdas: ReadonlyMap<string, LambdaNode>;
  readonly parent: ScopeTracker | null;
}

const EMPTY_SCOPE: ScopeTracker = {
  bindings: new Map(),
  lambdas: new Map(),
  parent: null,
};

/** Create a new root scope (no parent). */
export function createScope(): ScopeTracker {
  return EMPTY_SCOPE;
}

/** Create a child scope inheriting from parent. */
export function childScope(parent: ScopeTracker): ScopeTracker {
  return { bindings: new Map(), lambdas: new Map(), parent };
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
  newBindings.set(name, paths);
  return { bindings: newBindings, lambdas: scope.lambdas, parent: scope.parent };
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
): ScopeTracker {
  const newLambdas = new Map(scope.lambdas);
  newLambdas.set(name, lambda);
  return { bindings: scope.bindings, lambdas: newLambdas, parent: scope.parent };
}

/**
 * Look up a lambda node by variable name, walking up the scope chain.
 * Returns the LambdaNode or null if the variable is not bound to a lambda.
 */
export function resolveLambda(
  scope: ScopeTracker,
  name: string,
): LambdaNode | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.lambdas.has(name)) {
      return current.lambdas.get(name)!;
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
