import { describe, expect, it } from "vitest";
import {
  inspectDshPluginManifest,
  NetworkPluginDiscovery,
  normalizeGithubRepository,
} from "../src/main/plugin-discovery";

function npmMetadata(name: string, dsh: unknown = { bundle: { patch: "./cordis.patch.yml" } }) {
  return {
    "dist-tags": { latest: "0.1.3" },
    versions: {
      "0.1.3": {
        name,
        version: "0.1.3",
        description: "Wallpaper Engine backgrounds for DSH",
        repository: { url: "git+https://github.com/elysia395/dsh-wallpaper-engine.git" },
        keywords: ["dsh-plugin", "wallpaper"],
        dsh,
        scripts: { prepare: "node scripts/prepare.mjs" },
      },
    },
    time: { "0.1.3": "2026-08-17T00:00:00.000Z" },
  };
}

describe("NetworkPluginDiscovery", () => {
  it("recognizes explicit DSH bundle and client declarations", () => {
    expect(inspectDshPluginManifest({ dsh: { bundle: { patch: "./patch.yml" } } }).compatible).toBe(true);
    expect(inspectDshPluginManifest({ dsh: { client: { platform: "web" } } }).compatible).toBe(true);
    expect(inspectDshPluginManifest({ keywords: ["dsh-plugin"] }).compatible).toBe(false);
  });

  it("normalizes common GitHub repository forms", () => {
    expect(normalizeGithubRepository("git+https://github.com/owner/repo.git")).toBe(
      "https://github.com/owner/repo",
    );
    expect(normalizeGithubRepository({ url: "git@github.com:owner/repo.git" })).toBe(
      "https://github.com/owner/repo",
    );
  });

  it("finds an npm package only after verifying its published manifest", async () => {
    const discovery = new NetworkPluginDiscovery({
      now: () => new Date("2026-08-17T01:00:00.000Z"),
      fetchJson: async (url) => {
        if (url.includes("/-/v1/search")) {
          return { objects: [{ package: { name: "dsh-plugin-wallpaper-engine" } }] };
        }
        if (url.includes("registry.npmjs.org/dsh-plugin-wallpaper-engine")) {
          return npmMetadata("dsh-plugin-wallpaper-engine");
        }
        if (url.includes("api.github.com/search/repositories")) {
          return { items: [] };
        }
        throw new Error(`unexpected url ${url}`);
      },
    });

    const result = await discovery.search("dsh-plugin-wallpaper-engine");
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]).toMatchObject({
      id: "npm:dsh-plugin-wallpaper-engine",
      source: "npm",
      reviewStatus: "community",
      version: "0.1.3",
      installScripts: ["prepare"],
    });
  });

  it("drops ordinary npm packages that only mention DSH in their keywords", async () => {
    const discovery = new NetworkPluginDiscovery({
      fetchJson: async (url) => {
        if (url.includes("/-/v1/search")) {
          return { objects: [{ package: { name: "not-a-plugin" } }] };
        }
        if (url.includes("registry.npmjs.org")) {
          return npmMetadata("not-a-plugin", null);
        }
        if (url.includes("api.github.com/search/repositories")) {
          return { items: [] };
        }
        throw new Error(`unexpected url ${url}`);
      },
    });

    expect((await discovery.search("not-a-plugin")).plugins).toEqual([]);
  });

  it("does not expose internal @deepseek-ai runtime packages as user plugins", async () => {
    const discovery = new NetworkPluginDiscovery({
      fetchJson: async (url) => {
        if (url.includes("/-/v1/search")) {
          return { objects: [{ package: { name: "@deepseek-ai/dsh-client-ui-theme" } }] };
        }
        if (url.includes("registry.npmjs.org")) {
          return npmMetadata("@deepseek-ai/dsh-client-ui-theme", { client: { platform: "web" } });
        }
        if (url.includes("api.github.com/search/repositories")) return { items: [] };
        throw new Error(`unexpected url ${url}`);
      },
    });

    expect((await discovery.search("dsh theme")).plugins).toEqual([]);
  });

  it("accepts a direct GitHub repository only when its package manifest is compatible", async () => {
    const discovery = new NetworkPluginDiscovery({
      fetchJson: async (url) => {
        if (url.includes("/-/v1/search")) return { objects: [] };
        if (url.includes("api.github.com/repos/elysia395/dsh-wallpaper-engine")) {
          return {
            full_name: "elysia395/dsh-wallpaper-engine",
            html_url: "https://github.com/elysia395/dsh-wallpaper-engine",
            default_branch: "main",
            owner: { login: "elysia395" },
            description: "Wallpaper Engine for DSH",
            stargazers_count: 18,
            updated_at: "2026-08-17T00:00:00Z",
          };
        }
        if (url.includes("raw.githubusercontent.com")) {
          return npmMetadata("unused").versions["0.1.3"];
        }
        throw new Error(`unexpected url ${url}`);
      },
    });

    const result = await discovery.search("https://github.com/elysia395/dsh-wallpaper-engine");
    expect(result.plugins[0]).toMatchObject({
      id: "github:elysia395/dsh-wallpaper-engine",
      source: "github",
      stars: 18,
    });
  });

  it("keeps the npm install target, enriches duplicate GitHub metadata, and caches the query", async () => {
    let requests = 0;
    const discovery = new NetworkPluginDiscovery({
      now: () => new Date("2026-08-17T01:00:00.000Z"),
      fetchJson: async (url) => {
        requests += 1;
        if (url.includes("/-/v1/search")) {
          return { objects: [{ package: { name: "dsh-plugin-wallpaper-engine" } }] };
        }
        if (url.includes("registry.npmjs.org/dsh-plugin-wallpaper-engine")) {
          return npmMetadata("dsh-plugin-wallpaper-engine");
        }
        if (url.includes("api.github.com/search/repositories")) {
          return { items: [{
            full_name: "elysia395/dsh-wallpaper-engine",
            html_url: "https://github.com/elysia395/dsh-wallpaper-engine",
            default_branch: "main",
            owner: { login: "elysia395" },
            description: "Wallpaper Engine for DSH",
            stargazers_count: 18,
            updated_at: "2026-08-17T00:00:00Z",
          }] };
        }
        if (url.includes("raw.githubusercontent.com")) {
          return npmMetadata("dsh-plugin-wallpaper-engine").versions["0.1.3"];
        }
        throw new Error(`unexpected url ${url}`);
      },
    });

    const first = await discovery.search("dsh-plugin-wallpaper-engine");
    const countAfterFirst = requests;
    const second = await discovery.search("dsh-plugin-wallpaper-engine");
    expect(first.plugins).toHaveLength(1);
    expect(first.plugins[0]).toMatchObject({ source: "npm", stars: 18 });
    expect(second).toEqual(first);
    expect(requests).toBe(countAfterFirst);
  });
});
