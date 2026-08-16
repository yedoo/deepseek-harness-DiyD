import { contextBridge, ipcRenderer } from "electron";
import {
  presentUpdates,
  type UpdateAction,
  type UpdateChannelState,
  type UpdateStates,
} from "./preload/update-presentation";

interface DesktopStatus {
  phase: "starting" | "error";
  message: string;
  details?: string;
  canSelectHarness?: boolean;
}

type DesktopUpdateState = UpdateChannelState;
type HarnessUpdateState = UpdateChannelState;

const desktopBridge = {
  minimize: (): void => ipcRenderer.send("desktop:minimize"),
  toggleMaximize: (): void => ipcRenderer.send("desktop:toggle-maximize"),
  close: (): void => ipcRenderer.send("desktop:close"),
  retry: (): void => ipcRenderer.send("desktop:retry"),
  selectHarness: (): Promise<boolean> => ipcRenderer.invoke("desktop:select-harness"),
  openLogs: (): Promise<string> => ipcRenderer.invoke("desktop:open-logs"),
  getUpdateStates: (): Promise<UpdateStates> => ipcRenderer.invoke("desktop:get-update-states"),
  checkClientUpdate: (): Promise<DesktopUpdateState> =>
    ipcRenderer.invoke("desktop:check-client-update"),
  checkHarnessUpdate: (): Promise<HarnessUpdateState> =>
    ipcRenderer.invoke("desktop:check-harness-update"),
  downloadClientUpdate: (): Promise<DesktopUpdateState> =>
    ipcRenderer.invoke("desktop:download-client-update"),
  installClientUpdate: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:install-client-update"),
  installHarnessUpdate: (): Promise<HarnessUpdateState> =>
    ipcRenderer.invoke("desktop:install-harness-update"),
  restartForHarnessUpdate: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:restart-for-harness-update"),
  onClientUpdate: (callback: (state: DesktopUpdateState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => callback(state);
    ipcRenderer.on("desktop:update-state", listener);
    return () => ipcRenderer.removeListener("desktop:update-state", listener);
  },
  onHarnessUpdate: (callback: (state: HarnessUpdateState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: HarnessUpdateState) => callback(state);
    ipcRenderer.on("desktop:harness-update-state", listener);
    return () => ipcRenderer.removeListener("desktop:harness-update-state", listener);
  },
  onStatus: (callback: (status: DesktopStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: DesktopStatus) => callback(status);
    ipcRenderer.on("desktop:status", listener);
    return () => ipcRenderer.removeListener("desktop:status", listener);
  },
};

contextBridge.exposeInMainWorld("dshDesktop", desktopBridge);

window.addEventListener(
  "pointerdown",
  (event) => {
    const fromDesktopTitlebar = event
      .composedPath()
      .some((node) => node instanceof HTMLElement && node.id === "dsh-desktop-titlebar");
    if (!fromDesktopTitlebar) {
      ipcRenderer.send("desktop:workspace-interaction");
    }
  },
  { capture: true },
);

function injectTitlebar(): void {
  if (document.getElementById("dsh-desktop-titlebar")) {
    return;
  }

  const layoutStyle = document.createElement("style");
  layoutStyle.id = "dsh-desktop-layout";
  layoutStyle.textContent = `
    html {
      box-sizing: border-box !important;
      height: 100% !important;
      padding-top: 36px !important;
    }
    body {
      height: 100% !important;
      min-height: 0 !important;
    }
  `;
  document.head.append(layoutStyle);

  const host = document.createElement("div");
  host.id = "dsh-desktop-titlebar";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host {
        position: fixed;
        inset: 0 0 auto 0;
        z-index: 2147483647;
        display: block;
        height: 36px;
        color: #18181b;
        font: 12px/1 "Segoe UI Variable", "Segoe UI", sans-serif;
      }
      .bar {
        height: 36px;
        display: flex;
        align-items: center;
        border-bottom: 1px solid rgba(24, 24, 27, 0.08);
        background: rgba(250, 250, 251, 0.88);
        backdrop-filter: blur(18px) saturate(150%);
        -webkit-app-region: drag;
        user-select: none;
      }
      .identity {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        padding-left: 12px;
      }
      .mark {
        width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
        border-radius: 5px;
        background: #18181b;
        color: white;
        font-size: 9px;
        font-weight: 700;
      }
      .title { font-weight: 600; white-space: nowrap; }
      .version {
        color: #71717a;
        font-size: 10px;
        border: 1px solid rgba(113, 113, 122, 0.2);
        border-radius: 999px;
        padding: 3px 6px;
      }
      .update-shell {
        position: relative;
        height: 100%;
        display: flex;
        align-items: center;
        -webkit-app-region: no-drag;
      }
      .update-trigger {
        position: relative;
        width: 38px;
        height: 100%;
        border: 0;
        display: grid;
        place-items: center;
        color: #52525b;
        background: transparent;
      }
      .update-trigger:hover,
      .update-trigger[aria-expanded="true"] { background: rgba(24, 24, 27, 0.07); }
      .update-trigger svg { width: 17px; height: 17px; }
      .update-symbol { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
      .progress-ring { fill: none; stroke: #3b82f6; stroke-width: 2; stroke-linecap: round; opacity: 0; transform: rotate(-90deg); transform-origin: center; }
      .update-trigger[data-state="downloading"] .progress-ring { opacity: 1; }
      .update-dot {
        position: absolute;
        top: 7px;
        right: 7px;
        width: 6px;
        height: 6px;
        border: 2px solid #fafafa;
        border-radius: 50%;
        display: none;
        background: #3b82f6;
      }
      .update-trigger[data-state="available"] .update-dot,
      .update-trigger[data-state="ready"] .update-dot { display: block; }
      .update-trigger[data-state="ready"] .update-dot { background: #22c55e; }
      .update-panel {
        position: absolute;
        top: 40px;
        right: 0;
        width: 380px;
        box-sizing: border-box;
        border: 1px solid rgba(24, 24, 27, 0.12);
        border-radius: 12px;
        padding: 6px;
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 16px 44px rgba(24, 24, 27, 0.18), 0 2px 8px rgba(24, 24, 27, 0.08);
        color: #18181b;
        -webkit-app-region: no-drag;
      }
      .update-panel[hidden] { display: none; }
      .update-header,
      .update-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 9px;
      }
      .update-heading { font-size: 13px; font-weight: 650; }
      .update-auto { color: #a1a1aa; font-size: 10px; }
      .update-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        min-height: 54px;
        padding: 7px 9px;
        border-radius: 8px;
      }
      .update-row + .update-row { border-top: 1px solid rgba(24, 24, 27, 0.07); border-radius: 0 0 8px 8px; }
      .update-row-name { font-size: 12px; font-weight: 600; }
      .update-row-meta { display: flex; gap: 7px; margin-top: 5px; color: #71717a; font-size: 10px; }
      .update-row-version { color: #3f3f46; }
      .update-status-line { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
      .update-row-status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .update-spinner {
        display: none;
        width: 9px;
        height: 9px;
        flex: 0 0 auto;
        border: 1.5px solid rgba(82, 82, 91, 0.22);
        border-top-color: #52525b;
        border-radius: 50%;
        animation: row-spin 0.8s linear infinite;
      }
      .update-row[data-busy="true"] .update-spinner { display: inline-block; }
      @keyframes row-spin { to { transform: rotate(360deg); } }
      .update-progress {
        grid-column: 1 / -1;
        height: 2px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(59, 130, 246, 0.13);
      }
      .update-progress[hidden] { display: none; }
      .update-progress-bar { height: 100%; width: 0; border-radius: inherit; background: #3b82f6; transition: width 160ms ease; }
      .update-action,
      .update-check {
        border: 0;
        border-radius: 7px;
        color: #18181b;
        background: #f1f1f3;
        font: 11px/1 "Segoe UI Variable", "Segoe UI", sans-serif;
      }
      .update-action { min-width: 66px; height: 28px; padding: 0 9px; }
      .update-action:hover,
      .update-check:hover { background: #e4e4e7; }
      .update-check { height: 26px; padding: 0 9px; color: #52525b; background: transparent; }
      .update-check:disabled { opacity: 0.5; }
      .update-error { color: #dc2626; }
      .update-current { color: #16a34a; }
      @media (prefers-reduced-motion: reduce) {
        .update-spinner { animation: none; }
      }
      .spacer { flex: 1; }
      .controls {
        height: 100%;
        display: flex;
        -webkit-app-region: no-drag;
      }
      .controls button {
        width: 46px;
        height: 100%;
        border: 0;
        background: transparent;
        color: inherit;
        font: 15px/1 "Segoe UI Symbol", sans-serif;
      }
      .controls button:hover { background: rgba(24, 24, 27, 0.08); }
      .controls button.close:hover { background: #e81123; color: white; }
      @media (prefers-color-scheme: dark) {
        :host { color: #f4f4f5; }
        .bar {
          border-bottom-color: rgba(255, 255, 255, 0.09);
          background: rgba(24, 24, 27, 0.88);
        }
        .mark { background: #f4f4f5; color: #18181b; }
        .version { color: #a1a1aa; border-color: rgba(161, 161, 170, 0.25); }
        .update-trigger { color: #d4d4d8; }
        .update-trigger:hover,
        .update-trigger[aria-expanded="true"] { background: rgba(255, 255, 255, 0.09); }
        .update-dot { border-color: #18181b; }
        .update-panel {
          border-color: rgba(255, 255, 255, 0.13);
          background: rgba(32, 32, 35, 0.98);
          color: #f4f4f5;
          box-shadow: 0 16px 44px rgba(0, 0, 0, 0.42), 0 2px 8px rgba(0, 0, 0, 0.25);
        }
        .update-row + .update-row { border-top-color: rgba(255, 255, 255, 0.08); }
        .update-row-meta { color: #a1a1aa; }
        .update-row-version { color: #d4d4d8; }
        .update-spinner { border-color: rgba(212, 212, 216, 0.22); border-top-color: #d4d4d8; }
        .update-action { color: #f4f4f5; background: #3f3f46; }
        .update-action:hover { background: #52525b; }
        .update-check { color: #a1a1aa; }
        .update-check:hover { background: rgba(255, 255, 255, 0.08); }
        .update-current { color: #4ade80; }
        .controls button:hover { background: rgba(255, 255, 255, 0.1); }
      }
    </style>
    <div class="bar">
      <div class="identity">
        <span class="mark">DS</span>
        <span class="title">DeepSeek Harness</span>
        <span class="version" aria-label="应用版本"></span>
      </div>
      <div class="spacer"></div>
      <div class="update-shell">
        <button class="update-trigger" data-state="idle" aria-label="版本更新" title="版本更新" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle class="progress-ring" cx="12" cy="12" r="9" pathLength="100"></circle>
            <path class="update-symbol" d="M12 3.8v10.4M8.4 10.8 12 14.4l3.6-3.6M5 18.5h14"></path>
          </svg>
          <span class="update-dot" aria-hidden="true"></span>
        </button>
        <section class="update-panel" aria-label="版本更新" hidden>
          <div class="update-header">
            <span class="update-heading">版本更新</span>
            <span class="update-auto">后台下载已开启</span>
          </div>
          <div class="update-row desktop-row">
            <div>
              <div class="update-row-name"></div>
              <div class="update-row-meta">
                <span class="update-row-version"></span>
                <span class="update-status-line"><span class="update-spinner" aria-hidden="true"></span><span class="update-row-status"></span></span>
              </div>
            </div>
            <button class="update-action" hidden></button>
            <div class="update-progress" hidden><div class="update-progress-bar"></div></div>
          </div>
          <div class="update-row harness-row">
            <div>
              <div class="update-row-name"></div>
              <div class="update-row-meta">
                <span class="update-row-version"></span>
                <span class="update-status-line"><span class="update-spinner" aria-hidden="true"></span><span class="update-row-status"></span></span>
              </div>
            </div>
            <button class="update-action" hidden></button>
            <div class="update-progress" hidden><div class="update-progress-bar"></div></div>
          </div>
          <div class="update-footer">
            <span class="update-auto">客户端退出时安装 · Harness 安全切换</span>
            <button class="update-check">重新检查</button>
          </div>
        </section>
      </div>
      <div class="controls">
        <button class="minimize" aria-label="最小化" title="最小化">−</button>
        <button class="maximize" aria-label="最大化" title="最大化">□</button>
        <button class="close" aria-label="关闭" title="关闭">×</button>
      </div>
    </div>
  `;
  document.documentElement.append(host);

  const minimize = shadow.querySelector<HTMLButtonElement>(".minimize");
  const maximize = shadow.querySelector<HTMLButtonElement>(".maximize");
  const close = shadow.querySelector<HTMLButtonElement>(".close");
  const bar = shadow.querySelector<HTMLElement>(".bar");
  const version = shadow.querySelector<HTMLElement>(".version");
  const updateTrigger = shadow.querySelector<HTMLButtonElement>(".update-trigger");
  const updatePanel = shadow.querySelector<HTMLElement>(".update-panel");
  const updateCheck = shadow.querySelector<HTMLButtonElement>(".update-check");
  const progressRing = shadow.querySelector<SVGCircleElement>(".progress-ring");
  const desktopRow = shadow.querySelector<HTMLElement>(".desktop-row");
  const harnessRow = shadow.querySelector<HTMLElement>(".harness-row");
  minimize?.addEventListener("click", desktopBridge.minimize);
  maximize?.addEventListener("click", desktopBridge.toggleMaximize);
  close?.addEventListener("click", desktopBridge.close);
  bar?.addEventListener("dblclick", (event) => {
    if (!event.composedPath().some((node) => node instanceof HTMLButtonElement)) {
      desktopBridge.toggleMaximize();
    }
  });

  let desktopUpdate: DesktopUpdateState | undefined;
  let harnessUpdate: HarnessUpdateState | undefined;
  const setPanelOpen = (open: boolean): void => {
    if (!updatePanel || !updateTrigger) {
      return;
    }
    updatePanel.hidden = !open;
    updateTrigger.setAttribute("aria-expanded", String(open));
    host.dataset.updatePanelOpen = String(open);
  };
  updateTrigger?.addEventListener("click", () => setPanelOpen(updatePanel?.hidden !== false));
  document.addEventListener("pointerdown", (event) => {
    if (updatePanel?.hidden === false && !event.composedPath().includes(host)) {
      setPanelOpen(false);
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setPanelOpen(false);
    }
  });

  const performAction = async (action: UpdateAction): Promise<void> => {
    switch (action.kind) {
      case "check-desktop":
        desktopUpdate = await desktopBridge.checkClientUpdate();
        break;
      case "download-desktop":
        desktopUpdate = await desktopBridge.downloadClientUpdate();
        break;
      case "install-desktop":
        await desktopBridge.installClientUpdate();
        break;
      case "check-harness":
        harnessUpdate = await desktopBridge.checkHarnessUpdate();
        break;
      case "install-harness":
        harnessUpdate = await desktopBridge.installHarnessUpdate();
        break;
      case "restart-harness":
        await desktopBridge.restartForHarnessUpdate();
        break;
    }
    renderUpdate();
  };

  const renderRow = (
    row: HTMLElement | null,
    presentation: ReturnType<typeof presentUpdates>["desktop"],
  ): void => {
    if (!row) {
      return;
    }
    const name = row.querySelector<HTMLElement>(".update-row-name");
    const rowVersion = row.querySelector<HTMLElement>(".update-row-version");
    const status = row.querySelector<HTMLElement>(".update-row-status");
    const action = row.querySelector<HTMLButtonElement>(".update-action");
    const progress = row.querySelector<HTMLElement>(".update-progress");
    const progressBar = row.querySelector<HTMLElement>(".update-progress-bar");
    if (name) name.textContent = presentation.name;
    if (rowVersion) rowVersion.textContent = presentation.version;
    row.dataset.busy = String(presentation.busy === true);
    row.title = presentation.details ?? "";
    if (status) {
      status.textContent = presentation.status;
      status.classList.toggle("update-error", presentation.tone === "error");
      status.classList.toggle("update-current", presentation.tone === "success");
    }
    if (action) {
      action.hidden = presentation.action === undefined;
      action.disabled = presentation.busy === true;
      action.textContent = presentation.action?.label ?? "";
      action.onclick = presentation.action
        ? () => void performAction(presentation.action as UpdateAction)
        : null;
    }
    if (progress) {
      progress.hidden = presentation.progress === undefined;
    }
    if (progressBar) {
      progressBar.style.width = `${Math.max(0, Math.min(100, presentation.progress ?? 0))}%`;
    }
  };

  const renderUpdate = (): void => {
    if (!updateTrigger || !desktopUpdate || !harnessUpdate) {
      return;
    }
    const presentation = presentUpdates({ desktop: desktopUpdate, harness: harnessUpdate });
    updateTrigger.dataset.state = presentation.icon;
    updateTrigger.title = {
      idle: "版本更新",
      checking: "正在检查更新",
      available: "发现新版本",
      downloading: `正在下载 ${desktopUpdate.percent ?? 0}%`,
      ready: "更新已下载，等待重启",
    }[presentation.icon];
    updateTrigger.setAttribute("aria-label", updateTrigger.title);
    host.dataset.updateState = presentation.icon;
    if (updateCheck) {
      updateCheck.disabled = Boolean(
        presentation.desktop.busy || presentation.harness.busy,
      );
    }
    if (progressRing) {
      progressRing.style.strokeDasharray = "100";
      progressRing.style.strokeDashoffset = String(100 - (desktopUpdate.percent ?? 0));
    }
    renderRow(desktopRow, presentation.desktop);
    renderRow(harnessRow, presentation.harness);
  };

  updateCheck?.addEventListener("click", async () => {
    updateCheck.disabled = true;
    try {
      const [desktop, harness] = await Promise.all([
        desktopBridge.checkClientUpdate(),
        desktopBridge.checkHarnessUpdate(),
      ]);
      desktopUpdate = desktop;
      harnessUpdate = harness;
      renderUpdate();
    } finally {
      updateCheck.disabled = false;
    }
  });

  desktopBridge.onClientUpdate((state) => {
    desktopUpdate = state;
    renderUpdate();
  });
  desktopBridge.onHarnessUpdate((state) => {
    harnessUpdate = state;
    renderUpdate();
  });
  void desktopBridge.getUpdateStates().then((states) => {
    desktopUpdate = states.desktop;
    harnessUpdate = states.harness;
    renderUpdate();
  });
  host.dataset.updateControl = "true";
  host.dataset.updatePanelOpen = "false";

  void ipcRenderer.invoke("desktop:get-meta").then((meta: { version: string }) => {
    if (version) {
      version.textContent = `v${meta.version}`;
    }
  });
  const updateMaximizeIcon = (maximized: boolean): void => {
    if (!maximize) {
      return;
    }
    maximize.textContent = maximized ? "❐" : "□";
    maximize.title = maximized ? "还原" : "最大化";
    maximize.setAttribute("aria-label", maximize.title);
  };
  void ipcRenderer
    .invoke("desktop:get-window-state")
    .then((state: { maximized: boolean }) => updateMaximizeIcon(state.maximized));
  ipcRenderer.on(
    "desktop:window-state",
    (_event, state: { maximized: boolean }) => updateMaximizeIcon(state.maximized),
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectTitlebar, { once: true });
} else {
  injectTitlebar();
}
