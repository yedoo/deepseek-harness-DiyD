import type {
  AppearanceAssetPayload,
  AppearanceConfig,
  AppearanceSnapshot,
} from "../appearance-types";
import { appearanceCssVariables, resolveEffectiveAppearance } from "./appearance-presentation";
import { AppearanceProviderRegistry } from "./appearance-providers";

export interface AppearanceRuntimeApi {
  getAppearance(): Promise<AppearanceSnapshot>;
  getAppearanceAsset(assetId: string): Promise<AppearanceAssetPayload>;
}

const LAYER_ID = "dsh-desktop-appearance-layer";
const STYLE_ID = "dsh-desktop-appearance-style";

export function installAppearanceRuntime(
  api: AppearanceRuntimeApi,
  registry: AppearanceProviderRegistry,
): { apply(snapshot: AppearanceSnapshot): Promise<void>; dispose(): void } {
  let sequence = 0;
  let lastSnapshot: AppearanceSnapshot | undefined;
  const syncNativeTheme = (): void => {
    const dark = document.body.hasAttribute("data-ds-dark-theme");
    document.getElementById("dsh-desktop-titlebar")?.setAttribute("data-theme", dark ? "dark" : "light");
    if (lastSnapshot) {
      void apply(lastSnapshot);
    }
  };
  const themeObserver = new MutationObserver(syncNativeTheme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });

  installStyle(registry);
  syncNativeTheme();

  const apply = async (snapshot: AppearanceSnapshot): Promise<void> => {
    const currentSequence = ++sequence;
    lastSnapshot = snapshot;
    const config = resolveEffectiveAppearance(snapshot);
    applyTokens(config);
    const urls = await resolveAssetUrls(config, api);
    if (currentSequence !== sequence) {
      return;
    }
    await renderLayers(config, urls, snapshot, registry, currentSequence, () => sequence);
  };

  void api.getAppearance().then(apply).catch(() => undefined);

  return {
    apply,
    dispose: () => {
      sequence += 1;
      themeObserver.disconnect();
      document.getElementById(LAYER_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
      document.body.removeAttribute("data-dsh-desktop-appearance");
      document.body.removeAttribute("data-dsh-appearance-background");
    },
  };
}

function installStyle(registry: AppearanceProviderRegistry): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  const legacySettingsRules = registry.legacySettingsSelectors()
    .map((selector) => `${selector} { display: none !important; }`)
    .join("\n");
  style.textContent = `
    ${legacySettingsRules}
    #${LAYER_ID} { position: fixed; inset: 0; z-index: -4; overflow: hidden; pointer-events: none; }
    #${LAYER_ID} .dsh-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border: 0; transform: scale(var(--dsh-bg-scale, 1)); filter: blur(var(--dsh-bg-blur, 0px)); }
    #${LAYER_ID} .dsh-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, var(--dsh-appearance-dim, .08)); }
    #${LAYER_ID} .dsh-art { position: absolute; bottom: 0; max-height: calc(100% - 36px); max-width: 46%; object-fit: contain; }
    #${LAYER_ID} .dsh-art-left { left: 0; object-position: left bottom; }
    #${LAYER_ID} .dsh-art-right { right: 0; object-position: right bottom; }
    #${LAYER_ID} .dsh-art-sidebar { left: 0; bottom: 0; width: min(350px, 28vw); max-height: 72%; object-position: left bottom; opacity: .92; }
    #${LAYER_ID} .dsh-art-composer { left: 50%; bottom: 8%; width: min(780px, 58vw); max-height: 32%; transform: translateX(-50%); object-position: center bottom; }
    body[data-dsh-appearance-background="true"] {
      --dsw-alias-bg-base: transparent;
      --dsw-specific-sidebar-fill: transparent;
      --dsw-specific-input-major: rgba(255,255,255,var(--dsh-appearance-panel-opacity));
      --dsw-specific-bubble: rgba(255,255,255,calc(var(--dsh-appearance-panel-opacity) * .82));
      --dsw-alias-border-l1: rgba(160,160,170,var(--dsh-appearance-border-alpha));
      --dsw-alias-border-l2: rgba(160,160,170,var(--dsh-appearance-border-alpha));
    }
    body[data-ds-dark-theme][data-dsh-appearance-background="true"] {
      --dsw-specific-input-major: rgba(20,22,28,var(--dsh-appearance-panel-opacity));
      --dsw-specific-bubble: rgba(20,22,28,calc(var(--dsh-appearance-panel-opacity) * .82));
    }
    body[data-dsh-appearance-background="true"] [class*="_sidebarCol"],
    body[data-dsh-appearance-background="true"] .sidebar {
      border-right-color: transparent !important;
    }
    body[data-dsh-appearance-background="true"] [data-composer-card],
    body[data-dsh-appearance-background="true"] [class*="_bubble"] {
      backdrop-filter: blur(var(--dsh-appearance-blur)) saturate(1.35);
      -webkit-backdrop-filter: blur(var(--dsh-appearance-blur)) saturate(1.35);
      border-radius: var(--dsh-appearance-radius);
    }
  `;
  document.head.append(style);
}

function applyTokens(config: AppearanceConfig): void {
  document.body.setAttribute("data-dsh-desktop-appearance", "true");
  for (const [property, value] of Object.entries(appearanceCssVariables(config))) {
    document.body.style.setProperty(property, value);
  }
  const hasVisual = config.background.kind !== "none"
    || Boolean(config.assets.characterLeft)
    || Boolean(config.assets.characterRight)
    || Boolean(config.assets.sidebarDecoration)
    || Boolean(config.assets.composerDecoration);
  const nativeDark = document.body.hasAttribute("data-ds-dark-theme");
  const paletteMatchesNative = config.mode !== "system" && (config.mode === "dark") === nativeDark;
  if (paletteMatchesNative) {
    setOptionalToken("--dsw-alias-label-primary", config.colors.text);
  } else {
    document.body.style.removeProperty("--dsw-alias-label-primary");
  }
  if (hasVisual) {
    document.body.style.removeProperty("--dsw-alias-bg-base");
    document.body.style.removeProperty("--dsw-alias-bg-layer-1");
    document.body.style.removeProperty("--dsw-specific-sidebar-fill");
  } else if (paletteMatchesNative) {
    setOptionalToken("--dsw-alias-bg-base", config.colors.surface);
    setOptionalToken("--dsw-alias-bg-layer-1", config.colors.surface);
    setOptionalToken("--dsw-specific-sidebar-fill", config.colors.sidebar);
  } else {
    document.body.style.removeProperty("--dsw-alias-bg-base");
    document.body.style.removeProperty("--dsw-alias-bg-layer-1");
    document.body.style.removeProperty("--dsw-specific-sidebar-fill");
  }
}

async function resolveAssetUrls(
  config: AppearanceConfig,
  api: AppearanceRuntimeApi,
): Promise<Record<string, string>> {
  const assetIds = new Set(Object.values(config.assets).filter((value): value is string => Boolean(value)));
  if (config.background.kind === "local-image") {
    assetIds.add(config.background.assetId);
  }
  const urls: Record<string, string> = {};
  await Promise.all([...assetIds].map(async (assetId) => {
    try {
      const asset = await api.getAppearanceAsset(assetId);
      urls[assetId] = `data:${asset.mimeType};base64,${asset.data}`;
    } catch {
      // Missing assets are rendered as empty slots instead of breaking Harness.
    }
  }));
  return urls;
}

async function renderLayers(
  config: AppearanceConfig,
  urls: Record<string, string>,
  snapshot: AppearanceSnapshot,
  registry: AppearanceProviderRegistry,
  expectedSequence: number,
  currentSequence: () => number,
): Promise<void> {
  document.body.style.setProperty("--dsh-bg-blur", "0px");
  document.body.style.setProperty("--dsh-bg-scale", "1");
  let backgroundUrl: string | undefined;
  let backgroundType: "image" | "video" | "web" = "image";
  let externalProviderActive = false;
  if (config.background.kind === "local-image") {
    backgroundUrl = urls[config.background.assetId];
  } else if (config.background.kind === "provider") {
    const adapter = registry.get(config.background.providerId);
    const state = snapshot.settings.providers[config.background.providerId];
    if (state?.enabled) {
      window.dispatchEvent(new CustomEvent("dsh:appearance-provider-state", {
        detail: { providerId: config.background.providerId, ...structuredClone(state) },
      }));
      if (adapter) {
        adapter.syncCompatibilityState?.(state);
        const option = await adapter.resolveMedia?.(state);
        if (expectedSequence !== currentSequence()) {
          return;
        }
        backgroundUrl = option?.media;
        backgroundType = option?.type ?? "web";
      } else {
        externalProviderActive = true;
      }
      const wallpaperBlur = typeof state.settings.wallpaperBlur === "number"
        ? Math.min(60, Math.max(0, state.settings.wallpaperBlur))
        : 0;
      document.body.style.setProperty("--dsh-bg-blur", `${wallpaperBlur}px`);
      document.body.style.setProperty("--dsh-bg-scale", String(1 + wallpaperBlur * .006));
    }
  }
  const hasVisual = Boolean(
    backgroundUrl
    || externalProviderActive
    || config.assets.characterLeft
    || config.assets.characterRight
    || config.assets.sidebarDecoration
    || config.assets.composerDecoration,
  );
  document.body.setAttribute("data-dsh-appearance-background", String(hasVisual));
  document.getElementById(LAYER_ID)?.remove();
  if (!hasVisual) {
    return;
  }
  if (externalProviderActive && !backgroundUrl && Object.keys(config.assets).length === 0) {
    return;
  }
  document.getElementById("dsh-wallpaper-engine-layer")?.remove();
  document.getElementById("dsh-wallpaper-engine-scrim")?.remove();
  const layer = document.createElement("div");
  layer.id = LAYER_ID;
  if (backgroundUrl) {
    const element = backgroundType === "video"
      ? document.createElement("video")
      : backgroundType === "web"
        ? document.createElement("iframe")
        : document.createElement("img");
    element.className = "dsh-bg";
    element.setAttribute("src", backgroundUrl);
    if (element instanceof HTMLVideoElement) {
      const providerState = config.background.kind === "provider"
        ? snapshot.settings.providers[config.background.providerId]
        : undefined;
      element.autoplay = providerState?.settings.playing !== false;
      element.loop = true;
      element.muted = true;
      element.playsInline = true;
      if (providerState?.settings.playing === false) {
        element.addEventListener("loadeddata", () => element.pause(), { once: true });
      }
    }
    layer.append(element);
  }
  appendArt(layer, urls[config.assets.characterLeft ?? ""], "dsh-art dsh-art-left");
  appendArt(layer, urls[config.assets.characterRight ?? ""], "dsh-art dsh-art-right");
  appendArt(layer, urls[config.assets.sidebarDecoration ?? ""], "dsh-art dsh-art-sidebar");
  appendArt(layer, urls[config.assets.composerDecoration ?? ""], "dsh-art dsh-art-composer");
  const scrim = document.createElement("div");
  scrim.className = "dsh-scrim";
  layer.append(scrim);
  document.body.append(layer);
}

function appendArt(layer: HTMLElement, url: string | undefined, className: string): void {
  if (!url) {
    return;
  }
  const image = document.createElement("img");
  image.className = className;
  image.src = url;
  layer.append(image);
}

function setOptionalToken(property: string, value: string | undefined): void {
  if (value) {
    document.body.style.setProperty(property, value);
  } else {
    document.body.style.removeProperty(property);
  }
}
