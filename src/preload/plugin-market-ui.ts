import type {
  PluginMarketEntry,
  PluginMarketOperationResult,
  PluginMarketSearchResult,
  PluginMarketSnapshot,
} from "../plugin-market-types";
import {
  displayPluginName,
  filterPluginMarketEntries,
  formatPluginStars,
  PLUGIN_MARKET_CATEGORIES,
  type PluginMarketCategoryId,
  type PluginMarketSort,
} from "./plugin-market-presentation";

export interface PluginMarketDesktopApi {
  getPluginMarket(forceRefresh?: boolean): Promise<PluginMarketSnapshot>;
  searchPlugins(query: string): Promise<PluginMarketSearchResult>;
  installPlugin(pluginId: string): Promise<PluginMarketOperationResult>;
  removePlugin(pluginId: string): Promise<PluginMarketOperationResult>;
  restartHarnessForPlugins(): Promise<boolean>;
  openPluginSource(url: string): Promise<boolean>;
  openLogs(): Promise<string>;
}

interface SettingsPluginSection {
  container: HTMLElement;
  tablist: HTMLElement;
}

interface ViewState {
  snapshot?: PluginMarketSnapshot;
  query: string;
  category: PluginMarketCategoryId;
  sort: PluginMarketSort;
  loading: boolean;
  onlinePlugins: PluginMarketEntry[];
  onlineLoading: boolean;
  onlineWarnings: string[];
  busyPluginId?: string;
  confirming?: { plugin: PluginMarketEntry; operation: "install" | "remove" };
  notice?: { tone: "success" | "error" | "info"; message: string; restartSupported?: boolean };
}

const MARKET_TAB_ATTRIBUTE = "data-dsh-desktop-market-tab";
const MARKET_PANEL_ATTRIBUTE = "data-dsh-desktop-market-panel";

function exactText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function findPluginSection(): SettingsPluginSection | undefined {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3"));
  for (const heading of headings) {
    if (!["插件", "Plugins"].includes(exactText(heading))) {
      continue;
    }
    let container = heading.parentElement;
    while (container && container !== document.body) {
      const tablist = container.querySelector<HTMLElement>('[role="tablist"]');
      if (tablist) {
        return { container, tablist };
      }
      container = container.parentElement;
    }
  }
  return undefined;
}

function button(label: string, className: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  return element;
}

function githubAvatar(owner: string): string {
  return `https://github.com/identicons/${encodeURIComponent(owner)}.png`;
}

function categoryLabel(plugin: PluginMarketEntry): string {
  return {
    ui: "界面增强",
    vision: "视觉",
    dev: "开发工具",
    tools: "工具",
    workflow: "工作流",
    skill: "技能",
    memory: "记忆",
    model: "模型",
    notify: "通知",
    session: "会话",
    theme: "主题",
  }[plugin.category] ?? "社区插件";
}

function marketplaceStyles(): string {
  return `
    :host {
      display: block;
      color: #18181b;
      font: 14px/1.45 "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif;
    }
    :host([hidden]) { display: none !important; }
    * { box-sizing: border-box; }
    button, input, select { font: inherit; }
    button { color: inherit; }
    .root { padding-top: 16px; }
    .search {
      width: 100%;
      height: 44px;
      padding: 0 14px;
      border: 1px solid #dedfe3;
      border-radius: 10px;
      outline: none;
      color: #18181b;
      background: #fff;
    }
    .search:focus { border-color: #8fb2ff; box-shadow: 0 0 0 3px rgba(91, 141, 239, 0.12); }
    .search::placeholder { color: #a1a1aa; }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 12px;
      min-width: 0;
    }
    .categories { display: flex; align-items: center; gap: 4px; min-width: 0; flex-wrap: wrap; }
    .category {
      min-height: 30px;
      padding: 0 11px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #52525b;
      cursor: pointer;
    }
    .category:hover { background: #f5f5f6; }
    .category[data-active="true"] { color: #18181b; background: #f0f1f3; font-weight: 600; }
    .sort {
      margin-left: auto;
      height: 32px;
      padding: 0 28px 0 10px;
      border: 1px solid #e1e2e5;
      border-radius: 8px;
      color: #52525b;
      background: #fff;
    }
    .meta {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 28px;
      margin-top: 8px;
      color: #8a8a93;
      font-size: 12px;
    }
    .meta button { margin-left: auto; border: 0; background: transparent; color: #686872; cursor: pointer; }
    .notice {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 38px;
      margin: 2px 0 9px;
      padding: 8px 10px;
      border: 1px solid #e1e7f5;
      border-radius: 9px;
      color: #40516f;
      background: #f7f9fd;
      font-size: 12px;
    }
    .notice[data-tone="success"] { border-color: #d9eee1; color: #287347; background: #f5fbf7; }
    .notice[data-tone="error"] { border-color: #f3d6d6; color: #b42323; background: #fff7f7; }
    .notice button { margin-left: auto; border: 0; background: transparent; color: inherit; font-weight: 600; cursor: pointer; }
    .list {
      display: grid;
      gap: 9px;
      max-height: min(470px, calc(100vh - 470px));
      min-height: 220px;
      padding: 1px 4px 2px 0;
      overflow-y: auto;
      scrollbar-width: thin;
    }
    .card {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      min-height: 104px;
      padding: 12px 14px;
      border: 1px solid #e1e2e5;
      border-radius: 11px;
      background: #fff;
    }
    .card:hover { border-color: #d3d5da; background: #fefefe; }
    .avatar {
      width: 44px;
      height: 44px;
      overflow: hidden;
      border: 1px solid #e3e4e7;
      border-radius: 10px;
      background: #f5f5f6;
    }
    .avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .content { min-width: 0; }
    .titleRow { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .title {
      padding: 0;
      overflow: hidden;
      border: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
      background: transparent;
      color: #18181b;
      font-weight: 650;
      cursor: pointer;
    }
    .author { overflow: hidden; color: #7b7b84; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .description { margin: 4px 0 7px; overflow: hidden; color: #666671; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .badges { display: flex; align-items: center; gap: 5px; }
    .badge { display: inline-flex; padding: 2px 7px; border-radius: 6px; color: #71717a; background: #f1f1f3; font-size: 10px; }
    .badge[data-review="curated"] { color: #287347; background: #edf8f1; }
    .badge[data-review="community"] { color: #9a6815; background: #fff6e5; }
    .actions { display: flex; align-items: center; gap: 8px; }
    .install, .remove {
      min-width: 62px;
      height: 31px;
      padding: 0 11px;
      border-radius: 8px;
      cursor: pointer;
    }
    .install { border: 1px solid #8db3ff; color: #2f75e8; background: #fff; }
    .install:hover { background: #f4f8ff; }
    .remove { border: 0; color: #777780; background: #f2f2f4; }
    .remove:hover { color: #b42323; background: #fff0f0; }
    .install:disabled, .remove:disabled { cursor: default; opacity: .55; }
    .installed { color: #219653; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .empty, .loading {
      display: grid;
      place-items: center;
      min-height: 220px;
      border: 1px dashed #dedfe3;
      border-radius: 11px;
      color: #8b8b94;
      background: #fbfbfc;
    }
    .onlineProgress { padding: 8px 4px; color: #777780; font-size: 11px; text-align: center; }
    .footer { margin-top: 12px; color: #9999a1; font-size: 11px; }
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(24, 24, 27, .28);
      backdrop-filter: blur(2px);
    }
    .dialog {
      width: min(440px, calc(100vw - 48px));
      padding: 20px;
      border: 1px solid rgba(24, 24, 27, .12);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 18px 56px rgba(24, 24, 27, .2);
    }
    .dialog h3 { margin: 0; font-size: 17px; }
    .dialog p { margin: 9px 0 0; color: #666671; font-size: 13px; }
    .command { margin-top: 14px; padding: 10px; overflow-wrap: anywhere; border-radius: 8px; color: #52525b; background: #f5f5f6; font: 11px/1.5 Consolas, monospace; }
    .warning { color: #9a6815 !important; }
    .dialogActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .dialogActions button { height: 34px; padding: 0 14px; border-radius: 8px; cursor: pointer; }
    .cancel { border: 0; background: #f1f1f3; }
    .confirm { border: 0; color: #fff; background: #18181b; }
    @media (max-width: 900px) {
      .card { grid-template-columns: 40px minmax(0, 1fr); }
      .actions { grid-column: 2; justify-content: flex-end; }
      .avatar { width: 40px; height: 40px; }
      .sort { margin-left: 0; }
    }
    @media (prefers-color-scheme: dark) {
      :host { color: #f4f4f5; }
      .search, .sort, .card, .dialog { border-color: #414147; color: #f4f4f5; background: #242427; }
      .search::placeholder, .meta, .author, .description, .footer { color: #a1a1aa; }
      .category { color: #c0c0c5; }
      .category:hover, .category[data-active="true"] { color: #fff; background: #3a3a3f; }
      .avatar { border-color: #45454b; background: #333338; }
      .title { color: #f4f4f5; }
      .badge, .remove, .command { color: #c0c0c5; background: #39393e; }
      .badge[data-review="curated"] { color: #8bd6aa; background: #263b30; }
      .badge[data-review="community"] { color: #e7bb67; background: #45371f; }
      .install { color: #8db3ff; background: transparent; }
      .empty, .loading { border-color: #45454b; color: #a1a1aa; background: #242427; }
      .dialog p { color: #c0c0c5; }
      .cancel { color: #f4f4f5; background: #3f3f46; }
      .confirm { color: #18181b; background: #f4f4f5; }
    }
  `;
}

function createMarketplacePanel(api: PluginMarketDesktopApi): HTMLElement {
  const host = createElement("div");
  host.setAttribute(MARKET_PANEL_ATTRIBUTE, "true");
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "open" });
  const style = createElement("style");
  style.textContent = marketplaceStyles();
  shadow.append(style);
  const root = createElement("div", "root");
  shadow.append(root);

  const state: ViewState = {
    query: "",
    category: "featured",
    sort: "popular",
    loading: false,
    onlinePlugins: [],
    onlineLoading: false,
    onlineWarnings: [],
  };
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchSequence = 0;

  const render = (): void => {
    root.replaceChildren();
    const search = createElement("input", "search");
    search.type = "search";
    search.placeholder = "搜索插件、npm 包名或 GitHub 地址";
    search.value = state.query;
    search.setAttribute("aria-label", "搜索插件、npm 包名或 GitHub 地址");
    search.addEventListener("input", () => {
      state.query = search.value;
      scheduleOnlineSearch();
      renderList();
    });
    root.append(search);

    const toolbar = createElement("div", "toolbar");
    const categories = createElement("div", "categories");
    for (const category of PLUGIN_MARKET_CATEGORIES) {
      const item = button(category.label, "category");
      item.dataset.active = String(state.category === category.id);
      item.addEventListener("click", () => {
        state.category = category.id;
        render();
      });
      categories.append(item);
    }
    toolbar.append(categories);
    const sort = createElement("select", "sort");
    sort.setAttribute("aria-label", "插件排序");
    const popular = createElement("option");
    popular.value = "popular";
    popular.textContent = "热门优先";
    const newest = createElement("option");
    newest.value = "newest";
    newest.textContent = "最新发布";
    sort.append(popular, newest);
    sort.value = state.sort;
    sort.addEventListener("change", () => {
      state.sort = sort.value === "newest" ? "newest" : "popular";
      renderList();
    });
    toolbar.append(sort);
    root.append(toolbar);

    const meta = createElement("div", "meta");
    const metaText = createElement("span");
    const sourceNote = state.snapshot?.source === "fallback" ? " · 离线精选" : "";
    metaText.textContent = `社区精选 + npm / GitHub 在线发现${sourceNote}`;
    meta.append(metaText);
    const refresh = button("刷新目录", "");
    refresh.disabled = state.loading;
    refresh.addEventListener("click", () => void load(true));
    meta.append(refresh);
    root.append(meta);

    if (state.notice) {
      const notice = createElement("div", "notice");
      notice.dataset.tone = state.notice.tone;
      notice.setAttribute("role", state.notice.tone === "error" ? "alert" : "status");
      const message = createElement("span");
      message.textContent = state.notice.message;
      notice.append(message);
      if (state.notice.restartSupported) {
        const restart = button("立即重启", "");
        restart.addEventListener("click", async () => {
          restart.disabled = true;
          restart.textContent = "正在重启…";
          const restarted = await api.restartHarnessForPlugins();
          if (!restarted) {
            state.notice = { tone: "error", message: "无法自动重启，请手动重新启动 Harness" };
            render();
          }
        });
        notice.append(restart);
      } else if (state.notice.tone === "error") {
        const logs = button("打开日志", "");
        logs.addEventListener("click", () => void api.openLogs());
        notice.append(logs);
      }
      root.append(notice);
    }

    const list = createElement("div", "list");
    list.dataset.marketList = "true";
    root.append(list);
    renderList();

    const footer = createElement("div", "footer");
    footer.textContent = "已审核条目优先 · 在线发现结果安装前请确认来源与权限";
    root.append(footer);

    if (state.confirming) {
      root.append(createConfirmation(state.confirming.plugin, state.confirming.operation));
    }
  };

  const renderList = (): void => {
    const list = root.querySelector<HTMLElement>('[data-market-list="true"]');
    if (!list) {
      return;
    }
    list.replaceChildren();
    if (state.loading && !state.snapshot) {
      const loading = createElement("div", "loading");
      loading.textContent = "正在载入社区插件…";
      list.append(loading);
      return;
    }
    if (!state.snapshot) {
      const empty = createElement("div", "empty");
      empty.textContent = "插件目录暂时不可用";
      list.append(empty);
      return;
    }
    const combined = state.query.trim()
      ? [...state.snapshot.plugins, ...state.onlinePlugins]
      : state.snapshot.plugins;
    const plugins = filterPluginMarketEntries(
      combined,
      state.query,
      state.category,
      state.sort,
    );
    if (plugins.length === 0) {
      const empty = createElement("div", "empty");
      empty.textContent = state.query
        ? state.onlineLoading
          ? "正在搜索精选目录、npm 与 GitHub…"
          : state.onlineWarnings.length > 0
            ? `没有找到兼容插件 · ${state.onlineWarnings.join(" · ")}`
            : "没有找到兼容的 DSH 插件"
        : "这个分类暂时没有插件";
      list.append(empty);
      return;
    }
    for (const plugin of plugins) {
      list.append(createPluginCard(plugin));
    }
    if (state.onlineLoading) {
      const progress = createElement("div", "onlineProgress");
      progress.textContent = "正在继续搜索 npm 与 GitHub…";
      list.append(progress);
    } else if (state.onlineWarnings.length > 0) {
      const warning = createElement("div", "onlineProgress");
      warning.textContent = state.onlineWarnings.join(" · ");
      list.append(warning);
    }
  };

  const createPluginCard = (plugin: PluginMarketEntry): HTMLElement => {
    const displayName = displayPluginName(plugin);
    const card = createElement("article", "card");
    const avatar = createElement("div", "avatar");
    const image = createElement("img");
    image.src = githubAvatar(plugin.owner);
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      avatar.remove();
      card.style.gridTemplateColumns = "minmax(0, 1fr) auto";
    });
    avatar.append(image);
    card.append(avatar);

    const content = createElement("div", "content");
    const titleRow = createElement("div", "titleRow");
    const title = button(displayName, "title");
    title.title = `打开 ${displayName} 源码`;
    title.addEventListener("click", () => void api.openPluginSource(plugin.url));
    const author = createElement("span", "author");
    author.textContent = [
      plugin.owner,
      plugin.version ? `v${plugin.version}` : undefined,
      plugin.stars > 0 ? `★ ${formatPluginStars(plugin.stars)}` : undefined,
    ].filter(Boolean).join(" · ");
    titleRow.append(title, author);
    const description = createElement("div", "description");
    description.textContent = plugin.description;
    description.title = plugin.description;
    const badges = createElement("div", "badges");
    const category = createElement("span", "badge");
    category.textContent = categoryLabel(plugin);
    const review = createElement("span", "badge");
    review.dataset.review = plugin.reviewStatus;
    review.textContent = plugin.reviewStatus === "curated"
      ? "已审核"
      : `${plugin.source === "npm" ? "npm" : "GitHub"} · 未审核`;
    review.title = plugin.reviewStatus === "curated"
      ? "来自社区精选目录"
      : "已验证 DSH 插件声明，但尚未经过市场人工审核";
    badges.append(category, review);
    content.append(titleRow, description, badges);
    card.append(content);

    const actions = createElement("div", "actions");
    const busy = state.busyPluginId === plugin.id;
    if (plugin.installed) {
      const installed = createElement("span", "installed");
      installed.textContent = "已安装";
      const remove = button(busy ? "卸载中…" : "卸载", "remove");
      remove.disabled = Boolean(state.busyPluginId);
      remove.addEventListener("click", () => {
        state.confirming = { plugin, operation: "remove" };
        render();
      });
      actions.append(installed, remove);
    } else {
      const install = button(busy ? "安装中…" : "安装", "install");
      install.disabled = Boolean(state.busyPluginId);
      install.addEventListener("click", () => {
        state.confirming = { plugin, operation: "install" };
        render();
      });
      actions.append(install);
    }
    card.append(actions);
    return card;
  };

  const createConfirmation = (
    plugin: PluginMarketEntry,
    operation: "install" | "remove",
  ): HTMLElement => {
    const overlay = createElement("div", "overlay");
    overlay.setAttribute("role", "presentation");
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        state.confirming = undefined;
        render();
      }
    });
    const dialog = createElement("section", "dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = createElement("h3");
    const displayName = displayPluginName(plugin);
    heading.textContent = operation === "install" ? `安装 ${displayName}？` : `卸载 ${displayName}？`;
    const description = createElement("p");
    description.textContent = plugin.description;
    const command = createElement("div", "command");
    command.textContent = operation === "install"
      ? plugin.installCommand
      : `移除 ${plugin.dependencyName ?? plugin.name}`;
    const warning = createElement("p", "warning");
    warning.textContent = operation === "install"
      ? plugin.reviewStatus === "curated"
        ? "该插件来自精选目录，仍将以当前用户权限运行。请确认你信任此来源。"
        : `该插件由${plugin.source === "npm" ? " npm" : " GitHub"} 在线发现，已验证 DSH 声明但未经市场人工审核。${plugin.installScripts?.length ? ` 声明了生命周期脚本：${plugin.installScripts.join("、")}。` : ""}`
      : "插件配置将保留在 Harness 数据目录中，重新安装后可继续使用。";
    const actions = createElement("div", "dialogActions");
    const cancel = button("取消", "cancel");
    cancel.addEventListener("click", () => {
      state.confirming = undefined;
      render();
    });
    const confirm = button(operation === "install" ? "确认安装" : "确认卸载", "confirm");
    confirm.addEventListener("click", () => void performOperation(plugin, operation));
    actions.append(cancel, confirm);
    dialog.append(heading, description, command, warning, actions);
    overlay.append(dialog);
    return overlay;
  };

  const performOperation = async (
    plugin: PluginMarketEntry,
    operation: "install" | "remove",
  ): Promise<void> => {
    state.confirming = undefined;
    state.busyPluginId = plugin.id;
    state.notice = {
      tone: "info",
      message: operation === "install"
        ? `正在安装 ${displayPluginName(plugin)}…`
        : `正在卸载 ${displayPluginName(plugin)}…`,
    };
    render();
    try {
      const result = operation === "install"
        ? await api.installPlugin(plugin.id)
        : await api.removePlugin(plugin.id);
      state.snapshot = result.snapshot;
      if (result.plugin) {
        state.onlinePlugins = state.onlinePlugins.map((entry) =>
          entry.id === result.plugin?.id ? result.plugin : entry);
      }
      state.notice = {
        tone: "success",
        message: result.message,
        restartSupported: result.restartSupported,
      };
    } catch (error) {
      state.notice = {
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      state.busyPluginId = undefined;
      render();
    }
  };

  const load = async (forceRefresh = false): Promise<void> => {
    if (state.loading) {
      return;
    }
    state.loading = true;
    if (forceRefresh) {
      state.notice = { tone: "info", message: "正在刷新社区插件目录…" };
    }
    render();
    try {
      state.snapshot = await api.getPluginMarket(forceRefresh);
      state.notice = state.snapshot.restartRequired
        ? {
            tone: "success",
            message: "插件变更已经完成，重启 Harness 后生效",
            restartSupported: state.snapshot.restartSupported,
          }
        : undefined;
      if (state.query.trim()) {
        scheduleOnlineSearch();
      }
    } catch (error) {
      state.notice = {
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      state.loading = false;
      render();
    }
  };

  const searchOnline = async (query: string, sequence: number): Promise<void> => {
    state.onlineLoading = true;
    state.onlineWarnings = [];
    renderList();
    try {
      const result = await api.searchPlugins(query);
      if (sequence !== searchSequence || query !== state.query.trim()) {
        return;
      }
      state.onlinePlugins = result.plugins;
      state.onlineWarnings = result.warnings;
    } catch (error) {
      if (sequence !== searchSequence) {
        return;
      }
      state.onlinePlugins = [];
      state.onlineWarnings = [error instanceof Error ? error.message : String(error)];
    } finally {
      if (sequence === searchSequence) {
        state.onlineLoading = false;
        renderList();
      }
    }
  };

  const scheduleOnlineSearch = (): void => {
    if (searchTimer) {
      clearTimeout(searchTimer);
    }
    const sequence = ++searchSequence;
    const query = state.query.trim();
    state.onlinePlugins = [];
    state.onlineWarnings = [];
    state.onlineLoading = false;
    if (query.length < 2) {
      return;
    }
    searchTimer = setTimeout(() => void searchOnline(query, sequence), 500);
  };

  host.addEventListener("dsh-market-activate", () => {
    if (!state.snapshot && !state.loading) {
      void load();
    }
  });
  render();
  return host;
}

function installMarketTab(section: SettingsPluginSection, api: PluginMarketDesktopApi): void {
  if (section.tablist.querySelector(`[${MARKET_TAB_ATTRIBUTE}]`)) {
    return;
  }
  const nativeTabs = Array.from(section.tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (nativeTabs.length === 0) {
    return;
  }
  const marketTab = button("插件市场", nativeTabs[0]?.className ?? "");
  marketTab.setAttribute(MARKET_TAB_ATTRIBUTE, "true");
  marketTab.setAttribute("role", "tab");
  marketTab.setAttribute("aria-selected", "false");
  marketTab.tabIndex = -1;
  const panelId = `dsh-desktop-market-${Math.random().toString(36).slice(2)}`;
  marketTab.id = `${panelId}-tab`;
  marketTab.setAttribute("aria-controls", panelId);
  section.tablist.append(marketTab);

  const panel = createMarketplacePanel(api);
  panel.id = panelId;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", marketTab.id);
  const nativePanels = Array.from(section.container.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
  const lastPanel = nativePanels.at(-1);
  if (lastPanel?.parentElement) {
    lastPanel.insertAdjacentElement("afterend", panel);
  } else {
    section.container.append(panel);
  }

  const deactivateMarket = (): void => {
    marketTab.dataset.active = "";
    marketTab.removeAttribute("data-active");
    marketTab.setAttribute("aria-selected", "false");
    marketTab.tabIndex = -1;
    panel.hidden = true;
  };

  const activateMarket = (): void => {
    for (const tab of nativeTabs) {
      tab.removeAttribute("data-active");
      tab.setAttribute("aria-selected", "false");
      tab.tabIndex = -1;
    }
    for (const nativePanel of nativePanels) {
      nativePanel.hidden = true;
    }
    marketTab.dataset.active = "true";
    marketTab.setAttribute("aria-selected", "true");
    marketTab.tabIndex = 0;
    panel.hidden = false;
    panel.dispatchEvent(new CustomEvent("dsh-market-activate"));
  };

  marketTab.addEventListener("click", activateMarket);
  section.tablist.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(`[${MARKET_TAB_ATTRIBUTE}]`)) {
      return;
    }
    deactivateMarket();
  });
  section.tablist.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    const tabs = [...nativeTabs, marketTab];
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current === -1) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const index = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length;
    tabs[index]?.focus();
    tabs[index]?.click();
  }, { capture: true });
}

export function injectPluginMarket(api: PluginMarketDesktopApi): () => void {
  let queued = false;
  const enhance = (): void => {
    queued = false;
    const section = findPluginSection();
    if (section) {
      installMarketTab(section, api);
    }
  };
  const schedule = (): void => {
    if (queued) {
      return;
    }
    queued = true;
    queueMicrotask(enhance);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
  return () => observer.disconnect();
}
