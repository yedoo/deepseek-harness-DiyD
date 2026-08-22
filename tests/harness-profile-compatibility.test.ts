import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HarnessProfileCompatibility,
  type HarnessProfilePackageSynchronizer,
} from "../src/main/harness-profile-compatibility";

const roots: string[] = [];

function createProfile(): { dataRoot: string; profileDirectory: string } {
  const dataRoot = path.join(os.tmpdir(), `dsh-profile-${process.pid}-${roots.length}`);
  const profileDirectory = path.join(dataRoot, "profiles", "web");
  roots.push(dataRoot);
  mkdirSync(path.join(profileDirectory, "node_modules"), { recursive: true });
  writeFileSync(path.join(profileDirectory, "node_modules", "old-runtime.txt"), "rc.7");
  writeFileSync(path.join(profileDirectory, "package-lock.json"), "old lock");
  writeFileSync(path.join(profileDirectory, "package.json"), `${JSON.stringify({
    name: "dsh-profile-web",
    private: true,
    dependencies: { "dsh-plugin-wallpaper-engine": "^0.1.3" },
    dsh: {
      profile: {
        bundles: [
          "@deepseek-ai/dsh-base",
          "@deepseek-ai/dsh-web-app",
          "dsh-plugin-wallpaper-engine",
        ],
      },
    },
  }, null, 2)}\n`);
  return { dataRoot, profileDirectory };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("HarnessProfileCompatibility", () => {
  it("keeps community plugins while aligning the profile with the target Harness runtime", async () => {
    const { dataRoot, profileDirectory } = createProfile();
    const synchronizer: HarnessProfilePackageSynchronizer = {
      async synchronize(directory, version) {
        expect(directory).toBe(profileDirectory);
        expect(version).toBe("0.1.1-rc.2");
        const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")) as {
          dependencies: Record<string, string>;
          dsh: { profile: { bundles: string[] } };
        };
        expect(manifest.dependencies).toEqual({
          "@deepseek-ai/dsh-base": "0.1.1-rc.2",
          "@deepseek-ai/dsh-web-app": "0.1.1-rc.2",
          "dsh-plugin-wallpaper-engine": "^0.1.3",
        });
        expect(manifest.dsh.profile.bundles).toContain("dsh-plugin-wallpaper-engine");
        expect(existsSync(path.join(directory, "node_modules", "old-runtime.txt"))).toBe(false);
        mkdirSync(path.join(directory, "node_modules"), { recursive: true });
        writeFileSync(path.join(directory, "node_modules", "new-runtime.txt"), version);
        writeFileSync(path.join(directory, "package-lock.json"), "new lock");
      },
    };
    const compatibility = new HarnessProfileCompatibility(synchronizer);

    await compatibility.verify(dataRoot, "0.1.1-rc.2", async () => {
      expect(readFileSync(path.join(profileDirectory, "node_modules", "new-runtime.txt"), "utf8"))
        .toBe("0.1.1-rc.2");
    });

    const committed = JSON.parse(readFileSync(path.join(profileDirectory, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(committed.dependencies["dsh-plugin-wallpaper-engine"]).toBe("^0.1.3");
    expect(readFileSync(path.join(profileDirectory, "package-lock.json"), "utf8")).toBe("new lock");
  });

  it("restores the previous plugin runtime when the target Harness cannot start", async () => {
    const { dataRoot, profileDirectory } = createProfile();
    const originalManifest = readFileSync(path.join(profileDirectory, "package.json"), "utf8");
    const compatibility = new HarnessProfileCompatibility({
      async synchronize(directory) {
        mkdirSync(path.join(directory, "node_modules"), { recursive: true });
        writeFileSync(path.join(directory, "node_modules", "new-runtime.txt"), "broken");
        writeFileSync(path.join(directory, "package-lock.json"), "new lock");
      },
    });

    await expect(compatibility.verify(dataRoot, "0.1.1-rc.2", async () => {
      throw new Error("HTTP 400");
    })).rejects.toThrow("HTTP 400");

    expect(readFileSync(path.join(profileDirectory, "package.json"), "utf8")).toBe(originalManifest);
    expect(readFileSync(path.join(profileDirectory, "node_modules", "old-runtime.txt"), "utf8"))
      .toBe("rc.7");
    expect(existsSync(path.join(profileDirectory, "node_modules", "new-runtime.txt"))).toBe(false);
    expect(readFileSync(path.join(profileDirectory, "package-lock.json"), "utf8")).toBe("old lock");
  });

  it("recovers an interrupted profile migration before retrying the update", async () => {
    const { dataRoot, profileDirectory } = createProfile();
    renameSync(
      path.join(profileDirectory, "package.json"),
      path.join(profileDirectory, "package.desktop-harness-update.json"),
    );
    renameSync(
      path.join(profileDirectory, "node_modules"),
      path.join(profileDirectory, "node_modules.desktop-harness-update"),
    );
    renameSync(
      path.join(profileDirectory, "package-lock.json"),
      path.join(profileDirectory, "package-lock.desktop-harness-update.json"),
    );
    writeFileSync(path.join(profileDirectory, "package.json"), "{\"partial\":true}\n");
    mkdirSync(path.join(profileDirectory, "node_modules"));
    writeFileSync(path.join(profileDirectory, "node_modules", "partial.txt"), "partial");
    const compatibility = new HarnessProfileCompatibility({
      async synchronize(directory) {
        expect(existsSync(path.join(directory, "node_modules", "partial.txt"))).toBe(false);
        mkdirSync(path.join(directory, "node_modules"), { recursive: true });
        writeFileSync(path.join(directory, "node_modules", "new-runtime.txt"), "ready");
      },
    });

    await compatibility.verify(dataRoot, "0.1.1-rc.2", async () => undefined);

    expect(readFileSync(path.join(profileDirectory, "node_modules", "new-runtime.txt"), "utf8"))
      .toBe("ready");
    expect(existsSync(path.join(profileDirectory, "package.desktop-harness-update.json"))).toBe(false);
  });
});
