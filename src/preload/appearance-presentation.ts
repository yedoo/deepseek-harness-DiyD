import type {
  AppearanceConfig,
  AppearanceConfigPatch,
  AppearanceSnapshot,
} from "../appearance-types";

const DEFAULT_CONFIG: AppearanceConfig = {
  mode: "system",
  background: { kind: "none" },
  effects: { dim: 0.08, blur: 18, panelOpacity: 0.9, borderAlpha: 0.18, radius: 18 },
  colors: {},
  assets: {},
};

function mergeConfig(base: AppearanceConfig, patch?: AppearanceConfigPatch): AppearanceConfig {
  if (!patch) {
    return structuredClone(base);
  }
  return {
    mode: patch.mode ?? base.mode,
    background: patch.background ?? base.background,
    effects: { ...base.effects, ...patch.effects },
    colors: { ...base.colors, ...patch.colors },
    assets: { ...base.assets, ...patch.assets },
  };
}

export function resolveEffectiveAppearance(snapshot: AppearanceSnapshot): AppearanceConfig {
  const theme = snapshot.settings.activeThemeId
    ? snapshot.themes.find((candidate) => candidate.id === snapshot.settings.activeThemeId)
    : undefined;
  const base = theme?.config ?? {
    mode: snapshot.settings.mode,
    background: snapshot.settings.background,
    effects: snapshot.settings.effects,
    colors: snapshot.settings.colors,
    assets: snapshot.settings.assets,
  };
  return mergeConfig(base, snapshot.settings.overrides);
}

export function appearanceCssVariables(config: AppearanceConfig): Record<string, string> {
  const variables: Record<string, string> = {
    "--dsh-appearance-dim": String(config.effects.dim),
    "--dsh-appearance-blur": `${config.effects.blur}px`,
    "--dsh-appearance-panel-opacity": String(config.effects.panelOpacity),
    "--dsh-appearance-border-alpha": String(config.effects.borderAlpha),
    "--dsh-appearance-radius": `${config.effects.radius}px`,
  };
  if (config.colors.text) {
    variables["--dsw-alias-label-primary"] = config.colors.text;
  }
  if (config.colors.surface) {
    variables["--dsh-appearance-surface"] = config.colors.surface;
  }
  if (config.colors.sidebar) {
    variables["--dsh-appearance-sidebar"] = config.colors.sidebar;
  }
  if (config.colors.accent) {
    variables["--dsh-appearance-accent"] = config.colors.accent;
    variables["--dsw-alias-brand-primary"] = config.colors.accent;
    variables["--dsw-alias-brand-primary-new-colorprimary-new-color"] = config.colors.accent;
  }
  return variables;
}

export { DEFAULT_CONFIG };
