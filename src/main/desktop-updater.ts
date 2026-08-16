export interface DesktopUpdateRelease {
  version: string;
  size?: number;
}

export interface DesktopDownloadProgress {
  percent: number;
  transferredBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
}

export interface DesktopUpdaterOptions {
  autoDownload?: boolean;
}

export type DesktopUpdateState =
  | { phase: "idle"; currentVersion: string }
  | { phase: "checking"; currentVersion: string }
  | { phase: "up-to-date"; currentVersion: string }
  | {
      phase: "available";
      currentVersion: string;
      version: string;
      totalBytes?: number;
    }
  | {
      phase: "downloading";
      currentVersion: string;
      version: string;
      percent: number;
      transferredBytes?: number;
      totalBytes?: number;
      bytesPerSecond?: number;
    }
  | {
      phase: "downloaded";
      currentVersion: string;
      version: string;
      totalBytes?: number;
    }
  | {
      phase: "error";
      currentVersion: string;
      message: string;
      operation: "check" | "download";
      version?: string;
      totalBytes?: number;
    };

export interface DesktopUpdateTransport {
  check(): Promise<DesktopUpdateRelease | null>;
  download(onProgress: (progress: DesktopDownloadProgress) => void): Promise<void>;
  install(): void;
}

export type DesktopUpdateListener = (state: DesktopUpdateState) => void;

export class DesktopUpdater {
  private state: DesktopUpdateState;
  private readonly listeners = new Set<DesktopUpdateListener>();
  private checkInFlight: Promise<DesktopUpdateState> | undefined;
  private downloadInFlight: Promise<DesktopUpdateState> | undefined;

  constructor(
    private readonly currentVersion: string,
    private readonly transport: DesktopUpdateTransport,
    private readonly options: DesktopUpdaterOptions = {},
  ) {
    this.state = { phase: "idle", currentVersion };
  }

  getState(): DesktopUpdateState {
    return this.state;
  }

  subscribe(listener: DesktopUpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  check(): Promise<DesktopUpdateState> {
    if (this.state.phase === "downloading" || this.state.phase === "downloaded") {
      return Promise.resolve(this.state);
    }
    if (this.checkInFlight !== undefined) {
      return this.checkInFlight;
    }
    const check = this.performCheck();
    this.checkInFlight = check;
    void check.finally(() => {
      if (this.checkInFlight === check) {
        this.checkInFlight = undefined;
      }
    });
    return check;
  }

  private async performCheck(): Promise<DesktopUpdateState> {
    this.publish({ phase: "checking", currentVersion: this.currentVersion });
    try {
      const release = await this.transport.check();
      const state: DesktopUpdateState = release === null
        ? { phase: "up-to-date", currentVersion: this.currentVersion }
        : {
            phase: "available",
            currentVersion: this.currentVersion,
            version: release.version,
            ...(release.size === undefined ? {} : { totalBytes: release.size }),
          };
      this.publish(state);
      if (state.phase === "available" && this.options.autoDownload === true) {
        void this.download();
      }
      return state;
    } catch (error) {
      const state: DesktopUpdateState = {
        phase: "error",
        currentVersion: this.currentVersion,
        message: error instanceof Error ? error.message : String(error),
        operation: "check",
      };
      this.publish(state);
      return state;
    }
  }

  download(): Promise<DesktopUpdateState> {
    if (this.downloadInFlight) {
      return this.downloadInFlight;
    }
    const downloadableState = this.state.phase === "available" ||
      (this.state.phase === "error" && this.state.operation === "download")
      ? this.state
      : undefined;
    const version = downloadableState?.version;
    if (!version) {
      return Promise.resolve(this.state);
    }
    const download = this.performDownload(version, downloadableState.totalBytes);
    this.downloadInFlight = download;
    void download.finally(() => {
      if (this.downloadInFlight === download) {
        this.downloadInFlight = undefined;
      }
    });
    return download;
  }

  private async performDownload(
    version: string,
    knownTotalBytes?: number,
  ): Promise<DesktopUpdateState> {
    this.publish({
      phase: "downloading",
      currentVersion: this.currentVersion,
      version,
      percent: 0,
      ...(knownTotalBytes === undefined ? {} : { totalBytes: knownTotalBytes }),
    });
    let lastProgress: DesktopDownloadProgress | undefined;
    try {
      await this.transport.download((progress) => {
        lastProgress = progress;
        const totalBytes = progress.totalBytes ?? knownTotalBytes;
        this.publish({
          phase: "downloading",
          currentVersion: this.currentVersion,
          version,
          percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
          ...(progress.transferredBytes === undefined
            ? {}
            : { transferredBytes: progress.transferredBytes }),
          ...(totalBytes === undefined ? {} : { totalBytes }),
          ...(progress.bytesPerSecond === undefined
            ? {}
            : { bytesPerSecond: progress.bytesPerSecond }),
        });
      });
      const totalBytes = lastProgress?.totalBytes ?? knownTotalBytes;
      const state: DesktopUpdateState = {
        phase: "downloaded",
        currentVersion: this.currentVersion,
        version,
        ...(totalBytes === undefined ? {} : { totalBytes }),
      };
      this.publish(state);
      return state;
    } catch (error) {
      const totalBytes = lastProgress?.totalBytes ?? knownTotalBytes;
      const state: DesktopUpdateState = {
        phase: "error",
        currentVersion: this.currentVersion,
        version,
        message: error instanceof Error ? error.message : String(error),
        operation: "download",
        ...(totalBytes === undefined ? {} : { totalBytes }),
      };
      this.publish(state);
      return state;
    }
  }

  install(): boolean {
    if (this.state.phase !== "downloaded") {
      return false;
    }
    this.transport.install();
    return true;
  }

  private publish(state: DesktopUpdateState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
