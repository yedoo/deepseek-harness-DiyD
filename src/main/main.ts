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
import {
  inspectHarnessInstallation,
  resolveHarnessInstallation,
  type HarnessInstallation,
} from "./config";
import { DesktopSettingsStore } from "./desktop-settings";
import {
  DesktopUpdater,
  type DesktopUpdateState,
} from "./desktop-updater";
import { ElectronUpdateTransport } from "./electron-update-transport";
import { HarnessService, isHarnessHealthy } from "./harness-service";
import { HarnessUpdateCoordinator } from "./harness-update-coordinator";
import { HarnessUpdateProbe } from "./harness-update-probe";
import { HarnessUpdateTransactionStore } from "./harness-update-transaction";
import {
  fetchLatestHarnessVersion,
  HarnessUpdater,
  type HarnessUpdateState,
  type HarnessUpdateStage,
  readHarnessVersion,
} from "./harness-updater";
import {
  HarnessRuntimeInstaller,
  ArboristHarnessPackageInstaller,
} from "./harness-runtime-installer";
import { classifyNavigation } from "./navigation";
import {
  PluginMarketService,
  ProcessPluginPackageInstaller,
} from "./plugin-market";
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
let harnessRuntimeInstaller: HarnessRuntimeInstaller | undefined;
let harnessUpdateCoordinator: HarnessUpdateCoordinator | undefined;
let pluginMarketService: PluginMarketService | undefined;
let activeHarnessInstallation: HarnessInstallation | undefined;
let harnessUpdateUnsubscribe: (() => void) | undefined;
let desktopInitialCheckTimer: NodeJS.Timeout | undefined;
let desktopCheckInterval: NodeJS.Timeout | undefined;
let harnessInitialCheckTimer: NodeJS.Timeout | undefined;
let harnessCheckInterval: NodeJS.Timeout | undefined;
const UPDATE_CHECK_DELAY_MS = 2_500;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
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
  const userDataRoot = app.getPath("userData");
  settingsStore = new DesktopSettingsStore(path.join(userDataRoot, "settings.json"));
  harnessRuntimeInstaller = new HarnessRuntimeInstaller(
    path.join(userDataRoot, "harness-runtime"),
    new ArboristHarnessPackageInstaller({
      nodeExecutable: process.env.DSH_NODE_EXECUTABLE ?? process.execPath,
      workerPath: path.join(__dirname, "harness-package-worker.js"),
      logsRoot: path.join(userDataRoot, "logs"),
      runElectronAsNode: process.env.DSH_NODE_EXECUTABLE === undefined,
    }),
  );
  harnessUpdateCoordinator = new HarnessUpdateCoordinator(
    harnessRuntimeInstaller,
    new HarnessUpdateTransactionStore(
      path.join(userDataRoot, "harness-runtime", "update-transaction.json"),
    ),
    verifyHarnessRuntime,
  );
  const pluginMarketRoot = path.join(userDataRoot, "plugin-market");
  pluginMarketService = new PluginMarketService({
    dataRoot: () => resolveHarnessDataRoot(activeHarnessInstallation ?? tryResolveHarnessInstallation()),
    cacheDirectory: pluginMarketRoot,
    statePath: path.join(pluginMarketRoot, "state.json"),
    catalogCachePath: path.join(pluginMarketRoot, "catalog.json"),
    packageInstaller: new ProcessPluginPackageInstaller({
      nodeExecutable: process.env.DSH_NODE_EXECUTABLE ?? process.execPath,
      workerPath: path.join(__dirname, "plugin-package-worker.js"),
      logsRoot: path.join(userDataRoot, "logs"),
      cachePath: path.join(userDataRoot, "npm-cache"),
      runElectronAsNode: process.env.DSH_NODE_EXECUTABLE === undefined,
    }),
    restartSupported: () => harnessService !== undefined,
  });
  registerDesktopIpc();
  mainWindow = createMainWindow();
  initializeDesktopUpdater();
  await applyPendingHarnessUpdate();
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
    const managedInstallation = preferredManagedInstallation();
    const strategy = await chooseStartupStrategy({
      preferredUrl: process.env.DSH_SERVER_URL,
      preferInstallation: managedInstallation !== undefined,
      isHealthy: isHarnessHealthy,
      resolveHarnessInstallation: () => {
        const installation = managedInstallation ?? resolveConfiguredHarnessInstallation();
        const dataRoot = resolveHarnessDataRoot(installation);
        rememberHarnessInstallation(installation, dataRoot);
        return {
          installation,
          dataRoot,
        };
      },
    });

    if (strategy.kind === "connect") {
      harnessService = undefined;
      harnessOrigin = new URL(strategy.url).origin;
      await mainWindow.loadURL(strategy.url);
      const discoveredRoot = await runningHarnessLocator.find();
      const installation = discoveredRoot
        ? inspectHarnessInstallation(discoveredRoot)
        : tryResolveHarnessInstallation();
      if (installation) {
        const dataRoot = resolveHarnessDataRoot(installation);
        rememberHarnessInstallation(installation, dataRoot);
        activeHarnessInstallation = installation;
        initializeHarnessUpdater(installation);
      }
      return;
    }

    const { installation, dataRoot } = strategy.installation;
    await launchHarnessInstallation(
      installation,
      dataRoot,
      installation.kind !== "managed",
    );
    initializeHarnessUpdater(installation);
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

async function launchHarnessInstallation(
  installation: HarnessInstallation,
  dataRoot: string,
  reuseExisting: boolean,
): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("桌面窗口已经关闭");
  }
  const service = new HarnessService({
    harnessRoot: installation.root,
    cliPath: installation.cliPath,
    dataRoot,
    logsRoot: path.join(app.getPath("userData"), "logs"),
    nodeExecutable: process.env.DSH_NODE_EXECUTABLE ?? process.execPath,
    runElectronAsNode: process.env.DSH_NODE_EXECUTABLE === undefined,
    preferredUrl: process.env.DSH_SERVER_URL,
    reuseExisting,
  });
  service.once("unexpected-exit", (error: Error) => {
    void showLoading({
      phase: "error",
      message: "Harness 服务已停止",
      details: error.message,
    });
  });
  const connection = await service.start((message) => {
    sendStatus({ phase: "starting", message });
  });
  harnessService = service;
  harnessOrigin = new URL(connection.url).origin;
  activeHarnessInstallation = installation;
  rememberHarnessInstallation(installation, dataRoot);
  await mainWindow.loadURL(connection.url);
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
  desktopUpdater = new DesktopUpdater(
    app.getVersion(),
    new ElectronUpdateTransport(),
    { autoDownload: true },
  );
  desktopUpdater.subscribe(() => sendDesktopUpdateState());
  desktopInitialCheckTimer = setTimeout(() => void desktopUpdater?.check(), UPDATE_CHECK_DELAY_MS);
  desktopCheckInterval = setInterval(
    () => void desktopUpdater?.check(),
    UPDATE_CHECK_INTERVAL_MS,
  );
}

function initializeHarnessUpdater(installation: HarnessInstallation): void {
  resetHarnessUpdater();
  try {
    const currentVersion = readHarnessVersion(installation.root);
    harnessUpdater = new HarnessUpdater(
      currentVersion,
      fetchLatestHarnessVersion,
      applyHarnessUpdate,
    );
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

function preferredManagedInstallation(): HarnessInstallation | undefined {
  if (
    process.env.DSH_INSTALL_ROOT ||
    process.env.DSH_SERVER_URL ||
    settingsStore?.load().managedHarnessEnabled === false
  ) {
    return undefined;
  }
  return harnessRuntimeInstaller?.currentInstallation();
}

function resolveConfiguredHarnessInstallation(): HarnessInstallation {
  return resolveHarnessInstallation({
    explicitRoot: process.env.DSH_INSTALL_ROOT ?? settingsStore?.load().harnessRoot,
    appPath: app.getAppPath(),
    cwd: process.cwd(),
    executablePath: process.execPath,
    resourcesPath: process.resourcesPath,
  });
}

function tryResolveHarnessInstallation(): HarnessInstallation | undefined {
  try {
    return preferredManagedInstallation() ?? resolveConfiguredHarnessInstallation();
  } catch {
    return undefined;
  }
}

function resolveHarnessDataRoot(installation?: HarnessInstallation): string {
  const configured = process.env.DSH_HOME ?? settingsStore?.load().dataRoot;
  if (configured) {
    return path.resolve(configured);
  }
  if (installation?.kind === "checkout") {
    return path.resolve(path.join(path.dirname(installation.root), "data"));
  }
  return path.join(app.getPath("userData"), "data");
}

function rememberHarnessInstallation(
  installation: HarnessInstallation,
  dataRoot: string,
): void {
  settingsStore?.update({
    dataRoot,
    ...(installation.kind === "checkout" ? { harnessRoot: installation.root } : {}),
  });
}

async function applyHarnessUpdate(
  version: string,
  onStage: (stage: HarnessUpdateStage) => void,
): Promise<void> {
  if (!harnessUpdateCoordinator) {
    throw new Error("Harness 更新运行时尚未初始化");
  }

  const currentInstallation = activeHarnessInstallation ?? tryResolveHarnessInstallation();
  if (!currentInstallation) {
    throw new Error("没有找到当前 Harness 运行时");
  }
  const currentVersion = readHarnessVersion(currentInstallation.root);
  const dataRoot = resolveHarnessDataRoot(currentInstallation);
  settingsStore?.update({ dataRoot });
  await harnessUpdateCoordinator.prepare(currentVersion, version, onStage);
}

async function applyPendingHarnessUpdate(): Promise<void> {
  const transaction = harnessUpdateCoordinator?.transaction();
  if (!harnessUpdateCoordinator || !transaction || transaction.phase === "failed") {
    return;
  }
  await showLoading({
    phase: "starting",
    message: transaction.phase === "applied"
      ? `正在完成 Harness ${transaction.targetVersion} 更新…`
      : `正在验证 Harness ${transaction.targetVersion}…`,
  });
  const result = await harnessUpdateCoordinator.applyPending();
  if (result.status === "applied") {
    settingsStore?.update({ managedHarnessEnabled: true });
    harnessUpdateCoordinator.acknowledgeApplied();
  }
}

async function verifyHarnessRuntime(installation: HarnessInstallation): Promise<void> {
  const probe = new HarnessUpdateProbe((candidate, startupTimeoutMs) => (
    new HarnessService({
      harnessRoot: candidate.root,
      cliPath: candidate.cliPath,
      dataRoot: resolveHarnessDataRoot(candidate),
      logsRoot: path.join(app.getPath("userData"), "logs"),
      nodeExecutable: process.env.DSH_NODE_EXECUTABLE ?? process.execPath,
      runElectronAsNode: process.env.DSH_NODE_EXECUTABLE === undefined,
      reuseExisting: false,
      startupTimeoutMs,
    })
  ));
  await probe.verify(installation, (message) => {
    sendStatus({ phase: "starting", message: `正在验证更新：${message}` });
  });
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
  const transaction = harnessUpdateCoordinator?.transaction();
  if (transaction) {
    if (transaction.phase === "failed") {
      return {
        phase: "error",
        currentVersion: transaction.currentVersion,
        version: transaction.targetVersion,
        message: transaction.message ?? "新版本启动失败，已恢复原版本",
        operation: "install",
        supported: true,
      };
    }
    return {
      phase: "ready-to-restart",
      currentVersion: transaction.currentVersion,
      version: transaction.targetVersion,
      supported: true,
    };
  }
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
    const discoveredRoot = await runningHarnessLocator.find();
    const installation = discoveredRoot
      ? inspectHarnessInstallation(discoveredRoot)
      : tryResolveHarnessInstallation();
    if (installation) {
      const dataRoot = resolveHarnessDataRoot(installation);
      rememberHarnessInstallation(installation, dataRoot);
      activeHarnessInstallation = installation;
      initializeHarnessUpdater(installation);
    }
  }
  await harnessUpdater?.check();
  return harnessStateForRenderer();
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
      const installation = resolveHarnessInstallation({
        explicitRoot: result.filePaths[0],
        appPath: app.getAppPath(),
        cwd: process.cwd(),
        executablePath: process.execPath,
        resourcesPath: process.resourcesPath,
      });
      settingsStore?.update({
        harnessRoot: installation.root,
        managedHarnessEnabled: false,
      });
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
  ipcMain.handle("desktop:get-plugin-market", (_event, forceRefresh: unknown) => {
    if (!pluginMarketService) {
      throw new Error("插件市场尚未初始化");
    }
    return pluginMarketService.list(forceRefresh === true);
  });
  ipcMain.handle("desktop:install-plugin", (_event, pluginId: unknown) => {
    if (!pluginMarketService || typeof pluginId !== "string") {
      throw new Error("插件安装请求无效");
    }
    return pluginMarketService.install(pluginId);
  });
  ipcMain.handle("desktop:remove-plugin", (_event, pluginId: unknown) => {
    if (!pluginMarketService || typeof pluginId !== "string") {
      throw new Error("插件卸载请求无效");
    }
    return pluginMarketService.remove(pluginId);
  });
  ipcMain.handle("desktop:restart-harness-for-plugins", async () => {
    const service = harnessService;
    if (!service || !pluginMarketService) {
      return false;
    }
    await service.stop();
    harnessService = undefined;
    await startHarness();
    if (!harnessOrigin) {
      return false;
    }
    pluginMarketService.acknowledgeRestart();
    return true;
  });
  ipcMain.handle("desktop:open-plugin-source", async (_event, sourceUrl: unknown) => {
    if (typeof sourceUrl !== "string") {
      return false;
    }
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      return false;
    }
    if (url.protocol !== "https:" || url.hostname.toLocaleLowerCase() !== "github.com") {
      return false;
    }
    await shell.openExternal(url.toString());
    return true;
  });
  ipcMain.handle("desktop:get-update-states", () => getUpdateStates());
  ipcMain.handle("desktop:check-client-update", async () => {
    if (!desktopUpdater) {
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
  ipcMain.handle("desktop:restart-for-harness-update", () => {
    const transaction = harnessUpdateCoordinator?.transaction();
    if (!transaction || transaction.phase === "failed") {
      return false;
    }
    app.relaunch();
    app.quit();
    return true;
  });
  ipcMain.handle("desktop:install-harness-update", async () => {
    if (harnessUpdateCoordinator?.retryFailure()) {
      sendHarnessUpdateState();
      return harnessStateForRenderer();
    }
    if (harnessUpdateCoordinator?.dismissFailure()) {
      await harnessUpdater?.check();
    }
    await harnessUpdater?.install();
    return harnessStateForRenderer();
  });
}
