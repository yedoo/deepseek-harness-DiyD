export type AppearanceMode = "system" | "light" | "dark";
export type AppearanceThemeKind = "builtin" | "custom" | "imported";
export type AppearanceProviderKind = "background" | "theme" | "overlay" | "effect";
export type AppearanceAssetSlot =
  | "background"
  | "characterLeft"
  | "characterRight"
  | "sidebarDecoration"
  | "composerDecoration"
  | "preview";

export interface AppearanceEffects {
  dim: number;
  blur: number;
  panelOpacity: number;
  borderAlpha: number;
  radius: number;
}

export interface AppearanceColors {
  accent?: string;
  surface?: string;
  sidebar?: string;
  text?: string;
}

export type AppearanceBackground =
  | { kind: "none" }
  | { kind: "local-image"; assetId: string }
  | { kind: "provider"; providerId: string };

export type AppearanceAssets = Partial<Record<AppearanceAssetSlot, string>>;

export interface AppearanceConfig {
  mode: AppearanceMode;
  background: AppearanceBackground;
  effects: AppearanceEffects;
  colors: AppearanceColors;
  assets: AppearanceAssets;
}

export interface AppearanceConfigPatch {
  mode?: AppearanceMode;
  background?: AppearanceBackground;
  effects?: Partial<AppearanceEffects>;
  colors?: AppearanceColors;
  assets?: AppearanceAssets;
}

export interface AppearanceProviderState {
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface AppearanceSettings extends AppearanceConfig {
  activeThemeId?: string;
  providers: Record<string, AppearanceProviderState>;
  overrides: AppearanceConfigPatch;
}

export interface AppearanceTheme {
  id: string;
  name: string;
  author: string;
  version: string;
  kind: AppearanceThemeKind;
  description?: string;
  createdAt: string;
  updatedAt: string;
  config: AppearanceConfig;
}

export interface AppearanceProviderDescriptor {
  id: string;
  name: string;
  kind: AppearanceProviderKind;
  source: "native" | "plugin";
  available: boolean;
  description?: string;
  capabilities: string[];
}

export interface AppearanceSnapshot {
  settings: AppearanceSettings;
  themes: AppearanceTheme[];
  providers: AppearanceProviderDescriptor[];
}

export interface AppearanceAssetPayload {
  mimeType: string;
  data: string;
}

export interface AppearanceAssetReference {
  id: string;
  slot: AppearanceAssetSlot;
  mimeType: string;
}

export interface AppearanceThemeInput {
  name: string;
  author?: string;
  description?: string;
  version?: string;
  config?: AppearanceConfigPatch;
}

export interface AppearanceThemePatch {
  name?: string;
  author?: string;
  description?: string;
  version?: string;
  config?: AppearanceConfigPatch;
}

export interface AppearanceProviderUpdate {
  enabled: boolean;
  settings?: Record<string, unknown>;
}
