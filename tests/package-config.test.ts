import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  build?: {
    nsis?: Record<string, unknown>;
  };
}

describe("Windows package configuration", () => {
  it("uses a one-click per-user installer for the ready-to-use desktop flow", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as PackageManifest;

    expect(manifest.build?.nsis).toMatchObject({
      oneClick: true,
      perMachine: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
    });
    expect(manifest.build?.nsis).not.toHaveProperty("allowToChangeInstallationDirectory");
  });
});
