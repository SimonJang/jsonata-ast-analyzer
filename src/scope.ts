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
  /** Identity of the bindings that can affect callable resolution. */
  readonly callableEnvironment: object;
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
interface StoredBindingResolution {
  readonly lambda: LambdaBinding | null;
  readonly partial: PartialBinding | null;
  readonly transform: TransformBinding | null;
  readonly value: ValueBinding | null;
  readonly valueFrame: object | null;
}
const storedBindingResolutionCache = new WeakMap<
  ScopeTracker,
  Map<string, StoredBindingResolution>
>();
const objectIdentityCache = new WeakMap<object, number>();
const callableEnvironmentTransitions = new WeakMap<object, Map<string, object>>();
let nextObjectIdentity = 1;

function objectIdentity(value: object): number {
  const cached = objectIdentityCache.get(value);
  if (cached) return cached;
  const identity = nextObjectIdentity++;
  objectIdentityCache.set(value, identity);
  return identity;
}

function callableEnvironmentAfter(environment: object, operation: string): object {
  let transitions = callableEnvironmentTransitions.get(environment);
  const cached = transitions?.get(operation);
  if (cached) return cached;
  const next = {};
  if (!transitions) {
    transitions = new Map();
    callableEnvironmentTransitions.set(environment, transitions);
  }
  transitions.set(operation, next);
  return next;
}

function canContainCallableValue(node: AstNode): boolean {
  return ![
    "name",
    "string",
    "number",
    "value",
    "regex",
    "binary",
    "unary",
    "negate",
    "parent",
    "wildcard",
    "descendant",
    "operator",
    "bind",
  ].includes(node.type);
}

const EMPTY_SCOPE: ScopeTracker = {
  frame: {},
  callableEnvironment: {},
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
  return { ...EMPTY_SCOPE, frame: {}, callableEnvironment: {} };
}

/** Create a child scope inheriting from parent. */
export function childScope(parent: ScopeTracker): ScopeTracker {
  return {
    frame: {},
    callableEnvironment: parent.callableEnvironment,
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
> & { readonly callableEnvironment?: object };

/** Add an O(1) immutable revision without copying every binding in the frame. */
function reviseScope(scope: ScopeTracker, revision: ScopeRevision): ScopeTracker {
  return {
    frame: scope.frame,
    callableEnvironment: revision.callableEnvironment ?? scope.callableEnvironment,
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
  return reviseScope(scope, {
    bindings: new Map([[name, paths]]),
    callableEnvironment: ["", "$"].includes(name)
      ? scope.callableEnvironment
      : callableEnvironmentAfter(scope.callableEnvironment, `data:${name}`),
  });
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
    callableEnvironment: callableEnvironmentAfter(
      scope.callableEnvironment,
      `object-alias:${name}:${objectIdentity(alias)}`,
    ),
  });
}

export function bindDynamicObjectAlias(
  scope: ScopeTracker,
  name: string,
  alias: DynamicObjectAlias,
): ScopeTracker {
  return reviseScope(scope, {
    dynamicObjectAliases: new Map([[name, alias]]),
    callableEnvironment: callableEnvironmentAfter(
      scope.callableEnvironment,
      `dynamic-object-alias:${name}:${objectIdentity(alias)}`,
    ),
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
    callableEnvironment: callableEnvironmentAfter(
      scope.callableEnvironment,
      `lambda:${name}:${objectIdentity(lambda)}:${objectIdentity(closureScope.callableEnvironment)}`,
    ),
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
    callableEnvironment: callableEnvironmentAfter(
      scope.callableEnvironment,
      `lambda-ref:${name}:${objectIdentity(binding.lambda)}:${objectIdentity(binding.scope.callableEnvironment)}:${objectIdentity(forwardScope.callableEnvironment)}`,
    ),
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
    callableEnvironment: callableEnvironmentAfter(
      scope.callableEnvironment,
      `partial:${name}:${objectIdentity(partial)}:${objectIdentity(closureScope.callableEnvironment)}`,
    ),
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
    callableEnvironment: callableEnvironmentAfter(
      scope.callableEnvironment,
      `transform:${name}:${objectIdentity(transform)}:${objectIdentity(closureScope.callableEnvironment)}`,
    ),
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
    callableEnvironment: canContainCallableValue(node)
      ? callableEnvironmentAfter(
          scope.callableEnvironment,
          `value:${name}:${objectIdentity(node)}:${objectIdentity(closureScope.callableEnvironment)}`,
        )
      : scope.callableEnvironment,
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
  return resolveStoredBindings(scope, name).lambda;
}

export function resolvePartial(
  scope: ScopeTracker,
  name: string,
): PartialBinding | null {
  return resolveStoredBindings(scope, name).partial;
}

export function resolveTransform(
  scope: ScopeTracker,
  name: string,
): TransformBinding | null {
  return resolveStoredBindings(scope, name).transform;
}

export function resolveValue(
  scope: ScopeTracker,
  name: string,
): ValueBinding | null {
  return resolveStoredBindings(scope, name).value;
}

/** Return the lexical frame that owns a resolvable stored value. */
export function resolveValueFrame(
  scope: ScopeTracker,
  name: string,
): object | null {
  return resolveStoredBindings(scope, name).valueFrame;
}

function resolveStoredBindings(
  scope: ScopeTracker,
  name: string,
): StoredBindingResolution {
  const scopeCache = storedBindingResolutionCache.get(scope);
  const cached = scopeCache?.get(name);
  if (cached) return cached;

  let lambda: LambdaBinding | null | undefined;
  let partial: PartialBinding | null | undefined;
  let transform: TransformBinding | null | undefined;
  let value: ValueBinding | null | undefined;
  let valueFrame: object | null | undefined;

  let current: ScopeTracker | null = scope;
  while (current !== null) {
    lambda ??= current.lambdas.get(name);
    partial ??= current.partials.get(name);
    transform ??= current.transforms.get(name);
    if (value === undefined) {
      const storedValue = current.values.get(name);
      if (storedValue) {
        value = storedValue;
        valueFrame = current.frame;
      }
    }
    if (current.bindings.has(name)) {
      break;
    }
    current = previousScope(current);
  }

  const result: StoredBindingResolution = {
    lambda: lambda ?? null,
    partial: partial ?? null,
    transform: transform ?? null,
    value: value ?? null,
    valueFrame: valueFrame ?? null,
  };
  let entries = storedBindingResolutionCache.get(scope);
  if (!entries) {
    entries = new Map();
    storedBindingResolutionCache.set(scope, entries);
  }
  entries.set(name, result);
  return result;
}

/**
 * Resolve a variable name by walking up the scope chain.
 * Returns the bound paths or null if unresolvable.
 */
export function resolveVariable(
  scope: ScopeTracker,
  name: string,
): readonly string[] | null {
  const startingScope = scope;
  let current: ScopeTracker | null = scope;
  while (current !== null) {
    const cached = variableResolutionCache.get(current);
    if (cached?.has(name)) {
      const result = cached.get(name)!;
      cacheVariableResolution(startingScope, name, result);
      return result;
    }
    if (current.bindings.has(name)) {
      const result = current.bindings.get(name)!;
      cacheVariableResolution(startingScope, name, result);
      return result;
    }
    current = previousScope(current);
  }
  cacheVariableResolution(startingScope, name, null);
  return null; // unresolvable
}

function cacheVariableResolution(
  scope: ScopeTracker,
  name: string,
  result: readonly string[] | null,
): void {
  let cached = variableResolutionCache.get(scope);
  if (!cached) {
    cached = new Map();
    variableResolutionCache.set(scope, cached);
  }
  cached.set(name, result);
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
