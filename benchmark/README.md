# Benchmarks

This directory contains repository-only performance tools and result snapshots for the analyzer. It is excluded from the npm package by the `files` allowlist in `package.json`.

## Commands

Run the quick release-check smoke benchmark:

```sh
pnpm bench
```

Run the warm synthetic scaling suite:

```sh
pnpm bench:scaling
```

Run the redacted production-shaped resolver and projection suite:

```sh
pnpm bench:production-shaped
```

The scaling runner emits CSV with the expression family, generated size, expression length, extracted path count, medians for both public APIs, their ratio, and an optional comparison-release ratio. At size 400 it always enforces that `analyzeExpression()` remains within 2x the same-run `extractPaths()` median. Override its workload with:

```sh
JSONATA_BENCH_SIZES=50,100,200 JSONATA_BENCH_TARGET_MS=100 pnpm bench:scaling
```

`JSONATA_BENCH_SIZES` selects generated fixture sizes. `JSONATA_BENCH_TARGET_MS` controls the target duration of each measurement round. Runs that omit size 400 report measurements without applying the release gates.

To enforce the 10% `extractPaths()` regression gate without relying on machine-specific historical timings, build the comparison release and provide its ESM entry point. The runner measures the two implementations in alternating rounds in the same process:

```sh
JSONATA_BENCH_BASELINE_MODULE=/absolute/path/to/v1.0.3/dist/index.js pnpm bench:scaling
```

## Layout

- `fixtures.mjs` defines the smoke expressions and scaling fixture generators.
- `smoke.mjs` provides the fast threshold check used by `release:check`.
- `scaling.mjs` performs warm, adaptive, median-based scaling measurements.
- `production-shaped.mjs` reports median, p95, and maximum call latency for minimized production topologies.
- `data/` contains timestamped raw CSV snapshots from the performance investigation.

## Recorded data

The snapshots were collected on 2026-08-26 using Node.js 22.23.1 on arm64. Timings are local measurements and should be compared by shape and relative change rather than treated as portable absolute thresholds.

- `data/2026-08-26-before-optimizations.csv` records the original implementation.
- `data/2026-08-26-after-optimizations.csv` records commit `e140de5`.
- `data/2026-08-27-coverage-analysis.csv` records the `1.1.0` size-400 release gates against both public APIs and the built `v1.0.3` baseline.

To record a new clean CSV snapshot without package-manager build output:

```sh
pnpm build
node benchmark/scaling.mjs > benchmark/data/YYYY-MM-DD-description.csv
```
