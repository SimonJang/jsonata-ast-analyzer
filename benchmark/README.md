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

The scaling runner emits CSV with the expression family, generated size, expression length, extracted path count, and median milliseconds per analysis. Override its workload with:

```sh
JSONATA_BENCH_SIZES=50,100,200 JSONATA_BENCH_TARGET_MS=100 pnpm bench:scaling
```

`JSONATA_BENCH_SIZES` selects generated fixture sizes. `JSONATA_BENCH_TARGET_MS` controls the target duration of each measurement round.

## Layout

- `fixtures.mjs` defines the smoke expressions and scaling fixture generators.
- `smoke.mjs` provides the fast threshold check used by `release:check`.
- `scaling.mjs` performs warm, adaptive, median-based scaling measurements.
- `data/` contains timestamped raw CSV snapshots from the performance investigation.

## Recorded data

The snapshots were collected on 2026-08-26 using Node.js 22.23.1 on arm64. Timings are local measurements and should be compared by shape and relative change rather than treated as portable absolute thresholds.

- `data/2026-08-26-before-optimizations.csv` records the original implementation.
- `data/2026-08-26-after-optimizations.csv` records commit `e140de5`.

To record a new clean CSV snapshot without package-manager build output:

```sh
pnpm build
node benchmark/scaling.mjs > benchmark/data/YYYY-MM-DD-description.csv
```
