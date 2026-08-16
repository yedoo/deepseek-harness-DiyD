import { autoUpdater } from "electron-updater";
import type {
  DesktopDownloadProgress,
  DesktopUpdateTransport,
} from "./desktop-updater";

export class ElectronUpdateTransport implements DesktopUpdateTransport {
  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = console;
  }

  async check(): Promise<{ version: string; size?: number } | null> {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable !== true) {
      return null;
    }
    const size = result.updateInfo.files.find((file) => file.size !== undefined)?.size;
    return {
      version: result.updateInfo.version,
      ...(size === undefined ? {} : { size }),
    };
  }

  async download(onProgress: (progress: DesktopDownloadProgress) => void): Promise<void> {
    const handleProgress = (progress: {
      percent: number;
      transferred?: number;
      total?: number;
      bytesPerSecond?: number;
    }): void => {
      onProgress({
        percent: progress.percent,
        ...(progress.transferred === undefined
          ? {}
          : { transferredBytes: progress.transferred }),
        ...(progress.total === undefined ? {} : { totalBytes: progress.total }),
        ...(progress.bytesPerSecond === undefined
          ? {}
          : { bytesPerSecond: progress.bytesPerSecond }),
      });
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
