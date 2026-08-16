import { contextBridge, ipcRenderer } from "electron";

interface DesktopStatus {
  phase: "starting" | "error";
  message: string;
  details?: string;
  canSelectHarness?: boolean;
}

const desktopBridge = {
  minimize: (): void => ipcRenderer.send("desktop:minimize"),
  toggleMaximize: (): void => ipcRenderer.send("desktop:toggle-maximize"),
  close: (): void => ipcRenderer.send("desktop:close"),
  retry: (): void => ipcRenderer.send("desktop:retry"),
  selectHarness: (): Promise<boolean> => ipcRenderer.invoke("desktop:select-harness"),
  openLogs: (): Promise<string> => ipcRenderer.invoke("desktop:open-logs"),
  onStatus: (callback: (status: DesktopStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: DesktopStatus) => callback(status);
    ipcRenderer.on("desktop:status", listener);
    return () => ipcRenderer.removeListener("desktop:status", listener);
  },
};

contextBridge.exposeInMainWorld("dshDesktop", desktopBridge);

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
      .spacer { flex: 1; }
      .controls {
        height: 100%;
        display: flex;
        -webkit-app-region: no-drag;
      }
      button {
        width: 46px;
        height: 100%;
        border: 0;
        background: transparent;
        color: inherit;
        font: 15px/1 "Segoe UI Symbol", sans-serif;
      }
      button:hover { background: rgba(24, 24, 27, 0.08); }
      button.close:hover { background: #e81123; color: white; }
      @media (prefers-color-scheme: dark) {
        :host { color: #f4f4f5; }
        .bar {
          border-bottom-color: rgba(255, 255, 255, 0.09);
          background: rgba(24, 24, 27, 0.88);
        }
        .mark { background: #f4f4f5; color: #18181b; }
        .version { color: #a1a1aa; border-color: rgba(161, 161, 170, 0.25); }
        button:hover { background: rgba(255, 255, 255, 0.1); }
      }
    </style>
    <div class="bar">
      <div class="identity">
        <span class="mark">DS</span>
        <span class="title">DeepSeek Harness</span>
        <span class="version" aria-label="应用版本"></span>
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
  const version = shadow.querySelector<HTMLElement>(".version");
  minimize?.addEventListener("click", desktopBridge.minimize);
  maximize?.addEventListener("click", desktopBridge.toggleMaximize);
  close?.addEventListener("click", desktopBridge.close);
  bar?.addEventListener("dblclick", desktopBridge.toggleMaximize);

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
