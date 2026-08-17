import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import type {
  AppearanceAssetPayload,
  AppearanceAssetReference,
  AppearanceAssetSlot,
  AppearanceBackground,
  AppearanceConfig,
  AppearanceConfigPatch,
  AppearanceEffects,
  AppearanceProviderDescriptor,
  AppearanceProviderUpdate,
  AppearanceSettings,
  AppearanceSnapshot,
  AppearanceTheme,
  AppearanceThemeInput,
  AppearanceThemePatch,
} from "../appearance-types";

interface StoredAsset extends AppearanceAssetReference {
  fileName: string;
}

interface AppearanceState {
  schemaVersion: 1;
  settings: AppearanceSettings;
  themes: AppearanceTheme[];
  assets: Record<string, StoredAsset>;
}

interface ThemePackageManifest {
  schemaVersion: 1;
  theme: Omit<AppearanceTheme, "id" | "kind" | "createdAt" | "updatedAt"> & {
    config: AppearanceConfig;
  };
}

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 80 * 1024 * 1024;
const SUPPORTED_IMAGES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

const DEFAULT_EFFECTS: AppearanceEffects = {
  dim: 0.08,
  blur: 18,
  panelOpacity: 0.9,
  borderAlpha: 0.18,
  radius: 18,
};

const DEFAULT_CONFIG: AppearanceConfig = {
  mode: "system",
  background: { kind: "none" },
  effects: DEFAULT_EFFECTS,
  colors: {},
  assets: {},
};

const BUILTIN_THEMES: AppearanceTheme[] = [
  builtinTheme("builtin-light", "简洁明亮", "light", {
    surface: "#ffffff",
    sidebar: "#f7f8fa",
    text: "#18181b",
    accent: "#3b82f6",
  }),
  builtinTheme("builtin-dark", "深色工作台", "dark", {
    surface: "#1b1c20",
    sidebar: "#15161a",
    text: "#f4f4f5",
    accent: "#7aa2ff",
  }),
  builtinTheme("builtin-deep-sea", "深海蓝", "dark", {
    surface: "#10182b",
    sidebar: "#0b1222",
    text: "#eef4ff",
    accent: "#77aaff",
  }),
];

function builtinTheme(
  id: string,
  name: string,
  mode: "light" | "dark",
  colors: AppearanceConfig["colors"],
): AppearanceTheme {
  return {
    id,
    name,
    author: "DeepSeek Harness Desktop",
    version: "1.0.0",
    kind: "builtin",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    config: { ...structuredClone(DEFAULT_CONFIG), mode, colors },
  };
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanEffects(value: Partial<AppearanceEffects> | undefined, base = DEFAULT_EFFECTS): AppearanceEffects {
  return {
    dim: clamp(value?.dim, 0, 0.9, base.dim),
    blur: clamp(value?.blur, 0, 40, base.blur),
    panelOpacity: clamp(value?.panelOpacity, 0.35, 1, base.panelOpacity),
    borderAlpha: clamp(value?.borderAlpha, 0, 0.9, base.borderAlpha),
    radius: clamp(value?.radius, 0, 32, base.radius),
  };
}

function cleanColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

function cleanBackground(value: unknown): AppearanceBackground {
  if (!value || typeof value !== "object") {
    return { kind: "none" };
  }
  const candidate = value as Partial<AppearanceBackground> & { assetId?: unknown; providerId?: unknown };
  if (candidate.kind === "local-image" && typeof candidate.assetId === "string") {
    return { kind: "local-image", assetId: candidate.assetId };
  }
  if (candidate.kind === "provider" && typeof candidate.providerId === "string") {
    return { kind: "provider", providerId: candidate.providerId };
  }
  return { kind: "none" };
}

function mergeConfig(base: AppearanceConfig, patch?: AppearanceConfigPatch): AppearanceConfig {
  if (!patch) {
    return structuredClone(base);
  }
  const mode = patch.mode === "light" || patch.mode === "dark" || patch.mode === "system"
    ? patch.mode
    : base.mode;
  return {
    mode,
    background: patch.background ? cleanBackground(patch.background) : structuredClone(base.background),
    effects: cleanEffects(patch.effects, base.effects),
    colors: {
      ...base.colors,
      ...(cleanColor(patch.colors?.accent) ? { accent: patch.colors!.accent } : {}),
      ...(cleanColor(patch.colors?.surface) ? { surface: patch.colors!.surface } : {}),
      ...(cleanColor(patch.colors?.sidebar) ? { sidebar: patch.colors!.sidebar } : {}),
      ...(cleanColor(patch.colors?.text) ? { text: patch.colors!.text } : {}),
    },
    assets: {
      ...base.assets,
      ...Object.fromEntries(
        Object.entries(patch.assets ?? {}).filter(([, assetId]) => typeof assetId === "string"),
      ),
    },
  };
}

function defaultSettings(): AppearanceSettings {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    activeThemeId: "builtin-light",
    providers: {},
    overrides: {},
  };
}

function safeText(value: unknown, fallback: string, maximum = 80): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const clean = value.trim().replace(/[\u0000-\u001f]/g, "").slice(0, maximum);
  return clean || fallback;
}

export class AppearanceService {
  private readonly statePath: string;
  private readonly assetsRoot: string;
  private state: AppearanceState;

  constructor(private readonly root: string, private readonly now = () => new Date()) {
    this.statePath = path.join(root, "state.json");
    this.assetsRoot = path.join(root, "assets");
    this.state = this.load();
  }

  snapshot(providers: AppearanceProviderDescriptor[] = []): AppearanceSnapshot {
    return {
      settings: structuredClone(this.state.settings),
      themes: [...structuredClone(BUILTIN_THEMES), ...structuredClone(this.state.themes)],
      providers: structuredClone(providers),
    };
  }

  updateSettings(patch: AppearanceConfigPatch): AppearanceSnapshot {
    const updated = mergeConfig(this.state.settings, patch);
    this.state.settings = {
      ...this.state.settings,
      ...updated,
      overrides: this.state.settings.activeThemeId
        ? mergePatch(this.state.settings.overrides, patch)
        : this.state.settings.overrides,
    };
    this.save();
    return this.snapshot();
  }

  importLocalAsset(sourcePath: string, slot: AppearanceAssetSlot): AppearanceAssetReference {
    const extension = path.extname(sourcePath).toLocaleLowerCase();
    const mimeType = SUPPORTED_IMAGES[extension];
    if (!mimeType || !existsSync(sourcePath)) {
      throw new Error("请选择 PNG、JPG、WebP、GIF 或 AVIF 图片");
    }
    if (statSync(sourcePath).size > MAX_ASSET_BYTES) {
      throw new Error("图片不能超过 20 MB");
    }
    mkdirSync(this.assetsRoot, { recursive: true });
    const id = `asset-${randomUUID()}`;
    const fileName = `${id}${extension === ".jpeg" ? ".jpg" : extension}`;
    copyFileSync(sourcePath, path.join(this.assetsRoot, fileName));
    const asset: StoredAsset = { id, slot, mimeType, fileName };
    this.state.assets[id] = asset;
    if (slot === "background") {
      const background = { kind: "local-image", assetId: id } as const;
      this.state.settings.background = background;
      this.state.settings.overrides = mergePatch(this.state.settings.overrides, { background });
    } else {
      this.state.settings.assets[slot] = id;
      this.state.settings.overrides = mergePatch(this.state.settings.overrides, {
        assets: { [slot]: id },
      });
    }
    this.save();
    return { id, slot, mimeType };
  }

  readAsset(assetId: string): AppearanceAssetPayload {
    const asset = this.state.assets[assetId];
    if (!asset) {
      throw new Error("外观资源不存在");
    }
    const filePath = path.join(this.assetsRoot, asset.fileName);
    return { mimeType: asset.mimeType, data: readFileSync(filePath).toString("base64") };
  }

  createTheme(input: AppearanceThemeInput): AppearanceTheme {
    const timestamp = this.now().toISOString();
    const theme: AppearanceTheme = {
      id: `theme-${randomUUID()}`,
      name: safeText(input.name, "未命名主题"),
      author: safeText(input.author, "本机用户"),
      version: safeText(input.version, "1.0.0", 24),
      kind: "custom",
      ...(input.description ? { description: safeText(input.description, "", 240) } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      config: mergeConfig(this.currentConfig(), input.config),
    };
    this.state.themes.push(theme);
    this.save();
    return structuredClone(theme);
  }

  duplicateTheme(themeId: string): AppearanceTheme {
    const source = this.findTheme(themeId);
    return this.createTheme({
      name: `${source.name} 副本`,
      author: source.author,
      description: source.description,
      version: source.version,
      config: source.config,
    });
  }

  updateTheme(themeId: string, patch: AppearanceThemePatch): AppearanceTheme {
    const theme = this.state.themes.find((candidate) => candidate.id === themeId);
    if (!theme) {
      throw new Error("只能编辑自定义或导入的主题");
    }
    theme.name = patch.name === undefined ? theme.name : safeText(patch.name, theme.name);
    theme.author = patch.author === undefined ? theme.author : safeText(patch.author, theme.author);
    theme.version = patch.version === undefined ? theme.version : safeText(patch.version, theme.version, 24);
    if (patch.description !== undefined) {
      theme.description = safeText(patch.description, "", 240);
    }
    theme.config = mergeConfig(theme.config, patch.config);
    theme.updatedAt = this.now().toISOString();
    this.pruneAssets();
    this.save();
    return structuredClone(theme);
  }

  deleteTheme(themeId: string): void {
    if (BUILTIN_THEMES.some((theme) => theme.id === themeId)) {
      throw new Error("内置主题不能删除");
    }
    const before = this.state.themes.length;
    this.state.themes = this.state.themes.filter((theme) => theme.id !== themeId);
    if (this.state.themes.length === before) {
      throw new Error("主题不存在");
    }
    if (this.state.settings.activeThemeId === themeId) {
      this.state.settings = {
        ...this.state.settings,
        ...structuredClone(BUILTIN_THEMES[0]!.config),
        activeThemeId: "builtin-light",
        overrides: {},
      };
    }
    this.pruneAssets();
    this.save();
  }

  applyTheme(themeId: string): AppearanceSnapshot {
    const theme = this.findTheme(themeId);
    this.state.settings = {
      ...this.state.settings,
      ...structuredClone(theme.config),
      activeThemeId: theme.id,
      overrides: {},
    };
    this.pruneAssets();
    this.save();
    return this.snapshot();
  }

  updateProvider(providerId: string, update: AppearanceProviderUpdate): AppearanceSnapshot {
    const id = safeText(providerId, "", 100);
    if (!id) {
      throw new Error("外观提供器无效");
    }
    this.state.settings.providers[id] = {
      enabled: update.enabled,
      settings: sanitizeProviderSettings(update.settings ?? {}),
    };
    if (update.enabled) {
      const background = { kind: "provider", providerId: id } as const;
      this.state.settings.background = background;
      this.state.settings.overrides = mergePatch(this.state.settings.overrides, { background });
    } else if (
      this.state.settings.background.kind === "provider"
      && this.state.settings.background.providerId === id
    ) {
      this.state.settings.background = { kind: "none" };
      this.state.settings.overrides = mergePatch(this.state.settings.overrides, {
        background: { kind: "none" },
      });
    }
    this.save();
    return this.snapshot();
  }

  exportTheme(themeId: string, targetPath: string): string {
    const theme = this.findTheme(themeId);
    const archive = new AdmZip();
    const packageTheme = structuredClone(theme) as ThemePackageManifest["theme"] & { id?: string; kind?: string; createdAt?: string; updatedAt?: string };
    delete packageTheme.id;
    delete packageTheme.kind;
    delete packageTheme.createdAt;
    delete packageTheme.updatedAt;
    packageTheme.config = this.packageConfigAssets(packageTheme.config, archive);
    const manifest: ThemePackageManifest = { schemaVersion: 1, theme: packageTheme };
    archive.addFile("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    const output = targetPath.toLocaleLowerCase().endsWith(".dsh-theme")
      ? targetPath
      : `${targetPath}.dsh-theme`;
    mkdirSync(path.dirname(output), { recursive: true });
    archive.writeZip(output);
    return output;
  }

  importTheme(packagePath: string): AppearanceTheme {
    if (statSync(packagePath).size > MAX_PACKAGE_BYTES) {
      throw new Error("主题包不能超过 80 MB");
    }
    const archive = new AdmZip(packagePath);
    let total = 0;
    for (const entry of archive.getEntries()) {
      total += entry.header.size;
      const normalized = entry.entryName.replaceAll("\\", "/");
      if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
        throw new Error("主题包包含不安全路径");
      }
      if (normalized !== "manifest.json" && !/^assets\/[a-zA-Z0-9._-]+\.(png|jpe?g|webp|gif|avif)$/i.test(normalized)) {
        throw new Error("主题包包含不支持的主题资源");
      }
    }
    if (total > MAX_PACKAGE_BYTES) {
      throw new Error("主题包解压后过大");
    }
    const manifestEntry = archive.getEntry("manifest.json");
    if (!manifestEntry) {
      throw new Error("主题包缺少 manifest.json");
    }
    const manifest = JSON.parse(manifestEntry.getData().toString("utf8")) as Partial<ThemePackageManifest>;
    if (manifest.schemaVersion !== 1 || !manifest.theme || typeof manifest.theme.name !== "string") {
      throw new Error("主题包清单无效");
    }
    const config = this.importPackageAssets(mergeConfig(DEFAULT_CONFIG, manifest.theme.config), archive);
    const theme = this.createTheme({
      name: manifest.theme.name,
      author: manifest.theme.author,
      version: manifest.theme.version,
      description: manifest.theme.description,
      config,
    });
    const stored = this.state.themes.find((candidate) => candidate.id === theme.id)!;
    stored.kind = "imported";
    this.save();
    return structuredClone(stored);
  }

  private currentConfig(): AppearanceConfig {
    const theme = this.state.settings.activeThemeId
      ? this.findTheme(this.state.settings.activeThemeId)
      : undefined;
    return mergeConfig(theme?.config ?? this.state.settings, this.state.settings.overrides);
  }

  private findTheme(themeId: string): AppearanceTheme {
    const theme = [...BUILTIN_THEMES, ...this.state.themes].find((candidate) => candidate.id === themeId);
    if (!theme) {
      throw new Error("主题不存在");
    }
    return theme;
  }

  private packageConfigAssets(config: AppearanceConfig, archive: AdmZip): AppearanceConfig {
    const packaged = structuredClone(config);
    const packageAsset = (assetId: string): string => {
      const asset = this.state.assets[assetId];
      if (!asset) {
        throw new Error(`主题资源不存在：${assetId}`);
      }
      const entryName = `assets/${asset.fileName}`;
      if (!archive.getEntry(entryName)) {
        archive.addFile(entryName, readFileSync(path.join(this.assetsRoot, asset.fileName)));
      }
      return entryName;
    };
    if (packaged.background.kind === "local-image") {
      packaged.background.assetId = packageAsset(packaged.background.assetId);
    }
    for (const [slot, assetId] of Object.entries(packaged.assets)) {
      if (assetId) {
        packaged.assets[slot as AppearanceAssetSlot] = packageAsset(assetId);
      }
    }
    return packaged;
  }

  private importPackageAssets(config: AppearanceConfig, archive: AdmZip): AppearanceConfig {
    const imported = structuredClone(config);
    const importedEntries = new Map<string, string>();
    const importAsset = (entryName: string, slot: AppearanceAssetSlot): string => {
      const existing = importedEntries.get(entryName);
      if (existing) {
        return existing;
      }
      const entry = archive.getEntry(entryName);
      const extension = path.extname(entryName).toLocaleLowerCase();
      const mimeType = SUPPORTED_IMAGES[extension];
      if (!entry || !mimeType || entry.header.size > MAX_ASSET_BYTES) {
        throw new Error("主题资源无效或超过 20 MB");
      }
      mkdirSync(this.assetsRoot, { recursive: true });
      const id = `asset-${randomUUID()}`;
      const fileName = `${id}${extension === ".jpeg" ? ".jpg" : extension}`;
      writeFileSync(path.join(this.assetsRoot, fileName), entry.getData());
      this.state.assets[id] = { id, slot, mimeType, fileName };
      importedEntries.set(entryName, id);
      return id;
    };
    if (imported.background.kind === "local-image") {
      imported.background.assetId = importAsset(imported.background.assetId, "background");
    }
    for (const [slot, entryName] of Object.entries(imported.assets)) {
      if (entryName) {
        imported.assets[slot as AppearanceAssetSlot] = importAsset(entryName, slot as AppearanceAssetSlot);
      }
    }
    return imported;
  }

  private pruneAssets(): void {
    const used = new Set<string>();
    const collect = (config: AppearanceConfig): void => {
      if (config.background.kind === "local-image") used.add(config.background.assetId);
      for (const assetId of Object.values(config.assets)) {
        if (assetId) used.add(assetId);
      }
    };
    collect(this.state.settings);
    for (const theme of this.state.themes) collect(theme.config);
    for (const [assetId, asset] of Object.entries(this.state.assets)) {
      if (used.has(assetId)) continue;
      rmSync(path.join(this.assetsRoot, asset.fileName), { force: true });
      delete this.state.assets[assetId];
    }
  }

  private load(): AppearanceState {
    try {
      const raw = JSON.parse(readFileSync(this.statePath, "utf8")) as Partial<AppearanceState>;
      const settings = defaultSettings();
      const storedSettings = raw.settings;
      if (storedSettings) {
        Object.assign(settings, mergeConfig(settings, storedSettings));
        settings.activeThemeId = typeof storedSettings.activeThemeId === "string"
          ? storedSettings.activeThemeId
          : settings.activeThemeId;
        settings.providers = storedSettings.providers && typeof storedSettings.providers === "object"
          ? storedSettings.providers
          : {};
        settings.overrides = storedSettings.overrides && typeof storedSettings.overrides === "object"
          ? storedSettings.overrides
          : {};
      }
      return {
        schemaVersion: 1,
        settings,
        themes: Array.isArray(raw.themes) ? raw.themes.filter((theme) => theme.kind !== "builtin") : [],
        assets: raw.assets && typeof raw.assets === "object" ? raw.assets : {},
      };
    } catch {
      return { schemaVersion: 1, settings: defaultSettings(), themes: [], assets: {} };
    }
  }

  private save(): void {
    mkdirSync(this.root, { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, this.statePath);
  }
}

function mergePatch(base: AppearanceConfigPatch, patch: AppearanceConfigPatch): AppearanceConfigPatch {
  return {
    ...base,
    ...patch,
    effects: { ...base.effects, ...patch.effects },
    colors: { ...base.colors, ...patch.colors },
    assets: { ...base.assets, ...patch.assets },
  };
}

function sanitizeProviderSettings(value: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized.length > 32_000) {
    throw new Error("外观提供器配置过大");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}
