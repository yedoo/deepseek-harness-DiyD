import type {
  AppearanceAssetPayload,
  AppearanceAssetSlot,
  AppearanceConfigPatch,
  AppearanceProviderUpdate,
  AppearanceSnapshot,
  AppearanceTheme,
  AppearanceThemeInput,
  AppearanceThemePatch,
} from "../appearance-types";
import { resolveEffectiveAppearance } from "./appearance-presentation";
import {
  AppearanceProviderRegistry,
  type AppearanceProviderInventory,
} from "./appearance-providers";

export interface AppearanceDesktopApi {
  getAppearance(): Promise<AppearanceSnapshot>;
  updateAppearance(patch: AppearanceConfigPatch): Promise<AppearanceSnapshot>;
  selectAppearanceAsset(slot: AppearanceAssetSlot): Promise<{
    asset: { id: string; slot: AppearanceAssetSlot; mimeType: string };
    snapshot: AppearanceSnapshot;
  } | undefined>;
  getAppearanceAsset(assetId: string): Promise<AppearanceAssetPayload>;
  createAppearanceTheme(input: AppearanceThemeInput): Promise<AppearanceSnapshot>;
  duplicateAppearanceTheme(themeId: string): Promise<AppearanceSnapshot>;
  updateAppearanceTheme(themeId: string, patch: AppearanceThemePatch): Promise<AppearanceSnapshot>;
  deleteAppearanceTheme(themeId: string): Promise<AppearanceSnapshot>;
  applyAppearanceTheme(themeId: string): Promise<AppearanceSnapshot>;
  updateAppearanceProvider(providerId: string, update: AppearanceProviderUpdate): Promise<AppearanceSnapshot>;
  importAppearanceTheme(): Promise<AppearanceSnapshot | undefined>;
  exportAppearanceTheme(themeId: string): Promise<string | undefined>;
}

interface SettingsShell {
  nav: HTMLElement;
  content: HTMLElement;
  referenceButton: HTMLButtonElement;
  openConfigButton?: HTMLButtonElement;
  closeButton?: HTMLButtonElement;
}

type AppearancePage = "settings" | "themes" | "editor";

interface ViewState {
  snapshot?: AppearanceSnapshot;
  page: AppearancePage;
  editorThemeId?: string;
  loading: boolean;
  busy: boolean;
  notice?: { tone: "success" | "error"; message: string };
  inventories: Map<string, AppearanceProviderInventory>;
  loadingInventories: Set<string>;
}

const NAV_ATTRIBUTE = "data-dsh-appearance-nav";
const PANEL_ATTRIBUTE = "data-dsh-appearance-panel";

export function injectAppearanceSettings(
  api: AppearanceDesktopApi,
  registry: AppearanceProviderRegistry,
  onSnapshot: (snapshot: AppearanceSnapshot) => void,
): () => void {
  let queued = false;
  const enhance = (): void => {
    queued = false;
    const shell = findSettingsShell();
    if (shell) {
      installAppearanceSection(shell, api, registry, onSnapshot);
    }
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(enhance);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("dsh:appearance-providers-changed", schedule);
  schedule();
  return () => {
    observer.disconnect();
    window.removeEventListener("dsh:appearance-providers-changed", schedule);
  };
}

function findSettingsShell(): SettingsShell | undefined {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button,[role=button]"));
  const plugin = buttons.find((button) => exactText(button) === "插件" || exactText(button) === "Plugins");
  const general = buttons.find((button) => exactText(button) === "通用设置" || exactText(button) === "General");
  if (!plugin || !general) return undefined;
  let nav = plugin.parentElement;
  while (nav && !nav.contains(general)) nav = nav.parentElement;
  if (!nav) return undefined;
  const dialog = nav.closest<HTMLElement>('[role="dialog"]');
  if (dialog) {
    const navBranch = branchBelow(dialog, nav);
    const content = Array.from(dialog.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== navBranch,
    );
    if (content) {
      return {
        nav,
        content,
        referenceButton: general,
        openConfigButton: findButton(content, ["打开配置文件", "Open config file"]),
        closeButton: content.querySelector<HTMLButtonElement>('button[aria-label="关闭"],button[aria-label="Close"]')
          ?? findButton(content, ["关闭", "Close"]),
      };
    }
  }
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3"))
    .filter((heading) => !nav!.contains(heading) && !["设置", "Settings"].includes(exactText(heading)));
  const heading = headings.find((candidate) => {
    const common = commonAncestor(nav!, candidate);
    return common && common !== document.body;
  });
  if (!heading) return undefined;
  const root = commonAncestor(nav, heading);
  if (!root) return undefined;
  const content = branchBelow(root, heading);
  if (!content || content === nav) return undefined;
  return {
    nav,
    content,
    referenceButton: general,
    openConfigButton: findButton(root, ["打开配置文件", "Open config file"]),
    closeButton: root.querySelector<HTMLButtonElement>('button[aria-label="关闭"],button[aria-label="Close"]') ?? undefined,
  };
}

function commonAncestor(first: Element, second: Element): HTMLElement | undefined {
  const ancestors = new Set<Element>();
  let node: Element | null = first;
  while (node) { ancestors.add(node); node = node.parentElement; }
  node = second;
  while (node) {
    if (ancestors.has(node) && node instanceof HTMLElement) return node;
    node = node.parentElement;
  }
  return undefined;
}

function branchBelow(root: HTMLElement, element: HTMLElement): HTMLElement | undefined {
  let node: HTMLElement = element;
  while (node.parentElement && node.parentElement !== root) node = node.parentElement;
  return node.parentElement === root ? node : undefined;
}

function installAppearanceSection(
  shell: SettingsShell,
  api: AppearanceDesktopApi,
  registry: AppearanceProviderRegistry,
  onSnapshot: (snapshot: AppearanceSnapshot) => void,
): void {
  if (shell.nav.querySelector(`[${NAV_ATTRIBUTE}]`)) return;
  const navButton = document.createElement("button");
  navButton.type = "button";
  navButton.className = withoutActiveClasses(shell.referenceButton.className);
  navButton.setAttribute(NAV_ATTRIBUTE, "true");
  navButton.innerHTML = `<span aria-hidden="true" style="display:inline-block;width:1.25em">◐</span><span>外观</span>`;
  shell.referenceButton.insertAdjacentElement("afterend", navButton);

  const host = document.createElement("section");
  host.setAttribute(PANEL_ATTRIBUTE, "true");
  host.hidden = true;
  host.style.width = "100%";
  host.style.height = "100%";
  const shadow = host.attachShadow({ mode: "open" });
  shell.content.append(host);

  let active = false;
  const siblingNavButtons = (): HTMLElement[] => Array.from(shell.nav.querySelectorAll<HTMLElement>("button,[role=button]"))
    .filter((button) => button !== navButton);
  const nativeChildren = (): HTMLElement[] => Array.from(shell.content.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== host);
  const activate = (): void => {
    if (active) return;
    active = true;
    nativeChildren().forEach((child) => {
      child.dataset.dshAppearancePreviousDisplay = child.style.display;
      child.dataset.dshAppearancePreviousHidden = String(child.hidden);
      child.style.setProperty("display", "none", "important");
      child.hidden = true;
    });
    siblingNavButtons().forEach((button) => {
      button.dataset.dshAppearancePreviousBackground = button.style.background;
      button.dataset.dshAppearancePreviousClass = button.className;
      button.dataset.dshAppearancePreviousAriaCurrent = button.getAttribute("aria-current") ?? "__none__";
      button.className = withoutActiveClasses(button.className);
      button.removeAttribute("aria-current");
      button.style.setProperty("background", "transparent", "important");
    });
    host.hidden = false;
    navButton.style.background = "rgba(120, 128, 145, .14)";
    navButton.setAttribute("aria-current", "page");
    host.dispatchEvent(new CustomEvent("dsh-appearance-activate"));
  };
  const deactivate = (): void => {
    if (!active) return;
    active = false;
    nativeChildren().forEach((child) => {
      const previous = child.dataset.dshAppearancePreviousDisplay ?? "";
      previous ? child.style.setProperty("display", previous) : child.style.removeProperty("display");
      delete child.dataset.dshAppearancePreviousDisplay;
      child.hidden = child.dataset.dshAppearancePreviousHidden === "true";
      delete child.dataset.dshAppearancePreviousHidden;
    });
    siblingNavButtons().forEach((button) => {
      const previous = button.dataset.dshAppearancePreviousBackground ?? "";
      previous ? button.style.setProperty("background", previous) : button.style.removeProperty("background");
      delete button.dataset.dshAppearancePreviousBackground;
      button.className = button.dataset.dshAppearancePreviousClass ?? button.className;
      delete button.dataset.dshAppearancePreviousClass;
      const previousAriaCurrent = button.dataset.dshAppearancePreviousAriaCurrent;
      if (previousAriaCurrent && previousAriaCurrent !== "__none__") button.setAttribute("aria-current", previousAriaCurrent);
      else button.removeAttribute("aria-current");
      delete button.dataset.dshAppearancePreviousAriaCurrent;
    });
    host.hidden = true;
    navButton.style.removeProperty("background");
    navButton.removeAttribute("aria-current");
  };
  navButton.addEventListener("click", activate);
  shell.nav.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(`[${NAV_ATTRIBUTE}]`)) deactivate();
  });
  createPanel(shadow, host, api, registry, onSnapshot, {
    openConfig: () => shell.openConfigButton?.click(),
    close: () => shell.closeButton?.click(),
  });
}

function createPanel(
  shadow: ShadowRoot,
  host: HTMLElement,
  api: AppearanceDesktopApi,
  registry: AppearanceProviderRegistry,
  onSnapshot: (snapshot: AppearanceSnapshot) => void,
  nativeActions: { openConfig(): void; close(): void },
): void {
  const state: ViewState = {
    page: "settings",
    loading: false,
    busy: false,
    inventories: new Map(),
    loadingInventories: new Set(),
  };
  const root = document.createElement("div");
  root.className = "panel-root";
  const style = document.createElement("style");
  style.textContent = appearanceStyles();
  shadow.append(style, root);

  const mergeProviders = (snapshot: AppearanceSnapshot): AppearanceSnapshot => ({
    ...snapshot,
    providers: uniqueProviders([...snapshot.providers, ...registry.descriptors()]),
  });
  const accept = (snapshot: AppearanceSnapshot): void => {
    state.snapshot = mergeProviders(snapshot);
    const mode = resolveEffectiveAppearance(state.snapshot).mode;
    host.style.colorScheme = mode === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : mode;
    onSnapshot(state.snapshot);
    render();
  };
  window.addEventListener("dsh:appearance-providers-changed", () => {
    if (state.snapshot) {
      state.snapshot = mergeProviders(state.snapshot);
      render();
    }
  });
  const operation = async (work: () => Promise<AppearanceSnapshot | undefined>, success?: string): Promise<void> => {
    if (state.busy) return;
    state.busy = true;
    state.notice = undefined;
    render();
    try {
      const snapshot = await work();
      if (snapshot) accept(snapshot);
      if (success) state.notice = { tone: "success", message: success };
    } catch (error) {
      state.notice = { tone: "error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      state.busy = false;
      render();
    }
  };

  const load = async (): Promise<void> => {
    if (state.loading) return;
    state.loading = true;
    render();
    try { accept(await api.getAppearance()); }
    catch (error) { state.notice = { tone: "error", message: error instanceof Error ? error.message : String(error) }; }
    finally { state.loading = false; render(); }
  };

  const loadProviderInventory = async (providerId: string): Promise<void> => {
    const adapter = registry.get(providerId);
    if (!adapter?.inventory || state.loadingInventories.has(providerId)) return;
    state.loadingInventories.add(providerId);
    try { state.inventories.set(providerId, await adapter.inventory()); }
    finally { state.loadingInventories.delete(providerId); render(); }
  };

  const render = (): void => {
    root.innerHTML = `<div class="shell">${renderHeader(state)}${renderNotice(state)}${renderBody(state, registry)}</div>`;
    bindCommon(root, state, render, nativeActions);
    if (!state.snapshot) return;
    bindSettings(root, state, api, operation, loadProviderInventory);
    bindThemes(root, state, api, operation, render);
    bindEditor(root, state, api, operation, render);
    if (state.page === "settings") {
      for (const provider of state.snapshot.providers) {
        if (provider.available && registry.get(provider.id)?.inventory && !state.inventories.has(provider.id)) {
          void loadProviderInventory(provider.id);
        }
      }
    }
  };

  host.addEventListener("dsh-appearance-activate", () => {
    if (!state.snapshot) void load();
  });
  render();
}

function renderHeader(state: ViewState): string {
  return `
    <header><div><h2>外观</h2><p>管理工作台外观、主题包与外观扩展。</p></div><div class="header-actions"><button data-native-action="open-config">打开配置文件</button><button class="icon-btn" data-native-action="close" aria-label="关闭">×</button></div></header>
    <nav class="tabs" aria-label="外观页面">
      ${tabButton("settings", "外观设置", state.page)}
      ${tabButton("themes", "我的主题", state.page)}
      ${tabButton("editor", "主题编辑", state.page)}
    </nav>`;
}

function renderNotice(state: ViewState): string {
  if (!state.notice) return "";
  return `<div class="notice ${state.notice.tone}">${escapeHtml(state.notice.message)}</div>`;
}

function renderBody(state: ViewState, registry: AppearanceProviderRegistry): string {
  if (state.loading || !state.snapshot) return `<div class="empty">正在读取外观设置…</div>`;
  if (state.page === "themes") return renderThemes(state.snapshot);
  if (state.page === "editor") return renderEditor(state);
  return renderSettings(state, registry);
}

function renderSettings(state: ViewState, registry: AppearanceProviderRegistry): string {
  const snapshot = state.snapshot!;
  const config = resolveEffectiveAppearance(snapshot);
  return `<div class="page settings-page">
    <section class="block first-block">
      <div class="block-title"><div><h3>背景来源</h3><p>同一时间只启用一个背景来源。</p></div></div>
      <div class="source-grid">
        ${sourceCard("none", "纯色背景", "保留 Harness 的简洁默认背景", config.background.kind === "none")}
        ${sourceCard("local", "本地图片", "选择图片并安全复制到主题资源目录", config.background.kind === "local-image")}
        ${snapshot.providers.filter((provider) => provider.kind === "background").map((provider) => sourceCard(
          `provider:${provider.id}`,
          provider.name,
          provider.description ?? "由外观扩展提供",
          config.background.kind === "provider" && config.background.providerId === provider.id,
          !provider.available,
        )).join("")}
      </div>
      ${renderProviderControls(state, registry, config.background.kind === "provider" ? config.background.providerId : undefined)}
    </section>
    <section class="block">
      <div class="block-title"><div><h3>玻璃与可读性</h3><p>调节背景与工作区面板之间的层次。</p></div><button class="text-btn" data-action="reset-effects">恢复默认</button></div>
      <div class="sliders">
        ${slider("dim", "背景暗化", config.effects.dim, 0, .9, .05, `${Math.round(config.effects.dim * 100)}%`)}
        ${slider("blur", "玻璃模糊", config.effects.blur, 0, 40, 1, `${config.effects.blur}px`)}
        ${slider("panelOpacity", "面板不透明度", config.effects.panelOpacity, .35, 1, .05, `${Math.round(config.effects.panelOpacity * 100)}%`)}
        ${slider("borderAlpha", "边框强调", config.effects.borderAlpha, 0, .9, .05, `${Math.round(config.effects.borderAlpha * 100)}%`)}
        ${slider("radius", "圆角", config.effects.radius, 0, 32, 1, `${config.effects.radius}px`)}
      </div>
    </section>
    <section class="block extensions">
      <div class="block-title"><div><h3>外观扩展</h3><p>插件按能力接入，不与某个主题插件绑定。</p></div><span class="count">${snapshot.providers.length}</span></div>
      ${snapshot.providers.length ? snapshot.providers.map(providerCard).join("") : `<div class="soft-empty">尚未检测到外观扩展；原生主题功能仍可独立使用。</div>`}
    </section>
  </div>`;
}

function renderProviderControls(
  state: ViewState,
  registry: AppearanceProviderRegistry,
  activeProviderId: string | undefined,
): string {
  if (!activeProviderId) return "";
  const provider = state.snapshot!.providers.find((candidate) => candidate.id === activeProviderId);
  const adapter = registry.get(activeProviderId);
  const providerState = state.snapshot!.settings.providers[activeProviderId];
  const inventory = state.inventories.get(activeProviderId);
  if (!provider || !adapter?.inventory) {
    return `<div class="provider-panel"><strong>${escapeHtml(provider?.name ?? activeProviderId)}</strong><p>此扩展的详细设置由插件自己的设置页面提供。</p></div>`;
  }
  if (!inventory) return `<div class="provider-panel">正在读取 ${escapeHtml(provider.name)} 资源…</div>`;
  if (inventory.error) return `<div class="provider-panel error">无法读取资源：${escapeHtml(inventory.error)} <button data-action="refresh-provider" data-provider="${escapeAttr(activeProviderId)}">重试</button></div>`;
  const selected = typeof providerState?.settings.wallpaperId === "string" ? providerState.settings.wallpaperId : "";
  const playing = providerState?.settings.playing !== false;
  const wallpaperBlur = typeof providerState?.settings.wallpaperBlur === "number" ? providerState.settings.wallpaperBlur : 0;
  return `<div class="provider-panel">
    <div class="provider-line"><select data-provider-select="${escapeAttr(activeProviderId)}">
      <option value="">选择一个壁纸</option>
      ${inventory.options.map((option) => `<option value="${escapeAttr(option.id)}" ${option.id === selected ? "selected" : ""} ${option.playable ? "" : "disabled"}>${escapeHtml(option.playable ? option.title : `[不可播放] ${option.title}`)}</option>`).join("")}
    </select><button data-action="refresh-provider" data-provider="${escapeAttr(activeProviderId)}">刷新</button></div>
    <div class="provider-actions"><button data-action="toggle-provider-playback" data-provider="${escapeAttr(activeProviderId)}" ${selected ? "" : "disabled"}>${playing ? "暂停" : "播放"}</button><button data-action="close-provider" data-provider="${escapeAttr(activeProviderId)}">关闭</button></div>
    <label class="provider-slider"><span>壁纸模糊</span><input type="range" min="0" max="60" step="1" value="${wallpaperBlur}" data-provider-effect="wallpaperBlur" data-provider="${escapeAttr(activeProviderId)}"><output>${wallpaperBlur}px</output></label>
    <small>${inventory.total} 个资源 · ${inventory.available} 个可播放</small>
  </div>`;
}

function renderThemes(snapshot: AppearanceSnapshot): string {
  const active = snapshot.themes.find((theme) => theme.id === snapshot.settings.activeThemeId);
  const builtins = snapshot.themes.filter((theme) => theme.kind === "builtin");
  const personal = snapshot.themes.filter((theme) => theme.kind !== "builtin");
  return `<div class="page themes-page">
    <div class="toolbar"><div><h3>当前主题</h3><p>${escapeHtml(active?.name ?? "未选择")}</p></div><div><button data-action="create-theme" class="primary">新建主题</button><button data-action="import-theme">导入主题包</button></div></div>
    <div class="theme-grid current-grid">${active ? themeCard(active, true) : ""}</div>
    <div class="section-heading"><h3>内置主题</h3><span>${builtins.length}</span></div>
    <div class="theme-grid">${builtins.map((theme) => themeCard(theme, theme.id === active?.id)).join("")}</div>
    <div class="section-heading"><h3>我的主题</h3><span>${personal.length}</span></div>
    ${personal.length ? `<div class="theme-grid">${personal.map((theme) => themeCard(theme, theme.id === active?.id)).join("")}</div>` : `<div class="soft-empty">新建或导入 .dsh-theme 主题包后会显示在这里。</div>`}
  </div>`;
}

function renderEditor(state: ViewState): string {
  const themes = state.snapshot!.themes.filter((theme) => theme.kind !== "builtin");
  const theme = themes.find((candidate) => candidate.id === state.editorThemeId) ?? themes[0];
  if (!theme) return `<div class="empty"><h3>还没有可编辑的主题</h3><p>先新建一个主题，再配置颜色与图层资源。</p><button class="primary" data-action="create-theme">新建主题</button></div>`;
  state.editorThemeId = theme.id;
  const config = theme.config;
  return `<div class="page editor-page" data-editor-id="${escapeAttr(theme.id)}">
    <div class="editor-head"><div><label>主题名称<input data-editor="name" value="${escapeAttr(theme.name)}"></label><span>作者：${escapeHtml(theme.author)}</span></div><div><button data-action="export-theme" data-id="${escapeAttr(theme.id)}">导出</button><button class="primary" data-action="save-theme" data-id="${escapeAttr(theme.id)}">保存并应用</button></div></div>
    <div class="preview" style="--preview-surface:${escapeAttr(config.colors.surface ?? "#f5f6f8")};--preview-sidebar:${escapeAttr(config.colors.sidebar ?? "#eceef2")};--preview-accent:${escapeAttr(config.colors.accent ?? "#6f9fff")}">
      <div class="preview-sidebar"><i></i><i></i><i></i></div><div class="preview-main"><b>${escapeHtml(theme.name)}</b><div class="preview-composer"></div></div>
    </div>
    <section class="editor-section"><h3>颜色</h3><div class="color-grid">
      ${colorInput("accent", "强调色", config.colors.accent ?? "#6f9fff")}
      ${colorInput("surface", "主面板", config.colors.surface ?? "#f5f6f8")}
      ${colorInput("sidebar", "侧边栏", config.colors.sidebar ?? "#eceef2")}
      ${colorInput("text", "主要文字", config.colors.text ?? "#18181b")}
    </div></section>
    <section class="editor-section"><h3>图层资源</h3><p>背景、立绘与装饰相互独立；没有配置的槽位会自动跳过。</p><div class="asset-grid">
      ${assetSlot("background", "主背景", config.background.kind === "local-image" || Boolean(config.assets.background))}
      ${assetSlot("characterLeft", "左侧人物", Boolean(config.assets.characterLeft))}
      ${assetSlot("characterRight", "右侧人物", Boolean(config.assets.characterRight))}
      ${assetSlot("sidebarDecoration", "侧边栏装饰", Boolean(config.assets.sidebarDecoration))}
      ${assetSlot("composerDecoration", "输入框装饰", Boolean(config.assets.composerDecoration))}
      ${assetSlot("preview", "主题封面", Boolean(config.assets.preview))}
    </div></section>
    <div class="danger-row"><button data-action="duplicate-theme" data-id="${escapeAttr(theme.id)}">创建副本</button><button class="danger" data-action="delete-theme" data-id="${escapeAttr(theme.id)}">删除主题</button></div>
  </div>`;
}

function bindCommon(
  root: HTMLElement,
  state: ViewState,
  render: () => void,
  nativeActions: { openConfig(): void; close(): void },
): void {
  root.querySelectorAll<HTMLElement>("[data-page]").forEach((button) => button.addEventListener("click", () => {
    state.page = button.dataset.page as AppearancePage;
    state.notice = undefined;
    render();
  }));
  root.querySelector<HTMLElement>('[data-native-action="open-config"]')?.addEventListener("click", nativeActions.openConfig);
  root.querySelector<HTMLElement>('[data-native-action="close"]')?.addEventListener("click", nativeActions.close);
}

function bindSettings(
  root: HTMLElement,
  state: ViewState,
  api: AppearanceDesktopApi,
  operation: (work: () => Promise<AppearanceSnapshot | undefined>, success?: string) => Promise<void>,
  loadInventory: (providerId: string) => Promise<void>,
): void {
  if (state.page !== "settings") return;
  root.querySelectorAll<HTMLElement>("[data-source]").forEach((button) => button.addEventListener("click", () => {
    const source = button.dataset.source!;
    if (source === "local") {
      void operation(async () => (await api.selectAppearanceAsset("background"))?.snapshot, "背景图已更新");
    } else if (source === "none") {
      void operation(() => api.updateAppearance({ background: { kind: "none" } }));
    } else if (source.startsWith("provider:")) {
      const providerId = source.slice("provider:".length);
      const previous = state.snapshot!.settings.providers[providerId];
      void operation(() => api.updateAppearanceProvider(providerId, {
        enabled: true,
        settings: previous?.settings ?? {},
      }));
    }
  }));
  root.querySelectorAll<HTMLInputElement>("[data-effect]").forEach((input) => {
    input.addEventListener("input", () => {
      const output = input.parentElement?.querySelector("output");
      if (output) output.textContent = effectLabel(input.dataset.effect!, Number(input.value));
    });
    input.addEventListener("change", () => {
      void operation(() => api.updateAppearance({ effects: { [input.dataset.effect!]: Number(input.value) } }));
    });
  });
  root.querySelector<HTMLElement>('[data-action="reset-effects"]')?.addEventListener("click", () => {
    void operation(() => api.updateAppearance({ effects: { dim: .08, blur: 18, panelOpacity: .9, borderAlpha: .18, radius: 18 } }));
  });
  root.querySelectorAll<HTMLElement>('[data-action="refresh-provider"]').forEach((button) => button.addEventListener("click", () => void loadInventory(button.dataset.provider!)));
  root.querySelectorAll<HTMLSelectElement>("[data-provider-select]").forEach((select) => select.addEventListener("change", () => {
    const providerId = select.dataset.providerSelect!;
    const previous = state.snapshot!.settings.providers[providerId];
    void operation(() => api.updateAppearanceProvider(providerId, {
      enabled: Boolean(select.value),
      settings: { ...previous?.settings, wallpaperId: select.value, playing: true },
    }));
  }));
  root.querySelectorAll<HTMLElement>('[data-action="toggle-provider-playback"]').forEach((button) => button.addEventListener("click", () => {
    const providerId = button.dataset.provider!;
    const previous = state.snapshot!.settings.providers[providerId];
    void operation(() => api.updateAppearanceProvider(providerId, {
      enabled: true,
      settings: { ...previous?.settings, playing: previous?.settings.playing === false },
    }));
  }));
  root.querySelectorAll<HTMLElement>('[data-action="close-provider"]').forEach((button) => button.addEventListener("click", () => {
    const providerId = button.dataset.provider!;
    const previous = state.snapshot!.settings.providers[providerId];
    void operation(() => api.updateAppearanceProvider(providerId, {
      enabled: false,
      settings: previous?.settings ?? {},
    }));
  }));
  root.querySelectorAll<HTMLInputElement>("[data-provider-effect]").forEach((input) => {
    input.addEventListener("input", () => {
      const output = input.parentElement?.querySelector("output");
      if (output) output.textContent = `${input.value}px`;
    });
    input.addEventListener("change", () => {
      const providerId = input.dataset.provider!;
      const previous = state.snapshot!.settings.providers[providerId];
      void operation(() => api.updateAppearanceProvider(providerId, {
        enabled: true,
        settings: { ...previous?.settings, [input.dataset.providerEffect!]: Number(input.value) },
      }));
    });
  });
  root.querySelectorAll<HTMLElement>('[data-action="toggle-provider"]').forEach((button) => button.addEventListener("click", () => {
    const providerId = button.dataset.provider!;
    const previous = state.snapshot!.settings.providers[providerId];
    void operation(() => api.updateAppearanceProvider(providerId, {
      enabled: !previous?.enabled,
      settings: previous?.settings ?? {},
    }));
  }));
}

function bindThemes(
  root: HTMLElement,
  state: ViewState,
  api: AppearanceDesktopApi,
  operation: (work: () => Promise<AppearanceSnapshot | undefined>, success?: string) => Promise<void>,
  render: () => void,
): void {
  root.querySelectorAll<HTMLElement>('[data-action="apply-theme"]').forEach((button) => button.addEventListener("click", () => void operation(() => api.applyAppearanceTheme(button.dataset.id!), "主题已应用")));
  root.querySelectorAll<HTMLElement>('[data-action="edit-theme"]').forEach((button) => button.addEventListener("click", () => {
    state.editorThemeId = button.dataset.id;
    state.page = "editor";
    render();
  }));
  root.querySelectorAll<HTMLElement>('[data-action="create-theme"]').forEach((button) => button.addEventListener("click", () => {
    void operation(async () => {
      const snapshot = await api.createAppearanceTheme({ name: "我的新主题", author: "本机用户" });
      state.editorThemeId = snapshot.themes.filter((theme) => theme.kind !== "builtin").at(-1)?.id;
      state.page = "editor";
      return snapshot;
    });
  }));
  root.querySelector<HTMLElement>('[data-action="import-theme"]')?.addEventListener("click", () => void operation(() => api.importAppearanceTheme(), "主题包已导入"));
  root.querySelectorAll<HTMLElement>('[data-action="export-theme"]').forEach((button) => button.addEventListener("click", () => void operation(async () => {
    await api.exportAppearanceTheme(button.dataset.id!);
    return state.snapshot;
  }, "主题包已导出")));
  root.querySelectorAll<HTMLElement>('[data-action="duplicate-theme"]').forEach((button) => button.addEventListener("click", () => void operation(() => api.duplicateAppearanceTheme(button.dataset.id!), "已创建主题副本")));
  root.querySelectorAll<HTMLElement>('[data-action="delete-theme"]').forEach((button) => button.addEventListener("click", () => {
    if (confirm("删除这个主题？主题包文件和其他主题不会受影响。")) void operation(() => api.deleteAppearanceTheme(button.dataset.id!), "主题已删除");
  }));
}

function bindEditor(
  root: HTMLElement,
  state: ViewState,
  api: AppearanceDesktopApi,
  operation: (work: () => Promise<AppearanceSnapshot | undefined>, success?: string) => Promise<void>,
  render: () => void,
): void {
  if (state.page !== "editor") return;
  root.querySelectorAll<HTMLElement>("[data-asset-slot]").forEach((button) => button.addEventListener("click", () => {
    const slot = button.dataset.assetSlot as AppearanceAssetSlot;
    const themeId = root.querySelector<HTMLElement>("[data-editor-id]")?.dataset.editorId;
    if (!themeId) return;
    void operation(async () => {
      const selected = await api.selectAppearanceAsset(slot);
      if (!selected) return undefined;
      const config = slot === "background"
        ? { background: { kind: "local-image" as const, assetId: selected.asset.id }, assets: { background: selected.asset.id } }
        : { assets: { [slot]: selected.asset.id } };
      return api.updateAppearanceTheme(themeId, { config });
    }, "图层资源已更新");
  }));
  root.querySelector<HTMLElement>('[data-action="save-theme"]')?.addEventListener("click", () => {
    const themeId = root.querySelector<HTMLElement>("[data-editor-id]")?.dataset.editorId;
    const name = root.querySelector<HTMLInputElement>('[data-editor="name"]')?.value;
    if (!themeId || !name) return;
    const colors = Object.fromEntries(Array.from(root.querySelectorAll<HTMLInputElement>("[data-color]")).map((input) => [input.dataset.color!, input.value]));
    void operation(async () => {
      await api.updateAppearanceTheme(themeId, { name, config: { colors } });
      return api.applyAppearanceTheme(themeId);
    }, "主题已保存并应用");
  });
  bindThemes(root, state, api, operation, render);
}

function themeCard(theme: AppearanceTheme, active: boolean): string {
  return `<article class="theme-card ${active ? "active" : ""}" style="--card-bg:${escapeAttr(theme.config.colors.surface ?? "#f4f5f7")};--card-side:${escapeAttr(theme.config.colors.sidebar ?? "#e8eaee")};--card-accent:${escapeAttr(theme.config.colors.accent ?? "#7aa2ff")}">
    <div class="theme-preview"><span></span><i></i></div>
    <div class="theme-info"><strong>${escapeHtml(theme.name)}</strong><small>${escapeHtml(theme.author)} · ${escapeHtml(theme.version)}</small><em>${theme.kind === "builtin" ? "内置" : theme.kind === "imported" ? "已导入" : "自定义"}</em></div>
    <div class="theme-actions">${active ? `<span class="active-mark">使用中</span>` : `<button data-action="apply-theme" data-id="${escapeAttr(theme.id)}">应用</button>`}${theme.kind !== "builtin" ? `<button data-action="edit-theme" data-id="${escapeAttr(theme.id)}">编辑</button><button data-action="export-theme" data-id="${escapeAttr(theme.id)}">导出</button>` : ""}</div>
  </article>`;
}

function providerCard(provider: AppearanceSnapshot["providers"][number]): string {
  return `<article class="extension-card"><div class="extension-icon">${provider.kind === "background" ? "▧" : provider.kind === "theme" ? "◈" : "✦"}</div><div><strong>${escapeHtml(provider.name)}</strong><p>${escapeHtml(provider.description ?? "外观扩展")}</p><small>${provider.source === "plugin" ? "插件" : "原生"} · ${provider.kind}</small></div><button data-action="toggle-provider" data-provider="${escapeAttr(provider.id)}" ${provider.available ? "" : "disabled"}>管理</button></article>`;
}

function tabButton(page: AppearancePage, label: string, current: AppearancePage): string {
  return `<button data-page="${page}" aria-selected="${page === current}">${label}</button>`;
}

function sourceCard(id: string, title: string, description: string, active: boolean, disabled = false): string {
  return `<button class="source-card ${active ? "active" : ""}" data-source="${escapeAttr(id)}" ${disabled ? "disabled" : ""}><span class="source-icon">${id === "none" ? "○" : id === "local" ? "▧" : "◉"}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small>${active ? "<em>当前来源</em>" : ""}</button>`;
}

function slider(id: string, label: string, value: number, min: number, max: number, step: number, output: string): string {
  return `<label class="slider"><span>${label}</span><input type="range" data-effect="${id}" value="${value}" min="${min}" max="${max}" step="${step}"><output>${output}</output></label>`;
}

function effectLabel(id: string, value: number): string {
  return ["dim", "panelOpacity", "borderAlpha"].includes(id) ? `${Math.round(value * 100)}%` : `${value}px`;
}

function colorInput(id: string, label: string, value: string): string {
  return `<label class="color"><span>${label}</span><input type="color" data-color="${id}" value="${escapeAttr(value)}"><code>${escapeHtml(value)}</code></label>`;
}

function assetSlot(slot: AppearanceAssetSlot, label: string, selected: boolean): string {
  return `<button class="asset-slot ${selected ? "selected" : ""}" data-asset-slot="${slot}"><span>${selected ? "✓" : "+"}</span><strong>${label}</strong><small>${selected ? "点击替换" : "选择图片"}</small></button>`;
}

function uniqueProviders(providers: AppearanceSnapshot["providers"]): AppearanceSnapshot["providers"] {
  return [...new Map(providers.map((provider) => [provider.id, provider])).values()];
}

function exactText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function findButton(root: Element, labels: string[]): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button,[role=button]"))
    .find((button) => labels.includes(exactText(button)));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function escapeAttr(value: string): string { return escapeHtml(value); }

function withoutActiveClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter((token) => token && token !== "active" && !token.endsWith("_active"))
    .join(" ");
}

function appearanceStyles(): string {
  return `
    :host { display:block; height:100%; min-height:0; color:var(--dsw-alias-label-primary,#18181b); font:14px/1.45 "Segoe UI Variable","Segoe UI","Microsoft YaHei UI",sans-serif; }
    :host([hidden]) { display:none !important; } *,*::before,*::after { box-sizing:border-box; } button,input,select { font:inherit; color:inherit; }
    .panel-root { height:100%; min-height:0; overflow:hidden; } .shell { height:100%; min-height:0; overflow-x:hidden; overflow-y:auto; scrollbar-gutter:stable; padding:0 24px 40px 0; } header { display:flex; justify-content:space-between; align-items:flex-start; } .header-actions { display:flex; align-items:center; gap:10px; } .header-actions .icon-btn { min-width:34px; padding:0; border:0; font-size:20px; background:transparent; }
    h2,h3,p { margin:0; } h2 { font-size:22px; } header p,.block-title p,.toolbar p,.editor-section>p { margin-top:6px; color:var(--dsw-alias-label-secondary,#8a8a93); }
    .tabs { display:flex; gap:28px; height:49px; margin-top:12px; border-bottom:1px solid #e5e5e8; } .tabs button { position:relative; border:0; background:transparent; color:#777780; cursor:pointer; }
    .tabs button[aria-selected=true] { color:#18181b; font-weight:600; } .tabs button[aria-selected=true]::after { content:""; position:absolute; left:0; right:0; bottom:-1px; height:2px; background:#18181b; }
    .page { padding-top:18px; } .block { padding:18px 0; border-bottom:1px solid #ececef; } .block.first-block { padding-top:0; } .block-title,.toolbar,.editor-head,.provider-line,.section-heading,.danger-row { display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .block-title h3,.section-heading h3,.editor-section h3 { font-size:15px; } button { border:1px solid #dddfe4; border-radius:9px; background:#fff; min-height:34px; padding:0 12px; cursor:pointer; } button:hover { background:#f5f6f7; } button:disabled { opacity:.45; cursor:not-allowed; }
    button.primary { color:white; border-color:#18181b; background:#18181b; } .text-btn { border:0; color:#6d6d76; background:transparent; }
    .source-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:15px; } .source-card { position:relative; min-height:112px; display:grid; grid-template-columns:36px 1fr; grid-template-rows:auto auto; gap:2px 9px; padding:15px; text-align:left; }
    .source-card.active { border-color:#7aa2ff; box-shadow:0 0 0 3px rgba(90,139,239,.1); } .source-icon { grid-row:1/3; display:grid; place-items:center; width:36px; height:36px; border-radius:10px; background:#f0f2f6; font-size:20px; } .source-card small { color:#85858e; } .source-card em { position:absolute; right:10px; top:9px; color:#3978e8; font-size:10px; font-style:normal; }
    .provider-panel { margin-top:10px; padding:13px; border:1px solid #e3e4e7; border-radius:10px; background:#fafafb; } .provider-panel select { flex:1; height:36px; border:1px solid #dfe0e4; border-radius:8px; background:white; padding:0 10px; } .provider-panel small { display:block; margin-top:7px; color:#8a8a93; } .provider-panel.error { color:#b42318; } .provider-actions { display:flex; gap:7px; margin-top:9px; } .provider-slider { display:grid; grid-template-columns:86px 1fr 44px; align-items:center; gap:8px; margin-top:10px; } .provider-slider input { width:100%; accent-color:#6b9df6; } .provider-slider output { color:#7a7a84; text-align:right; font-size:12px; }
    .sliders { display:grid; grid-template-columns:1fr 1fr; column-gap:28px; row-gap:14px; margin-top:16px; } .slider { display:grid; grid-template-columns:112px 1fr 48px; align-items:center; gap:9px; } .slider input { width:100%; accent-color:#6b9df6; } .slider output { color:#707079; text-align:right; font-size:12px; }
    .extension-card { display:grid; grid-template-columns:42px 1fr auto; gap:12px; align-items:center; margin-top:10px; padding:12px; border:1px solid #e4e5e8; border-radius:11px; } .extension-icon { display:grid; place-items:center; width:42px; height:42px; border-radius:12px; background:#eef3ff; color:#527fd4; font-size:20px; } .extension-card p { color:#767680; } .extension-card small { color:#a0a0a8; }
    .toolbar { padding:4px 0 18px; } .toolbar button+button { margin-left:8px; } .theme-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; } .current-grid { grid-template-columns:1fr; margin-bottom:22px; } .section-heading { margin:18px 0 10px; } .section-heading span,.count { color:#92929a; }
    .theme-card { display:grid; grid-template-columns:96px 1fr auto; gap:12px; align-items:center; min-height:112px; padding:11px; border:1px solid #e2e3e6; border-radius:12px; } .theme-card.active { border-color:#8fb2ff; } .theme-preview { display:grid; grid-template-columns:26px 1fr; width:96px; height:72px; overflow:hidden; border-radius:9px; background:var(--card-bg); box-shadow:inset 0 0 0 1px rgba(0,0,0,.06); } .theme-preview span { background:var(--card-side); } .theme-preview i { width:48px; height:15px; place-self:center; border-radius:6px; background:var(--card-accent); opacity:.6; }
    .theme-info { min-width:0; } .theme-info strong,.theme-info small,.theme-info em { display:block; } .theme-info small { margin-top:4px; overflow:hidden; color:#85858e; text-overflow:ellipsis; white-space:nowrap; } .theme-info em { width:max-content; margin-top:7px; padding:2px 6px; border-radius:5px; color:#666670; background:#f0f1f3; font-size:10px; font-style:normal; } .theme-actions { display:flex; flex-direction:column; gap:5px; } .theme-actions button { min-height:27px; padding:0 8px; font-size:11px; } .active-mark { color:#17a35a; font-size:12px; }
    .editor-head label { display:grid; gap:5px; color:#777780; font-size:12px; } .editor-head input { width:280px; height:38px; padding:0 10px; border:1px solid #dedfe3; border-radius:9px; font-size:15px; } .editor-head span { display:block; margin-top:4px; color:#9898a1; font-size:11px; } .editor-head button+button { margin-left:7px; }
    .preview { display:grid; grid-template-columns:24% 1fr; height:210px; margin-top:16px; overflow:hidden; border:1px solid #e2e3e7; border-radius:15px; background:var(--preview-surface); box-shadow:0 14px 35px rgba(60,70,90,.1); } .preview-sidebar { display:flex; flex-direction:column; gap:12px; padding:24px 14px; background:var(--preview-sidebar); } .preview-sidebar i { height:10px; border-radius:5px; background:rgba(100,105,115,.16); } .preview-main { display:grid; place-items:center; color:#444; } .preview-composer { width:58%; height:54px; border:1px solid rgba(100,100,110,.15); border-radius:14px; background:color-mix(in srgb,var(--preview-accent) 16%,white); }
    .editor-section { padding:18px 0; border-bottom:1px solid #ececef; } .color-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:12px; } .color { display:grid; grid-template-columns:30px 1fr; grid-template-rows:auto auto; gap:2px 8px; padding:10px; border:1px solid #e2e3e6; border-radius:10px; } .color input { grid-row:1/3; width:30px; height:30px; padding:0; border:0; background:transparent; } .color code { color:#909099; font-size:10px; }
    .asset-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:9px; margin-top:13px; } .asset-slot { min-height:78px; display:grid; grid-template-columns:32px 1fr; grid-template-rows:auto auto; gap:0 8px; text-align:left; } .asset-slot>span { grid-row:1/3; place-self:center; display:grid; place-items:center; width:30px; height:30px; border-radius:9px; background:#f0f2f6; } .asset-slot small { color:#8d8d96; } .asset-slot.selected { border-color:#98b7ef; } .danger-row { padding-top:18px; justify-content:flex-end; } .danger { color:#c43232; }
    .notice { margin-top:12px; padding:9px 11px; border-radius:9px; font-size:12px; } .notice.success { color:#137a44; background:#eefaf3; } .notice.error { color:#b42318; background:#fff1f0; } .empty,.soft-empty { padding:42px 18px; color:#8b8b94; text-align:center; } .soft-empty { border:1px dashed #dedfe3; border-radius:12px; }
    @media (max-width:1050px) { .source-grid,.asset-grid { grid-template-columns:1fr 1fr; } .theme-grid { grid-template-columns:1fr; } .sliders { grid-template-columns:1fr; } }
    :host-context(body[data-ds-dark-theme]) { color:var(--dsw-alias-label-primary,#f4f4f5); } :host-context(body[data-ds-dark-theme]) .tabs { border-color:#3b3b40; } :host-context(body[data-ds-dark-theme]) .tabs button[aria-selected=true] { color:#fff; } :host-context(body[data-ds-dark-theme]) .tabs button[aria-selected=true]::after { background:#fff; } :host-context(body[data-ds-dark-theme]) button { color:inherit; border-color:#424248; background:#29292e; } :host-context(body[data-ds-dark-theme]) button:hover { background:#34343a; } :host-context(body[data-ds-dark-theme]) .block,:host-context(body[data-ds-dark-theme]) .editor-section { border-color:#36363b; } :host-context(body[data-ds-dark-theme]) .source-icon,:host-context(body[data-ds-dark-theme]) .asset-slot>span { background:#313239; } :host-context(body[data-ds-dark-theme]) .provider-panel { border-color:#3d3d43; background:#25252a; } :host-context(body[data-ds-dark-theme]) .provider-panel select { color:inherit; border-color:#46464d; background:#29292e; } :host-context(body[data-ds-dark-theme]) .extension-card,:host-context(body[data-ds-dark-theme]) .theme-card,:host-context(body[data-ds-dark-theme]) .color,:host-context(body[data-ds-dark-theme]) .preview { border-color:#3d3d43; } :host-context(body[data-ds-dark-theme]) .soft-empty { border-color:#45454b; }
  `;
}
