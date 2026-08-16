export type DesktopUpdateState =
  | { phase: "idle"; currentVersion: string }
  | { phase: "checking"; currentVersion: string }
  | { phase: "up-to-date"; currentVersion: string }
  | { phase: "available"; currentVersion: string; version: string }
  | { phase: "downloading"; currentVersion: string; version: string; percent: number }
  | { phase: "downloaded"; currentVersion: string; version: string }
  | {
      phase: "error";
      currentVersion: string;
      message: string;
      operation: "check" | "download";
      version?: string;
    };

export interface DesktopUpdateTransport {
  check(): Promise<{ version: string } | null>;
  download(onProgress: (percent: number) => void): Promise<void>;
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
          };
      this.publish(state);
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
    const version = this.state.phase === "available"
      ? this.state.version
      : this.state.phase === "error" && this.state.operation === "download"
        ? this.state.version
        : undefined;
    if (!version) {
      return Promise.resolve(this.state);
    }
    const download = this.performDownload(version);
    this.downloadInFlight = download;
    void download.finally(() => {
      if (this.downloadInFlight === download) {
        this.downloadInFlight = undefined;
      }
    });
    return download;
  }

  private async performDownload(version: string): Promise<DesktopUpdateState> {
    this.publish({
      phase: "downloading",
      currentVersion: this.currentVersion,
      version,
      percent: 0,
    });
    try {
      await this.transport.download((percent) => {
        this.publish({
          phase: "downloading",
          currentVersion: this.currentVersion,
          version,
          percent: Math.max(0, Math.min(100, Math.round(percent))),
        });
      });
      const state: DesktopUpdateState = {
        phase: "downloaded",
        currentVersion: this.currentVersion,
        version,
      };
      this.publish(state);
      return state;
    } catch (error) {
      const state: DesktopUpdateState = {
        phase: "error",
        currentVersion: this.currentVersion,
        version,
        message: error instanceof Error ? error.message : String(error),
        operation: "download",
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
