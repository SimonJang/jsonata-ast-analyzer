import { performance } from "node:perf_hooks";

import { analyzeExpression } from "../dist/index.js";
import { productionShapedFixtures } from "./fixtures.mjs";

const warmRepetitions = Number(process.env.JSONATA_PRODUCTION_BENCH_REPETITIONS ?? 10);
const maximumCallMs = Number(process.env.JSONATA_PRODUCTION_BENCH_MAX_MS ?? 500);

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const failures = [];
console.log("case,paths,median_ms,p95_ms,max_ms");

for (const [name, expression] of Object.entries(productionShapedFixtures)) {
  analyzeExpression(expression);
  const samples = [];
  let pathCount = 0;
  for (let repetition = 0; repetition < warmRepetitions; repetition += 1) {
    const startedAt = performance.now();
    pathCount = analyzeExpression(expression).accesses.length;
    samples.push(performance.now() - startedAt);
  }

  const medianMs = percentile(samples, 0.5);
  const p95Ms = percentile(samples, 0.95);
  const maxMs = Math.max(...samples);
  console.log(
    `${name},${pathCount},${medianMs.toFixed(3)},${p95Ms.toFixed(3)},${maxMs.toFixed(3)}`,
  );
  if (maxMs > maximumCallMs) {
    failures.push(`${name}: ${maxMs.toFixed(3)}ms exceeds ${maximumCallMs}ms`);
  }
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`Performance gate failed: ${failure}`));
  process.exitCode = 1;
}
