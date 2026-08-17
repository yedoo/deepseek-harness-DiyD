import type { PluginMarketEntry } from "../plugin-market-types";

export type PluginMarketCategoryId = "featured" | "dev" | "vision" | "ui";
export type PluginMarketSort = "popular" | "newest";

export const PLUGIN_MARKET_CATEGORIES: ReadonlyArray<{
  id: PluginMarketCategoryId;
  label: string;
}> = [
  { id: "featured", label: "精选" },
  { id: "dev", label: "开发工具" },
  { id: "vision", label: "视觉" },
  { id: "ui", label: "界面增强" },
];

const FEATURED_NAMES = [
  "dsh-better-sidebar",
  "modlens",
  "dsh-at-file",
  "dsh-context",
  "dsh-vision-toolkit",
  "dsh-vision-router",
  "dsh-genui",
  "dsh-browser",
];

const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "dsh-better-sidebar": "Better Sidebar",
  modlens: "ModLens",
  "dsh-at-file": "@ File",
  "dsh-context": "DSH Context",
};

function normalizedName(plugin: PluginMarketEntry): string {
  return plugin.name.toLocaleLowerCase();
}

function categoryMatches(plugin: PluginMarketEntry, category: PluginMarketCategoryId): boolean {
  switch (category) {
    case "featured":
      return FEATURED_NAMES.includes(normalizedName(plugin));
    case "dev":
      return ["dev", "tools", "workflow", "skill"].includes(plugin.category);
    case "vision":
      return plugin.category === "vision";
    case "ui":
      return plugin.category === "ui";
  }
}

function featuredRank(plugin: PluginMarketEntry): number {
  const index = FEATURED_NAMES.indexOf(normalizedName(plugin));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function filterPluginMarketEntries(
  plugins: readonly PluginMarketEntry[],
  query: string,
  category: PluginMarketCategoryId,
  sort: PluginMarketSort,
): PluginMarketEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matching = plugins.filter((plugin) => {
    if (!normalizedQuery && !categoryMatches(plugin, category)) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [plugin.name, plugin.owner, plugin.description, plugin.category]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });

  return matching.sort((left, right) => {
    if (category === "featured") {
      const rank = featuredRank(left) - featuredRank(right);
      if (rank !== 0) {
        return rank;
      }
    }
    if (sort === "newest") {
      const dateOrder = (right.added ?? "").localeCompare(left.added ?? "");
      if (dateOrder !== 0) {
        return dateOrder;
      }
    }
    return right.stars - left.stars || left.name.localeCompare(right.name);
  });
}

export function formatPluginStars(stars: number): string {
  if (stars < 1_000) {
    return String(stars);
  }
  const compact = Math.round(stars / 100) / 10;
  return `${compact.toFixed(Number.isInteger(compact) ? 0 : 1)}k`;
}

export function displayPluginName(plugin: PluginMarketEntry): string {
  return DISPLAY_NAMES[normalizedName(plugin)] ?? plugin.name;
}
