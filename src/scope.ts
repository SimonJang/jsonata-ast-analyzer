/**
 * Immutable scope chain for variable resolution.
 * Each scope level has its own bindings and a parent pointer.
 * Lookups walk up the chain until found or exhausted.
 */
export interface ScopeTracker {
  readonly bindings: ReadonlyMap<string, readonly string[]>;
  readonly parent: ScopeTracker | null;
}

const EMPTY_SCOPE: ScopeTracker = { bindings: new Map(), parent: null };

/** Create a new root scope (no parent). */
export function createScope(): ScopeTracker {
  return EMPTY_SCOPE;
}

/** Create a child scope inheriting from parent. */
export function childScope(parent: ScopeTracker): ScopeTracker {
  return { bindings: new Map(), parent };
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
  return { bindings: newBindings, parent: scope.parent };
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
