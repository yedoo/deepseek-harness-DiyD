import { readFileSync } from "node:fs";
import { gt, valid } from "semver";
import { inspectHarnessInstallation } from "./config";
import type { HarnessInstallStage } from "./harness-runtime-installer";

export type HarnessUpdateStage = HarnessInstallStage;

export type HarnessUpdateState =
  | { phase: "idle"; currentVersion: string }
  | { phase: "checking"; currentVersion: string }
  | { phase: "up-to-date"; currentVersion: string }
  | { phase: "available"; currentVersion: string; version: string }
  | { phase: "ready-to-restart"; currentVersion: string; version: string }
  | {
      phase: "installing";
      currentVersion: string;
      version: string;
      stage: HarnessUpdateStage;
    }
  | {
      phase: "error";
      currentVersion: string;
      message: string;
      operation: "check" | "install";
      version?: string;
    };

export type HarnessVersionSource = () => Promise<string>;
export type HarnessVersionInstaller = (
  version: string,
  onStage: (stage: HarnessUpdateStage) => void,
) => Promise<void>;
export type HarnessUpdateListener = (state: HarnessUpdateState) => void;

const HARNESS_LATEST_URL = "https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest";

export function readHarnessVersion(harnessRoot: string): string {
  const installation = inspectHarnessInstallation(harnessRoot);
  if (!installation) {
    throw new Error("没有找到有效的 Harness 安装");
  }
  const metadata = JSON.parse(readFileSync(installation.packagePath, "utf8")) as {
    version?: unknown;
  };
  if (typeof metadata.version !== "string" || valid(metadata.version) === null) {
    throw new Error("Harness CLI package.json 缺少有效版本号");
  }
  return metadata.version;
}

export async function fetchLatestHarnessVersion(
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(HARNESS_LATEST_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Harness 版本检查失败（HTTP ${response.status}）`);
    }
    const metadata = await response.json() as { version?: unknown };
    if (typeof metadata.version !== "string") {
      throw new Error("Harness 版本响应缺少 version");
    }
    return metadata.version;
  } finally {
    clearTimeout(timeout);
  }
}

export class HarnessUpdater {
  private state: HarnessUpdateState;
  private readonly listeners = new Set<HarnessUpdateListener>();
  private checkInFlight: Promise<HarnessUpdateState> | undefined;
  private installInFlight: Promise<HarnessUpdateState> | undefined;

  constructor(
    private currentVersion: string,
    private readonly latestVersion: HarnessVersionSource,
    private readonly installVersion?: HarnessVersionInstaller,
  ) {
    this.state = { phase: "idle", currentVersion };
  }

  getState(): HarnessUpdateState {
    return this.state;
  }

  subscribe(listener: HarnessUpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async check(): Promise<HarnessUpdateState> {
    if (this.state.phase === "installing" || this.state.phase === "ready-to-restart") {
      return this.state;
    }
    if (this.checkInFlight) {
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

  private async performCheck(): Promise<HarnessUpdateState> {
    this.publish({ phase: "checking", currentVersion: this.currentVersion });
    try {
      const latest = await this.latestVersion();
      if (valid(this.currentVersion) === null || valid(latest) === null) {
        throw new Error("Harness 返回了无效版本号");
      }
      const state: HarnessUpdateState = gt(latest, this.currentVersion)
        ? { phase: "available", currentVersion: this.currentVersion, version: latest }
        : { phase: "up-to-date", currentVersion: this.currentVersion };
      this.publish(state);
      return state;
    } catch (error) {
      const state: HarnessUpdateState = {
        phase: "error",
        currentVersion: this.currentVersion,
        message: error instanceof Error ? error.message : String(error),
        operation: "check",
      };
      this.publish(state);
      return state;
    }
  }

  install(): Promise<HarnessUpdateState> {
    if (this.installInFlight) {
      return this.installInFlight;
    }
    const version = this.installableVersion();
    if (!version) {
      return Promise.resolve(this.state);
    }
    const install = this.performInstall(version);
    this.installInFlight = install;
    void install.finally(() => {
      if (this.installInFlight === install) {
        this.installInFlight = undefined;
      }
    });
    return install;
  }

  private async performInstall(version: string): Promise<HarnessUpdateState> {
    if (!this.installVersion) {
      const state: HarnessUpdateState = {
        phase: "error",
        currentVersion: this.currentVersion,
        version,
        message: "当前客户端不包含 Harness 安装运行时",
        operation: "install",
      };
      this.publish(state);
      return state;
    }

    const publishStage = (stage: HarnessUpdateStage): void => {
      this.publish({
        phase: "installing",
        currentVersion: this.currentVersion,
        version,
        stage,
      });
    };
    publishStage("preparing");
    try {
      await this.installVersion(version, publishStage);
      const state: HarnessUpdateState = {
        phase: "ready-to-restart",
        currentVersion: this.currentVersion,
        version,
      };
      this.publish(state);
      return state;
    } catch (error) {
      const state: HarnessUpdateState = {
        phase: "error",
        currentVersion: this.currentVersion,
        version,
        message: error instanceof Error ? error.message : String(error),
        operation: "install",
      };
      this.publish(state);
      return state;
    }
  }

  private installableVersion(): string | undefined {
    if (this.state.phase === "available") {
      return this.state.version;
    }
    if (this.state.phase === "error" && this.state.operation === "install") {
      return this.state.version;
    }
    return undefined;
  }

  private publish(state: HarnessUpdateState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
