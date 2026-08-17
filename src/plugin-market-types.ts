export interface PluginMarketCategory {
  id: string;
  label: string;
}

export interface PluginMarketEntry {
  id: string;
  name: string;
  owner: string;
  url: string;
  category: string;
  description: string;
  stars: number;
  installCommand: string;
  added?: string;
  installed: boolean;
  dependencyName?: string;
  source: "catalog" | "npm" | "github";
  reviewStatus: "curated" | "community";
  version?: string;
  installScripts?: string[];
}

export interface PluginMarketSnapshot {
  updated: string;
  source: "network" | "cache" | "fallback";
  categories: PluginMarketCategory[];
  plugins: PluginMarketEntry[];
  installedCount: number;
  restartRequired: boolean;
  restartSupported: boolean;
}

export interface PluginMarketOperationResult {
  snapshot: PluginMarketSnapshot;
  message: string;
  restartSupported: boolean;
  plugin?: PluginMarketEntry;
}

export interface PluginMarketSearchResult {
  query: string;
  plugins: PluginMarketEntry[];
  warnings: string[];
  searchedAt: string;
}
