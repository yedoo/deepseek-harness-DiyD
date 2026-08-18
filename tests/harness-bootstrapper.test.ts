import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessBootstrapper } from "../src/main/harness-bootstrapper";
import {
  HarnessRuntimeInstaller,
  type HarnessPackageInstaller,
} from "../src/main/harness-runtime-installer";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runtimeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-bootstrap-"));
  temporaryDirectories.push(root);
  return root;
}

function fakePackageInstaller(): HarnessPackageInstaller {
  return {
    install: async (prefix, version, onStatus) => {
      onStatus("downloading");
      const packageRoot = path.join(prefix, "node_modules", "@deepseek-ai", "dsh");
      mkdirSync(path.join(packageRoot, "lib"), { recursive: true });
      writeFileSync(path.join(packageRoot, "lib", "bin.js"), "");
      writeFileSync(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "@deepseek-ai/dsh", version }),
      );
    },
  };
}

describe("HarnessBootstrapper", () => {
  it("installs and verifies the latest Harness before making it the managed runtime", async () => {
    const runtime = new HarnessRuntimeInstaller(runtimeRoot(), fakePackageInstaller());
    const verifier = vi.fn(async () => undefined);
    const stages: string[] = [];
    const bootstrapper = new HarnessBootstrapper(runtime, async () => "0.1.0-rc.7");

    const installation = await bootstrapper.install(
      (stage) => stages.push(stage),
      verifier,
    );

    expect(stages).toEqual([
      "checking",
      "preparing",
      "downloading",
      "verifying",
      "starting",
    ]);
    expect(verifier).toHaveBeenCalledOnce();
    expect(verifier).toHaveBeenCalledWith(installation);
    expect(installation.kind).toBe("managed");
    expect(runtime.currentInstallation()).toEqual(installation);
  });

  it("rolls back a failed first launch and reuses the verified download on retry", async () => {
    const installPackage = vi.fn(fakePackageInstaller().install);
    const runtime = new HarnessRuntimeInstaller(runtimeRoot(), { install: installPackage });
    const bootstrapper = new HarnessBootstrapper(runtime, async () => "0.1.0-rc.7");

    await expect(bootstrapper.install(
      () => undefined,
      async () => {
        throw new Error("Harness startup probe failed");
      },
    )).rejects.toThrow("Harness startup probe failed");
    expect(runtime.currentInstallation()).toBeUndefined();

    const retryStages: string[] = [];
    const installation = await bootstrapper.install(
      (stage) => retryStages.push(stage),
      async () => undefined,
    );

    expect(installPackage).toHaveBeenCalledOnce();
    expect(retryStages).toEqual(["checking", "starting"]);
    expect(runtime.currentInstallation()).toEqual(installation);
  });
});
