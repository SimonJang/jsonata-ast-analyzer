/** Set of all JSONata built-in function names (without $ prefix). */
export const BUILTIN_FUNCTIONS = new Set([
  // Aggregation
  "sum", "count", "max", "min", "average",
  // String
  "string", "length", "substring", "substringBefore", "substringAfter",
  "uppercase", "lowercase", "trim", "pad", "contains", "split", "join",
  "match", "replace",
  // Numeric
  "number", "floor", "ceil", "round", "power", "sqrt", "random",
  // Boolean
  "boolean", "not", "exists",
  // Array
  "append", "sort", "reverse", "shuffle", "distinct", "zip",
  // Object
  "keys", "values", "spread", "merge", "each", "error",
  // Type
  "type", "clone",
  // Higher-order
  "map", "filter", "single", "reduce", "sift", "lookup",
  // Date/Time
  "now", "millis", "fromMillis", "toMillis",
  // Encoding
  "base64encode", "base64decode",
  "encodeUrlComponent", "encodeUrl", "decodeUrlComponent", "decodeUrl",
  // Other
  "assert",
]);

/**
 * Higher-order function parameter semantics.
 * Maps function name -> parameter position -> semantic role.
 *
 * Roles:
 * - "element"/"value"/"left"/"right"/"curr" -> bound to first argument's element paths
 * - "index"/"key" -> non-data-path (skip, like positional variables)
 * - "array"/"accumulator"/"prev" -> bound to first argument's paths (full collection)
 */
export const HIGHER_ORDER_SEMANTICS: Record<string, Record<number, string>> = {
  map:    { 0: "element", 1: "index", 2: "array" },
  filter: { 0: "element", 1: "index", 2: "array" },
  single: { 0: "element", 1: "index", 2: "array" },
  each:   { 0: "value", 1: "key" },
  reduce: { 0: "accumulator", 1: "element", 2: "array" },
  sift:   { 0: "value", 1: "key" },
  sort:   { 0: "left", 1: "right" },
};
