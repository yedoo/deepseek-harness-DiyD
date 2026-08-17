import type { AppearanceProviderDescriptor, AppearanceProviderState } from "../appearance-types";

export interface AppearanceProviderOption {
  id: string;
  title: string;
  type?: "video" | "web";
  media?: string;
  preview?: string;
  playable: boolean;
}

export interface AppearanceProviderInventory {
  options: AppearanceProviderOption[];
  total: number;
  available: number;
  error?: string;
}

export interface AppearanceProviderAdapter {
  readonly id: string;
  readonly legacySettingsSelectors?: readonly string[];
  inventory?(): Promise<AppearanceProviderInventory>;
  resolveMedia?(state: AppearanceProviderState): Promise<AppearanceProviderOption | undefined>;
  syncCompatibilityState?(state: AppearanceProviderState): void;
}

interface WallpaperInventoryResponse {
  wallpapers?: Array<{
    id?: unknown;
    title?: unknown;
    type?: unknown;
    media?: unknown;
    preview?: unknown;
    playable?: unknown;
  }>;
  total?: unknown;
  portableCount?: unknown;
}

class WallpaperEngineAdapter implements AppearanceProviderAdapter {
  readonly id = "wallpaper-engine";
  readonly legacySettingsSelectors = [".we-picker"] as const;

  async inventory(): Promise<AppearanceProviderInventory> {
    try {
      const response = await fetch("/wallpaper-engine/inventory", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as WallpaperInventoryResponse;
      const options = (payload.wallpapers ?? []).flatMap((entry) => {
        if (typeof entry.id !== "string" || typeof entry.title !== "string") {
          return [];
        }
        return [{
          id: entry.id,
          title: entry.title,
          type: entry.type === "video" ? "video" as const : "web" as const,
          ...(typeof entry.media === "string" ? { media: entry.media } : {}),
          ...(typeof entry.preview === "string" ? { preview: entry.preview } : {}),
          playable: entry.playable === true,
        }];
      });
      return {
        options,
        total: typeof payload.total === "number" ? payload.total : options.length,
        available: typeof payload.portableCount === "number"
          ? payload.portableCount
          : options.filter((option) => option.playable).length,
      };
    } catch (error) {
      return {
        options: [],
        total: 0,
        available: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async resolveMedia(state: AppearanceProviderState): Promise<AppearanceProviderOption | undefined> {
    const wallpaperId = typeof state.settings.wallpaperId === "string"
      ? state.settings.wallpaperId
      : this.compatibilitySelection().id;
    if (!wallpaperId) {
      return undefined;
    }
    const inventory = await this.inventory();
    return inventory.options.find((option) => option.id === wallpaperId && option.playable);
  }

  syncCompatibilityState(state: AppearanceProviderState): void {
    const current = this.compatibilitySelection();
    const next = {
      ...current,
      id: typeof state.settings.wallpaperId === "string" ? state.settings.wallpaperId : current.id,
      scrim: numberSetting(state.settings.dim, current.scrim, 0, 0.9),
      border: numberSetting(state.settings.borderAlpha, current.border, 0, 0.9),
      blur: numberSetting(state.settings.blur, current.blur, 0, 40),
      wallpaperBlur: numberSetting(state.settings.wallpaperBlur, current.wallpaperBlur, 0, 60),
    };
    localStorage.setItem("dsh-wallpaper-engine:selection", JSON.stringify(next));
  }

  private compatibilitySelection(): {
    id: string;
    scrim: number;
    border: number;
    blur: number;
    wallpaperBlur: number;
  } {
    try {
      const parsed = JSON.parse(localStorage.getItem("dsh-wallpaper-engine:selection") ?? "{}") as Record<string, unknown>;
      return {
        id: typeof parsed.id === "string" ? parsed.id : "",
        scrim: numberSetting(parsed.scrim, 0.25, 0, 0.9),
        border: numberSetting(parsed.border, 0.35, 0, 0.9),
        blur: numberSetting(parsed.blur, 24, 0, 40),
        wallpaperBlur: numberSetting(parsed.wallpaperBlur, 0, 0, 60),
      };
    } catch {
      return { id: "", scrim: 0.25, border: 0.35, blur: 24, wallpaperBlur: 0 };
    }
  }
}

export class AppearanceProviderRegistry {
  private readonly adapters = new Map<string, AppearanceProviderAdapter>();
  private readonly externalDescriptors = new Map<string, AppearanceProviderDescriptor>();

  constructor() {
    this.register(new WallpaperEngineAdapter());
    window.addEventListener("dsh:appearance-provider-register", (event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const descriptor = validateExternalDescriptor(detail);
      if (descriptor) {
        this.externalDescriptors.set(descriptor.id, descriptor);
        window.dispatchEvent(new CustomEvent("dsh:appearance-providers-changed"));
      }
    });
  }

  register(adapter: AppearanceProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): AppearanceProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  descriptors(): AppearanceProviderDescriptor[] {
    return [...this.externalDescriptors.values()];
  }

  legacySettingsSelectors(): string[] {
    return [...new Set(
      [...this.adapters.values()].flatMap((adapter) => adapter.legacySettingsSelectors ?? []),
    )];
  }
}

function numberSetting(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function validateExternalDescriptor(value: unknown): AppearanceProviderDescriptor | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<AppearanceProviderDescriptor>;
  if (
    typeof candidate.id !== "string"
    || !/^[a-z0-9][a-z0-9._-]{1,99}$/i.test(candidate.id)
    || typeof candidate.name !== "string"
    || !["background", "theme", "overlay", "effect"].includes(String(candidate.kind))
  ) {
    return undefined;
  }
  return {
    id: candidate.id,
    name: candidate.name.slice(0, 80),
    kind: candidate.kind!,
    source: "plugin",
    available: candidate.available !== false,
    ...(typeof candidate.description === "string" ? { description: candidate.description.slice(0, 240) } : {}),
    capabilities: Array.isArray(candidate.capabilities)
      ? candidate.capabilities.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [],
  };
}
