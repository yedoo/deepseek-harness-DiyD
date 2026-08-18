const path = require("node:path");
const { writeFileSync } = require("node:fs");
const { app, BrowserWindow, ipcMain } = require("electron");

const screenshotPath = process.env.DSH_SKILLS_SCREENSHOT;

const skills = [
  ["code-review", "审查代码变更并提供改进建议。", "项目", "project-dsh", true, true],
  ["test-driven-development", "在实现功能前先编写可验证的测试。", "项目", "project-agents", true, false],
  ["browser-automation", "验证桌面工作台的浏览器交互流程。", "用户", "user-agents", false, true],
  ["release-notes", "根据本次更改生成简洁的发布说明。", "用户", "user-dsh", true, true],
  ["planning", "为复杂任务创建和维护执行计划。", "内置", "bundled", true, true],
  ["memory", "在任务之间保存和读取持久化记忆。", "内置", "bundled", true, false],
  ["web-search", "需要外部资料时搜索最新网络信息。", "内置", "bundled", true, true],
  ["document-tools", "读取、编辑并验证工作区文档。", "用户", "user-agents", false, true],
].map(([name, description, sourceLabel, source, modelInvocable, userInvocable]) => ({
  id: `${source}:${name}`,
  name,
  description,
  source,
  sourceLabel,
  sourcePath: source === "bundled" ? "Harness preset" : ".dsh/skills",
  filePath: `D:\\project\\skills\\${name}\\SKILL.md`,
  modelInvocable,
  userInvocable,
}));

const snapshot = () => ({
  workspaceRoot: "D:\\DeepSeek\\deepseek-harness-desktop",
  userSkillsRoot: "D:\\DeepSeek\\data\\skills",
  skills,
  sourceCounts: { project: 2, user: 3, custom: 0, bundled: 3 },
});

ipcMain.handle("desktop:get-meta", () => ({ version: "0.8.8" }));
ipcMain.handle("desktop:get-window-state", () => ({ maximized: false }));
ipcMain.handle("desktop:get-update-states", () => ({
  desktop: { phase: "up-to-date", currentVersion: "0.8.8", supported: true },
  harness: { phase: "up-to-date", currentVersion: "0.1.0-rc.6", supported: true },
}));
ipcMain.handle("desktop:get-appearance", () => ({
  settings: {
    mode: "system",
    background: { kind: "none" },
    effects: { dim: .08, blur: 18, panelOpacity: .9, borderAlpha: .18, radius: 18 },
    colors: {}, assets: {}, providers: {}, overrides: {},
  },
  themes: [],
  providers: [],
}));
ipcMain.handle("desktop:get-plugin-market", () => ({
  updated: "2026-08-18", source: "cache", categories: [], plugins: [],
  installedCount: 0, restartRequired: false, restartSupported: true,
}));
ipcMain.handle("desktop:get-skills", () => snapshot());
ipcMain.handle("desktop:import-skill", () => undefined);
ipcMain.handle("desktop:open-skills-directory", () => true);
ipcMain.handle("desktop:open-skill", () => true);
ipcMain.on("desktop:workspace-interaction", () => undefined);
ipcMain.on("desktop:minimize", () => undefined);
ipcMain.on("desktop:toggle-maximize", () => undefined);
ipcMain.on("desktop:close", () => undefined);

async function waitFor(window, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 1000,
    show: false,
    frame: false,
    backgroundColor: "#18181b",
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(__dirname, "..", "dist", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(path.join(__dirname, "..", "tests", "fixtures", "plugin-settings.html"));
  await waitFor(window, `document.querySelector('[data-dsh-skills-nav]')`);
  await window.webContents.executeJavaScript(`(() => {
    document.body.setAttribute('data-ds-dark-theme', '');
    const style = document.createElement('style');
    style.textContent = \`
      body[data-ds-dark-theme] { color:#f4f4f5; background:#18181b; }
      body[data-ds-dark-theme] .modal { color:#f4f4f5; background:#29292c; }
      body[data-ds-dark-theme] .config { color:#f4f4f5; border-color:rgba(255,255,255,.16); background:#29292c; }
      body[data-ds-dark-theme] .close,
      body[data-ds-dark-theme] .navItem { color:#f4f4f5; }
      body[data-ds-dark-theme] .navItem.active { background:#45464b; }
      body[data-ds-dark-theme] .backdrop { background:rgba(0,0,0,.58); }
    \`;
    document.head.append(style);
  })()`);
  const nativeHeading = await window.webContents.executeJavaScript(`(() => {
    const heading = [...document.querySelectorAll('h1,h2,h3')].find(el => el.textContent?.trim() === '插件');
    const rect = heading?.getBoundingClientRect();
    const style = heading ? getComputedStyle(heading) : null;
    return rect && style ? { top: rect.top, left: rect.left, fontSize: style.fontSize, lineHeight: style.lineHeight, fontWeight: style.fontWeight } : null;
  })()`);
  await window.webContents.executeJavaScript(`document.querySelector('[data-dsh-skills-nav]').click()`);
  await waitFor(window, `document.querySelector('[data-dsh-skills-panel]')?.shadowRoot?.querySelectorAll('.skill-card').length === 8`);
  await new Promise((resolve) => setTimeout(resolve, 180));

  const regression = await window.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('[data-dsh-skills-panel]');
    const root = host.shadowRoot;
    const modal = document.querySelector('.modal');
    const skillRoot = root.querySelector('.skill-root');
    const heading = root.querySelector('h2');
    const search = root.querySelector('.skill-search');
    const grid = root.querySelector('.skill-grid');
    const card = root.querySelector('.skill-card');
    const rect = modal.getBoundingClientRect();
    const rootRect = skillRoot.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const headingStyle = getComputedStyle(heading);
    const searchStyle = getComputedStyle(search);
    const cardStyle = getComputedStyle(card);
    const gridStyle = getComputedStyle(grid);
    const activeNav = [...document.querySelectorAll('.settingsNav button')]
      .filter(el => el.getAttribute('aria-current') || el.classList.contains('active'))
      .map(el => el.textContent?.trim());
    return {
      activeNav,
      heading: { top: headingRect.top, left: headingRect.left, fontSize: headingStyle.fontSize, lineHeight: headingStyle.lineHeight, fontWeight: headingStyle.fontWeight },
      searchBackground: searchStyle.backgroundColor,
      cardBackground: cardStyle.backgroundColor,
      gridColumns: gridStyle.gridTemplateColumns.split(' ').filter(Boolean).length,
      scrollbarColor: gridStyle.scrollbarColor,
      rootWithinModal: rootRect.left >= rect.left && rootRect.right <= rect.right + 1 && rootRect.bottom <= rect.bottom + 1,
      horizontalOverflow: skillRoot.scrollWidth - skillRoot.clientWidth,
      cards: root.querySelectorAll('.skill-card').length,
      sourceLabels: [...root.querySelectorAll('.badge.source')].map(el => el.textContent?.trim()),
      invocationLabels: [...root.querySelectorAll('.badge.invocation')].map(el => el.textContent?.trim()),
    };
  })()`);

  if (screenshotPath) {
    window.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 250));
    writeFileSync(screenshotPath, (await window.webContents.capturePage()).toPNG());
    window.hide();
  }

  const searchResult = await window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-dsh-skills-panel]').shadowRoot;
    const search = root.querySelector('.skill-search');
    search.value = 'release';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    return [...root.querySelectorAll('.skill-name')].map(el => el.textContent?.trim());
  })()`);

  await window.webContents.executeJavaScript(`document.querySelector('[data-dsh-skills-panel]').shadowRoot.querySelector('.skill-search').value = ''`);
  await window.webContents.executeJavaScript(`
    [...document.querySelectorAll('.settingsNav button')].find(el => el.textContent?.trim() === '通用设置').click()
  `);
  await waitFor(window, `document.querySelector('[data-dsh-skills-panel]')?.hidden === true`);
  const isolation = await window.webContents.executeJavaScript(`(() => ({
    skillsHidden: document.querySelector('[data-dsh-skills-panel]').hidden,
    pluginHeadingVisible: [...document.querySelectorAll('h1,h2,h3')].some(el => el.textContent?.trim() === '插件' && el.getClientRects().length > 0),
    appearanceStillPresent: Boolean(document.querySelector('[data-dsh-appearance-nav]')),
  }))()`);

  const problems = [];
  if (!nativeHeading || Math.abs(nativeHeading.top - regression.heading.top) > 1 || Math.abs(nativeHeading.left - regression.heading.left) > 1 || nativeHeading.fontSize !== regression.heading.fontSize || nativeHeading.lineHeight !== regression.heading.lineHeight || nativeHeading.fontWeight !== regression.heading.fontWeight) problems.push(`heading mismatch: ${JSON.stringify({ nativeHeading, skillHeading: regression.heading })}`);
  if (regression.activeNav.length !== 1 || regression.activeNav[0] !== "Skills") problems.push(`navigation state: ${JSON.stringify(regression.activeNav)}`);
  if (regression.searchBackground === "rgb(255, 255, 255)" || regression.cardBackground === "rgb(255, 255, 255)") problems.push(`dark controls: ${JSON.stringify({ search: regression.searchBackground, card: regression.cardBackground })}`);
  if (regression.gridColumns !== 2) problems.push(`grid columns: ${regression.gridColumns}`);
  if (!regression.rootWithinModal || regression.horizontalOverflow > 1) problems.push(`layout overflow: ${JSON.stringify(regression)}`);
  if (!regression.sourceLabels.includes("项目") || !regression.sourceLabels.includes("用户") || !regression.sourceLabels.includes("内置")) problems.push(`source labels: ${JSON.stringify(regression.sourceLabels)}`);
  if (!regression.invocationLabels.includes("仅用户") || !regression.invocationLabels.includes("仅模型")) problems.push(`invocation labels: ${JSON.stringify(regression.invocationLabels)}`);
  if (searchResult.length !== 1 || searchResult[0] !== "release-notes") problems.push(`search result: ${JSON.stringify(searchResult)}`);
  if (!isolation.skillsHidden || !isolation.pluginHeadingVisible || !isolation.appearanceStillPresent) problems.push(`page isolation: ${JSON.stringify(isolation)}`);
  if (problems.length) throw new Error(`Skills UI regression: ${problems.join('; ')}`);

  console.log(JSON.stringify({ nativeHeading, regression, searchResult, isolation }));
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
