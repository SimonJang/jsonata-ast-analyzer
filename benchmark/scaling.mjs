import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeExpression, extractPaths } from "../dist/index.js";
import { scalingFixtures } from "./fixtures.mjs";

const defaultSizes = [10, 25, 50, 100, 200, 400];
const sizes = (process.env.JSONATA_BENCH_SIZES ?? defaultSizes.join(","))
  .split(",")
  .map(Number)
  .filter((size) => Number.isInteger(size) && size > 0);
const targetDurationMs = Number(process.env.JSONATA_BENCH_TARGET_MS ?? 50);

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function calibratedIterations(expression, analyze) {
  for (let iteration = 0; iteration < 25; iteration++) {
    analyze(expression);
  }

  const calibrationStartedAt = performance.now();
  let calibrationIterations = 0;
  do {
    analyze(expression);
    calibrationIterations++;
  } while (performance.now() - calibrationStartedAt < 10);

  const calibrationDurationMs = Math.max(
    performance.now() - calibrationStartedAt,
    0.1,
  );
  return Math.max(
    3,
    Math.min(
      5000,
      Math.ceil(
        (calibrationIterations / calibrationDurationMs) * targetDurationMs,
      ),
    ),
  );
}

function measurePair(expression, leftAnalyze, rightAnalyze) {
  for (let iteration = 0; iteration < 25; iteration++) {
    leftAnalyze(expression);
    rightAnalyze(expression);
  }

  const iterations = Math.min(
    calibratedIterations(expression, leftAnalyze),
    calibratedIterations(expression, rightAnalyze),
  );
  const leftSamples = [];
  const rightSamples = [];
  let leftResult = [];
  let rightResult = [];

  const measure = (analyze) => {
    const startedAt = performance.now();
    let result = [];
    for (let iteration = 0; iteration < iterations; iteration++) {
      result = analyze(expression);
    }
    return { durationMs: performance.now() - startedAt, result };
  };

  for (let round = 0; round < 6; round++) {
    if (round % 2 === 0) {
      const left = measure(leftAnalyze);
      const right = measure(rightAnalyze);
      leftSamples.push(left.durationMs / iterations);
      rightSamples.push(right.durationMs / iterations);
      leftResult = left.result;
      rightResult = right.result;
    } else {
      const right = measure(rightAnalyze);
      const left = measure(leftAnalyze);
      rightSamples.push(right.durationMs / iterations);
      leftSamples.push(left.durationMs / iterations);
      rightResult = right.result;
      leftResult = left.result;
    }
  }

  return {
    chars: expression.length,
    leftPaths: leftResult.length,
    rightPaths: rightResult.length,
    leftMedianMs: median(leftSamples),
    rightMedianMs: median(rightSamples),
  };
}

const baselineModulePath = process.env.JSONATA_BENCH_BASELINE_MODULE;
const baselineExtractPaths = baselineModulePath
  ? (await import(pathToFileURL(resolve(baselineModulePath)).href)).extractPaths
  : null;
if (baselineModulePath && typeof baselineExtractPaths !== "function") {
  throw new TypeError(
    `Baseline module does not export extractPaths(): ${baselineModulePath}`,
  );
}
const failures = [];

console.log(
  "case,size,chars,paths,extract_median_ms,analyze_median_ms,analyze_ratio,extract_baseline_ratio",
);
for (const [name, createExpression] of Object.entries(scalingFixtures)) {
  for (const size of sizes) {
    const expression = createExpression(size);
    const comparison = measurePair(
      expression,
      extractPaths,
      (value) => analyzeExpression(value).accesses,
    );
    const ratio = comparison.rightMedianMs / comparison.leftMedianMs;
    let extractBaselineRatio = null;
    if (size === 400 && baselineExtractPaths) {
      const baselineComparison = measurePair(
        expression,
        baselineExtractPaths,
        extractPaths,
      );
      extractBaselineRatio =
        baselineComparison.rightMedianMs / baselineComparison.leftMedianMs;
    }
    console.log(
      `${name},${size},${comparison.chars},${comparison.leftPaths},${comparison.leftMedianMs.toFixed(6)},${comparison.rightMedianMs.toFixed(6)},${ratio.toFixed(3)},${extractBaselineRatio?.toFixed(3) ?? ""}`,
    );

    if (size !== 400) continue;
    if (ratio > 2) {
      failures.push(
        `${name}: analyzeExpression ratio ${ratio.toFixed(3)} exceeds 2.000`,
      );
    }
    if (extractBaselineRatio !== null && extractBaselineRatio > 1.1) {
      failures.push(
        `${name}: extractPaths ratio ${extractBaselineRatio.toFixed(3)} exceeds 1.100 against ${baselineModulePath}`,
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`Performance gate failed: ${failure}`);
  process.exitCode = 1;
}
