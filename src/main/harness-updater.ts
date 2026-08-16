import { readFileSync } from "node:fs";
import path from "node:path";
import { gt, valid } from "semver";

export type HarnessUpdateState =
  | { phase: "idle"; currentVersion: string }
  | { phase: "checking"; currentVersion: string }
  | { phase: "up-to-date"; currentVersion: string }
  | { phase: "available"; currentVersion: string; version: string }
  | { phase: "error"; currentVersion: string; message: string };

export type HarnessVersionSource = () => Promise<string>;
export type HarnessUpdateListener = (state: HarnessUpdateState) => void;

const HARNESS_LATEST_URL = "https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest";

export function readHarnessVersion(harnessRoot: string): string {
  const packagePath = path.join(harnessRoot, "apps", "cli", "package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
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

  constructor(
    private readonly currentVersion: string,
    private readonly latestVersion: HarnessVersionSource,
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
      };
      this.publish(state);
      return state;
    }
  }

  private publish(state: HarnessUpdateState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
