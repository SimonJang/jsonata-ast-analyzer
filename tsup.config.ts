import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Library entry: generates type declarations, sourcemap, cleans dist/ first
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    // CLI entry: shebang injected via banner, no type declarations needed for a binary
    // NOTE: clean is intentionally omitted — would wipe the library output built above
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
