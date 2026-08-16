import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveHarnessRoot } from "../src/main/config";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("resolveHarnessRoot", () => {
  it("uses the explicit Harness installation when it contains the CLI", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dsh-desktop-"));
    temporaryDirectories.push(root);
    const cliDirectory = path.join(root, "apps", "cli", "lib");
    mkdirSync(cliDirectory, { recursive: true });
    writeFileSync(path.join(cliDirectory, "bin.js"), "");

    const resolved = resolveHarnessRoot({
      explicitRoot: root,
      appPath: "C:\\app",
      cwd: "C:\\work",
      executablePath: "C:\\app\\desktop.exe",
      resourcesPath: "C:\\app\\resources",
    });

    expect(resolved).toBe(path.resolve(root));
  });

  it("discovers a Harness checkout beside the desktop project", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "dsh-workspace-"));
    temporaryDirectories.push(workspace);
    const desktopRoot = path.join(workspace, "deepseek-harness-desktop");
    const harnessRoot = path.join(workspace, "deepseek-harness");
    const cliDirectory = path.join(harnessRoot, "apps", "cli", "lib");
    mkdirSync(desktopRoot, { recursive: true });
    mkdirSync(cliDirectory, { recursive: true });
    writeFileSync(path.join(cliDirectory, "bin.js"), "");

    const resolved = resolveHarnessRoot({
      appPath: desktopRoot,
      cwd: desktopRoot,
      executablePath: path.join(desktopRoot, "desktop.exe"),
      resourcesPath: path.join(desktopRoot, "resources"),
    });

    expect(resolved).toBe(harnessRoot);
  });
});
