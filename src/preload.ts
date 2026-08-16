import { contextBridge, ipcRenderer } from "electron";

interface DesktopStatus {
  phase: "starting" | "error";
  message: string;
  details?: string;
  canSelectHarness?: boolean;
}

interface DesktopUpdateState {
  phase: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
  supported: boolean;
  skipped?: boolean;
}

interface HarnessUpdateState {
  phase: "idle" | "checking" | "up-to-date" | "available" | "error";
  currentVersion: string;
  version?: string;
  message?: string;
  supported: boolean;
  skipped?: boolean;
}

interface UpdateStates {
  desktop: DesktopUpdateState;
  harness: HarnessUpdateState;
}

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
  downloadClientUpdate: (): Promise<DesktopUpdateState> =>
    ipcRenderer.invoke("desktop:download-client-update"),
  installClientUpdate: (): Promise<boolean> =>
    ipcRenderer.invoke("desktop:install-client-update"),
  showHarnessUpdate: (): Promise<HarnessUpdateState> =>
    ipcRenderer.invoke("desktop:show-harness-update"),
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
        width: auto;
        height: auto;
        color: #71717a;
        font-size: 10px;
        border: 1px solid rgba(113, 113, 122, 0.2);
        border-radius: 999px;
        padding: 3px 6px;
        background: transparent;
        -webkit-app-region: no-drag;
      }
      .version:hover { background: rgba(24, 24, 27, 0.06); }
      .update {
        width: auto;
        height: 22px;
        border: 0;
        border-radius: 999px;
        padding: 0 9px;
        background: #18181b;
        color: white;
        font: 11px/1 "Segoe UI Variable", "Segoe UI", sans-serif;
        -webkit-app-region: no-drag;
      }
      .update:hover { background: #3f3f46; }
      .update[hidden] { display: none; }
      .update.progress {
        background: #e8eefc;
        color: #315a9d;
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
        .version:hover { background: rgba(255, 255, 255, 0.08); }
        .update { background: #f4f4f5; color: #18181b; }
        .update:hover { background: #d4d4d8; }
        .update.progress { background: #253451; color: #b9cff8; }
        .controls button:hover { background: rgba(255, 255, 255, 0.1); }
      }
    </style>
    <div class="bar">
      <div class="identity">
        <span class="mark">DS</span>
        <span class="title">DeepSeek Harness</span>
        <button class="version" aria-label="检查桌面客户端更新" title="检查更新"></button>
        <button class="update" hidden></button>
      </div>
      <div class="spacer"></div>
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
  const version = shadow.querySelector<HTMLButtonElement>(".version");
  const update = shadow.querySelector<HTMLButtonElement>(".update");
  minimize?.addEventListener("click", desktopBridge.minimize);
  maximize?.addEventListener("click", desktopBridge.toggleMaximize);
  close?.addEventListener("click", desktopBridge.close);
  version?.addEventListener("click", () => void desktopBridge.checkClientUpdate());
  bar?.addEventListener("dblclick", desktopBridge.toggleMaximize);

  let desktopUpdate: DesktopUpdateState | undefined;
  let harnessUpdate: HarnessUpdateState | undefined;
  const renderUpdate = (): void => {
    if (!update) {
      return;
    }
    update.hidden = true;
    update.classList.remove("progress");
    update.onclick = null;

    if (desktopUpdate?.phase === "available" && !desktopUpdate.skipped) {
      update.textContent = `客户端 v${desktopUpdate.version}`;
      update.title = "下载桌面客户端更新";
      update.onclick = () => void desktopBridge.downloadClientUpdate();
      update.hidden = false;
      return;
    }
    if (desktopUpdate?.phase === "downloading") {
      update.textContent = `下载 ${desktopUpdate.percent ?? 0}%`;
      update.title = "正在下载桌面客户端更新";
      update.classList.add("progress");
      update.hidden = false;
      return;
    }
    if (desktopUpdate?.phase === "downloaded") {
      update.textContent = "重启并更新";
      update.title = `安装桌面客户端 v${desktopUpdate.version}`;
      update.onclick = () => void desktopBridge.installClientUpdate();
      update.hidden = false;
      return;
    }
    if (desktopUpdate?.phase === "checking") {
      update.textContent = "检查中…";
      update.title = "正在检查桌面客户端更新";
      update.classList.add("progress");
      update.hidden = false;
      return;
    }
    if (harnessUpdate?.phase === "available" && !harnessUpdate.skipped) {
      update.textContent = `Harness v${harnessUpdate.version}`;
      update.title = "查看官方 Harness 更新";
      update.onclick = () => void desktopBridge.showHarnessUpdate();
      update.hidden = false;
    }
  };

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
