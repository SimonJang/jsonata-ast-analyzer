export const ROOT_PATH = "\0";

export const TRANSFORM_CURRENT_PATH = "\u0001";

export const PATH_PRESERVING_RESULT_FUNCTIONS = new Set([
  "lookup",
  "filter",
  "single",
  "sort",
  "append",
  "zip",
  "reverse",
  "shuffle",
  "distinct",
  "merge",
  "spread",
  "sift",
  "clone",
]);

export const IMPLICIT_ROOT_SHALLOW_FUNCTIONS = new Set([
  "keys",
  "spread",
  "boolean",
  "not",
]);

export const IMPLICIT_ROOT_DEEP_FUNCTIONS = new Set(["clone", "string"]);

export const MATCHER_CALLBACK_FUNCTIONS = new Set([
  "contains",
  "match",
  "replace",
  "split",
]);

export const CONTEXT_DEFAULT_BUILTINS = new Set([
  "string",
  "substring",
  "substringBefore",
  "substringAfter",
  "lowercase",
  "uppercase",
  "length",
  "trim",
  "pad",
  "match",
  "contains",
  "replace",
  "split",
  "formatNumber",
  "formatBase",
  "formatInteger",
  "parseInteger",
  "number",
  "floor",
  "ceil",
  "round",
  "abs",
  "sqrt",
  "power",
  "boolean",
  "not",
  "sift",
  "keys",
  "lookup",
  "spread",
  "each",
  "base64encode",
  "base64decode",
  "encodeUrlComponent",
  "encodeUrl",
  "decodeUrlComponent",
  "decodeUrl",
  "toMillis",
  "fromMillis",
  "clone",
]);
