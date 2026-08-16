import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HarnessRuntimeInstaller,
  type HarnessPackageInstaller,
} from "../src/main/harness-runtime-installer";
import { readHarnessVersion } from "../src/main/harness-updater";
import { bundledArboristVersion } from "../src/main/harness-package-worker";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runtimeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-managed-runtime-"));
  temporaryDirectories.push(root);
  return root;
}

function fakePackageInstaller(installedVersion?: string): HarnessPackageInstaller {
  return {
    install: async (prefix, version, onStatus) => {
      onStatus("downloading");
      const packageRoot = path.join(prefix, "node_modules", "@deepseek-ai", "dsh");
      mkdirSync(path.join(packageRoot, "lib"), { recursive: true });
      writeFileSync(path.join(packageRoot, "lib", "bin.js"), "");
      writeFileSync(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "@deepseek-ai/dsh", version: installedVersion ?? version }),
      );
    },
  };
}

describe("HarnessRuntimeInstaller", () => {
  it("ships the isolated package installer used by packaged builds", () => {
    expect(bundledArboristVersion()).toBe("9.9.1");
  });

  it("installs into staging and activates only after version verification", async () => {
    const installer = new HarnessRuntimeInstaller(runtimeRoot(), fakePackageInstaller());
    const stages: string[] = [];

    const prepared = await installer.prepare("0.1.0-rc.6", (stage) => stages.push(stage));
    const activated = installer.activate(prepared);
    installer.commit();

    expect(stages).toEqual(["preparing", "downloading", "verifying"]);
    expect(activated.installation.kind).toBe("managed");
    expect(readHarnessVersion(installer.currentRoot)).toBe("0.1.0-rc.6");
  });

  it("recovers a verified staging runtime after the desktop app restarts", async () => {
    const root = runtimeRoot();
    const firstProcess = new HarnessRuntimeInstaller(root, fakePackageInstaller());
    await firstProcess.prepare("0.1.0-rc.6");

    const restartedProcess = new HarnessRuntimeInstaller(root, fakePackageInstaller());
    const prepared = restartedProcess.preparedRuntime("0.1.0-rc.6");

    expect(prepared).toEqual({
      version: "0.1.0-rc.6",
      stagingRoot: path.join(root, "staging"),
    });
  });

  it("restores the previous managed runtime when the new one fails its health check", async () => {
    const installer = new HarnessRuntimeInstaller(runtimeRoot(), fakePackageInstaller());
    installer.activate(await installer.prepare("0.1.0-rc.5"));
    installer.commit();

    installer.activate(await installer.prepare("0.1.0-rc.6"));
    expect(readHarnessVersion(installer.currentRoot)).toBe("0.1.0-rc.6");

    const restored = installer.rollback();

    expect(restored?.kind).toBe("managed");
    expect(readHarnessVersion(installer.currentRoot)).toBe("0.1.0-rc.5");
  });

  it("rejects a mismatched package before it can replace the working runtime", async () => {
    const installer = new HarnessRuntimeInstaller(
      runtimeRoot(),
      fakePackageInstaller("0.1.0-rc.4"),
    );

    await expect(installer.prepare("0.1.0-rc.6")).rejects.toThrow(
      "安装版本校验失败",
    );
    expect(installer.currentInstallation()).toBeUndefined();
  });
});
