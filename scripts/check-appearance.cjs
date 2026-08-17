const path = require("node:path");
const { writeFileSync } = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const screenshotPath = process.env.DSH_APPEARANCE_SCREENSHOT;
const settingsScreenshotPath = process.env.DSH_APPEARANCE_SETTINGS_SCREENSHOT;
const targetUrl = process.env.DSH_APPEARANCE_TEST_URL;
const testWidth = Number(process.env.DSH_APPEARANCE_TEST_WIDTH || 1752);
const testHeight = Number(process.env.DSH_APPEARANCE_TEST_HEIGHT || 1128);
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
    background: { kind: "provider", providerId: "wallpaper-engine" },
    activeThemeId: "builtin-light",
    providers: { "wallpaper-engine": { enabled: true, settings: {} } },
    overrides: { background: { kind: "provider", providerId: "wallpaper-engine" } },
  },
  themes: [
    { id: "builtin-light", name: "简洁明亮", author: "DeepSeek Harness Desktop", version: "1.0.0", kind: "builtin", createdAt: now, updatedAt: now, config: config("light", "#ffffff", "#f7f8fa", "#3b82f6", "#18181b") },
    { id: "builtin-dark", name: "深色工作台", author: "DeepSeek Harness Desktop", version: "1.0.0", kind: "builtin", createdAt: now, updatedAt: now, config: config("dark", "#1b1c20", "#15161a", "#7aa2ff", "#f4f4f5") },
    { id: "builtin-deep-sea", name: "深海蓝", author: "DeepSeek Harness Desktop", version: "1.0.0", kind: "builtin", createdAt: now, updatedAt: now, config: config("dark", "#10182b", "#0b1222", "#77aaff", "#eef4ff") },
  ],
  providers: [{ id: "wallpaper-engine", name: "Wallpaper Engine", kind: "background", source: "plugin", available: true, description: "使用 Wallpaper Engine 的视频与网页壁纸", capabilities: ["inventory", "video"] }],
};

const clone = () => structuredClone(snapshot);
ipcMain.handle("desktop:get-meta", () => ({ version: "0.8.2" }));
ipcMain.handle("desktop:get-window-state", () => ({ maximized: false }));
ipcMain.handle("desktop:get-update-states", () => ({ desktop: { phase: "up-to-date", currentVersion: "0.8.2", supported: true }, harness: { phase: "up-to-date", currentVersion: "rc.6", supported: true } }));
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
    width: testWidth,
    height: testHeight,
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
  const legacyWallpaperPickerDisplay = await window.webContents.executeJavaScript(`document.querySelector('.we-picker') ? getComputedStyle(document.querySelector('.we-picker')).display : 'absent'`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-dsh-appearance-nav]').click()`);
  await waitFor(window, `document.querySelector('[data-dsh-appearance-panel]')?.shadowRoot?.querySelectorAll('.source-card').length === 3`);
  await waitFor(window, `(() => { const panel = document.querySelector('[data-dsh-appearance-panel]')?.shadowRoot?.querySelector('.provider-panel'); return panel && !panel.textContent.includes('正在读取'); })()`);
  const regression = await window.webContents.executeJavaScript(`(() => {
    const appearanceNav = document.querySelector('[data-dsh-appearance-nav]');
    const modal = appearanceNav?.closest('[role=dialog]') || appearanceNav?.closest('section') || appearanceNav?.parentElement?.parentElement;
    const navItems = appearanceNav?.parentElement ? [...appearanceNav.parentElement.children] : [];
    const root = document.querySelector('[data-dsh-appearance-panel]')?.shadowRoot;
    const host = document.querySelector('[data-dsh-appearance-panel]');
    const hostParent = host?.parentElement;
    const activeNavItems = navItems.filter((element) => {
      const className = typeof element.className === 'string' ? element.className : '';
      return element.getAttribute('aria-current') || className.split(/\\s+/).some((token) => token === 'active' || token.endsWith('_active'));
    });
    const rect = modal?.getBoundingClientRect();
    const shell = root?.querySelector('.shell');
    const shellRect = shell?.getBoundingClientRect();
    const contentEdges = root ? [...root.querySelectorAll('.tabs,.block')].map((element) => element.getBoundingClientRect().right) : [];
    const lastContent = root?.querySelector('.extension-card') || root?.querySelector('.block:last-child');
    if (shell) shell.scrollTop = shell.scrollHeight;
    const lastContentRect = lastContent?.getBoundingClientRect();
    const layout = shell && shellRect ? {
      overflowY: getComputedStyle(shell).overflowY,
      clientHeight: shell.clientHeight,
      scrollHeight: shell.scrollHeight,
      scrollTopAtBottom: shell.scrollTop,
      rightInset: rect && contentEdges.length ? rect.right - Math.max(...contentEdges) : -1,
      lastContentBottom: lastContentRect?.bottom ?? -1,
      viewportBottom: shellRect.bottom,
      host: host ? { top: host.getBoundingClientRect().top, bottom: host.getBoundingClientRect().bottom, height: host.getBoundingClientRect().height } : null,
      parent: hostParent ? {
        top: hostParent.getBoundingClientRect().top,
        bottom: hostParent.getBoundingClientRect().bottom,
        height: hostParent.getBoundingClientRect().height,
        clientHeight: hostParent.clientHeight,
        scrollHeight: hostParent.scrollHeight,
        overflowY: getComputedStyle(hostParent).overflowY,
        paddingTop: getComputedStyle(hostParent).paddingTop,
        paddingBottom: getComputedStyle(hostParent).paddingBottom,
      } : null,
    } : null;
    if (shell) shell.scrollTop = 0;
    return {
      activeNavItems: activeNavItems.map((element) => element.textContent?.trim()),
      modeButtonCount: root ? [...root.querySelectorAll('button')].filter((element) => ['跟随系统', '明亮', '深色'].includes(element.textContent?.trim())).length : -1,
      modal: rect ? { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, scrollHeight: modal.scrollHeight, clientHeight: modal.clientHeight } : null,
      layout,
      viewport: { width: innerWidth, height: innerHeight },
    };
  })()`);
  const nativeThemeRegression = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    document.body.setAttribute('data-ds-dark-theme', '');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const host = document.querySelector('[data-dsh-appearance-panel]');
      resolve({ preserved: document.body.hasAttribute('data-ds-dark-theme'), hostColor: host ? getComputedStyle(host).color : '', inlineLabelColor: document.body.style.getPropertyValue('--dsw-alias-label-primary') });
      document.body.removeAttribute('data-ds-dark-theme');
    }));
  })`);
  const regressionProblems = [];
  if (regression.activeNavItems.length !== 1 || !regression.activeNavItems[0]?.includes('外观')) regressionProblems.push(`active navigation: ${JSON.stringify(regression.activeNavItems)}`);
  if (regression.modeButtonCount !== 0) regressionProblems.push(`duplicate display-mode controls: ${regression.modeButtonCount}`);
  if (!regression.modal || regression.modal.left < 0 || regression.modal.top < 0 || regression.modal.right > regression.viewport.width + 1 || regression.modal.bottom > regression.viewport.height + 1 || regression.modal.scrollHeight > regression.modal.clientHeight + 1) regressionProblems.push(`squeezed modal: ${JSON.stringify(regression.modal)}`);
  if (!regression.layout || regression.layout.rightInset < 20) regressionProblems.push(`cramped right edge: ${JSON.stringify(regression.layout)}`);
  if (!regression.layout || !['auto', 'scroll'].includes(regression.layout.overflowY) || (regression.layout.scrollHeight > regression.layout.clientHeight + 1 && regression.layout.scrollTopAtBottom < 1) || regression.layout.lastContentBottom > regression.layout.viewportBottom + 1) regressionProblems.push(`bottom content unreachable: ${JSON.stringify(regression.layout)}`);
  if (legacyWallpaperPickerDisplay !== 'absent' && legacyWallpaperPickerDisplay !== 'none') regressionProblems.push(`legacy Wallpaper picker visible: ${legacyWallpaperPickerDisplay}`);
  const nativeDarkTextChannels = nativeThemeRegression.hostColor.match(/\d+/g)?.map(Number) ?? [];
  const nativeDarkTextIsLight = nativeDarkTextChannels.length >= 3
    && nativeDarkTextChannels.slice(0, 3).every((channel) => channel >= 220);
  if (!nativeThemeRegression.preserved || !nativeDarkTextIsLight || nativeThemeRegression.inlineLabelColor !== '') regressionProblems.push(`native dark theme not inherited: ${JSON.stringify(nativeThemeRegression)}`);
  if (regressionProblems.length) throw new Error(`Appearance regression: ${regressionProblems.join('; ')}`);
  if (settingsScreenshotPath) {
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(settingsScreenshotPath, (await window.webContents.capturePage()).toPNG());
  }
  await window.webContents.executeJavaScript(`(() => {
    const appearanceNav = document.querySelector('[data-dsh-appearance-nav]');
    [...appearanceNav.parentElement.children].find((element) => element.textContent?.trim() === '通用设置' || element.textContent?.trim() === 'General')?.click();
  })()`);
  await waitFor(window, `document.querySelector('[data-dsh-appearance-panel]')?.hidden === true`);
  const restoredNavigation = await window.webContents.executeJavaScript(`(() => {
    const appearanceNav = document.querySelector('[data-dsh-appearance-nav]');
    const navItems = appearanceNav?.parentElement ? [...appearanceNav.parentElement.children] : [];
    const active = navItems.filter((element) => {
      const className = typeof element.className === 'string' ? element.className : '';
      return element.getAttribute('aria-current') || className.split(/\\s+/).some((token) => token === 'active' || token.endsWith('_active'));
    });
    return active.map((element) => element.textContent?.trim());
  })()`);
  if (restoredNavigation.length !== 1 || restoredNavigation[0]?.includes('外观')) throw new Error(`Native navigation was not restored: ${JSON.stringify(restoredNavigation)}`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-dsh-appearance-nav]').click()`);
  await waitFor(window, `document.querySelector('[data-dsh-appearance-panel]')?.hidden === false`);
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
