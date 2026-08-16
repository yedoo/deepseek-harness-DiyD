const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

ipcMain.handle("desktop:get-meta", () => ({ version: "test" }));
ipcMain.handle("desktop:get-window-state", () => ({ maximized: false }));

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
  await window.loadFile(path.join(__dirname, "..", "dist", "renderer", "loading.html"));
  const result = await window.webContents.executeJavaScript(`(() => {
    const host = document.getElementById("dsh-desktop-titlebar");
    if (!host) return { exists: false };
    const style = getComputedStyle(host);
    const rect = host.getBoundingClientRect();
    return {
      exists: true,
      position: style.position,
      top: Math.round(rect.top),
      height: Math.round(rect.height),
    };
  })()`);
  const passed =
    result.exists === true &&
    result.position === "fixed" &&
    result.top === 0 &&
    result.height === 36;
  console.log(JSON.stringify(result));
  window.destroy();
  app.exit(passed ? 0 : 1);
});
