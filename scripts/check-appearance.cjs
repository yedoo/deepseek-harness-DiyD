const path = require("node:path");
const { writeFileSync } = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const screenshotPath = process.env.DSH_APPEARANCE_SCREENSHOT;
const targetUrl = process.env.DSH_APPEARANCE_TEST_URL;
const now = "2026-08-17T00:00:00.000Z";
const config = (mode, surface, sidebar, accent, text) => ({
  mode,
  background: { kind: "none" },
  effects: { dim: .08, blur: 18, panelOpacity: .9, borderAlpha: .18, radius: 18 },
  colors: { surface, sidebar, accent, text },
  assets: {},
});
let snapshot = {
  settings: {
    ...config("light", "#ffffff", "#f7f8fa", "#3b82f6", "#18181b"),
    activeThemeId: "builtin-light",
    providers: { "wallpaper-engine": { enabled: false, settings: {} } },
    overrides: {},
  },
  themes: [
    { id: "builtin-light", name: "简洁明亮", author: "DeepSeek Harness Desktop", version: "1.0.0", kind: "builtin", createdAt: now, updatedAt: now, config: config("light", "#ffffff", "#f7f8fa", "#3b82f6", "#18181b") },
    { id: "builtin-dark", name: "深色工作台", author: "DeepSeek Harness Desktop", version: "1.0.0", kind: "builtin", createdAt: now, updatedAt: now, config: config("dark", "#1b1c20", "#15161a", "#7aa2ff", "#f4f4f5") },
    { id: "builtin-deep-sea", name: "深海蓝", author: "DeepSeek Harness Desktop", version: "1.0.0", kind: "builtin", createdAt: now, updatedAt: now, config: config("dark", "#10182b", "#0b1222", "#77aaff", "#eef4ff") },
  ],
  providers: [{ id: "wallpaper-engine", name: "Wallpaper Engine", kind: "background", source: "plugin", available: true, description: "使用 Wallpaper Engine 的视频与网页壁纸", capabilities: ["inventory", "video"] }],
};

const clone = () => structuredClone(snapshot);
ipcMain.handle("desktop:get-meta", () => ({ version: "0.8.0" }));
ipcMain.handle("desktop:get-window-state", () => ({ maximized: false }));
ipcMain.handle("desktop:get-update-states", () => ({ desktop: { phase: "up-to-date", currentVersion: "0.8.0", supported: true }, harness: { phase: "up-to-date", currentVersion: "rc.6", supported: true } }));
ipcMain.handle("desktop:get-plugin-market", () => ({ updated: now, source: "cache", categories: [], plugins: [], installedCount: 0, restartRequired: false, restartSupported: true }));
ipcMain.handle("desktop:get-appearance", () => clone());
ipcMain.handle("desktop:update-appearance", (_event, patch) => {
  snapshot.settings = { ...snapshot.settings, ...patch, effects: { ...snapshot.settings.effects, ...patch.effects } };
  return clone();
});
ipcMain.handle("desktop:get-appearance-asset", () => { throw new Error("no asset"); });
ipcMain.handle("desktop:select-appearance-asset", () => undefined);
ipcMain.handle("desktop:update-appearance-provider", (_event, id, update) => {
  snapshot.settings.providers[id] = update;
  if (update.enabled) snapshot.settings.background = { kind: "provider", providerId: id };
  return clone();
});
ipcMain.handle("desktop:create-appearance-theme", (_event, input) => {
  const theme = { id: `theme-${snapshot.themes.length}`, name: input.name, author: input.author || "本机用户", version: "1.0.0", kind: "custom", createdAt: now, updatedAt: now, config: structuredClone(snapshot.settings) };
  delete theme.config.activeThemeId; delete theme.config.providers; delete theme.config.overrides;
  snapshot.themes.push(theme);
  return clone();
});
ipcMain.handle("desktop:update-appearance-theme", () => clone());
ipcMain.handle("desktop:duplicate-appearance-theme", () => clone());
ipcMain.handle("desktop:delete-appearance-theme", () => clone());
ipcMain.handle("desktop:apply-appearance-theme", (_event, id) => { snapshot.settings.activeThemeId = id; return clone(); });
ipcMain.handle("desktop:import-appearance-theme", () => undefined);
ipcMain.handle("desktop:export-appearance-theme", () => undefined);
ipcMain.handle("desktop:open-logs", () => "");
ipcMain.on("desktop:workspace-interaction", () => undefined);
ipcMain.on("desktop:minimize", () => undefined);
ipcMain.on("desktop:toggle-maximize", () => undefined);
ipcMain.on("desktop:close", () => undefined);

async function waitFor(window, expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out: ${expression}`);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1500,
    height: 980,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (targetUrl) {
    await window.loadURL(targetUrl);
    await waitFor(window, `[...document.querySelectorAll('button,[role=button]')].some(el => el.textContent?.trim() === '设置')`, 30000);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button,[role=button]')].find(el => el.textContent?.trim() === '设置')?.click()`);
  } else {
    await window.loadFile(path.join(__dirname, "..", "tests", "fixtures", "plugin-settings.html"));
  }
  try {
    await waitFor(window, `document.querySelector('[data-dsh-appearance-nav]')`);
  } catch (error) {
    const diagnostic = await window.webContents.executeJavaScript(`({
      buttons: [...document.querySelectorAll('button,[role=button]')].map(el => el.textContent?.replace(/\\s+/g,' ').trim()).filter(Boolean).slice(-40),
      headings: [...document.querySelectorAll('h1,h2,h3')].map(el => ({ text: el.textContent?.trim(), tag: el.tagName, parent: el.parentElement?.tagName, parentClass: el.parentElement?.className })).slice(-20),
      dialogs: [...document.querySelectorAll('[role=dialog]')].map(el => ({ text: el.textContent?.replace(/\\s+/g,' ').trim().slice(0,300), children: el.children.length, html: el.innerHTML.slice(0,2500) })),
      pluginPath: (() => { let el=[...document.querySelectorAll('button,[role=button]')].find(el=>el.textContent?.trim()==='插件'); const out=[]; while(el&&out.length<8){out.push({tag:el.tagName,cls:el.className,role:el.getAttribute('role'),text:el.textContent?.replace(/\\s+/g,' ').trim().slice(0,120),children:el.children.length});el=el.parentElement;} return out; })()
    })`);
    console.error(JSON.stringify(diagnostic));
    throw error;
  }
  await window.webContents.executeJavaScript(`document.querySelector('[data-dsh-appearance-nav]').click()`);
  await waitFor(window, `document.querySelector('[data-dsh-appearance-panel]')?.shadowRoot?.querySelectorAll('.source-card').length === 3`);
  const settings = await window.webContents.executeJavaScript(`(() => { const root = document.querySelector('[data-dsh-appearance-panel]').shadowRoot; return { tabs: [...root.querySelectorAll('[data-page]')].map(x => x.textContent), sources: root.querySelectorAll('.source-card').length, extensions: root.querySelectorAll('.extension-card').length }; })()`);
  if (settings.tabs.join("|") !== "外观设置|我的主题|主题编辑" || settings.sources !== 3 || settings.extensions !== 1) throw new Error(`Unexpected appearance settings: ${JSON.stringify(settings)}`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-dsh-appearance-panel]').shadowRoot.querySelector('[data-page=themes]').click()`);
  await waitFor(window, `document.querySelector('[data-dsh-appearance-panel]')?.shadowRoot?.querySelectorAll('.theme-card').length === 4`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-dsh-appearance-panel]').shadowRoot.querySelector('[data-action=create-theme]').click()`);
  await waitFor(window, `document.querySelector('[data-dsh-appearance-panel]')?.shadowRoot?.querySelector('.editor-page')`);
  if (screenshotPath) {
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
  }
  console.log(JSON.stringify({ settings, editor: true }));
  window.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
