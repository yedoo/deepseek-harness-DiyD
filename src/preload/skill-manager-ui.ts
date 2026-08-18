import type {
  SkillCatalogEntry,
  SkillCatalogSnapshot,
  SkillDetail,
  SkillImportResult,
} from "../skill-types";
import { filterSkillEntries, invocationLabel } from "./skill-presentation";

export interface SkillDesktopApi {
  getSkills(): Promise<SkillCatalogSnapshot>;
  getSkillDetail(skillId: string): Promise<SkillDetail | undefined>;
  importSkill(): Promise<SkillImportResult | undefined>;
  openSkillsDirectory(): Promise<boolean>;
  openSkillFile(skillId: string): Promise<boolean>;
  openSkillDirectory(skillId: string): Promise<boolean>;
}

interface SettingsShell {
  nav: HTMLElement;
  content: HTMLElement;
  pluginButton: HTMLButtonElement;
}

interface ViewState {
  snapshot?: SkillCatalogSnapshot;
  query: string;
  loading: boolean;
  busy: boolean;
  selectedSkillId?: string;
  detail?: SkillDetail;
  detailLoading: boolean;
  notice?: { tone: "success" | "error"; message: string };
}

interface NativeSkillIcons {
  project: string;
  user: string;
  bundled: string;
  custom: string;
}

const NAV_ATTRIBUTE = "data-dsh-skills-nav";
const PANEL_ATTRIBUTE = "data-dsh-skills-panel";
const PREVIOUS_DISPLAY = "dshSkillsPreviousDisplay";
const PREVIOUS_HIDDEN = "dshSkillsPreviousHidden";
const PREVIOUS_CLASS = "dshSkillsPreviousClass";
const PREVIOUS_BACKGROUND = "dshSkillsPreviousBackground";
const PREVIOUS_ARIA_CURRENT = "dshSkillsPreviousAriaCurrent";
const NATIVE_PAGE_TITLES = new Set([
  "模型",
  "Model",
  "插件",
  "Plugins",
  "Agent 预设",
  "Agent presets",
]);

export function injectSkillManager(api: SkillDesktopApi): () => void {
  let queued = false;
  const enhance = (): void => {
    queued = false;
    const shell = findSettingsShell();
    if (shell) installSkillSection(shell, api);
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(enhance);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
  return () => observer.disconnect();
}

function findSettingsShell(): SettingsShell | undefined {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button,[role=button]"));
  const pluginButton = buttons.find((button) => ["插件", "Plugins"].includes(exactText(button)));
  const generalButton = buttons.find((button) => ["通用设置", "General"].includes(exactText(button)));
  if (!pluginButton || !generalButton) return undefined;

  let nav = pluginButton.parentElement;
  while (nav && !nav.contains(generalButton)) nav = nav.parentElement;
  if (!nav) return undefined;

  const dialog = nav.closest<HTMLElement>('[role="dialog"]');
  if (dialog) {
    const navBranch = branchBelow(dialog, nav);
    const content = Array.from(dialog.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== navBranch,
    );
    if (content) return { nav, content, pluginButton };
  }

  const heading = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3"))
    .find((candidate) => !nav!.contains(candidate) && NATIVE_PAGE_TITLES.has(exactText(candidate)));
  if (!heading) return undefined;
  const root = commonAncestor(nav, heading);
  const content = root ? branchBelow(root, heading) : undefined;
  return root && content && content !== nav ? { nav, content, pluginButton } : undefined;
}

function installSkillSection(shell: SettingsShell, api: SkillDesktopApi): void {
  if (shell.nav.querySelector(`[${NAV_ATTRIBUTE}]`)) return;

  const navButton = cloneNativeNavButton(shell.pluginButton);
  navButton.setAttribute(NAV_ATTRIBUTE, "true");
  shell.pluginButton.insertAdjacentElement("afterend", navButton);

  const host = document.createElement("section");
  host.setAttribute(PANEL_ATTRIBUTE, "true");
  host.hidden = true;
  host.style.width = "100%";
  host.style.height = "100%";
  host.style.minWidth = "0";
  host.style.minHeight = "0";
  const shadow = host.attachShadow({ mode: "open" });
  shell.content.append(host);

  const icons = nativeSkillIcons(shell.nav);
  createPanel(shadow, host, api, icons);

  let active = false;
  const nativeChildren = (): HTMLElement[] => Array.from(shell.content.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== host);
  const siblingNavButtons = (): HTMLElement[] => Array.from(
    shell.nav.querySelectorAll<HTMLElement>("button,[role=button]"),
  ).filter((button) => button !== navButton);

  const syncNativeMetrics = (): void => {
    const parentRect = shell.content.getBoundingClientRect();
    const parentStyle = getComputedStyle(shell.content);
    const contentTop = parentRect.top + shell.content.clientTop
      + (Number.parseFloat(parentStyle.paddingTop) || 0);
    const contentLeft = parentRect.left + shell.content.clientLeft
      + (Number.parseFloat(parentStyle.paddingLeft) || 0);
    host.style.setProperty("--dsh-skill-font", parentStyle.fontFamily);
    const heading = nativeChildren()
      .flatMap((child) => [
        ...(child.matches("h1,h2,h3") ? [child] : []),
        ...Array.from(child.querySelectorAll<HTMLElement>("h1,h2,h3")),
      ])
      .find((candidate) => NATIVE_PAGE_TITLES.has(exactText(candidate)) && candidate.getClientRects().length > 0);
    if (!heading) return;
    const headingRect = heading.getBoundingClientRect();
    const headingStyle = getComputedStyle(heading);
    host.style.setProperty("--dsh-skill-inset-top", `${Math.max(0, headingRect.top - contentTop)}px`);
    host.style.setProperty("--dsh-skill-inset-left", `${Math.max(0, headingRect.left - contentLeft)}px`);
    host.style.setProperty("--dsh-skill-title-size", headingStyle.fontSize);
    host.style.setProperty("--dsh-skill-title-height", headingStyle.lineHeight);
    host.style.setProperty("--dsh-skill-title-weight", headingStyle.fontWeight);
    const description = heading.nextElementSibling instanceof HTMLElement
      ? heading.nextElementSibling
      : undefined;
    if (description) {
      const descriptionStyle = getComputedStyle(description);
      const descriptionRect = description.getBoundingClientRect();
      host.style.setProperty("--dsh-skill-description-size", descriptionStyle.fontSize);
      host.style.setProperty("--dsh-skill-description-height", descriptionStyle.lineHeight);
      host.style.setProperty(
        "--dsh-skill-description-gap",
        `${Math.max(0, descriptionRect.top - headingRect.bottom)}px`,
      );
    }
  };

  const activate = (): void => {
    if (active) return;
    syncNativeMetrics();
    active = true;
    nativeChildren().forEach((child) => {
      child.dataset[PREVIOUS_DISPLAY] = child.style.display;
      child.dataset[PREVIOUS_HIDDEN] = String(child.hidden);
      child.style.setProperty("display", "none", "important");
      child.hidden = true;
    });
    siblingNavButtons().forEach((button) => {
      button.dataset[PREVIOUS_CLASS] = button.className;
      button.dataset[PREVIOUS_BACKGROUND] = button.style.background;
      button.dataset[PREVIOUS_ARIA_CURRENT] = button.getAttribute("aria-current") ?? "__none__";
      button.className = withoutActiveClasses(button.className);
      button.style.setProperty("background", "transparent", "important");
      button.removeAttribute("aria-current");
    });
    host.hidden = false;
    navButton.style.background = "rgba(120, 128, 145, .14)";
    navButton.setAttribute("aria-current", "page");
    host.dispatchEvent(new CustomEvent("dsh-skills-activate"));
  };

  const deactivate = (): void => {
    if (!active) return;
    active = false;
    nativeChildren().forEach((child) => {
      const display = child.dataset[PREVIOUS_DISPLAY] ?? "";
      display ? child.style.setProperty("display", display) : child.style.removeProperty("display");
      child.hidden = child.dataset[PREVIOUS_HIDDEN] === "true";
      delete child.dataset[PREVIOUS_DISPLAY];
      delete child.dataset[PREVIOUS_HIDDEN];
    });
    siblingNavButtons().forEach((button) => {
      button.className = button.dataset[PREVIOUS_CLASS] ?? button.className;
      const background = button.dataset[PREVIOUS_BACKGROUND] ?? "";
      background ? button.style.setProperty("background", background) : button.style.removeProperty("background");
      const ariaCurrent = button.dataset[PREVIOUS_ARIA_CURRENT];
      if (ariaCurrent && ariaCurrent !== "__none__") button.setAttribute("aria-current", ariaCurrent);
      else button.removeAttribute("aria-current");
      delete button.dataset[PREVIOUS_CLASS];
      delete button.dataset[PREVIOUS_BACKGROUND];
      delete button.dataset[PREVIOUS_ARIA_CURRENT];
    });
    host.hidden = true;
    navButton.style.removeProperty("background");
    navButton.removeAttribute("aria-current");
  };

  shell.nav.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const skillTarget = event.target.closest(`[${NAV_ATTRIBUTE}]`);
    if (!skillTarget) {
      deactivate();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    shell.pluginButton.click();
    queueMicrotask(activate);
  }, { capture: true });
}

function createPanel(
  shadow: ShadowRoot,
  host: HTMLElement,
  api: SkillDesktopApi,
  icons: NativeSkillIcons,
): void {
  const state: ViewState = { query: "", loading: false, busy: false, detailLoading: false };
  const style = document.createElement("style");
  style.textContent = skillStyles();
  const root = document.createElement("div");
  root.className = "skill-root";
  shadow.append(style, root);

  const render = (): void => {
    root.replaceChildren();
    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.textContent = "Skills";
    const subtitle = document.createElement("p");
    subtitle.textContent = "管理当前工作区可用的 Skill。";
    header.append(title, subtitle);

    const search = document.createElement("input");
    search.className = "skill-search";
    search.type = "search";
    search.placeholder = "搜索 Skill";
    search.value = state.query;
    search.setAttribute("aria-label", "搜索 Skill");
    search.addEventListener("input", () => {
      state.query = search.value;
      if (state.selectedSkillId) {
        state.selectedSkillId = undefined;
        state.detail = undefined;
        render();
      } else {
        renderCatalog();
      }
    });

    const catalog = document.createElement("section");
    catalog.className = "catalog";
    const catalogHeader = document.createElement("div");
    catalogHeader.className = "catalog-header";
    const catalogIdentity = document.createElement("div");
    catalogIdentity.className = "catalog-identity";
    const catalogTitle = document.createElement("strong");
    catalogTitle.textContent = state.snapshot?.workspaceRoot ? "当前工作区" : "可用 Skills";
    catalogTitle.title = state.snapshot?.workspaceRoot ?? "";
    const count = document.createElement("span");
    count.className = "skill-count";
    count.textContent = String(state.snapshot?.skills.length ?? 0);
    catalogIdentity.append(catalogTitle, count);
    const actions = document.createElement("div");
    actions.className = "catalog-actions";
    const importButton = actionButton("导入 Skill", async () => {
      if (state.busy) return;
      state.busy = true;
      render();
      try {
        const result = await api.importSkill();
        if (result) {
          state.snapshot = result.snapshot;
          state.notice = { tone: "success", message: `已导入 ${result.imported.name}` };
        }
      } catch (error) {
        state.notice = { tone: "error", message: errorMessage(error) };
      } finally {
        state.busy = false;
        render();
      }
    });
    importButton.disabled = state.busy;
    const directoryButton = actionButton("打开目录", async () => {
      try {
        await api.openSkillsDirectory();
      } catch (error) {
        state.notice = { tone: "error", message: errorMessage(error) };
        render();
      }
    });
    actions.append(importButton, directoryButton);
    catalogHeader.append(catalogIdentity, actions);

    const catalogBody = document.createElement("div");
    catalogBody.className = "catalog-body";
    const cards = document.createElement("div");
    cards.className = "skill-grid";
    cards.setAttribute("data-testid", "skill-grid");
    catalogBody.append(cards);
    catalog.append(catalogHeader, catalogBody);

    if (state.notice) {
      const notice = document.createElement("div");
      notice.className = `notice ${state.notice.tone}`;
      notice.textContent = state.notice.message;
      catalog.insertBefore(notice, catalogBody);
    }

    root.append(header, search, catalog);
    const renderCatalog = (): void => {
      count.textContent = String(state.snapshot?.skills.length ?? 0);
      catalog.classList.toggle("detail-open", Boolean(state.selectedSkillId));
      catalogBody.classList.toggle("detail-open", Boolean(state.selectedSkillId));
      cards.classList.toggle("compact", Boolean(state.selectedSkillId));
      cards.replaceChildren();
      catalogBody.querySelector(".skill-detail")?.remove();
      if (state.loading) {
        cards.append(emptyState("正在读取 Skills…"));
        return;
      }
      const visible = filterSkillEntries(state.snapshot?.skills ?? [], state.query);
      if (visible.length === 0) {
        cards.append(emptyState(state.query ? "没有找到匹配的 Skill" : "当前没有可用的 Skill"));
        return;
      }
      const selectSkill = async (skill: SkillCatalogEntry): Promise<void> => {
        state.selectedSkillId = skill.id;
        state.detail = undefined;
        state.detailLoading = true;
        state.notice = undefined;
        render();
        try {
          const detail = await api.getSkillDetail(skill.id);
          if (!detail) throw new Error("无法读取该 Skill 的详情");
          state.detail = detail;
        } catch (error) {
          state.notice = { tone: "error", message: errorMessage(error) };
        } finally {
          state.detailLoading = false;
          render();
        }
      };
      visible.forEach((skill) => cards.append(skillCard(
        skill,
        icons,
        () => void selectSkill(skill),
        state.selectedSkillId === skill.id,
      )));
      if (state.selectedSkillId) {
        const detail = skillDetailPane(state, api, () => {
          state.selectedSkillId = undefined;
          state.detail = undefined;
          render();
        }, (error) => {
          state.notice = { tone: "error", message: errorMessage(error) };
          render();
        });
        catalogBody.append(detail);
      }
    };
    renderCatalog();
  };

  const load = async (): Promise<void> => {
    state.loading = true;
    state.notice = undefined;
    render();
    try {
      state.snapshot = await api.getSkills();
    } catch (error) {
      state.notice = { tone: "error", message: errorMessage(error) };
    } finally {
      state.loading = false;
      render();
    }
  };
  host.addEventListener("dsh-skills-activate", () => void load());
  render();
}

function skillCard(
  skill: SkillCatalogEntry,
  icons: NativeSkillIcons,
  select: () => void,
  selected: boolean,
): HTMLButtonElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "skill-card";
  card.dataset.skillId = skill.id;
  card.title = `${skill.sourcePath}\n${skill.filePath}`;
  card.classList.toggle("selected", selected);
  card.setAttribute("aria-label", `查看 ${skill.name}`);
  card.setAttribute("aria-pressed", String(selected));

  const iconMarkup = skill.source.startsWith("project-")
    ? icons.project
    : skill.source.startsWith("user-")
      ? icons.user
      : skill.source === "bundled"
        ? icons.bundled
        : icons.custom;

  if (iconMarkup) {
    const icon = document.createElement("span");
    icon.className = "skill-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconMarkup;
    card.append(icon);
  } else {
    card.classList.add("no-icon");
  }

  const body = document.createElement("span");
  body.className = "skill-body";
  const heading = document.createElement("span");
  heading.className = "skill-name";
  heading.textContent = skill.name;
  const description = document.createElement("span");
  description.className = "skill-description";
  description.textContent = skill.description;
  const badges = document.createElement("span");
  badges.className = "skill-badges";
  const source = document.createElement("span");
  source.className = `badge source ${skill.sourceLabel}`;
  source.textContent = skill.sourceLabel;
  const invocation = document.createElement("span");
  invocation.className = "badge invocation";
  invocation.textContent = invocationLabel(skill);
  badges.append(source, invocation);
  body.append(heading, description, badges);
  card.append(body);

  const open = document.createElement("span");
  open.className = "open-label";
  open.textContent = "查看";
  card.append(open);
  card.addEventListener("click", select);
  return card;
}

function skillDetailPane(
  state: ViewState,
  api: SkillDesktopApi,
  close: () => void,
  reportError: (error: unknown) => void,
): HTMLElement {
  const pane = document.createElement("article");
  pane.className = "skill-detail";
  pane.setAttribute("data-testid", "skill-detail");
  if (state.detailLoading) {
    pane.append(emptyState("正在读取 Skill 详情…"));
    return pane;
  }
  if (!state.detail) {
    pane.append(emptyState("暂时无法显示 Skill 详情"));
    return pane;
  }

  const { skill, markdown } = state.detail;
  const header = document.createElement("header");
  header.className = "detail-header";
  const identity = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = skill.name;
  const description = document.createElement("p");
  description.textContent = skill.description;
  identity.append(title, description);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "detail-close";
  closeButton.textContent = "返回列表";
  closeButton.addEventListener("click", close);
  header.append(identity, closeButton);

  const metadata = document.createElement("dl");
  metadata.className = "detail-meta";
  appendMetadata(metadata, "来源", `${skill.sourceLabel} · ${skill.sourcePath}`);
  appendMetadata(metadata, "调用", invocationLabel(skill));
  if (skill.whenToUse) appendMetadata(metadata, "适用场景", skill.whenToUse);

  const content = document.createElement("section");
  content.className = "detail-content";
  const contentTitle = document.createElement("strong");
  contentTitle.textContent = "说明";
  const markdownView = renderMarkdown(markdown || skill.description);
  content.append(contentTitle, markdownView);

  const footer = document.createElement("footer");
  footer.className = "detail-actions";
  const editButton = actionButton("编辑 SKILL.md", async () => {
    try {
      await api.openSkillFile(skill.id);
    } catch (error) {
      reportError(error);
    }
  });
  const directoryButton = actionButton("打开所在目录", async () => {
    try {
      await api.openSkillDirectory(skill.id);
    } catch (error) {
      reportError(error);
    }
  });
  footer.append(editButton, directoryButton);
  pane.append(header, metadata, content, footer);
  return pane;
}

function appendMetadata(list: HTMLDListElement, label: string, value: string): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  list.append(term, description);
}

function renderMarkdown(markdown: string): HTMLElement {
  const viewer = document.createElement("div");
  viewer.className = "markdown-view";
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = /^```\s*([^\s]*)/.exec(line);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      viewer.append(pre);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(4, heading[1]!.length + 2);
      const element = document.createElement(`h${level}`);
      appendInline(element, heading[2]!);
      viewer.append(element);
      index += 1;
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const list = document.createElement("ul");
      while (index < lines.length && /^[-*+]\s+/.test(lines[index] ?? "")) {
        const item = document.createElement("li");
        appendInline(item, (lines[index] ?? "").replace(/^[-*+]\s+/, ""));
        list.append(item);
        index += 1;
      }
      viewer.append(list);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const list = document.createElement("ol");
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? "")) {
        const item = document.createElement("li");
        appendInline(item, (lines[index] ?? "").replace(/^\d+\.\s+/, ""));
        list.append(item);
        index += 1;
      }
      viewer.append(list);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = document.createElement("blockquote");
      appendInline(quote, line.replace(/^>\s?/, ""));
      viewer.append(quote);
      index += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      viewer.append(document.createElement("hr"));
      index += 1;
      continue;
    }
    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index]!.trim() && !isMarkdownBlockStart(lines[index]!)) {
      paragraphLines.push(lines[index]!.trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInline(paragraph, paragraphLines.join(" "));
    viewer.append(paragraph);
  }
  return viewer;
}

function isMarkdownBlockStart(line: string): boolean {
  return /^(#{1,4}\s+|```|[-*+]\s+|\d+\.\s+|>\s?|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$)/.test(line);
}

function appendInline(target: HTMLElement, value: string): void {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) target.append(document.createTextNode(value.slice(cursor, start)));
    const token = match[0];
    const element = document.createElement(token.startsWith("`") ? "code" : "strong");
    element.textContent = token.startsWith("`") ? token.slice(1, -1) : token.slice(2, -2);
    target.append(element);
    cursor = start + token.length;
  }
  if (cursor < value.length) target.append(document.createTextNode(value.slice(cursor)));
}

function actionButton(label: string, action: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action";
  button.textContent = label;
  button.addEventListener("click", () => void action());
  return button;
}

function emptyState(message: string): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = message;
  return empty;
}

function cloneNativeNavButton(reference: HTMLButtonElement): HTMLButtonElement {
  const clone = reference.cloneNode(true) as HTMLButtonElement;
  clone.type = "button";
  clone.removeAttribute("id");
  clone.removeAttribute("aria-current");
  clone.removeAttribute("data-state");
  clone.className = withoutActiveClasses(reference.className);
  const textNode = [...clone.querySelectorAll<HTMLElement>("*")]
    .reverse()
    .find((element) => ["插件", "Plugins"].includes(exactText(element)));
  if (textNode) {
    textNode.textContent = "Skills";
  } else {
    const icon = clone.querySelector("svg")?.cloneNode(true);
    clone.replaceChildren();
    if (icon) clone.append(icon);
    const label = document.createElement("span");
    label.textContent = "Skills";
    clone.append(label);
  }
  return clone;
}

function nativeSkillIcons(nav: HTMLElement): NativeSkillIcons {
  const candidates = Array.from(nav.querySelectorAll<HTMLButtonElement>("button,[role=button]"));
  const read = (labels: string[]): string => candidates
    .find((candidate) => labels.includes(exactText(candidate)))
    ?.querySelector("svg")
    ?.outerHTML ?? "";
  const project = read(["Agent 预设", "Agent presets"]);
  const user = read(["插件", "Plugins"]);
  const bundled = read(["模型", "Model"]);
  const fallback = project || user || bundled;
  return {
    project: project || fallback,
    user: user || fallback,
    bundled: bundled || fallback,
    custom: user || fallback,
  };
}

function branchBelow(root: HTMLElement, element: HTMLElement): HTMLElement | undefined {
  let node = element;
  while (node.parentElement && node.parentElement !== root) node = node.parentElement;
  return node.parentElement === root ? node : undefined;
}

function commonAncestor(first: Element, second: Element): HTMLElement | undefined {
  const ancestors = new Set<Element>();
  let node: Element | null = first;
  while (node) {
    ancestors.add(node);
    node = node.parentElement;
  }
  node = second;
  while (node) {
    if (ancestors.has(node) && node instanceof HTMLElement) return node;
    node = node.parentElement;
  }
  return undefined;
}

function exactText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function withoutActiveClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter((token) => token && token !== "active" && !token.endsWith("_active"))
    .join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function skillStyles(): string {
  return `
    :host {
      display:block;
      height:100%;
      min-width:0;
      min-height:0;
      color:var(--dsw-alias-label-primary,#18181b);
      font-family:var(--dsh-skill-font,inherit);
      font-size:14px;
      line-height:1.45;
    }
    :host([hidden]) { display:none !important; }
    *,*::before,*::after { box-sizing:border-box; }
    button,input { font:inherit; color:inherit; }
    .skill-root {
      height:100%;
      min-height:0;
      display:flex;
      flex-direction:column;
      overflow:hidden;
      padding:var(--dsh-skill-inset-top,0) 22px 24px var(--dsh-skill-inset-left,0);
    }
    header { flex:0 0 auto; }
    h2,p { margin:0; }
    h2 {
      font-size:var(--dsh-skill-title-size,18px);
      line-height:var(--dsh-skill-title-height,26px);
      font-weight:var(--dsh-skill-title-weight,600);
    }
    header p {
      margin-top:var(--dsh-skill-description-gap,8px);
      color:var(--dsw-alias-label-secondary,#8a8a93);
      font-size:var(--dsh-skill-description-size,14px);
      line-height:var(--dsh-skill-description-height,22px);
    }
    .skill-search {
      flex:0 0 44px;
      width:100%;
      height:44px;
      margin-top:22px;
      padding:0 14px;
      border:1px solid #dedfe3;
      border-radius:10px;
      outline:none;
      background:#fff;
    }
    .skill-search:focus { border-color:#8aa9e7; box-shadow:0 0 0 3px rgba(92,139,234,.10); }
    .skill-search::placeholder { color:#a2a2aa; }
    .catalog { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; padding-top:18px; }
    .catalog-header { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .catalog-identity { min-width:0; display:flex; align-items:baseline; gap:8px; }
    .catalog-identity strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:15px; }
    .skill-count { color:#92929a; font-size:12px; }
    .catalog-actions { display:flex; gap:8px; }
    .action {
      min-height:34px;
      padding:0 12px;
      border:1px solid #dddfe4;
      border-radius:9px;
      background:#fff;
      cursor:pointer;
    }
    .action:hover { background:#f5f6f7; }
    .action:disabled { opacity:.45; cursor:not-allowed; }
    .notice { flex:0 0 auto; margin-top:10px; padding:8px 10px; border-radius:8px; font-size:12px; }
    .notice.success { color:#137a44; background:#eefaf3; }
    .notice.error { color:#b42318; background:#fff1f0; }
    .catalog-body { flex:1 1 auto; min-height:0; display:flex; }
    .catalog-body.detail-open {
      display:grid;
      grid-template-columns:minmax(210px,.72fr) minmax(0,1.28fr);
      gap:12px;
      margin-top:13px;
    }
    .skill-grid {
      flex:1 1 auto;
      min-height:0;
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      align-content:start;
      gap:10px;
      margin-top:13px;
      padding:1px 8px 18px 0;
      overflow-y:auto;
      overflow-x:hidden;
      scrollbar-width:thin;
      scrollbar-color:rgba(120,120,128,.48) transparent;
    }
    .catalog-body.detail-open .skill-grid { margin-top:0; padding-bottom:8px; }
    .skill-grid.compact { grid-template-columns:1fr; gap:7px; padding-right:4px; }
    .skill-grid::-webkit-scrollbar { width:6px; }
    .skill-grid::-webkit-scrollbar-track { background:transparent; }
    .skill-grid::-webkit-scrollbar-thumb { border-radius:999px; background:rgba(120,120,128,.48); }
    .skill-card {
      width:100%;
      min-width:0;
      min-height:104px;
      display:grid;
      grid-template-columns:42px minmax(0,1fr) auto;
      align-items:center;
      gap:12px;
      padding:14px;
      border:1px solid #e1e2e6;
      border-radius:12px;
      background:#fff;
      text-align:left;
      cursor:pointer;
    }
    .skill-card.no-icon { grid-template-columns:minmax(0,1fr) auto; }
    .skill-card:hover { border-color:#cbd2df; background:#fafbfc; }
    .skill-card.selected { border-color:#9fb5da; background:#f4f7fc; }
    .skill-card:focus-visible { outline:2px solid #6b95e8; outline-offset:1px; }
    .skill-grid.compact .skill-card {
      min-height:76px;
      grid-template-columns:34px minmax(0,1fr) auto;
      gap:9px;
      padding:10px;
      border-radius:10px;
    }
    .skill-grid.compact .skill-card.no-icon { grid-template-columns:minmax(0,1fr) auto; }
    .skill-grid.compact .skill-icon { width:34px; height:34px; border-radius:9px; }
    .skill-grid.compact .skill-icon svg { width:18px; height:18px; }
    .skill-grid.compact .skill-description { display:none; }
    .skill-grid.compact .skill-badges { margin-top:5px; }
    .skill-icon {
      width:42px;
      height:42px;
      display:grid;
      place-items:center;
      border-radius:11px;
      color:#567bbf;
      background:#eef3fc;
    }
    .skill-icon svg { width:21px; height:21px; }
    .skill-body { min-width:0; display:block; }
    .skill-name { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
    .skill-description {
      display:block;
      margin-top:4px;
      overflow:hidden;
      color:#777780;
      text-overflow:ellipsis;
      white-space:nowrap;
      font-size:12px;
    }
    .skill-badges { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
    .badge { padding:2px 6px; border-radius:5px; color:#666670; background:#f0f1f3; font-size:10px; line-height:1.4; }
    .badge.source.项目 { color:#2563a7; background:#edf5ff; }
    .badge.source.用户 { color:#6b4ea0; background:#f4effc; }
    .badge.source.内置 { color:#666670; background:#f0f1f3; }
    .badge.invocation { color:#18724a; background:#edf8f1; }
    .open-label { color:#777780; font-size:11px; }
    .empty { grid-column:1/-1; padding:80px 18px; color:#8b8b94; text-align:center; }
    .skill-detail {
      min-width:0;
      min-height:0;
      display:flex;
      flex-direction:column;
      overflow:hidden;
      border:1px solid #e1e2e6;
      border-radius:12px;
      background:#fff;
    }
    .detail-header {
      flex:0 0 auto;
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:14px;
      padding:18px 18px 14px;
      border-bottom:1px solid #e7e8eb;
    }
    .detail-header > div { min-width:0; }
    .detail-header h3 { margin:0; overflow-wrap:anywhere; font-size:19px; line-height:1.35; }
    .detail-header p { margin:6px 0 0; color:#777780; font-size:13px; line-height:1.55; }
    .detail-close {
      flex:0 0 auto;
      padding:6px 9px;
      border:0;
      border-radius:7px;
      color:#707078;
      background:transparent;
      cursor:pointer;
      font-size:12px;
    }
    .detail-close:hover { background:#f1f2f4; }
    .detail-meta {
      flex:0 0 auto;
      display:grid;
      grid-template-columns:58px minmax(0,1fr);
      gap:9px 12px;
      margin:0;
      padding:14px 18px;
      border-bottom:1px solid #e7e8eb;
      font-size:12px;
    }
    .detail-meta dt { color:#8a8a93; }
    .detail-meta dd { min-width:0; margin:0; overflow-wrap:anywhere; }
    .detail-content { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; padding:14px 18px 0; }
    .detail-content > strong { flex:0 0 auto; font-size:14px; }
    .markdown-view {
      flex:1 1 auto;
      min-height:0;
      margin-top:9px;
      padding:0 7px 14px 0;
      overflow:auto;
      color:#4f4f57;
      font-size:12px;
      line-height:1.65;
      scrollbar-width:thin;
      scrollbar-color:rgba(120,120,128,.48) transparent;
    }
    .markdown-view::-webkit-scrollbar { width:6px; }
    .markdown-view::-webkit-scrollbar-track { background:transparent; }
    .markdown-view::-webkit-scrollbar-thumb { border-radius:999px; background:rgba(120,120,128,.48); }
    .markdown-view h3,.markdown-view h4,.markdown-view h5,.markdown-view h6 { margin:14px 0 6px; color:inherit; line-height:1.4; }
    .markdown-view h3 { font-size:15px; }
    .markdown-view h4 { font-size:14px; }
    .markdown-view h5,.markdown-view h6 { font-size:13px; }
    .markdown-view p { margin:0 0 9px; }
    .markdown-view ul,.markdown-view ol { margin:0 0 9px; padding-left:20px; }
    .markdown-view blockquote { margin:0 0 9px; padding:7px 10px; border-left:3px solid #b8c5da; color:#6d6d76; background:#f6f7f9; }
    .markdown-view pre { margin:0 0 10px; padding:10px; overflow:auto; border-radius:8px; background:#f4f5f7; font-size:11px; }
    .markdown-view :not(pre) > code { padding:1px 4px; border-radius:4px; background:#f0f1f3; font-size:.94em; }
    .markdown-view hr { height:1px; margin:14px 0; border:0; background:#e4e5e8; }
    .detail-actions { flex:0 0 auto; display:flex; gap:8px; padding:12px 18px; border-top:1px solid #e7e8eb; }
    :host-context(body[data-ds-dark-theme]) {
      color:var(--dsw-alias-label-primary,#f4f4f5);
      color-scheme:dark;
    }
    :host-context(body[data-ds-dark-theme]) .skill-search,
    :host-context(body[data-ds-dark-theme]) .action,
    :host-context(body[data-ds-dark-theme]) .skill-card,
    :host-context(body[data-ds-dark-theme]) .skill-detail {
      border-color:rgba(255,255,255,.13);
      background:#29292c;
    }
    :host-context(body[data-ds-dark-theme]) .skill-search:focus { border-color:#7599d9; box-shadow:0 0 0 3px rgba(92,139,234,.13); }
    :host-context(body[data-ds-dark-theme]) .action:hover,
    :host-context(body[data-ds-dark-theme]) .skill-card:hover { border-color:rgba(255,255,255,.22); background:#303034; }
    :host-context(body[data-ds-dark-theme]) .skill-card.selected { border-color:#607aa7; background:#30343b; }
    :host-context(body[data-ds-dark-theme]) .skill-icon { color:#a9c4f4; background:#333943; }
    :host-context(body[data-ds-dark-theme]) .skill-description,
    :host-context(body[data-ds-dark-theme]) .open-label { color:#a5a5ad; }
    :host-context(body[data-ds-dark-theme]) .badge { color:#c8c8ce; background:#3a3a3e; }
    :host-context(body[data-ds-dark-theme]) .badge.source.项目 { color:#a9ccf3; background:#263848; }
    :host-context(body[data-ds-dark-theme]) .badge.source.用户 { color:#cfb9f0; background:#3a3048; }
    :host-context(body[data-ds-dark-theme]) .badge.invocation { color:#86ddb0; background:#263d32; }
    :host-context(body[data-ds-dark-theme]) .notice.success { color:#86ddb0; background:#263d32; }
    :host-context(body[data-ds-dark-theme]) .notice.error { color:#ffaaa4; background:#452b2b; }
    :host-context(body[data-ds-dark-theme]) .detail-header,
    :host-context(body[data-ds-dark-theme]) .detail-meta,
    :host-context(body[data-ds-dark-theme]) .detail-actions { border-color:rgba(255,255,255,.10); }
    :host-context(body[data-ds-dark-theme]) .detail-header p,
    :host-context(body[data-ds-dark-theme]) .detail-meta dt,
    :host-context(body[data-ds-dark-theme]) .markdown-view { color:#aaaab2; }
    :host-context(body[data-ds-dark-theme]) .detail-close { color:#c0c0c7; }
    :host-context(body[data-ds-dark-theme]) .detail-close:hover,
    :host-context(body[data-ds-dark-theme]) .markdown-view blockquote,
    :host-context(body[data-ds-dark-theme]) .markdown-view pre,
    :host-context(body[data-ds-dark-theme]) .markdown-view :not(pre) > code { background:#333338; }
    :host-context(body[data-ds-dark-theme]) .markdown-view blockquote { border-color:#546985; color:#b8b8c0; }
    :host-context(body[data-ds-dark-theme]) .markdown-view hr { background:rgba(255,255,255,.10); }
    @media (max-width:1100px) {
      .skill-root { padding-right:14px; }
      .skill-grid { grid-template-columns:1fr; }
    }
    @media (max-width:900px) {
      .catalog-body.detail-open { grid-template-columns:1fr; }
      .catalog-body.detail-open .skill-grid { max-height:190px; }
      .skill-detail { min-height:340px; }
    }
  `;
}
