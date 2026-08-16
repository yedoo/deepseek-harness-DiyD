export type DesktopUpdateState =
  | { phase: "idle"; currentVersion: string }
  | { phase: "checking"; currentVersion: string }
  | { phase: "up-to-date"; currentVersion: string }
  | { phase: "available"; currentVersion: string; version: string }
  | { phase: "downloading"; currentVersion: string; version: string; percent: number }
  | { phase: "downloaded"; currentVersion: string; version: string }
  | { phase: "error"; currentVersion: string; message: string };

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
      };
      this.publish(state);
      return state;
    }
  }

  async download(): Promise<DesktopUpdateState> {
    if (this.state.phase !== "available") {
      return this.state;
    }
    const version = this.state.version;
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
        message: error instanceof Error ? error.message : String(error),
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
