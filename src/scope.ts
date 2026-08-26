import type {
  AstNode,
  LambdaNode,
  ObjectNode,
  PartialNode,
  TransformNode,
} from "./types.js";

export interface LambdaBinding {
  readonly lambda: LambdaNode;
  readonly scope: ScopeTracker;
  readonly name?: string;
  readonly forwardScope?: ScopeTracker;
}

export interface PartialBinding {
  readonly partial: PartialNode;
  readonly scope: ScopeTracker;
}

export interface TransformBinding {
  readonly transform: TransformNode;
  readonly scope: ScopeTracker;
}

export interface ValueBinding {
  readonly node: AstNode;
  readonly scope: ScopeTracker;
}

export type ObjectAlias = ReadonlyMap<string, readonly string[]>;

export interface DynamicObjectAliasVariant {
  readonly node: ObjectNode;
  readonly scope: ScopeTracker;
  readonly parentDataArgPaths?: readonly string[];
  readonly contextBasePaths?: readonly string[];
  readonly prefixSteps?: readonly string[];
}

export interface DynamicObjectAlias {
  readonly variants: readonly DynamicObjectAliasVariant[];
}

/**
 * Immutable scope chain for variable resolution.
 * Lexical levels have a parent pointer; updates within one level use revisions.
 * Lookups walk up the chain until found or exhausted.
 *
 * The optional `lambdas` map stores lambda node references
 * for custom function call tracing (SCOPE-05).
 */
export interface ScopeTracker {
  /** Stable identity shared by immutable revisions of one lexical frame. */
  readonly frame: object;
  readonly bindings: ReadonlyMap<string, readonly string[]>;
  readonly lambdas: ReadonlyMap<string, LambdaBinding>;
  readonly partials: ReadonlyMap<string, PartialBinding>;
  readonly transforms: ReadonlyMap<string, TransformBinding>;
  readonly values: ReadonlyMap<string, ValueBinding>;
  readonly objectAliases: ReadonlyMap<string, ObjectAlias>;
  readonly dynamicObjectAliases: ReadonlyMap<string, DynamicObjectAlias>;
  readonly suffixBaseBindings: ReadonlyMap<string, readonly string[]>;
  /** Previous immutable revision of this lexical frame. */
  readonly previous: ScopeTracker | null;
  /** Dynamic aliases explicitly cleared by a newer object-alias binding. */
  readonly clearedDynamicObjectAliases: ReadonlySet<string>;
  readonly parent: ScopeTracker | null;
}

const EMPTY_MAP = new Map();
const EMPTY_SET = new Set<string>();
const variableResolutionCache = new WeakMap<
  ScopeTracker,
  Map<string, readonly string[] | null>
>();

const EMPTY_SCOPE: ScopeTracker = {
  frame: {},
  bindings: EMPTY_MAP,
  lambdas: EMPTY_MAP,
  partials: EMPTY_MAP,
  transforms: EMPTY_MAP,
  values: EMPTY_MAP,
  objectAliases: EMPTY_MAP,
  dynamicObjectAliases: EMPTY_MAP,
  suffixBaseBindings: EMPTY_MAP,
  previous: null,
  clearedDynamicObjectAliases: EMPTY_SET,
  parent: null,
};

/** Create a new root scope (no parent). */
export function createScope(): ScopeTracker {
  return EMPTY_SCOPE;
}

/** Create a child scope inheriting from parent. */
export function childScope(parent: ScopeTracker): ScopeTracker {
  return {
    frame: {},
    bindings: EMPTY_MAP,
    lambdas: EMPTY_MAP,
    partials: EMPTY_MAP,
    transforms: EMPTY_MAP,
    values: EMPTY_MAP,
    objectAliases: EMPTY_MAP,
    dynamicObjectAliases: EMPTY_MAP,
    suffixBaseBindings: EMPTY_MAP,
    previous: null,
    clearedDynamicObjectAliases: EMPTY_SET,
    parent,
  };
}

type ScopeRevision = Partial<
  Pick<
    ScopeTracker,
    | "bindings"
    | "lambdas"
    | "partials"
    | "transforms"
    | "values"
    | "objectAliases"
    | "dynamicObjectAliases"
    | "suffixBaseBindings"
    | "clearedDynamicObjectAliases"
  >
>;

/** Add an O(1) immutable revision without copying every binding in the frame. */
function reviseScope(scope: ScopeTracker, revision: ScopeRevision): ScopeTracker {
  return {
    frame: scope.frame,
    bindings: revision.bindings ?? EMPTY_MAP,
    lambdas: revision.lambdas ?? EMPTY_MAP,
    partials: revision.partials ?? EMPTY_MAP,
    transforms: revision.transforms ?? EMPTY_MAP,
    values: revision.values ?? EMPTY_MAP,
    objectAliases: revision.objectAliases ?? EMPTY_MAP,
    dynamicObjectAliases: revision.dynamicObjectAliases ?? EMPTY_MAP,
    suffixBaseBindings: revision.suffixBaseBindings ?? EMPTY_MAP,
    previous: scope,
    clearedDynamicObjectAliases:
      revision.clearedDynamicObjectAliases ?? EMPTY_SET,
    parent: scope.parent,
  };
}

function previousScope(scope: ScopeTracker): ScopeTracker | null {
  return scope.previous ?? scope.parent;
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
  return reviseScope(scope, { bindings: new Map([[name, paths]]) });
}

export function bindSuffixBasePaths(
  scope: ScopeTracker,
  name: string,
  paths: readonly string[],
): ScopeTracker {
  if (paths.length === 0) return scope;

  return reviseScope(scope, {
    suffixBaseBindings: new Map([[name, paths]]),
  });
}

export function bindObjectAlias(
  scope: ScopeTracker,
  name: string,
  alias: ObjectAlias,
): ScopeTracker {
  return reviseScope(scope, {
    objectAliases: new Map([[name, alias]]),
    clearedDynamicObjectAliases: new Set([name]),
  });
}

export function bindDynamicObjectAlias(
  scope: ScopeTracker,
  name: string,
  alias: DynamicObjectAlias,
): ScopeTracker {
  return reviseScope(scope, {
    dynamicObjectAliases: new Map([[name, alias]]),
  });
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
  return reviseScope(scope, {
    lambdas: new Map([[name, { lambda, scope: closureScope, name }]]),
  });
}

export function bindLambdaReference(
  scope: ScopeTracker,
  name: string,
  binding: LambdaBinding,
  forwardScope: ScopeTracker,
): ScopeTracker {
  return reviseScope(scope, {
    lambdas: new Map([
      [
        name,
        {
          ...binding,
          name: binding.name ?? name,
          forwardScope,
        },
      ],
    ]),
  });
}

export function bindPartial(
  scope: ScopeTracker,
  name: string,
  partial: PartialNode,
  closureScope: ScopeTracker = scope,
): ScopeTracker {
  return reviseScope(scope, {
    partials: new Map([[name, { partial, scope: closureScope }]]),
  });
}

export function bindTransform(
  scope: ScopeTracker,
  name: string,
  transform: TransformNode,
  closureScope: ScopeTracker = scope,
): ScopeTracker {
  return reviseScope(scope, {
    transforms: new Map([[name, { transform, scope: closureScope }]]),
  });
}

export function bindValue(
  scope: ScopeTracker,
  name: string,
  node: AstNode,
  closureScope: ScopeTracker = scope,
): ScopeTracker {
  return reviseScope(scope, {
    values: new Map([[name, { node, scope: closureScope }]]),
  });
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
    if (current.bindings.has(name)) {
      return null;
    }
    current = previousScope(current);
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
    if (current.bindings.has(name)) {
      return null;
    }
    current = previousScope(current);
  }
  return null;
}

export function resolveTransform(
  scope: ScopeTracker,
  name: string,
): TransformBinding | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.transforms.has(name)) {
      return current.transforms.get(name)!;
    }
    if (current.bindings.has(name)) {
      return null;
    }
    current = previousScope(current);
  }
  return null;
}

export function resolveValue(
  scope: ScopeTracker,
  name: string,
): ValueBinding | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.values.has(name)) return current.values.get(name)!;
    if (current.bindings.has(name)) return null;
    current = previousScope(current);
  }
  return null;
}

/** Return the lexical frame that owns a resolvable stored value. */
export function resolveValueFrame(
  scope: ScopeTracker,
  name: string,
): object | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.values.has(name)) return current.frame;
    if (current.bindings.has(name)) return null;
    current = previousScope(current);
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
  const visited: ScopeTracker[] = [];
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    const cached = variableResolutionCache.get(current);
    if (cached?.has(name)) {
      const result = cached.get(name)!;
      cacheVariableResolution(visited, name, result);
      return result;
    }
    visited.push(current);
    if (current.bindings.has(name)) {
      const result = current.bindings.get(name)!;
      cacheVariableResolution(visited, name, result);
      return result;
    }
    current = previousScope(current);
  }
  cacheVariableResolution(visited, name, null);
  return null; // unresolvable
}

function cacheVariableResolution(
  scopes: ScopeTracker[],
  name: string,
  result: readonly string[] | null,
): void {
  for (const scope of scopes) {
    let cached = variableResolutionCache.get(scope);
    if (!cached) {
      cached = new Map();
      variableResolutionCache.set(scope, cached);
    }
    cached.set(name, result);
  }
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
    if (current.bindings.has(name)) {
      return null;
    }
    current = previousScope(current);
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
    if (current.bindings.has(name)) {
      return null;
    }
    current = previousScope(current);
  }
  return null;
}

export function resolveDynamicObjectAlias(
  scope: ScopeTracker,
  name: string,
): DynamicObjectAlias | null {
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    if (current.clearedDynamicObjectAliases.has(name)) return null;
    if (current.dynamicObjectAliases.has(name)) {
      return current.dynamicObjectAliases.get(name)!;
    }
    if (current.bindings.has(name)) {
      return null;
    }
    current = previousScope(current);
  }
  return null;
}
