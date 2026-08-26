import { performance } from "node:perf_hooks";
import { extractPaths } from "../dist/index.js";

const defaultSizes = [10, 25, 50, 100, 200, 400];
const sizes = (process.env.JSONATA_BENCH_SIZES ?? defaultSizes.join(","))
  .split(",")
  .map(Number)
  .filter((size) => Number.isInteger(size) && size > 0);
const targetDurationMs = Number(process.env.JSONATA_BENCH_TARGET_MS ?? 50);

const fixtures = {
  "long-path": (size) =>
    Array.from({ length: size }, (_, index) => `f${index}`).join("."),
  "wide-binary": (size) =>
    Array.from({ length: size }, (_, index) => `f${index}`).join(" + "),
  "wide-object": (size) =>
    `{${Array.from(
      { length: size },
      (_, index) => `"k${index}": f${index}`,
    ).join(",")}}`,
  "many-bindings": (size) =>
    `(${Array.from(
      { length: size },
      (_, index) => `$v${index} := root.f${index}`,
    ).join(";")}; $v${size - 1})`,
  "alias-chain": (size) =>
    `($v0 := root; ${Array.from(
      { length: size - 1 },
      (_, index) => `$v${index + 1} := $v${index}.f${index}`,
    ).join(";")}; $v${size - 1})`,
  "wide-filter": (size) =>
    `items[${Array.from(
      { length: size },
      (_, index) => `f${index}`,
    ).join(" and ")}]`,
  "repeated-path": (size) =>
    Array.from({ length: size }, () => "root.same").join(" + "),
};

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(expression) {
  for (let iteration = 0; iteration < 25; iteration++) {
    extractPaths(expression);
  }

  const calibrationStartedAt = performance.now();
  let calibrationIterations = 0;
  do {
    extractPaths(expression);
    calibrationIterations++;
  } while (performance.now() - calibrationStartedAt < 10);

  const calibrationDurationMs = Math.max(
    performance.now() - calibrationStartedAt,
    0.1,
  );
  const iterations = Math.max(
    3,
    Math.min(
      5000,
      Math.ceil(
        (calibrationIterations / calibrationDurationMs) * targetDurationMs,
      ),
    ),
  );
  const samples = [];
  let result = [];

  for (let round = 0; round < 5; round++) {
    const startedAt = performance.now();
    for (let iteration = 0; iteration < iterations; iteration++) {
      result = extractPaths(expression);
    }
    samples.push((performance.now() - startedAt) / iterations);
  }

  return {
    chars: expression.length,
    paths: result.length,
    medianMs: median(samples),
  };
}

console.log("case,size,chars,paths,median_ms");
for (const [name, createExpression] of Object.entries(fixtures)) {
  for (const size of sizes) {
    const expression = createExpression(size);
    const result = measure(expression);
    console.log(
      `${name},${size},${result.chars},${result.paths},${result.medianMs.toFixed(6)}`,
    );
  }
}
