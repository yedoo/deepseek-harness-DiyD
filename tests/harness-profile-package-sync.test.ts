import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { synchronizeHarnessProfilePackages } from "../src/main/plugin-package-worker";

const roots: string[] = [];

function writePackage(directory: string, manifest: Record<string, unknown>): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(directory, "index.js"), "module.exports = {};\n");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("synchronizeHarnessProfilePackages", () => {
  it("uses the target core package even when a community plugin declares an outdated peer range", async () => {
    const root = path.join(os.tmpdir(), `dsh-package-sync-${process.pid}-${Date.now()}`);
    roots.push(root);
    const profile = path.join(root, "profile");
    const core = path.join(root, "core");
    const plugin = path.join(root, "plugin");
    writePackage(core, { name: "example-core", version: "2.0.0", main: "index.js" });
    writePackage(plugin, {
      name: "example-plugin",
      version: "1.0.0",
      main: "index.js",
      peerDependencies: { "example-core": "^1.0.0" },
    });
    mkdirSync(profile, { recursive: true });
    writeFileSync(path.join(profile, "package.json"), `${JSON.stringify({
      name: "example-profile",
      private: true,
      dependencies: {
        "example-core": `file:${core}`,
        "example-plugin": `file:${plugin}`,
      },
    }, null, 2)}\n`);

    await synchronizeHarnessProfilePackages(profile, "0.1.1-rc.2");

    const installedCore = JSON.parse(
      readFileSync(path.join(profile, "node_modules", "example-core", "package.json"), "utf8"),
    ) as { version: string };
    expect(installedCore.version).toBe("2.0.0");
  });
});
