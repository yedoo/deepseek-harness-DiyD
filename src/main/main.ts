import path from "node:path";
import { mkdirSync } from "node:fs";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} from "electron";
import { resolveHarnessRoot } from "./config";
import { DesktopSettingsStore } from "./desktop-settings";
import {
  DesktopUpdater,
  type DesktopUpdateState,
} from "./desktop-updater";
import { ElectronUpdateTransport } from "./electron-update-transport";
import { HarnessService, isHarnessHealthy } from "./harness-service";
import {
  fetchLatestHarnessVersion,
  HarnessUpdater,
  type HarnessUpdateState,
  readHarnessVersion,
} from "./harness-updater";
import { classifyNavigation } from "./navigation";
import { RunningHarnessLocator } from "./running-harness-locator";
import { chooseStartupStrategy } from "./startup-strategy";
import {
  bringWorkspaceDialogToForeground,
  prepareForWorkspaceDialog,
  WorkspaceDialogForegroundWatcher,
} from "./workspace-dialog-foreground";

interface DesktopStatus {
  phase: "starting" | "error";
  message: string;
  details?: string;
  canSelectHarness?: boolean;
}

let mainWindow: BrowserWindow | undefined;
let harnessService: HarnessService | undefined;
let harnessOrigin: string | undefined;
let starting = false;
let cleanupStarted = false;
let cleanupFinished = false;
let settingsStore: DesktopSettingsStore | undefined;
let desktopUpdater: DesktopUpdater | undefined;
let harnessUpdater: HarnessUpdater | undefined;
let harnessUpdateUnsubscribe: (() => void) | undefined;
let desktopInitialCheckTimer: NodeJS.Timeout | undefined;
let desktopCheckInterval: NodeJS.Timeout | undefined;
let harnessInitialCheckTimer: NodeJS.Timeout | undefined;
let harnessCheckInterval: NodeJS.Timeout | undefined;
const UPDATE_CHECK_DELAY_MS = 2_500;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const HARNESS_PACKAGE_URL = "https://www.npmjs.com/package/@deepseek-ai/dsh";
const runningHarnessLocator = new RunningHarnessLocator();
const workspaceDialogWatcher = new WorkspaceDialogForegroundWatcher(
  bringWorkspaceDialogToForeground,
);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

app.on("before-quit", (event) => {
  if (cleanupFinished) {
    return;
  }
  event.preventDefault();
  if (cleanupStarted) {
    return;
  }
  cleanupStarted = true;
  workspaceDialogWatcher.dispose();
  disposeUpdateChecks();
  void (harnessService?.stop() ?? Promise.resolve()).finally(() => {
    cleanupFinished = true;
    app.quit();
  });
});

app.on("window-all-closed", () => app.quit());

void app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    return;
  }
  app.setAppUserModelId("com.yedoo.deepseek-harness-desktop");
  Menu.setApplicationMenu(null);
  settingsStore = new DesktopSettingsStore(path.join(app.getPath("userData"), "settings.json"));
  registerDesktopIpc();
  mainWindow = createMainWindow();
  initializeDesktopUpdater();
  await startHarness();
});

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    roundedCorners: true,
    backgroundColor: "#f7f8fa",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("maximize", () => sendWindowState(window));
  window.on("unmaximize", () => sendWindowState(window));

  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, harnessOrigin) === "external") {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const decision = classifyNavigation(url, harnessOrigin);
    if (decision === "allow") {
      return;
    }
    event.preventDefault();
    if (decision === "external") {
      void shell.openExternal(url);
    }
  });

  return window;
}

async function startHarness(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed() || starting) {
    return;
  }
  starting = true;
  harnessOrigin = undefined;
  resetHarnessUpdater();
  await showLoading({ phase: "starting", message: "正在准备桌面工作台…" });

  try {
    sendStatus({ phase: "starting", message: "正在检查已有的 Harness 服务…" });
    const strategy = await chooseStartupStrategy({
      preferredUrl: process.env.DSH_SERVER_URL,
      isHealthy: isHarnessHealthy,
      resolveHarnessInstallation: () => {
        const harnessRoot = resolveHarnessRoot({
          explicitRoot: process.env.DSH_INSTALL_ROOT ?? settingsStore?.load().harnessRoot,
          appPath: app.getAppPath(),
          cwd: process.cwd(),
          executablePath: process.execPath,
          resourcesPath: process.resourcesPath,
        });
        return {
          harnessRoot,
          dataRoot: path.resolve(
            process.env.DSH_HOME ?? path.join(path.dirname(harnessRoot), "data"),
          ),
        };
      },
    });

    if (strategy.kind === "connect") {
      harnessService = undefined;
      harnessOrigin = new URL(strategy.url).origin;
      await mainWindow.loadURL(strategy.url);
      const harnessRoot = await runningHarnessLocator.find() ?? tryResolveHarnessRoot();
      if (harnessRoot) {
        settingsStore?.update({ harnessRoot });
        initializeHarnessUpdater(harnessRoot);
      }
      return;
    }

    const { harnessRoot, dataRoot } = strategy.installation;
    const logsRoot = path.join(app.getPath("userData"), "logs");
    harnessService = new HarnessService({
      harnessRoot,
      dataRoot,
      logsRoot,
      nodeExecutable: process.env.DSH_NODE_EXECUTABLE ?? process.execPath,
      runElectronAsNode: process.env.DSH_NODE_EXECUTABLE === undefined,
      preferredUrl: process.env.DSH_SERVER_URL,
    });
    harnessService.once("unexpected-exit", (error: Error) => {
      void showLoading({
        phase: "error",
        message: "Harness 服务已停止",
        details: error.message,
      });
    });

    const connection = await harnessService.start((message) => {
      sendStatus({ phase: "starting", message });
    });
    harnessOrigin = new URL(connection.url).origin;
    await mainWindow.loadURL(connection.url);
    initializeHarnessUpdater(harnessRoot);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    await showLoading({
      phase: "error",
      message: "桌面工作台启动失败",
      details,
      canSelectHarness: details.includes("DeepSeek Harness was not found"),
    });
  } finally {
    starting = false;
  }
}

async function showLoading(status: DesktopStatus): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  await mainWindow.loadFile(path.join(__dirname, "..", "renderer", "loading.html"));
  sendStatus(status);
}

function sendStatus(status: DesktopStatus): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("desktop:status", status);
}

function sendWindowState(window: BrowserWindow): void {
  window.webContents.send("desktop:window-state", { maximized: window.isMaximized() });
}

function initializeDesktopUpdater(): void {
  if (!app.isPackaged) {
    return;
  }
  desktopUpdater = new DesktopUpdater(app.getVersion(), new ElectronUpdateTransport());
  desktopUpdater.subscribe(() => sendDesktopUpdateState());
  desktopInitialCheckTimer = setTimeout(() => void desktopUpdater?.check(), UPDATE_CHECK_DELAY_MS);
  desktopCheckInterval = setInterval(
    () => void desktopUpdater?.check(),
    UPDATE_CHECK_INTERVAL_MS,
  );
}

function initializeHarnessUpdater(harnessRoot: string): void {
  resetHarnessUpdater();
  try {
    const currentVersion = readHarnessVersion(harnessRoot);
    harnessUpdater = new HarnessUpdater(currentVersion, fetchLatestHarnessVersion);
    harnessUpdateUnsubscribe = harnessUpdater.subscribe(() => sendHarnessUpdateState());
    harnessInitialCheckTimer = setTimeout(
      () => void harnessUpdater?.check(),
      UPDATE_CHECK_DELAY_MS,
    );
    harnessCheckInterval = setInterval(
      () => void harnessUpdater?.check(),
      UPDATE_CHECK_INTERVAL_MS,
    );
  } catch (error) {
    console.warn("Unable to initialize Harness update checks", error);
  }
}

function resetHarnessUpdater(notifyRenderer = true): void {
  harnessUpdateUnsubscribe?.();
  harnessUpdateUnsubscribe = undefined;
  if (harnessInitialCheckTimer) {
    clearTimeout(harnessInitialCheckTimer);
    harnessInitialCheckTimer = undefined;
  }
  if (harnessCheckInterval) {
    clearInterval(harnessCheckInterval);
    harnessCheckInterval = undefined;
  }
  harnessUpdater = undefined;
  if (notifyRenderer) {
    sendHarnessUpdateState();
  }
}

function tryResolveHarnessRoot(): string | undefined {
  try {
    return resolveHarnessRoot({
      explicitRoot: process.env.DSH_INSTALL_ROOT ?? settingsStore?.load().harnessRoot,
      appPath: app.getAppPath(),
      cwd: process.cwd(),
      executablePath: process.execPath,
      resourcesPath: process.resourcesPath,
    });
  } catch {
    return undefined;
  }
}

function desktopStateForRenderer(): DesktopUpdateState & {
  supported: boolean;
  skipped?: boolean;
} {
  const state = desktopUpdater?.getState() ?? {
    phase: "idle" as const,
    currentVersion: app.getVersion(),
  };
  return {
    ...state,
    supported: desktopUpdater !== undefined,
    ...(state.phase === "available"
      ? { skipped: settingsStore?.load().skippedDesktopVersion === state.version }
      : {}),
  };
}

function harnessStateForRenderer(): (HarnessUpdateState & {
  supported: boolean;
  skipped?: boolean;
}) | { phase: "idle"; currentVersion: string; supported: false } {
  const state = harnessUpdater?.getState();
  if (!state) {
    return { phase: "idle", currentVersion: "", supported: false };
  }
  return {
    ...state,
    supported: true,
    ...(state.phase === "available"
      ? { skipped: settingsStore?.load().skippedHarnessVersion === state.version }
      : {}),
  };
}

function getUpdateStates(): {
  desktop: ReturnType<typeof desktopStateForRenderer>;
  harness: ReturnType<typeof harnessStateForRenderer>;
} {
  return {
    desktop: desktopStateForRenderer(),
    harness: harnessStateForRenderer(),
  };
}

function sendDesktopUpdateState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("desktop:update-state", desktopStateForRenderer());
}

function sendHarnessUpdateState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("desktop:harness-update-state", harnessStateForRenderer());
}

async function checkHarnessUpdates(): Promise<ReturnType<typeof harnessStateForRenderer>> {
  if (!harnessUpdater) {
    const harnessRoot = await runningHarnessLocator.find() ?? tryResolveHarnessRoot();
    if (harnessRoot) {
      settingsStore?.update({ harnessRoot });
      initializeHarnessUpdater(harnessRoot);
    }
  }
  await harnessUpdater?.check();
  return harnessStateForRenderer();
}

async function showHarnessUpdatePrompt(
  state: Extract<HarnessUpdateState, { phase: "available" }>,
): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "DeepSeek Harness 更新",
    message: `官方 Harness v${state.version} 已发布`,
    detail: `当前本地版本为 v${state.currentVersion}。第一版仅提醒，不会覆盖你的源码目录。`,
    buttons: ["打开官方 npm 页面", "跳过此版本", "取消"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (result.response === 0) {
    await shell.openExternal(HARNESS_PACKAGE_URL);
  } else if (result.response === 1) {
    settingsStore?.update({ skippedHarnessVersion: state.version });
    sendHarnessUpdateState();
  }
}

async function showDesktopUpdatesUnavailable(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "检查更新",
    message: "开发模式不使用自动更新",
    detail: "安装版会从 GitHub Releases 检查、下载并安装桌面客户端更新。",
    buttons: ["知道了"],
    noLink: true,
  });
}

function disposeUpdateChecks(): void {
  if (desktopInitialCheckTimer) {
    clearTimeout(desktopInitialCheckTimer);
  }
  if (desktopCheckInterval) {
    clearInterval(desktopCheckInterval);
  }
  resetHarnessUpdater(false);
}

function registerDesktopIpc(): void {
  ipcMain.on("desktop:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on("desktop:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    window.isMaximized() ? window.unmaximize() : window.maximize();
  });
  ipcMain.on("desktop:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("desktop:get-window-state", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return { maximized: window?.isMaximized() ?? false };
  });
  ipcMain.handle("desktop:get-meta", () => ({ version: app.getVersion() }));
  ipcMain.on("desktop:retry", () => {
    void (harnessService?.stop() ?? Promise.resolve()).finally(() => {
      harnessService = undefined;
      void startHarness();
    });
  });
  ipcMain.on("desktop:workspace-interaction", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window !== mainWindow || !window.isFocused()) {
      return;
    }
    prepareForWorkspaceDialog();
    workspaceDialogWatcher.arm();
  });
  ipcMain.handle("desktop:select-harness", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }
    const result = await dialog.showOpenDialog(window, {
      title: "选择 DeepSeek Harness 目录",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length !== 1) {
      return false;
    }
    try {
      const harnessRoot = resolveHarnessRoot({
        explicitRoot: result.filePaths[0],
        appPath: app.getAppPath(),
        cwd: process.cwd(),
        executablePath: process.execPath,
        resourcesPath: process.resourcesPath,
      });
      settingsStore?.update({ harnessRoot });
      void (harnessService?.stop() ?? Promise.resolve()).finally(() => {
        harnessService = undefined;
        void startHarness();
      });
      return true;
    } catch (error) {
      sendStatus({
        phase: "error",
        message: "所选目录不是有效的 DeepSeek Harness",
        details: error instanceof Error ? error.message : String(error),
        canSelectHarness: true,
      });
      return false;
    }
  });
  ipcMain.handle("desktop:open-logs", async () => {
    const logsRoot = path.join(app.getPath("userData"), "logs");
    mkdirSync(logsRoot, { recursive: true });
    return shell.openPath(logsRoot);
  });
  ipcMain.handle("desktop:get-update-states", () => getUpdateStates());
  ipcMain.handle("desktop:check-client-update", async () => {
    if (!desktopUpdater) {
      await showDesktopUpdatesUnavailable();
      return getUpdateStates().desktop;
    }
    await desktopUpdater.check();
    return desktopStateForRenderer();
  });
  ipcMain.handle("desktop:check-harness-update", () => checkHarnessUpdates());
  ipcMain.handle("desktop:download-client-update", async () => {
    await desktopUpdater?.download();
    return desktopStateForRenderer();
  });
  ipcMain.handle("desktop:install-client-update", () => desktopUpdater?.install() ?? false);
  ipcMain.handle("desktop:show-harness-update", async () => {
    const state = harnessUpdater?.getState();
    if (state?.phase === "available") {
      await showHarnessUpdatePrompt(state);
    }
    return harnessStateForRenderer();
  });
}
