import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunningHarnessLocator } from "../src/main/running-harness-locator";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("RunningHarnessLocator", () => {
  it("finds the Harness checkout behind an already-running web process", async () => {
    const harnessRoot = mkdtempSync(path.join(tmpdir(), "Deep Seek Harness "));
    temporaryDirectories.push(harnessRoot);
    const cliEntry = path.join(harnessRoot, "apps", "cli", "lib", "bin.js");
    mkdirSync(path.dirname(cliEntry), { recursive: true });
    writeFileSync(cliEntry, "// fixture");
    const locator = new RunningHarnessLocator(async () => [
      '"C:\\Program Files\\nodejs\\node.exe" unrelated.js',
      `"C:\\Program Files\\nodejs\\node.exe" "${cliEntry}" web --host 127.0.0.1 --port 3080`,
    ]);

    await expect(locator.find()).resolves.toBe(harnessRoot);
  });
});
