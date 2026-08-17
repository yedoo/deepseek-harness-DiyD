const path = require("node:path");
const { writeFileSync } = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const targetUrl = process.env.DSH_MARKET_TEST_URL || "http://127.0.0.1:43127";
const screenshotPath = process.env.DSH_MARKET_SCREENSHOT;
const resultScreenshotPath = process.env.DSH_MARKET_RESULT_SCREENSHOT;
const useFixture = process.env.DSH_MARKET_FIXTURE === "1";

let snapshot = {
  updated: "2026-08-17",
  source: "network",
  categories: [
    { id: "ui", label: "界面增强" },
    { id: "vision", label: "视觉" },
    { id: "dev", label: "开发工具" },
  ],
  plugins: [
    {
      id: "https://github.com/omdsh-dev/DSH-better-sidebar",
      name: "DSH-better-sidebar",
      owner: "omdsh-dev",
      url: "https://github.com/omdsh-dev/DSH-better-sidebar",
      category: "ui",
      description: "文件预览、终端、Git 与子代理侧边栏",
      stars: 1714,
      installCommand: "dsh plugin --profile web add dsh-better-sidebar",
      installed: false,
      source: "catalog",
      reviewStatus: "curated",
    },
    {
      id: "https://github.com/liustack/modlens",
      name: "modlens",
      owner: "liustack",
      url: "https://github.com/liustack/modlens",
      category: "vision",
      description: "图片理解、OCR 与界面布局识别",
      stars: 2478,
      installCommand: "dsh plugin --profile web add @liustack/modlens",
      installed: false,
      source: "catalog",
      reviewStatus: "curated",
    },
    {
      id: "https://github.com/omdsh-dev/dsh-at-file",
      name: "dsh-at-file",
      owner: "omdsh-dev",
      url: "https://github.com/omdsh-dev/dsh-at-file",
      category: "dev",
      description: "在对话中快速引用项目文件",
      stars: 270,
      installCommand: "dsh plugin --profile web add github:omdsh-dev/dsh-at-file",
      installed: true,
      dependencyName: "dsh-at-file",
      source: "catalog",
      reviewStatus: "curated",
    },
    {
      id: "https://github.com/bowenliang123/dsh-context",
      name: "dsh-context",
      owner: "bowenliang123",
      url: "https://github.com/bowenliang123/dsh-context",
      category: "dev",
      description: "查看上下文窗口占用与组成",
      stars: 112,
      installCommand: "dsh plugin --profile web add github:bowenliang123/dsh-context",
      installed: false,
      source: "catalog",
      reviewStatus: "curated",
    },
  ],
  installedCount: 1,
  restartRequired: false,
  restartSupported: true,
};

const wallpaperPlugin = {
  id: "npm:dsh-plugin-wallpaper-engine",
  name: "dsh-plugin-wallpaper-engine",
  owner: "elysia395",
  url: "https://github.com/elysia395/dsh-wallpaper-engine",
  category: "theme",
  description: "将 Wallpaper Engine 视频与网页壁纸接入 DSH",
  stars: 18,
  installCommand: "dsh plugin --profile web add dsh-plugin-wallpaper-engine",
  installed: false,
  source: "npm",
  reviewStatus: "community",
  version: "0.1.3",
  installScripts: ["prepare"],
};

ipcMain.handle("desktop:get-meta", () => ({ version: "0.6.0" }));
ipcMain.handle("desktop:get-window-state", () => ({ maximized: false }));
ipcMain.handle("desktop:get-update-states", () => ({
  desktop: { phase: "up-to-date", currentVersion: "0.6.0", supported: true },
  harness: { phase: "up-to-date", currentVersion: "0.1.0-rc.6", supported: true },
}));
ipcMain.handle("desktop:get-plugin-market", () => snapshot);
ipcMain.handle("desktop:search-plugins", (_event, query) => ({
  query,
  plugins: String(query).toLowerCase().includes("wallpaper") ? [wallpaperPlugin] : [],
  warnings: [],
  searchedAt: new Date().toISOString(),
}));
ipcMain.handle("desktop:install-plugin", (_event, id) => {
  if (id === wallpaperPlugin.id) {
    snapshot = { ...snapshot, restartRequired: true, installedCount: snapshot.installedCount + 1 };
    return {
      snapshot,
      plugin: { ...wallpaperPlugin, installed: true, dependencyName: wallpaperPlugin.name },
      message: "安装完成，重启 Harness 后生效",
      restartSupported: true,
    };
  }
  snapshot = {
    ...snapshot,
    restartRequired: true,
    installedCount: snapshot.installedCount + 1,
    plugins: snapshot.plugins.map((plugin) => plugin.id === id
      ? { ...plugin, installed: true, dependencyName: plugin.name }
      : plugin),
  };
  return { snapshot, message: "安装完成，重启 Harness 后生效", restartSupported: true };
});
ipcMain.handle("desktop:remove-plugin", (_event, id) => {
  snapshot = {
    ...snapshot,
    restartRequired: true,
    installedCount: Math.max(0, snapshot.installedCount - 1),
    plugins: snapshot.plugins.map((plugin) => plugin.id === id
      ? { ...plugin, installed: false, dependencyName: undefined }
      : plugin),
  };
  return { snapshot, message: "卸载完成，重启 Harness 后生效", restartSupported: true };
});
ipcMain.handle("desktop:restart-harness-for-plugins", () => true);
ipcMain.handle("desktop:open-plugin-source", () => true);
ipcMain.handle("desktop:open-logs", () => "");
ipcMain.on("desktop:workspace-interaction", () => undefined);
ipcMain.on("desktop:minimize", () => undefined);
ipcMain.on("desktop:toggle-maximize", () => undefined);
ipcMain.on("desktop:close", () => undefined);

async function waitForPage(window, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await window.webContents.executeJavaScript(`Boolean(${expression})`);
    if (found) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1752,
    height: 1128,
    show: false,
    frame: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(__dirname, "..", "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`Preload failed at ${preloadPath}:`, error);
  });
  if (useFixture) {
    await window.loadFile(path.join(__dirname, "..", "tests", "fixtures", "plugin-settings.html"));
  } else {
    await window.loadURL(targetUrl);
    await waitForPage(window, `[...document.querySelectorAll('button,[role="button"]')].some(el => el.textContent?.trim() === '设置')`, 30_000);
    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('button,[role="button"]')]
        .find(el => el.textContent?.trim() === '设置')?.click()
    `);
    await waitForPage(window, `[...document.querySelectorAll('button,[role="button"]')].some(el => el.textContent?.trim() === '插件')`);
    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('button,[role="button"]')]
        .find(el => el.textContent?.trim() === '插件')?.click()
    `);
  }
  await waitForPage(window, `document.querySelector('[data-dsh-desktop-market-tab]')`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-dsh-desktop-market-tab]').click()`);
  await waitForPage(window, `document.querySelector('[data-dsh-desktop-market-panel]')?.shadowRoot?.querySelectorAll('.card').length === 4`);
  if (!useFixture) {
    await waitForPage(window, `!document.body.innerText.includes('Loading plugins...')`);
  }
  await new Promise((resolve) => setTimeout(resolve, useFixture ? 2_000 : 500));
  await waitForPage(window, `document.querySelector('[data-dsh-desktop-market-panel]')?.shadowRoot?.querySelectorAll('.card').length === 4`);

  const image = await window.webContents.capturePage();
  if (screenshotPath) {
    writeFileSync(screenshotPath, image.toPNG());
  }

  const searchInteraction = await window.webContents.executeJavaScript(`(async () => {
    const panel = document.querySelector('[data-dsh-desktop-market-panel]');
    const root = panel.shadowRoot;
    const search = root.querySelector('.search');
    search.value = 'ModLens';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    const filteredCount = root.querySelectorAll('.card').length;
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    search.value = 'dsh-plugin-wallpaper-engine';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const onlineDeadline = Date.now() + 3000;
    while (Date.now() < onlineDeadline && !root.querySelector('[data-review="community"]')) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const onlineSearchCount = root.querySelectorAll('.card').length;
    const onlineReview = root.querySelector('[data-review="community"]')?.textContent ?? '';
    return { filteredCount, onlineSearchCount, onlineReview };
  })()`);

  if (resultScreenshotPath) {
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const resultImage = await window.webContents.capturePage();
    writeFileSync(resultScreenshotPath, resultImage.toPNG());
  }

  const installInteraction = await window.webContents.executeJavaScript(`(async () => {
    const root = document.querySelector('[data-dsh-desktop-market-panel]').shadowRoot;
    const install = [...root.querySelectorAll('button')].find(el => el.textContent === '安装');
    install.click();
    const confirmationVisible = root.querySelector('[role="dialog"]') !== null;
    [...root.querySelectorAll('button')].find(el => el.textContent === '确认安装').click();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && root.querySelectorAll('.installed').length < 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return {
      confirmationVisible,
      installedCount: root.querySelectorAll('.installed').length,
      notice: root.querySelector('.notice')?.textContent ?? '',
    };
  })()`);

  await new Promise((resolve) => setTimeout(resolve, 400));
  const postInteraction = await window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-dsh-desktop-market-panel]').shadowRoot;
    return {
      cards: root.querySelectorAll('.card').length,
      installed: root.querySelectorAll('.installed').length,
      empty: root.querySelector('.empty')?.textContent ?? '',
      notice: root.querySelector('.notice')?.textContent ?? '',
    };
  })()`);

  const result = {
    marketTab: true,
    initialCards: 4,
    ...searchInteraction,
    ...installInteraction,
    postInteraction,
  };
  console.log(JSON.stringify(result));
  const passed = result.filteredCount === 1
    && result.confirmationVisible === true
    && result.onlineSearchCount === 1
    && result.onlineReview.includes("未审核")
    && result.installedCount === 1
    && result.postInteraction.cards === 1
    && result.postInteraction.installed === 1
    && result.notice.includes("重启 Harness 后生效");
  window.destroy();
  app.exit(passed ? 0 : 1);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
