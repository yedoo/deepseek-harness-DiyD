import { describe, expect, it } from "vitest";
import type { PluginMarketEntry } from "../src/plugin-market-types";
import {
  displayPluginName,
  filterPluginMarketEntries,
  formatPluginStars,
} from "../src/preload/plugin-market-presentation";

function plugin(
  name: string,
  category: string,
  stars: number,
  description = "",
): PluginMarketEntry {
  return {
    id: `https://github.com/example/${name}`,
    name,
    owner: "example",
    url: `https://github.com/example/${name}`,
    category,
    description,
    stars,
    installCommand: `dsh plugin --profile web add ${name}`,
    installed: false,
    source: "catalog",
    reviewStatus: "curated",
  };
}

describe("plugin market presentation", () => {
  it("keeps the approved featured order instead of letting parent repository stars dominate", () => {
    const entries = [
      plugin("dsh-context", "dev", 112),
      plugin("modlens", "vision", 2_478),
      plugin("DSH-better-sidebar", "ui", 1_714),
      plugin("OpenViking", "memory", 28_000),
      plugin("dsh-at-file", "dev", 270),
    ];

    expect(
      filterPluginMarketEntries(entries, "", "featured", "popular").map((entry) => entry.name),
    ).toEqual(["DSH-better-sidebar", "modlens", "dsh-at-file", "dsh-context"]);
  });

  it("filters search tools and performs a case-insensitive text search", () => {
    const entries = [
      plugin("modsearch", "tools", 120, "网页与 X 搜索"),
      plugin("dsh-browser", "ui", 200, "Browser automation"),
      plugin("dsh-context", "dev", 112, "上下文分析"),
    ];

    expect(
      filterPluginMarketEntries(entries, "", "search", "popular").map((entry) => entry.name),
    ).toEqual(["dsh-browser", "modsearch"]);
    expect(
      filterPluginMarketEntries(entries, "BROWSER", "search", "popular")
        .map((entry) => entry.name),
    ).toEqual(["dsh-browser"]);
  });

  it("searches the whole catalog even when a category tab is selected", () => {
    const entries = [
      plugin("modlens", "vision", 2_478, "视觉反馈"),
      plugin("dsh-context", "dev", 112, "上下文分析"),
    ];

    expect(
      filterPluginMarketEntries(entries, "context", "vision", "popular")
        .map((entry) => entry.name),
    ).toEqual(["dsh-context"]);
  });

  it("formats star counts compactly", () => {
    expect(formatPluginStars(999)).toBe("999");
    expect(formatPluginStars(1_000)).toBe("1k");
    expect(formatPluginStars(2_478)).toBe("2.5k");
  });

  it("uses friendly names for the curated cards without changing package identity", () => {
    const entry = plugin("dsh-at-file", "dev", 270);
    expect(displayPluginName(entry)).toBe("@ File");
    expect(entry.name).toBe("dsh-at-file");
  });
});
