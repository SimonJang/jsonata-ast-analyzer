import { extractPaths } from "./index.js";
import { createInterface } from "node:readline";

async function main(): Promise<void> {
  let expression: string;

  if (process.argv[2] !== undefined) {
    // Mode 1: expression passed as CLI argument
    expression = process.argv[2];
  } else if (!process.stdin.isTTY) {
    // Mode 2: expression piped via stdin
    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      lines.push(line);
    }
    expression = lines.join("\n").trim();
  } else {
    // No input — interactive TTY with no argument
    process.stderr.write(
      "Usage: jsonata-paths <expression>\n" +
      "       echo '<expression>' | jsonata-paths\n"
    );
    process.exitCode = 1;
    return;
  }

  try {
    const paths = extractPaths(expression);
    process.stdout.write(JSON.stringify(paths) + "\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}

main();
