import { __benchmarkExpression } from "../dist/index.js";
import { smokeFixtures } from "./fixtures.mjs";

const maxDurationMs = Number(process.env.JSONATA_BENCH_MAX_MS ?? 1000);
let failed = false;

for (const expression of smokeFixtures) {
  const stats = __benchmarkExpression(expression);
  const duration = stats.durationMs.toFixed(3);
  console.log(
    `${duration}ms raw=${stats.rawPathCount} unique=${stats.uniquePathCount} ${expression}`,
  );
  if (stats.durationMs > maxDurationMs) failed = true;
}

if (failed) {
  console.error(`Benchmark smoke exceeded ${maxDurationMs}ms`);
  process.exit(1);
}
