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
import { HarnessService, isHarnessHealthy } from "./harness-service";
import { classifyNavigation } from "./navigation";
import { chooseStartupStrategy } from "./startup-strategy";

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
      settingsStore?.save({ harnessRoot });
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
}
