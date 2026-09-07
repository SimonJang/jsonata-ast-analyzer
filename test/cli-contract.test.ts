import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgs = process.argv;
const originalExitCode = process.exitCode;

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("../src/index.js");
  vi.resetModules();
  process.argv = originalArgs;
  process.exitCode = originalExitCode;
});

async function runCli(options: { expression?: string; input?: string; tty?: boolean }) {
  vi.resetModules();
  process.argv = ["node", "jsonata-paths", ...(
    options.expression === undefined ? [] : [options.expression]
  )];
  process.exitCode = undefined;
  const input = Readable.from(options.input === undefined ? [] : [options.input]);
  Object.assign(input, { isTTY: options.tty ?? false });
  vi.spyOn(process, "stdin", "get").mockReturnValue(input as typeof process.stdin);
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  await import("../src/cli.js");
  await vi.waitFor(() => expect(stdout.length + stderr.length).toBeGreaterThan(0));
  return { stdout, stderr, exitCode: process.exitCode };
}

describe("CLI contract", () => {
  it("writes path JSON for its expression argument, taking precedence over stdin", async () => {
    expect(await runCli({ expression: "customer.name", input: "ignored.field" })).toEqual({
      stdout: '[{"path":"customer.name","confidence":"static"}]\n',
      stderr: "",
      exitCode: undefined,
    });
  });

  it("assembles and trims multiline piped input", async () => {
    expect(await runCli({ input: " \ncustomer.\nname\n " })).toEqual({
      stdout: '[{"path":"customer.name","confidence":"static"}]\n',
      stderr: "",
      exitCode: undefined,
    });
  });

  it("reports usage and failure when an interactive invocation supplies no expression", async () => {
    expect(await runCli({ tty: true })).toEqual({
      stdout: "",
      stderr: "Usage: jsonata-paths <expression>\n       echo '<expression>' | jsonata-paths\n",
      exitCode: 1,
    });
  });

  it("reports parser failures on stderr without emitting result JSON", async () => {
    expect(await runCli({ expression: "[" })).toEqual({
      stdout: "",
      stderr: "Error: Expected \"]\" before end of expression\n",
      exitCode: 1,
    });
  });

  it.each([
    { label: "Error", error: new Error("analysis failed"), message: "analysis failed" },
    { label: "string", error: "analysis failed", message: "analysis failed" },
    { label: "null", error: null, message: "null" },
    { label: "object without a message", error: {}, message: "[object Object]" },
  ])("formats an unexpected $label failure from the analyzer", async ({ error, message }) => {
    // Replace only the analyzer boundary: this test owns CLI failure serialization.
    vi.doMock("../src/index.js", () => ({ extractPaths: () => { throw error; } }));
    expect(await runCli({ expression: "customer.name" })).toEqual({
      stdout: "",
      stderr: `Error: ${message}\n`,
      exitCode: 1,
    });
  });
});
