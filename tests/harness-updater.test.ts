import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchLatestHarnessVersion,
  HarnessUpdater,
  readHarnessVersion,
} from "../src/main/harness-updater";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("HarnessUpdater", () => {
  it("detects a newer official npm prerelease", async () => {
    const updater = new HarnessUpdater("0.1.0-rc.5", async () => "0.1.0-rc.6");

    await updater.check();

    expect(updater.getState()).toEqual({
      phase: "available",
      currentVersion: "0.1.0-rc.5",
      version: "0.1.0-rc.6",
    });
  });

  it("reads the release version from the official npm metadata endpoint", async () => {
    const fakeFetch: typeof fetch = async (input) => {
      expect(String(input)).toBe("https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest");
      return new Response(JSON.stringify({ version: "0.1.0-rc.6" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await expect(fetchLatestHarnessVersion(fakeFetch)).resolves.toBe("0.1.0-rc.6");
  });

  it("reads the installed Harness CLI version from its checkout", () => {
    const harnessRoot = mkdtempSync(path.join(tmpdir(), "dsh-harness-version-"));
    temporaryDirectories.push(harnessRoot);
    const cliRoot = path.join(harnessRoot, "apps", "cli");
    mkdirSync(cliRoot, { recursive: true });
    mkdirSync(path.join(cliRoot, "lib"), { recursive: true });
    writeFileSync(path.join(cliRoot, "lib", "bin.js"), "");
    writeFileSync(
      path.join(cliRoot, "package.json"),
      JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.1.0-rc.5" }),
    );

    expect(readHarnessVersion(harnessRoot)).toBe("0.1.0-rc.5");
  });

  it("installs a detected version in-app and reports each safe-switch stage", async () => {
    const stages: string[] = [];
    const updater = new HarnessUpdater(
      "0.1.0-rc.5",
      async () => "0.1.0-rc.6",
      async (_version, onStage) => {
        for (const stage of ["downloading", "verifying", "switching", "restarting"] as const) {
          stages.push(stage);
          onStage(stage);
        }
      },
    );

    await updater.check();
    await updater.install();

    expect(stages).toEqual(["downloading", "verifying", "switching", "restarting"]);
    expect(updater.getState()).toEqual({
      phase: "up-to-date",
      currentVersion: "0.1.0-rc.6",
    });
  });

  it("keeps the old version actionable when an in-app install fails", async () => {
    const updater = new HarnessUpdater(
      "0.1.0-rc.5",
      async () => "0.1.0-rc.6",
      async () => {
        throw new Error("health check failed");
      },
    );

    await updater.check();
    await updater.install();

    expect(updater.getState()).toEqual({
      phase: "error",
      currentVersion: "0.1.0-rc.5",
      version: "0.1.0-rc.6",
      message: "health check failed",
      operation: "install",
    });
  });
});
