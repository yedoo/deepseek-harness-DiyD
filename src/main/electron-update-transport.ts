import { autoUpdater } from "electron-updater";
import type { DesktopUpdateTransport } from "./desktop-updater";

export class ElectronUpdateTransport implements DesktopUpdateTransport {
  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = console;
  }

  async check(): Promise<{ version: string } | null> {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable !== true) {
      return null;
    }
    return { version: result.updateInfo.version };
  }

  async download(onProgress: (percent: number) => void): Promise<void> {
    const handleProgress = (progress: { percent: number }): void => {
      onProgress(progress.percent);
    };
    autoUpdater.on("download-progress", handleProgress);
    try {
      await autoUpdater.downloadUpdate();
    } finally {
      autoUpdater.removeListener("download-progress", handleProgress);
    }
  }

  install(): void {
    autoUpdater.quitAndInstall(true, true);
  }
}
