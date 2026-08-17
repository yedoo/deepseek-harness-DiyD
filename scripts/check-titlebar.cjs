const path = require("node:path");
const { writeFileSync } = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");

ipcMain.handle("desktop:get-meta", () => ({ version: "test" }));
ipcMain.handle("desktop:get-window-state", () => ({ maximized: false }));
ipcMain.handle("desktop:get-update-states", () => ({
  desktop: { phase: "idle", currentVersion: "test", supported: false },
  harness: {
    phase: "available",
    currentVersion: "0.1.0-rc.5",
    version: "0.1.0-rc.6",
    supported: true,
  },
}));
ipcMain.handle("desktop:get-appearance", () => ({
  settings: {
    mode: "system",
    background: { kind: "none" },
    effects: { dim: .08, blur: 18, panelOpacity: .9, borderAlpha: .18, radius: 18 },
    colors: {},
    assets: {},
    providers: {},
    overrides: {},
  },
  themes: [],
  providers: [],
}));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`Preload failed at ${preloadPath}:`, error);
  });
  await window.loadFile(path.join(__dirname, "..", "dist", "renderer", "loading.html"));
  const result = await window.webContents.executeJavaScript(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    const host = document.getElementById("dsh-desktop-titlebar");
    if (!host) return { exists: false };
    const style = getComputedStyle(host);
    const rect = host.getBoundingClientRect();
    return {
      exists: true,
      position: style.position,
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      width: Math.round(rect.width),
      updateControl: host.dataset.updateControl,
      updateState: host.dataset.updateState,
      hasUpdateApi:
        typeof window.dshDesktop.checkClientUpdate === "function" &&
        typeof window.dshDesktop.checkHarnessUpdate === "function" &&
        typeof window.dshDesktop.installHarnessUpdate === "function" &&
        typeof window.dshDesktop.restartForHarnessUpdate === "function" &&
        typeof window.dshDesktop.downloadClientUpdate === "function" &&
        typeof window.dshDesktop.installClientUpdate === "function",
    };
  })()`);
  const updateX = result.width - (46 * 3) - 19;
  window.webContents.sendInputEvent({ type: "mouseDown", x: updateX, y: 18, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: updateX, y: 18, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  result.panelOpen = await window.webContents.executeJavaScript(
    `document.getElementById("dsh-desktop-titlebar")?.dataset.updatePanelOpen`,
  );
  if (process.env.DSH_TITLEBAR_SCREENSHOT) {
    const image = await window.webContents.capturePage();
    writeFileSync(process.env.DSH_TITLEBAR_SCREENSHOT, image.toPNG());
  }
  const passed =
    result.exists === true &&
    result.position === "fixed" &&
    result.top === 0 &&
    result.height === 36 &&
    result.updateControl === "true" &&
    result.updateState === "available" &&
    result.panelOpen === "true" &&
    result.hasUpdateApi === true;
  console.log(JSON.stringify(result));
  window.destroy();
  app.exit(passed ? 0 : 1);
});
