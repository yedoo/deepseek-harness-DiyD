import { spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type {
  PluginMarketCategory,
  PluginMarketEntry,
  PluginMarketOperationResult,
  PluginMarketSearchResult,
  PluginMarketSnapshot,
} from "../plugin-market-types";
import {
  inferPluginCategory,
  inspectDshPluginManifest,
  NetworkPluginDiscovery,
  normalizeGithubRepository,
  type PluginDiscoveryProvider,
} from "./plugin-discovery";
import { RESULT_PREFIX, type PluginPackageOperationResult } from "./plugin-package-worker";

const DEFAULT_CATALOG_URL = "https://awesome-dsh-plugin.com/plugins.json";
const FETCH_TIMEOUT_MS = 15_000;
const OPERATION_TIMEOUT_MS = 20 * 60 * 1_000;

interface RegistryPlugin {
  name: string;
  owner: string;
  url: string;
  category: string;
  description: { zh?: string; en?: string };
  npm: string | null;
  stars: number;
  install: string;
  added?: string;
}

interface RegistryCatalog {
  updated: string;
  categories: Record<string, { zh?: string; en?: string }>;
  plugins: RegistryPlugin[];
}

interface ProfileManifest {
  dependencies?: Record<string, string>;
  dsh?: {
    profile?: {
      bundles?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface PluginMarketState {
  installed: Record<string, string>;
  restartRequired: boolean;
}

export interface PluginPackageInstaller {
  run(
    operation: "add" | "remove",
    profileDirectory: string,
    target: string,
  ): Promise<PluginPackageOperationResult>;
}

export interface PluginMarketServiceOptions {
  dataRoot: () => string;
  cacheDirectory: string;
  statePath: string;
  catalogCachePath: string;
  packageInstaller: PluginPackageInstaller;
  restartSupported: () => boolean;
  catalogUrl?: string;
  fetchCatalog?: (url: string) => Promise<unknown>;
  discovery?: PluginDiscoveryProvider;
}

export interface ProcessPluginPackageInstallerOptions {
  nodeExecutable: string;
  workerPath: string;
  logsRoot: string;
  cachePath: string;
  runElectronAsNode?: boolean;
}

const FALLBACK_CATALOG: RegistryCatalog = {
  updated: "离线精选",
  categories: {
    ui: { zh: "界面增强" },
    vision: { zh: "视觉" },
    dev: { zh: "开发工具" },
  },
  plugins: [
    {
      name: "DSH-better-sidebar",
      owner: "omdsh-dev",
      url: "https://github.com/omdsh-dev/DSH-better-sidebar",
      category: "ui",
      description: { zh: "文件预览、终端、Git 与子代理侧边栏" },
      npm: "dsh-better-sidebar",
      stars: 1714,
      install: "dsh plugin --profile web add dsh-better-sidebar",
    },
    {
      name: "modlens",
      owner: "liustack",
      url: "https://github.com/liustack/modlens",
      category: "vision",
      description: { zh: "图片理解、OCR 与界面布局识别" },
      npm: "@liustack/modlens",
      stars: 2478,
      install: "dsh plugin --profile web add @liustack/modlens",
    },
    {
      name: "dsh-at-file",
      owner: "omdsh-dev",
      url: "https://github.com/omdsh-dev/dsh-at-file",
      category: "dev",
      description: { zh: "在对话中快速引用项目文件" },
      npm: null,
      stars: 270,
      install: "dsh plugin --profile web add github:omdsh-dev/dsh-at-file",
    },
    {
      name: "dsh-context",
      owner: "bowenliang123",
      url: "https://github.com/bowenliang123/dsh-context",
      category: "dev",
      description: { zh: "查看上下文窗口占用与组成" },
      npm: null,
      stars: 112,
      install: "dsh plugin --profile web add github:bowenliang123/dsh-context",
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRegistryCatalog(value: unknown): RegistryCatalog {
  if (!isRecord(value) || !Array.isArray(value.plugins) || !isRecord(value.categories)) {
    throw new Error("插件目录格式无效");
  }
  const plugins: RegistryPlugin[] = [];
  for (const candidate of value.plugins) {
    if (!isRecord(candidate) || !isRecord(candidate.description)) {
      continue;
    }
    if (
      typeof candidate.name !== "string"
      || typeof candidate.owner !== "string"
      || typeof candidate.url !== "string"
      || typeof candidate.category !== "string"
      || typeof candidate.stars !== "number"
      || typeof candidate.install !== "string"
    ) {
      continue;
    }
    if (!/^https:\/\/github\.com\//i.test(candidate.url) || parseInstallSpec(candidate.install) === undefined) {
      continue;
    }
    plugins.push({
      name: candidate.name,
      owner: candidate.owner,
      url: candidate.url,
      category: candidate.category,
      description: {
        ...(typeof candidate.description.zh === "string" ? { zh: candidate.description.zh } : {}),
        ...(typeof candidate.description.en === "string" ? { en: candidate.description.en } : {}),
      },
      npm: typeof candidate.npm === "string" ? candidate.npm : null,
      stars: Math.max(0, Math.round(candidate.stars)),
      install: candidate.install,
      ...(typeof candidate.added === "string" ? { added: candidate.added } : {}),
    });
  }
  if (plugins.length === 0) {
    throw new Error("插件目录中没有可安装条目");
  }
  const categories: RegistryCatalog["categories"] = {};
  for (const [id, label] of Object.entries(value.categories)) {
    if (!isRecord(label)) {
      continue;
    }
    categories[id] = {
      ...(typeof label.zh === "string" ? { zh: label.zh } : {}),
      ...(typeof label.en === "string" ? { en: label.en } : {}),
    };
  }
  return {
    updated: typeof value.updated === "string" ? value.updated : "",
    categories,
    plugins,
  };
}

export function parseInstallSpec(command: string): string | undefined {
  const match = /^dsh plugin --profile web add (\S+)$/.exec(command.trim());
  const spec = match?.[1];
  return spec && !spec.startsWith("-") ? spec : undefined;
}

function repositorySlug(url: string): string | undefined {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/#]+)(?:\/|#|$)/i.exec(url);
  return match?.[1]?.replace(/\.git$/i, "").toLocaleLowerCase();
}

function repositorySlugFromSpec(spec: string): string | undefined {
  const github = /^github:([^#]+?)(?:#|$)/i.exec(spec)?.[1];
  if (github) {
    return github.replace(/\.git$/i, "").toLocaleLowerCase();
  }
  const git = /github\.com[/:]([^/#]+\/[^/#]+?)(?:\.git)?(?:#|$)/i.exec(spec)?.[1];
  return git?.toLocaleLowerCase();
}

function registryPackageName(spec: string): string | undefined {
  if (spec.startsWith("@")) {
    const versionAt = spec.indexOf("@", spec.indexOf("/") + 1);
    return versionAt === -1 ? spec : spec.slice(0, versionAt);
  }
  const match = /^([a-z0-9][a-z0-9._-]*)(?:@[^/]+)?$/i.exec(spec);
  return match?.[1];
}

function readProfileManifest(profileDirectory: string): ProfileManifest {
  const manifestPath = path.join(profileDirectory, "package.json");
  if (!existsSync(manifestPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as ProfileManifest;
  } catch {
    return {};
  }
}

function profileBundles(manifest: ProfileManifest): string[] {
  return Array.isArray(manifest.dsh?.profile?.bundles)
    ? manifest.dsh.profile.bundles.filter((bundle): bundle is string => typeof bundle === "string")
    : [];
}

function readInstalledPackageManifest(
  profileDirectory: string,
  dependencyName: string,
): Record<string, unknown> | undefined {
  if (
    dependencyName.toLocaleLowerCase().startsWith("@deepseek-ai/")
    || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(dependencyName)
  ) {
    return undefined;
  }
  const manifestPath = path.join(profileDirectory, "node_modules", dependencyName, "package.json");
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    return isRecord(manifest) && manifest.name === dependencyName ? manifest : undefined;
  } catch {
    return undefined;
  }
}

function packageOwner(repositoryUrl: string): string | undefined {
  return repositorySlug(repositoryUrl)?.split("/")[0];
}

function installedPluginId(
  dependencyName: string,
  dependencySpec: string,
  repositoryUrl: string,
  state: PluginMarketState,
): string {
  const remembered = Object.entries(state.installed)
    .find(([, dependency]) => dependency === dependencyName)?.[0];
  if (remembered) {
    return remembered;
  }
  const slug = repositorySlugFromSpec(dependencySpec) ?? repositorySlug(repositoryUrl);
  return repositorySlugFromSpec(dependencySpec) && slug
    ? `github:${slug}`
    : `npm:${dependencyName.toLocaleLowerCase()}`;
}

function setProfileBundleEnabled(
  profileDirectory: string,
  dependencyName: string,
  enabled: boolean,
): void {
  const manifest = readProfileManifest(profileDirectory);
  if (!Object.hasOwn(manifest.dependencies ?? {}, dependencyName)) {
    throw new Error("没有找到这个插件的已安装依赖");
  }
  const bundles = profileBundles(manifest).filter((bundle) => bundle !== dependencyName);
  if (enabled) {
    bundles.push(dependencyName);
  }
  manifest.dsh = isRecord(manifest.dsh) ? manifest.dsh : {};
  manifest.dsh.profile = isRecord(manifest.dsh.profile) ? manifest.dsh.profile : {};
  manifest.dsh.profile.bundles = bundles;
  writeJsonAtomic(path.join(profileDirectory, "package.json"), manifest);
}

export function findInstalledDependency(
  plugin: RegistryPlugin,
  dependencies: Record<string, string>,
  remembered?: string,
): string | undefined {
  if (remembered && Object.hasOwn(dependencies, remembered)) {
    return remembered;
  }
  const installSpec = parseInstallSpec(plugin.install);
  const packageName = plugin.npm ?? (installSpec ? registryPackageName(installSpec) : undefined);
  if (packageName && Object.hasOwn(dependencies, packageName)) {
    return packageName;
  }
  const slug = repositorySlug(plugin.url);
  if (slug) {
    for (const [name, spec] of Object.entries(dependencies)) {
      if (repositorySlugFromSpec(spec) === slug) {
        return name;
      }
    }
  }
  return undefined;
}

function initialState(): PluginMarketState {
  return { installed: {}, restartRequired: false };
}

function readState(statePath: string): PluginMarketState {
  if (!existsSync(statePath)) {
    return initialState();
  }
  try {
    const value = JSON.parse(readFileSync(statePath, "utf8")) as Partial<PluginMarketState>;
    return {
      installed: isRecord(value.installed)
        ? Object.fromEntries(Object.entries(value.installed).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : {},
      restartRequired: value.restartRequired === true,
    };
  } catch {
    return initialState();
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

async function defaultFetchCatalog(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`插件目录请求失败（HTTP ${response.status}）`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function catalogCategories(catalog: RegistryCatalog): PluginMarketCategory[] {
  return Object.entries(catalog.categories).map(([id, label]) => ({
    id,
    label: label.zh ?? label.en ?? id,
  }));
}

export class ProcessPluginPackageInstaller implements PluginPackageInstaller {
  constructor(private readonly options: ProcessPluginPackageInstallerOptions) {}

  run(
    operation: "add" | "remove",
    profileDirectory: string,
    target: string,
  ): Promise<PluginPackageOperationResult> {
    mkdirSync(this.options.logsRoot, { recursive: true });
    mkdirSync(this.options.cachePath, { recursive: true });
    const logPath = path.join(this.options.logsRoot, "plugin-market.log");
    const log = createWriteStream(logPath, { flags: "a" });
    log.write(`\n[${new Date().toISOString()}] ${operation} ${target}\n`);

    return new Promise((resolve, reject) => {
      const child = spawn(
        this.options.nodeExecutable,
        [this.options.workerPath, operation, profileDirectory, target, this.options.cachePath],
        {
          cwd: profileDirectory,
          env: {
            ...process.env,
            npm_config_update_notifier: "false",
            npm_config_audit: "false",
            npm_config_fund: "false",
            npm_config_cache: this.options.cachePath,
            ...(this.options.runElectronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        log.write(chunk);
      });
      child.stderr?.pipe(log, { end: false });
      let settled = false;
      const finish = (error?: Error, result?: PluginPackageOperationResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        log.end(`[${new Date().toISOString()}] ${error ? `Failed: ${error.message}` : "Completed"}\n`);
        if (error) {
          reject(error);
        } else if (result) {
          resolve(result);
        } else {
          reject(new Error(`插件操作没有返回结果，请查看日志：${logPath}`));
        }
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error(`插件操作超时，请查看日志：${logPath}`));
      }, OPERATION_TIMEOUT_MS);
      child.once("error", (error) => finish(error));
      child.once("exit", (code) => {
        if (code !== 0) {
          finish(new Error(`插件操作失败（退出码 ${String(code)}），请查看日志：${logPath}`));
          return;
        }
        const line = stdout.split(/\r?\n/).find((item) => item.startsWith(RESULT_PREFIX));
        if (!line) {
          finish();
          return;
        }
        try {
          finish(undefined, JSON.parse(line.slice(RESULT_PREFIX.length)) as PluginPackageOperationResult);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }
}

export class PluginMarketService {
  private catalog?: RegistryCatalog;
  private catalogSource: PluginMarketSnapshot["source"] = "fallback";
  private operation?: Promise<PluginMarketOperationResult>;
  private readonly discovery: PluginDiscoveryProvider;
  private readonly discovered = new Map<string, PluginMarketEntry>();

  constructor(private readonly options: PluginMarketServiceOptions) {
    this.discovery = options.discovery ?? new NetworkPluginDiscovery();
  }

  async list(forceRefresh = false): Promise<PluginMarketSnapshot> {
    const catalog = await this.loadCatalog(forceRefresh);
    return this.snapshot(catalog);
  }

  async search(rawQuery: string): Promise<PluginMarketSearchResult> {
    const query = rawQuery.trim().slice(0, 100);
    if (query.length < 2) {
      return { query, plugins: [], warnings: [], searchedAt: new Date().toISOString() };
    }
    const [catalog, result] = await Promise.all([
      this.loadCatalog(false),
      this.discovery.search(query),
    ]);
    const catalogRepositories = new Set(catalog.plugins.map((plugin) => repositorySlug(plugin.url)));
    const catalogPackages = new Set(catalog.plugins.flatMap((plugin) => {
      const spec = parseInstallSpec(plugin.install);
      const packageName = plugin.npm ?? (spec ? registryPackageName(spec) : undefined);
      return packageName ? [packageName.toLocaleLowerCase()] : [];
    }));
    const profileDirectory = this.profileDirectory();
    const profile = readProfileManifest(profileDirectory);
    const state = readState(this.options.statePath);
    const plugins = result.plugins
      .filter((entry) => {
        const slug = repositorySlug(entry.url);
        const spec = parseInstallSpec(entry.installCommand);
        const packageName = spec ? registryPackageName(spec) : undefined;
        return !(slug && catalogRepositories.has(slug))
          && !(packageName && catalogPackages.has(packageName.toLocaleLowerCase()));
      })
      .map((entry) => this.withInstallState(entry, profileDirectory, profile, state));
    if (this.discovered.size > 200) {
      this.discovered.clear();
    }
    for (const entry of plugins) {
      this.discovered.set(entry.id, entry);
    }
    return { ...result, plugins };
  }

  async install(pluginId: string): Promise<PluginMarketOperationResult> {
    return this.runExclusive(async () => {
      const catalog = await this.loadCatalog(false);
      this.snapshot(catalog);
      const discovered = this.discovered.get(pluginId);
      const plugin = catalog.plugins.find((entry) => entry.url === pluginId)
        ?? (discovered ? registryPluginFromEntry(discovered) : undefined);
      if (!plugin) {
        throw new Error("插件不在当前目录或在线搜索结果中，请重新搜索后再试");
      }
      const spec = parseInstallSpec(plugin.install);
      if (!spec) {
        throw new Error("插件安装命令无效");
      }
      const profileDirectory = this.profileDirectory();
      const beforeDependencies = readProfileManifest(profileDirectory).dependencies ?? {};
      const result = await this.options.packageInstaller.run("add", profileDirectory, spec);
      const remembered = findInstalledDependency(plugin, result.dependencies)
        ?? Object.keys(result.dependencies).find((name) => !Object.hasOwn(beforeDependencies, name));
      if (!remembered) {
        throw new Error("插件已经下载，但未能确认安装的包名");
      }
      const state = readState(this.options.statePath);
      const stateKey = discovered?.id ?? plugin.url;
      state.installed[stateKey] = remembered;
      state.restartRequired = true;
      writeJsonAtomic(this.options.statePath, state);
      const snapshot = this.snapshot(catalog);
      const operationResult: PluginMarketOperationResult = {
        snapshot,
        message: "安装完成，重启 Harness 后生效",
        restartSupported: this.options.restartSupported(),
      };
      if (discovered) {
        const installedEntry = snapshot.plugins.find((entry) => entry.id === discovered.id)
          ?? this.withInstallState(
            discovered,
            profileDirectory,
            readProfileManifest(profileDirectory),
            state,
          );
        this.discovered.set(discovered.id, installedEntry);
        operationResult.plugin = installedEntry;
      }
      return operationResult;
    });
  }

  async remove(pluginId: string): Promise<PluginMarketOperationResult> {
    return this.runExclusive(async () => {
      const catalog = await this.loadCatalog(false);
      this.snapshot(catalog);
      const discovered = this.discovered.get(pluginId);
      const plugin = catalog.plugins.find((entry) => entry.url === pluginId)
        ?? (discovered ? registryPluginFromEntry(discovered) : undefined);
      if (!plugin) {
        throw new Error("插件不在当前目录或在线搜索结果中，请重新搜索后再试");
      }
      const profileDirectory = this.profileDirectory();
      const dependencies = readProfileManifest(profileDirectory).dependencies ?? {};
      const state = readState(this.options.statePath);
      const stateKey = discovered?.id ?? plugin.url;
      const dependencyName = findInstalledDependency(plugin, dependencies, state.installed[stateKey]);
      if (!dependencyName) {
        throw new Error("没有找到这个插件的已安装依赖");
      }
      await this.options.packageInstaller.run("remove", profileDirectory, dependencyName);
      delete state.installed[stateKey];
      state.restartRequired = true;
      writeJsonAtomic(this.options.statePath, state);
      const snapshot = this.snapshot(catalog);
      const operationResult: PluginMarketOperationResult = {
        snapshot,
        message: "卸载完成，重启 Harness 后生效",
        restartSupported: this.options.restartSupported(),
      };
      if (discovered) {
        const removedEntry = this.withInstallState(
          discovered,
          profileDirectory,
          readProfileManifest(profileDirectory),
          state,
        );
        this.discovered.set(discovered.id, removedEntry);
        operationResult.plugin = removedEntry;
      }
      return operationResult;
    });
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<PluginMarketOperationResult> {
    return this.runExclusive(async () => {
      const catalog = await this.loadCatalog(false);
      const current = this.snapshot(catalog).plugins.find((entry) => entry.id === pluginId)
        ?? this.discovered.get(pluginId);
      if (!current?.installed || !current.dependencyName) {
        throw new Error("没有找到这个插件的已安装依赖");
      }
      if (!current.canToggle) {
        throw new Error("这个插件不支持独立停用");
      }
      const profileDirectory = this.profileDirectory();
      setProfileBundleEnabled(profileDirectory, current.dependencyName, enabled);
      const state = readState(this.options.statePath);
      state.restartRequired = true;
      writeJsonAtomic(this.options.statePath, state);
      const snapshot = this.snapshot(catalog);
      const updated = snapshot.plugins.find((entry) => entry.id === pluginId);
      if (!updated) {
        throw new Error("插件状态已经更新，但未能刷新插件列表");
      }
      this.discovered.set(updated.id, updated);
      return {
        snapshot,
        plugin: updated,
        message: `${enabled ? "启用" : "停用"}完成，重启 Harness 后生效`,
        restartSupported: this.options.restartSupported(),
      };
    });
  }

  acknowledgeRestart(): void {
    const state = readState(this.options.statePath);
    if (!state.restartRequired) {
      return;
    }
    state.restartRequired = false;
    writeJsonAtomic(this.options.statePath, state);
  }

  private async runExclusive(
    operation: () => Promise<PluginMarketOperationResult>,
  ): Promise<PluginMarketOperationResult> {
    if (this.operation) {
      throw new Error("另一个插件操作正在进行，请稍候");
    }
    this.operation = operation();
    try {
      return await this.operation;
    } finally {
      this.operation = undefined;
    }
  }

  private profileDirectory(): string {
    const dataRoot = this.options.dataRoot();
    if (!path.isAbsolute(dataRoot)) {
      throw new Error("Harness 数据目录无效");
    }
    return path.join(dataRoot, "profiles", "web");
  }

  private async loadCatalog(forceRefresh: boolean): Promise<RegistryCatalog> {
    if (this.catalog && !forceRefresh) {
      return this.catalog;
    }
    mkdirSync(this.options.cacheDirectory, { recursive: true });
    try {
      const value = await (this.options.fetchCatalog ?? defaultFetchCatalog)(
        this.options.catalogUrl ?? DEFAULT_CATALOG_URL,
      );
      this.catalog = parseRegistryCatalog(value);
      this.catalogSource = "network";
      writeJsonAtomic(this.options.catalogCachePath, value);
      return this.catalog;
    } catch (networkError) {
      if (existsSync(this.options.catalogCachePath)) {
        try {
          this.catalog = parseRegistryCatalog(
            JSON.parse(readFileSync(this.options.catalogCachePath, "utf8")) as unknown,
          );
          this.catalogSource = "cache";
          return this.catalog;
        } catch {
          // The bundled fallback below keeps the market usable offline.
        }
      }
      this.catalog = FALLBACK_CATALOG;
      this.catalogSource = "fallback";
      if (forceRefresh) {
        console.warn("Unable to refresh plugin catalog", networkError);
      }
      return this.catalog;
    }
  }

  private snapshot(catalog: RegistryCatalog): PluginMarketSnapshot {
    const profileDirectory = this.profileDirectory();
    const profile = readProfileManifest(profileDirectory);
    const dependencies = profile.dependencies ?? {};
    const bundles = profileBundles(profile);
    const state = readState(this.options.statePath);
    const plugins: PluginMarketEntry[] = catalog.plugins
      .filter((plugin) => plugin.url !== "https://github.com/dsh-market/dsh-market")
      .map((plugin) => {
        const dependencyName = findInstalledDependency(
          plugin,
          dependencies,
          state.installed[plugin.url],
        );
        const packageManifest = dependencyName
          ? readInstalledPackageManifest(profileDirectory, dependencyName)
          : undefined;
        const inspection = inspectDshPluginManifest(packageManifest);
        const canToggle = dependencyName !== undefined && inspection.hasBundle;
        return {
          id: plugin.url,
          name: plugin.name,
          owner: plugin.owner,
          url: plugin.url,
          category: plugin.category,
          description: plugin.description.zh ?? plugin.description.en ?? "暂无说明",
          stars: plugin.stars,
          installCommand: plugin.install,
          ...(plugin.added ? { added: plugin.added } : {}),
          installed: dependencyName !== undefined,
          enabled: dependencyName !== undefined && (!canToggle || bundles.includes(dependencyName)),
          canToggle,
          ...(dependencyName ? { dependencyName } : {}),
          source: "catalog",
          reviewStatus: "curated",
        };
      });
    const representedDependencies = new Set(
      plugins.flatMap((plugin) => plugin.dependencyName ? [plugin.dependencyName] : []),
    );
    const representedPackages = new Set(catalog.plugins.flatMap((plugin) => {
      const spec = parseInstallSpec(plugin.install);
      const packageName = plugin.npm ?? (spec ? registryPackageName(spec) : undefined);
      return packageName ? [packageName] : [];
    }));
    for (const [dependencyName, spec] of Object.entries(dependencies)) {
      if (representedDependencies.has(dependencyName) || representedPackages.has(dependencyName)) {
        continue;
      }
      const packageManifest = readInstalledPackageManifest(profileDirectory, dependencyName);
      const inspection = inspectDshPluginManifest(packageManifest);
      if (!packageManifest || !inspection.compatible) {
        continue;
      }
      const url = normalizeGithubRepository(packageManifest.repository)
        ?? normalizeGithubRepository(packageManifest.homepage);
      const owner = url ? packageOwner(url) : undefined;
      if (!url || !owner) {
        continue;
      }
      const id = installedPluginId(dependencyName, spec, url, state);
      const source: PluginMarketEntry["source"] = id.startsWith("github:") ? "github" : "npm";
      const entry: PluginMarketEntry = {
        id,
        name: typeof packageManifest.name === "string" ? packageManifest.name : dependencyName,
        owner,
        url,
        category: inferPluginCategory(packageManifest),
        description: typeof packageManifest.description === "string"
          ? packageManifest.description
          : "本机已安装的 DSH 社区插件",
        stars: 0,
        installCommand: `dsh plugin --profile web add ${
          source === "github" && repositorySlugFromSpec(spec) ? spec : dependencyName
        }`,
        installed: true,
        enabled: !inspection.hasBundle || bundles.includes(dependencyName),
        canToggle: inspection.hasBundle,
        dependencyName,
        source,
        reviewStatus: "community",
        ...(typeof packageManifest.version === "string" ? { version: packageManifest.version } : {}),
        ...(inspection.installScripts.length > 0 ? { installScripts: inspection.installScripts } : {}),
      };
      plugins.push(entry);
      this.discovered.set(entry.id, entry);
    }
    return {
      updated: catalog.updated,
      source: this.catalogSource,
      categories: catalogCategories(catalog),
      plugins,
      installedCount: plugins.filter((plugin) => plugin.installed).length,
      restartRequired: state.restartRequired,
      restartSupported: this.options.restartSupported(),
    };
  }

  private withInstallState(
    entry: PluginMarketEntry,
    profileDirectory: string,
    profile: ProfileManifest,
    state: PluginMarketState,
  ): PluginMarketEntry {
    const plugin = registryPluginFromEntry(entry);
    const dependencies = profile.dependencies ?? {};
    const dependencyName = findInstalledDependency(plugin, dependencies, state.installed[entry.id]);
    const packageManifest = dependencyName
      ? readInstalledPackageManifest(profileDirectory, dependencyName)
      : undefined;
    const inspection = inspectDshPluginManifest(packageManifest);
    const canToggle = dependencyName !== undefined && inspection.hasBundle;
    const { dependencyName: _previousDependencyName, ...base } = entry;
    return {
      ...base,
      installed: dependencyName !== undefined,
      enabled: dependencyName !== undefined
        && (!canToggle || profileBundles(profile).includes(dependencyName)),
      canToggle,
      ...(dependencyName ? { dependencyName } : {}),
    };
  }
}

function registryPluginFromEntry(entry: PluginMarketEntry): RegistryPlugin {
  const spec = parseInstallSpec(entry.installCommand);
  return {
    name: entry.name,
    owner: entry.owner,
    url: entry.url,
    category: entry.category,
    description: { zh: entry.description },
    npm: entry.source === "npm" && spec ? registryPackageName(spec) ?? null : null,
    stars: entry.stars,
    install: entry.installCommand,
    ...(entry.added ? { added: entry.added } : {}),
  };
}
