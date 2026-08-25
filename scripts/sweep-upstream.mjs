import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import jsonata from "jsonata";
import { extractPaths } from "../dist/index.js";

if (!process.argv[2]) {
  throw new Error("Usage: node scripts/sweep-upstream.mjs <jsonata-test-suite-groups>");
}
const suiteRoot = resolve(process.argv[2]);

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function casesFrom(value, file) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => casesFrom(entry, file));
  }
  if (!value || typeof value !== "object") return [];

  const cases = [];
  if (typeof value.expr === "string") {
    cases.push({ expression: value.expr, file });
  }
  if (typeof value["expr-file"] === "string") {
    const expressionFile = join(dirname(file), value["expr-file"]);
    cases.push({ expression: readFileSync(expressionFile, "utf8"), file: expressionFile });
  }
  return cases;
}

function segmentIsPresent(paths, name) {
  return paths.some(({ path }) =>
    path.split(".").some((segment) => segment.replaceAll("[*]", "") === name),
  );
}

function inspectAst(
  node,
  parent,
  index,
  inventory,
  examples,
  missingNames,
  paths,
  expression,
  file,
) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((entry, entryIndex) =>
      inspectAst(
        entry,
        parent,
        entryIndex,
        inventory,
        examples,
        missingNames,
        paths,
        expression,
        file,
      ),
    );
    return;
  }

  if (typeof node.type === "string") {
    const keys = Object.keys(node).sort().join(",");
    if (!inventory.has(node.type)) inventory.set(node.type, new Set());
    inventory.get(node.type).add(keys);
    if (!examples.has(node.type)) examples.set(node.type, []);
    const typeExamples = examples.get(node.type);
    if (
      typeExamples.length < 5 &&
      !typeExamples.some((example) => example.expression === expression)
    ) {
      typeExamples.push({ file, expression, keys });
    }

    if (node.type === "name" && !segmentIsPresent(paths, String(node.value))) {
      missingNames.push({
        name: String(node.value),
        parentType: parent?.type ?? null,
        parentKey: index,
      });
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key !== "ancestor" && key !== "nextFunction") {
      inspectAst(
        value,
        node,
        key,
        inventory,
        examples,
        missingNames,
        paths,
        expression,
        file,
      );
    }
  }
}

const jsonFiles = filesBelow(suiteRoot).filter((file) => extname(file) === ".json");
const cases = jsonFiles.flatMap((file) => {
  try {
    return casesFrom(JSON.parse(readFileSync(file, "utf8")), file);
  } catch {
    return [];
  }
});

const inventory = new Map();
const examples = new Map();
const failures = [];
const missing = [];
let accepted = 0;
const fullMissing = process.env.SWEEP_FULL_MISSING === "1";

for (const { expression, file } of cases) {
  let ast;
  try {
    ast = jsonata(expression).ast();
  } catch {
    continue;
  }
  accepted += 1;

  let paths;
  try {
    paths = extractPaths(expression);
  } catch (error) {
    failures.push({ file, expression, error: String(error) });
    continue;
  }

  const missingNames = [];
  inspectAst(
    ast,
    null,
    null,
    inventory,
    examples,
    missingNames,
    paths,
    expression,
    file,
  );
  if (missingNames.length > 0) {
    missing.push({ file, expression, paths, missingNames });
  }
}

console.log(
  JSON.stringify(
    {
      suiteRoot,
      jsonFiles: jsonFiles.length,
      cases: cases.length,
      accepted,
      failures,
      astInventory: Object.fromEntries(
        [...inventory.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([type, shapes]) => [type, [...shapes].sort()]),
      ),
      astExamples: Object.fromEntries(
        [...examples.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      missingNameCandidateCount: missing.length,
      missingNamesByParent: Object.fromEntries(
        [...missing.flatMap(({ missingNames }) => missingNames)
          .reduce((counts, { parentType, parentKey }) => {
            const key = `${parentType ?? "null"}.${String(parentKey)}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
            return counts;
          }, new Map())]
          .sort(([, left], [, right]) => right - left),
      ),
      missingNameCandidates: fullMissing ? missing : missing.slice(0, 40),
    },
    null,
    2,
  ),
);
