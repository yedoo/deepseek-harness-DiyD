import type {
  PluginMarketEntry,
  PluginMarketSearchResult,
} from "../plugin-market-types";

const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";
const NPM_REGISTRY_URL = "https://registry.npmjs.org";
const GITHUB_API_URL = "https://api.github.com";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_NPM_CANDIDATES = 8;
const MAX_GITHUB_CANDIDATES = 8;
const SEARCH_CACHE_MS = 10 * 60 * 1_000;

type JsonFetcher = (
  url: string,
  headers?: Readonly<Record<string, string>>,
) => Promise<unknown>;

export interface PluginDiscoveryOptions {
  fetchJson?: JsonFetcher;
  now?: () => Date;
}

export interface PluginDiscoveryProvider {
  search(query: string): Promise<PluginMarketSearchResult>;
}

interface ManifestInspection {
  compatible: boolean;
  installScripts: string[];
}

interface GithubRepository {
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  owner: string;
  description: string;
  stars: number;
  updatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validNpmName(value: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function userInstallablePackageName(value: string): boolean {
  return validNpmName(value) && !value.toLocaleLowerCase().startsWith("@deepseek-ai/");
}

function lifecycleScripts(manifest: Record<string, unknown>): string[] {
  if (!isRecord(manifest.scripts)) {
    return [];
  }
  const scripts = manifest.scripts;
  return ["preinstall", "install", "postinstall", "prepare"]
    .filter((name) => typeof scripts[name] === "string");
}

export function inspectDshPluginManifest(value: unknown): ManifestInspection {
  if (!isRecord(value) || !isRecord(value.dsh)) {
    return { compatible: false, installScripts: [] };
  }
  const bundle = isRecord(value.dsh.bundle) ? value.dsh.bundle : undefined;
  const client = isRecord(value.dsh.client) ? value.dsh.client : undefined;
  const hasBundle = typeof bundle?.patch === "string" && bundle.patch.trim().length > 0;
  const hasClient = client !== undefined && (
    typeof client.platform === "string"
    || typeof client.immediately === "boolean"
    || Array.isArray(client.inject)
  );
  return {
    compatible: hasBundle || hasClient,
    installScripts: lifecycleScripts(value),
  };
}

export function normalizeGithubRepository(value: unknown): string | undefined {
  const raw = typeof value === "string"
    ? value
    : isRecord(value) && typeof value.url === "string"
      ? value.url
      : undefined;
  if (!raw) {
    return undefined;
  }
  const normalized = raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/^git@github\.com:/i, "https://github.com/");
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/|#|$)/i.exec(normalized);
  return match ? `https://github.com/${match[1]}/${match[2]}` : undefined;
}

function repositorySlug(url: string): string | undefined {
  return /^https:\/\/github\.com\/([^/]+\/[^/#]+)/i.exec(url)?.[1]?.toLocaleLowerCase();
}

function inferCategory(manifest: Record<string, unknown>): string {
  const keywords = Array.isArray(manifest.keywords)
    ? manifest.keywords.filter((value): value is string => typeof value === "string").join(" ")
    : "";
  const text = `${stringValue(manifest.name) ?? ""} ${stringValue(manifest.description) ?? ""} ${keywords}`;
  if (/wallpaper|theme|skin|壁纸|主题/i.test(text)) return "theme";
  if (/vision|image|ocr|视觉|图片/i.test(text)) return "vision";
  if (/search|browser|fetch|搜索|浏览器/i.test(text)) return "tools";
  if (/memory|context|记忆|上下文/i.test(text)) return "memory";
  if (/sidebar|layout|ui|界面|侧边栏/i.test(text)) return "ui";
  return "community";
}

async function defaultFetchJson(
  url: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", ...headers },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function githubRepositoryFromApi(value: unknown): GithubRepository | undefined {
  if (!isRecord(value) || typeof value.full_name !== "string" || typeof value.html_url !== "string") {
    return undefined;
  }
  const htmlUrl = normalizeGithubRepository(value.html_url);
  const slug = htmlUrl ? repositorySlug(htmlUrl) : undefined;
  const owner = slug?.split("/")[0];
  const defaultBranch = stringValue(value.default_branch);
  if (!htmlUrl || !owner || !slug || !defaultBranch || slug !== value.full_name.toLocaleLowerCase()) {
    return undefined;
  }
  return {
    fullName: slug,
    htmlUrl,
    defaultBranch,
    owner,
    description: stringValue(value.description) ?? "DSH 社区插件",
    stars: typeof value.stargazers_count === "number" ? Math.max(0, Math.round(value.stargazers_count)) : 0,
    ...(typeof value.updated_at === "string" ? { updatedAt: value.updated_at } : {}),
  };
}

function directGithubSlug(query: string): string | undefined {
  const trimmed = query.trim();
  const url = normalizeGithubRepository(trimmed);
  if (url) {
    return repositorySlug(url);
  }
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)
    ? trimmed.toLocaleLowerCase()
    : undefined;
}

function npmManifestFromMetadata(value: unknown): {
  manifest: Record<string, unknown>;
  version: string;
  publishedAt?: string;
} | undefined {
  if (!isRecord(value) || !isRecord(value["dist-tags"]) || !isRecord(value.versions)) {
    return undefined;
  }
  const version = stringValue(value["dist-tags"].latest);
  if (!version || !isRecord(value.versions[version])) {
    return undefined;
  }
  const time = isRecord(value.time) ? stringValue(value.time[version]) : undefined;
  return {
    manifest: value.versions[version],
    version,
    ...(time ? { publishedAt: time } : {}),
  };
}

function npmCandidateNames(value: unknown, query: string): string[] {
  const names = new Set<string>();
  if (validNpmName(query)) {
    names.add(query);
  }
  if (isRecord(value) && Array.isArray(value.objects)) {
    for (const item of value.objects) {
      if (!isRecord(item) || !isRecord(item.package)) continue;
      const name = stringValue(item.package.name);
      if (name && validNpmName(name)) names.add(name);
      if (names.size >= MAX_NPM_CANDIDATES) break;
    }
  }
  return [...names].slice(0, MAX_NPM_CANDIDATES);
}

function entryFromNpmMetadata(name: string, value: unknown): PluginMarketEntry | undefined {
  const versioned = npmManifestFromMetadata(value);
  if (!versioned) return undefined;
  const inspection = inspectDshPluginManifest(versioned.manifest);
  if (!inspection.compatible) return undefined;
  const manifestName = stringValue(versioned.manifest.name);
  if (
    !manifestName
    || manifestName.toLocaleLowerCase() !== name.toLocaleLowerCase()
    || !userInstallablePackageName(manifestName)
  ) return undefined;
  const url = normalizeGithubRepository(versioned.manifest.repository)
    ?? normalizeGithubRepository(versioned.manifest.homepage);
  if (!url) return undefined;
  const slug = repositorySlug(url);
  const owner = slug?.split("/")[0];
  if (!owner) return undefined;
  return {
    id: `npm:${manifestName.toLocaleLowerCase()}`,
    name: manifestName,
    owner,
    url,
    category: inferCategory(versioned.manifest),
    description: stringValue(versioned.manifest.description) ?? "已验证包含 DSH 插件声明的 npm 包",
    stars: 0,
    installCommand: `dsh plugin --profile web add ${manifestName}`,
    installed: false,
    source: "npm",
    reviewStatus: "community",
    version: versioned.version,
    ...(inspection.installScripts.length > 0 ? { installScripts: inspection.installScripts } : {}),
    ...(versioned.publishedAt ? { added: versioned.publishedAt.slice(0, 10) } : {}),
  };
}

async function githubEntry(
  repository: GithubRepository,
  fetchJson: JsonFetcher,
): Promise<PluginMarketEntry | undefined> {
  const branch = repository.defaultBranch.split("/").map(encodeURIComponent).join("/");
  const manifestUrl = `https://raw.githubusercontent.com/${repository.fullName}/${branch}/package.json`;
  let manifest: unknown;
  try {
    manifest = await fetchJson(manifestUrl);
  } catch {
    return undefined;
  }
  const inspection = inspectDshPluginManifest(manifest);
  if (!inspection.compatible || !isRecord(manifest)) return undefined;
  const name = stringValue(manifest.name) ?? repository.fullName.split("/")[1];
  if (!name || !userInstallablePackageName(name)) return undefined;
  return {
    id: `github:${repository.fullName.toLocaleLowerCase()}`,
    name,
    owner: repository.owner,
    url: repository.htmlUrl,
    category: inferCategory(manifest),
    description: stringValue(manifest.description) ?? repository.description,
    stars: repository.stars,
    installCommand: `dsh plugin --profile web add github:${repository.fullName}`,
    installed: false,
    source: "github",
    reviewStatus: "community",
    ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
    ...(inspection.installScripts.length > 0 ? { installScripts: inspection.installScripts } : {}),
    ...(repository.updatedAt ? { added: repository.updatedAt.slice(0, 10) } : {}),
  };
}

export class NetworkPluginDiscovery implements PluginDiscoveryProvider {
  private readonly fetchJson: JsonFetcher;
  private readonly now: () => Date;
  private readonly cache = new Map<string, { at: number; result: PluginMarketSearchResult }>();

  constructor(options: PluginDiscoveryOptions = {}) {
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.now = options.now ?? (() => new Date());
  }

  async search(rawQuery: string): Promise<PluginMarketSearchResult> {
    const query = rawQuery.trim().slice(0, 100);
    if (query.length < 2) {
      return { query, plugins: [], warnings: [], searchedAt: this.now().toISOString() };
    }
    const cacheKey = query.toLocaleLowerCase();
    const now = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now.getTime() - cached.at < SEARCH_CACHE_MS) {
      return cached.result;
    }
    const warnings: string[] = [];
    const [npmResult, githubResult] = await Promise.allSettled([
      this.searchNpm(query),
      this.searchGithub(query),
    ]);
    const npmPlugins = npmResult.status === "fulfilled" ? npmResult.value : [];
    const githubPlugins = githubResult.status === "fulfilled" ? githubResult.value : [];
    if (npmResult.status === "rejected") warnings.push("npm 搜索暂时不可用");
    if (githubResult.status === "rejected") warnings.push("GitHub 搜索暂时不可用或已达到访问频率限制");
    const seenIds = new Set<string>();
    const repositoryIndexes = new Map<string, number>();
    const plugins: PluginMarketEntry[] = [];
    for (const plugin of [...npmPlugins, ...githubPlugins]) {
      const slug = repositorySlug(plugin.url);
      const existingIndex = slug ? repositoryIndexes.get(slug) : undefined;
      if (existingIndex !== undefined) {
        const existing = plugins[existingIndex]!;
        plugins[existingIndex] = {
          ...existing,
          stars: Math.max(existing.stars, plugin.stars),
          ...(existing.added ? {} : plugin.added ? { added: plugin.added } : {}),
        };
        continue;
      }
      if (seenIds.has(plugin.id)) continue;
      seenIds.add(plugin.id);
      if (slug) repositoryIndexes.set(slug, plugins.length);
      plugins.push(plugin);
    }
    const result = { query, plugins, warnings, searchedAt: now.toISOString() };
    this.cache.set(cacheKey, { at: now.getTime(), result });
    return result;
  }

  private async searchNpm(query: string): Promise<PluginMarketEntry[]> {
    let searchPayload: unknown = { objects: [] };
    try {
      searchPayload = await this.fetchJson(
        `${NPM_SEARCH_URL}?text=${encodeURIComponent(query)}&size=${MAX_NPM_CANDIDATES}`,
      );
    } catch {
      if (!validNpmName(query)) throw new Error("npm search unavailable");
    }
    const names = npmCandidateNames(searchPayload, query);
    const entries = await Promise.all(names.map(async (name) => {
      try {
        const metadata = await this.fetchJson(`${NPM_REGISTRY_URL}/${encodeURIComponent(name)}`);
        return entryFromNpmMetadata(name, metadata);
      } catch {
        return undefined;
      }
    }));
    return entries.filter((entry): entry is PluginMarketEntry => entry !== undefined);
  }

  private async searchGithub(query: string): Promise<PluginMarketEntry[]> {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "DeepSeek-Harness-Desktop",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const direct = directGithubSlug(query);
    let repositories: GithubRepository[] = [];
    if (direct) {
      const repository = githubRepositoryFromApi(
        await this.fetchJson(`${GITHUB_API_URL}/repos/${direct}`, headers),
      );
      if (repository) repositories.push(repository);
    } else {
      const payload = await this.fetchJson(
        `${GITHUB_API_URL}/search/repositories?q=${encodeURIComponent(`${query} dsh plugin in:name,description,readme`)}&per_page=${MAX_GITHUB_CANDIDATES}`,
        headers,
      );
      if (isRecord(payload) && Array.isArray(payload.items)) {
        repositories = payload.items
          .map(githubRepositoryFromApi)
          .filter((entry): entry is GithubRepository => entry !== undefined)
          .slice(0, MAX_GITHUB_CANDIDATES);
      }
    }
    const entries = await Promise.all(repositories.map((repository) => githubEntry(repository, this.fetchJson)));
    return entries.filter((entry): entry is PluginMarketEntry => entry !== undefined);
  }
}
