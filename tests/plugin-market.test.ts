import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findInstalledDependency,
  parseInstallSpec,
  parseRegistryCatalog,
  PluginMarketService,
  type PluginPackageInstaller,
} from "../src/main/plugin-market";
import type { PluginDiscoveryProvider } from "../src/main/plugin-discovery";
import { reconcileProfileBundles } from "../src/main/plugin-package-worker";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-plugin-market-"));
  temporaryDirectories.push(root);
  return root;
}

function catalog() {
  return {
    updated: "2026-08-17",
    categories: {
      ui: { zh: "界面增强", en: "UI Enhancements" },
      vision: { zh: "视觉", en: "Vision" },
    },
    plugins: [
      {
        name: "DSH-better-sidebar",
        owner: "omdsh-dev",
        url: "https://github.com/omdsh-dev/DSH-better-sidebar",
        category: "ui",
        description: { zh: "侧边栏工作台" },
        npm: "dsh-better-sidebar",
        stars: 1714,
        install: "dsh plugin --profile web add dsh-better-sidebar",
        added: "2026-08-01",
      },
      {
        name: "modlens",
        owner: "liustack",
        url: "https://github.com/liustack/modlens",
        category: "vision",
        description: { zh: "视觉桥梁" },
        npm: "@liustack/modlens",
        stars: 2478,
        install: "dsh plugin --profile web add @liustack/modlens",
      },
    ],
  };
}

function writeProfile(dataRoot: string, dependencies: Record<string, string> = {}): string {
  const profile = path.join(dataRoot, "profiles", "web");
  mkdirSync(profile, { recursive: true });
  writeFileSync(
    path.join(profile, "package.json"),
    `${JSON.stringify({
      private: true,
      dependencies,
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } },
    }, null, 2)}\n`,
  );
  return profile;
}

function writeInstalledDshPlugin(
  profile: string,
  name = "dsh-plugin-wallpaper-engine",
): void {
  const packageRoot = path.join(profile, "node_modules", name);
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify({
      name,
      version: "0.1.3",
      description: "Wallpaper Engine backgrounds for DeepSeek Harness",
      repository: "https://github.com/elysia395/dsh-wallpaper-engine",
      keywords: ["dsh", "wallpaper", "theme"],
      dsh: {
        bundle: { patch: "./cordis.patch.yml" },
        client: { platform: "web" },
      },
    }, null, 2)}\n`,
  );
}

describe("plugin market catalog", () => {
  it("accepts curated GitHub entries and rejects arbitrary install arguments", () => {
    const parsed = parseRegistryCatalog(catalog());

    expect(parsed.plugins).toHaveLength(2);
    expect(parseInstallSpec(parsed.plugins[0]!.install)).toBe("dsh-better-sidebar");
    expect(parseInstallSpec("dsh plugin --profile web add --global evil")).toBeUndefined();
  });

  it("recognizes npm and GitHub dependencies without trusting renderer state", () => {
    const [npmPlugin] = parseRegistryCatalog(catalog()).plugins;
    expect(findInstalledDependency(npmPlugin!, { "dsh-better-sidebar": "^1.0.0" })).toBe(
      "dsh-better-sidebar",
    );

    const githubPlugin = {
      ...npmPlugin!,
      npm: null,
      url: "https://github.com/example/plugin/tree/main/packages/dsh",
      install: "dsh plugin --profile web add github:example/plugin#path:/packages/dsh",
    };
    expect(findInstalledDependency(githubPlugin, { "actual-package": "github:example/plugin#main" })).toBe(
      "actual-package",
    );
  });

  it("adds and removes only dependency-managed bundles", () => {
    const root = temporaryRoot();
    const profile = writeProfile(root, { "new-plugin": "1.0.0" });
    const packageRoot = path.join(profile, "node_modules", "new-plugin");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
    );
    const before = {
      dependencies: {},
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } },
    };
    const after = JSON.parse(readFileSync(path.join(profile, "package.json"), "utf8"));

    expect(reconcileProfileBundles(profile, before, after).bundles).toEqual([
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "new-plugin",
    ]);
  });
});

describe("PluginMarketService", () => {
  it("recovers installed community plugins on startup and can disable or enable them without uninstalling", async () => {
    const root = temporaryRoot();
    const dataRoot = path.join(root, "data");
    const profile = writeProfile(dataRoot, { "dsh-plugin-wallpaper-engine": "^0.1.3" });
    writeInstalledDshPlugin(profile);
    const manifestPath = path.join(profile, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.dsh.profile.bundles.push("dsh-plugin-wallpaper-engine");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const statePath = path.join(root, "market", "state.json");
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify({
      installed: { "npm:dsh-plugin-wallpaper-engine": "dsh-plugin-wallpaper-engine" },
      restartRequired: false,
    }, null, 2)}\n`);
    const options = {
      dataRoot: () => dataRoot,
      cacheDirectory: path.join(root, "market"),
      statePath,
      catalogCachePath: path.join(root, "market", "catalog.json"),
      packageInstaller: { run: async () => { throw new Error("toggle must not run npm"); } },
      restartSupported: () => true,
      fetchCatalog: async () => catalog(),
    } satisfies ConstructorParameters<typeof PluginMarketService>[0];
    const service = new PluginMarketService(options);

    const initial = await service.list();
    const installed = initial.plugins.find((entry) => entry.id === "npm:dsh-plugin-wallpaper-engine");
    expect(installed).toMatchObject({
      installed: true,
      enabled: true,
      canToggle: true,
      dependencyName: "dsh-plugin-wallpaper-engine",
    });

    const disabled = await service.setEnabled("npm:dsh-plugin-wallpaper-engine", false);
    expect(disabled.plugin).toMatchObject({ installed: true, enabled: false, canToggle: true });
    let updatedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(updatedManifest.dependencies["dsh-plugin-wallpaper-engine"]).toBe("^0.1.3");
    expect(updatedManifest.dsh.profile.bundles).not.toContain("dsh-plugin-wallpaper-engine");

    const reloaded = new PluginMarketService(options);
    expect(
      (await reloaded.list()).plugins.find((entry) => entry.id === "npm:dsh-plugin-wallpaper-engine"),
    ).toMatchObject({ installed: true, enabled: false, canToggle: true });

    const enabled = await reloaded.setEnabled("npm:dsh-plugin-wallpaper-engine", true);
    expect(enabled.plugin).toMatchObject({ installed: true, enabled: true, canToggle: true });
    updatedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(
      updatedManifest.dsh.profile.bundles.filter(
        (bundle: string) => bundle === "dsh-plugin-wallpaper-engine",
      ),
    ).toHaveLength(1);
  });

  it("loads the live schema, marks installed plugins, and persists install state", async () => {
    const root = temporaryRoot();
    const dataRoot = path.join(root, "data");
    const profile = writeProfile(dataRoot, { "dsh-better-sidebar": "^1.0.0" });
    const installer: PluginPackageInstaller = {
      run: async (operation, _profile, target) => {
        const manifestPath = path.join(profile, "package.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (operation === "add") {
          manifest.dependencies["@liustack/modlens"] = target;
        } else {
          delete manifest.dependencies[target];
        }
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        return { dependencies: manifest.dependencies, bundles: manifest.dsh.profile.bundles };
      },
    };
    const service = new PluginMarketService({
      dataRoot: () => dataRoot,
      cacheDirectory: path.join(root, "market"),
      statePath: path.join(root, "market", "state.json"),
      catalogCachePath: path.join(root, "market", "catalog.json"),
      packageInstaller: installer,
      restartSupported: () => true,
      fetchCatalog: async () => catalog(),
    });

    const initial = await service.list();
    expect(initial.plugins.find((entry) => entry.name === "DSH-better-sidebar")?.installed).toBe(true);
    expect(initial.source).toBe("network");

    const installed = await service.install("https://github.com/liustack/modlens");
    expect(installed.snapshot.plugins.find((entry) => entry.name === "modlens")?.installed).toBe(true);
    expect(installed.message).toContain("重启 Harness 后生效");
    expect(installed.restartSupported).toBe(true);

    const removed = await service.remove("https://github.com/liustack/modlens");
    expect(removed.snapshot.plugins.find((entry) => entry.name === "modlens")?.installed).toBe(false);
  });

  it("installs a server-verified online result and rejects a forged id", async () => {
    const root = temporaryRoot();
    const dataRoot = path.join(root, "data");
    const profile = writeProfile(dataRoot);
    const onlinePlugin = {
      id: "npm:dsh-plugin-wallpaper-engine",
      name: "dsh-plugin-wallpaper-engine",
      owner: "elysia395",
      url: "https://github.com/elysia395/dsh-wallpaper-engine",
      category: "theme",
      description: "Wallpaper Engine backgrounds",
      stars: 18,
      installCommand: "dsh plugin --profile web add dsh-plugin-wallpaper-engine",
      installed: false,
      enabled: false,
      canToggle: false,
      source: "npm" as const,
      reviewStatus: "community" as const,
      version: "0.1.3",
    };
    const discovery: PluginDiscoveryProvider = {
      search: async (query) => ({
        query,
        plugins: [onlinePlugin],
        warnings: [],
        searchedAt: "2026-08-17T00:00:00.000Z",
      }),
    };
    const installer: PluginPackageInstaller = {
      run: async (operation, _profile, target) => {
        const manifestPath = path.join(profile, "package.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (operation === "add") {
          manifest.dependencies["dsh-plugin-wallpaper-engine"] = target;
        } else {
          delete manifest.dependencies[target];
        }
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        return { dependencies: manifest.dependencies, bundles: manifest.dsh.profile.bundles };
      },
    };
    const service = new PluginMarketService({
      dataRoot: () => dataRoot,
      cacheDirectory: path.join(root, "market"),
      statePath: path.join(root, "market", "state.json"),
      catalogCachePath: path.join(root, "market", "catalog.json"),
      packageInstaller: installer,
      restartSupported: () => true,
      fetchCatalog: async () => catalog(),
      discovery,
    });

    await expect(service.install(onlinePlugin.id)).rejects.toThrow("重新搜索");
    const search = await service.search("wallpaper");
    expect(search.plugins[0]?.reviewStatus).toBe("community");
    const installed = await service.install(onlinePlugin.id);
    expect(installed.plugin?.installed).toBe(true);
    expect(installed.plugin?.dependencyName).toBe("dsh-plugin-wallpaper-engine");
    const removed = await service.remove(onlinePlugin.id);
    expect(removed.plugin?.installed).toBe(false);
    expect(removed.plugin?.dependencyName).toBeUndefined();
  });
});
