import { parse } from "./parser.js";
import { walkNode } from "./walker.js";
import { createWalker } from "./walker/index.js";
import { bindVariable, createScope, type ScopeTracker } from "./scope.js";
import {
  CURRENT_CONTEXT_PATH,
  PARENT_CONTEXT_PATH,
  ROOT_PATH,
  UNRESOLVED_PATH,
} from "./walker/constants.js";
import type {
  AccessKind,
  AccessOrigin,
  AnalysisDiagnostic,
  AnalysisResult,
  AnalyzeOptions,
  Confidence,
  ContextualAnalysisResult,
  ContextualPathAccess,
  ExternalFunctionContract,
  PathResult,
} from "./types.js";

export type {
  AccessKind,
  AccessOrigin,
  AnalysisDiagnostic,
  AnalysisContext,
  AnalysisResult,
  AnalyzeOptions,
  Confidence,
  ContextualAnalysisResult,
  ContextualPathAccess,
  Coverage,
  ExternalFunctionAccessMode,
  ExternalFunctionContract,
  PathAccess,
  PathResult,
} from "./types.js";

interface AnalysisDetails {
  rawPaths: string[];
  uniquePaths: string[];
}

export interface BenchmarkStats {
  expression: string;
  durationMs: number;
  rawPathCount: number;
  uniquePathCount: number;
}

/**
 * Derive confidence level from a path string.
 * Priority order: "partial" > "dynamic" > "static"
 *
 * - "partial": path contains "%" as a whole dot-separated segment (parent operator)
 * - "dynamic": path contains "[*]" anywhere (unresolvable bracket-filter variable)
 * - "static": fully resolvable at analysis time (all other paths)
 *
 * Note: explicit wildcards like "item.*" and "**.price" are "static" — they are
 * author-written and fully known at analysis time (not dynamically computed).
 *
 * Known edge case: a backtick-escaped field literally named "%" (e.g., `items.`%``) would
 * produce a false "partial" classification. This is accepted per project precedent for
 * pragmatic tradeoffs on vanishingly rare inputs.
 */
function deriveConfidence(path: string): Confidence {
  // Split on "." to check for "%" as a WHOLE segment (not substring of a field name)
  const segments = path.split(".");
  if (segments.includes("%")) return "partial";
  // Check for bracket-wildcard marker injected by walker for dynamic filter paths
  if (path.includes("[*]")) return "dynamic";
  return "static";
}

/**
 * Extract all data paths read from the input object by a JSONata expression.
 *
 * @param expression - A JSONata expression string
 * @returns Deduplicated array of PathResult objects with confidence annotations
 * @throws On invalid JSONata input (parser error propagates unmodified)
 */
export function extractPaths(expression: string): PathResult[] {
  const { uniquePaths } = analyzePaths(expression);
  return uniquePaths.map((path) => ({ path, confidence: deriveConfidence(path) }));
}

function normalizePath(path: string): string {
  return path
    .replace(new RegExp(`^[${ROOT_PATH}${CURRENT_CONTEXT_PATH}${PARENT_CONTEXT_PATH}]\\.?`), "")
    .replace(UNRESOLVED_PATH, "**");
}

function normalizeOpaqueFunctions(options?: AnalyzeOptions): ReadonlySet<string> {
  return new Set(
    (options?.opaqueFunctions ?? []).map((name) => name.replace(/^\$/, "")),
  );
}

function normalizeExternalFunctions(
  options?: AnalyzeOptions,
): ReadonlyMap<string, ExternalFunctionContract> {
  return new Map(
    Object.entries(options?.externalFunctions ?? {}).map(([name, contract]) => [
      name.replace(/^\$/, ""),
      contract,
    ]),
  );
}

function contextualMarkerPath(marker: string, path: string | undefined): string {
  return path ? `${marker}.${path}` : marker;
}

function analysisScope(
  options: AnalyzeOptions | undefined,
  _preserveDefaultCurrent: boolean,
): ScopeTracker {
  let scope = createScope();
  const context = options?.context;
  if (context?.currentPath) {
    scope = bindVariable(scope, "", [
      contextualMarkerPath(CURRENT_CONTEXT_PATH, context?.currentPath),
    ]);
  }
  if (context?.parentVariable && context.parentPath !== undefined) {
    scope = bindVariable(
      scope,
      context.parentVariable.replace(/^\$/, ""),
      [contextualMarkerPath(PARENT_CONTEXT_PATH, context.parentPath)],
    );
  }
  return scope;
}

interface RawAnalysis {
  rawPaths: string[];
  selectedPaths: Set<string>;
}

function analyzeRaw(
  expression: string,
  options: AnalyzeOptions | undefined,
  preserveDefaultCurrent: boolean,
): RawAnalysis {
  const ast = parse(expression);
  return analyzeAst(ast, options, preserveDefaultCurrent);
}

function analyzeAst(
  ast: Parameters<typeof walkNode>[0],
  options: AnalyzeOptions | undefined,
  preserveDefaultCurrent: boolean,
): RawAnalysis {
  const scope = analysisScope(options, preserveDefaultCurrent);
  const walker = createWalker(
    normalizeOpaqueFunctions(options),
    normalizeExternalFunctions(options),
  );
  const rawPaths = walker.walkNode(ast, scope);
  const selectedPaths = new Set([
    ...walker.getSelectedResultPaths(ast, scope),
    ...walker.getExternalSubtreeAccessPaths(),
  ]);
  return { rawPaths, selectedPaths };
}

function diagnosticMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const details = error as Record<string, unknown>;
    const message = typeof details.message === "string" ? details.message : "Unknown JSONata error";
    const context = [
      typeof details.code === "string" ? details.code : null,
      typeof details.position === "number" ? `at position ${details.position}` : null,
      details.token !== undefined ? `near ${JSON.stringify(String(details.token))}` : null,
    ].filter((value): value is string => value !== null);
    return context.length > 0 ? `${context.join(" ")}: ${message}` : message;
  }
  return String(error);
}

function contextualAccessKey(access: {
  path: string;
  origin: AccessOrigin;
  kind: AccessKind;
}): string {
  return `${access.origin}\0${access.kind}\0${access.path}`;
}

function contextualPath(path: string): {
  path: string;
  origin: AccessOrigin;
  kind: AccessKind;
} {
  let origin: AccessOrigin = "current";
  let remainder = path;
  if (remainder.startsWith(ROOT_PATH)) {
    origin = "root";
    remainder = remainder.slice(ROOT_PATH.length).replace(/^\./, "");
  } else if (remainder.startsWith(CURRENT_CONTEXT_PATH)) {
    remainder = remainder.slice(CURRENT_CONTEXT_PATH.length).replace(/^\./, "");
  } else if (remainder.startsWith(PARENT_CONTEXT_PATH)) {
    origin = "parent";
    remainder = remainder.slice(PARENT_CONTEXT_PATH.length).replace(/^\./, "");
  }

  const unresolved = remainder.includes(UNRESOLVED_PATH);
  remainder = remainder
    .split(".")
    .filter((segment) => segment !== UNRESOLVED_PATH)
    .join(".");
  const segments = remainder.split(".");
  const kind: AccessKind = unresolved
    ? "unresolved"
    : remainder.includes("[*]")
      ? "dynamic"
      : segments.includes("*") || segments.includes("**")
        ? "wildcard"
        : "path";
  return { path: remainder, origin, kind };
}

/**
 * Analyze input-path dependencies, including whether each path's complete
 * value is selected into the expression result.
 */
export function analyzeExpression(
  expression: string,
  options?: AnalyzeOptions,
): AnalysisResult {
  const { rawPaths: unresolvedPaths, selectedPaths: rawSelectedPaths } =
    analyzeRaw(expression, options, false);
  const rawPaths = unresolvedPaths
    .map(normalizePath)
    .filter((path) => path !== "");
  const selectedPaths = new Set(
    [...rawSelectedPaths]
      .map(normalizePath)
      .filter((path) => path !== ""),
  );
  const uniquePaths = [...new Set(rawPaths)];
  return {
    accesses: uniquePaths.map((path) => ({
      path,
      confidence: deriveConfidence(path),
      coverage: selectedPaths.has(path) ? "subtree" : "exact",
    })),
  };
}

/**
 * Analyze dependencies while retaining whether each access starts at the
 * absolute root, current host context, or parent host context.
 */
export function analyzeExpressionWithContext(
  expression: string,
  options?: AnalyzeOptions,
): ContextualAnalysisResult {
  let ast: Parameters<typeof walkNode>[0];
  try {
    ast = parse(expression);
  } catch (error) {
    return {
      accesses: [],
      diagnostics: [{ kind: "parse", message: diagnosticMessage(error) }],
    };
  }

  let rawAnalysis: RawAnalysis;
  try {
    rawAnalysis = analyzeAst(ast, options, true);
  } catch (error) {
    return {
      accesses: [],
      diagnostics: [{ kind: "analysis", message: diagnosticMessage(error) }],
    };
  }
  const { rawPaths, selectedPaths } = rawAnalysis;
  const selectedAccesses = new Set(
    [...selectedPaths].map((path) => contextualAccessKey(contextualPath(path))),
  );
  const merged = new Map<string, ContextualPathAccess>();

  for (const rawPath of rawPaths) {
    const decoded = contextualPath(rawPath);
    const key = contextualAccessKey(decoded);
    const selected = selectedAccesses.has(key);
    const candidate: ContextualPathAccess = {
      ...decoded,
      confidence: deriveConfidence(decoded.path),
      coverage: selected ? "subtree" : "exact",
    };
    const existing = merged.get(key);
    if (!existing || candidate.coverage === "subtree") merged.set(key, candidate);
  }

  return { accesses: [...merged.values()], diagnostics: [] };
}

function analyzePaths(expression: string): AnalysisDetails {
  const ast = parse(expression);
  const scope = createScope();
  const rawPaths = walkNode(ast, scope)
    .map(normalizePath)
    .filter((path) => path !== "");
  return { rawPaths, uniquePaths: [...new Set(rawPaths)] };
}

/** Internal release-check helper; not part of the public API contract. */
export function __benchmarkExpression(expression: string): BenchmarkStats {
  const startedAt = performance.now();
  const { rawPaths, uniquePaths } = analyzePaths(expression);
  return {
    expression,
    durationMs: performance.now() - startedAt,
    rawPathCount: rawPaths.length,
    uniquePathCount: uniquePaths.length,
  };
}
