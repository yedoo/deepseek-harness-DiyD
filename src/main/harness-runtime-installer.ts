import { spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { valid } from "semver";
import {
  inspectHarnessInstallation,
  type HarnessInstallation,
} from "./config";

const HARNESS_PACKAGE = "@deepseek-ai/dsh";

export type HarnessInstallStage =
  | "preparing"
  | "reusing"
  | "downloading"
  | "verifying";
export type HarnessInstallStatus = (stage: HarnessInstallStage) => void;

export interface HarnessPackageInstaller {
  install(
    prefix: string,
    version: string,
    onStatus: HarnessInstallStatus,
    seedRoot?: string,
  ): Promise<void>;
}

export interface PreparedHarnessRuntime {
  version: string;
  stagingRoot: string;
}

export interface ActivatedHarnessRuntime {
  version: string;
  installation: HarnessInstallation;
  hadPrevious: boolean;
}

export class HarnessRuntimeInstaller {
  readonly currentRoot: string;
  private readonly stagingRoot: string;
  private readonly previousRoot: string;
  private readonly failedRoot: string;

  constructor(
    readonly runtimeRoot: string,
    private readonly packageInstaller: HarnessPackageInstaller,
  ) {
    this.currentRoot = path.join(runtimeRoot, "current");
    this.stagingRoot = path.join(runtimeRoot, "staging");
    this.previousRoot = path.join(runtimeRoot, "previous");
    this.failedRoot = path.join(runtimeRoot, "failed");
  }

  currentInstallation(): HarnessInstallation | undefined {
    return inspectHarnessInstallation(this.currentRoot);
  }

  preparedRuntime(expectedVersion: string): PreparedHarnessRuntime {
    const installation = inspectHarnessInstallation(this.stagingRoot);
    if (!installation) {
      throw new Error("没有找到已准备的 Harness 更新");
    }
    const installedVersion = readPackageVersion(installation.packagePath);
    if (installedVersion !== expectedVersion) {
      throw new Error(
        `已准备版本校验失败：期望 ${expectedVersion}，实际 ${installedVersion}`,
      );
    }
    return { version: installedVersion, stagingRoot: this.stagingRoot };
  }

  activeRuntime(expectedVersion: string): ActivatedHarnessRuntime {
    const installation = this.currentInstallation();
    if (!installation) {
      throw new Error("没有找到已切换的 Harness 更新");
    }
    const installedVersion = readPackageVersion(installation.packagePath);
    if (installedVersion !== expectedVersion) {
      throw new Error(
        `已切换版本校验失败：期望 ${expectedVersion}，实际 ${installedVersion}`,
      );
    }
    return {
      version: installedVersion,
      installation,
      hadPrevious: existsSync(this.previousRoot),
    };
  }

  recoverFailedRuntime(expectedVersion: string): PreparedHarnessRuntime {
    const installation = inspectHarnessInstallation(this.failedRoot);
    if (!installation) {
      throw new Error("没有找到可重试的 Harness 运行时");
    }
    const installedVersion = readPackageVersion(installation.packagePath);
    if (installedVersion !== expectedVersion) {
      throw new Error(
        `失败版本校验失败：期望 ${expectedVersion}，实际 ${installedVersion}`,
      );
    }
    rmSync(this.stagingRoot, { recursive: true, force: true });
    renameSync(this.failedRoot, this.stagingRoot);
    return { version: installedVersion, stagingRoot: this.stagingRoot };
  }

  async prepare(
    version: string,
    onStatus: HarnessInstallStatus = () => undefined,
  ): Promise<PreparedHarnessRuntime> {
    if (valid(version) === null) {
      throw new Error("Harness 更新版本号无效");
    }

    onStatus("preparing");
    mkdirSync(this.runtimeRoot, { recursive: true });
    rmSync(this.stagingRoot, { recursive: true, force: true });
    mkdirSync(this.stagingRoot, { recursive: true });
    const seedRoot = this.currentInstallation() ? this.currentRoot : undefined;
    if (seedRoot) {
      onStatus("reusing");
    }

    try {
      await this.packageInstaller.install(this.stagingRoot, version, onStatus, seedRoot);
      onStatus("verifying");
      const installation = inspectHarnessInstallation(this.stagingRoot);
      if (!installation) {
        throw new Error("安装完成，但没有找到 Harness 启动入口");
      }
      const installedVersion = readPackageVersion(installation.packagePath);
      if (installedVersion !== version) {
        throw new Error(`安装版本校验失败：期望 ${version}，实际 ${installedVersion}`);
      }
      return { version, stagingRoot: this.stagingRoot };
    } catch (error) {
      rmSync(this.stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  activate(prepared: PreparedHarnessRuntime): ActivatedHarnessRuntime {
    if (path.resolve(prepared.stagingRoot) !== path.resolve(this.stagingRoot)) {
      throw new Error("Harness staging 目录不属于当前更新任务");
    }

    rmSync(this.previousRoot, { recursive: true, force: true });
    const hadPrevious = existsSync(this.currentRoot);
    try {
      if (hadPrevious) {
        renameSync(this.currentRoot, this.previousRoot);
      }
      renameSync(this.stagingRoot, this.currentRoot);
    } catch (error) {
      if (!existsSync(this.currentRoot) && existsSync(this.previousRoot)) {
        renameSync(this.previousRoot, this.currentRoot);
      }
      rmSync(this.stagingRoot, { recursive: true, force: true });
      throw new Error(
        `切换 Harness 新版本失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const installation = inspectHarnessInstallation(this.currentRoot);
    if (!installation) {
      this.rollback();
      throw new Error("切换完成，但新 Harness 运行时无效，已自动回滚");
    }
    return { version: prepared.version, installation, hadPrevious };
  }

  commit(): void {
    rmSync(this.previousRoot, { recursive: true, force: true });
    rmSync(this.failedRoot, { recursive: true, force: true });
  }

  rollback(): HarnessInstallation | undefined {
    rmSync(this.failedRoot, { recursive: true, force: true });
    if (existsSync(this.currentRoot)) {
      renameSync(this.currentRoot, this.failedRoot);
    }
    if (existsSync(this.previousRoot)) {
      renameSync(this.previousRoot, this.currentRoot);
    }
    return this.currentInstallation();
  }
}

export interface ArboristHarnessPackageInstallerOptions {
  nodeExecutable: string;
  workerPath: string;
  logsRoot: string;
  runElectronAsNode?: boolean;
}

export class ArboristHarnessPackageInstaller implements HarnessPackageInstaller {
  constructor(private readonly options: ArboristHarnessPackageInstallerOptions) {}

  install(
    prefix: string,
    version: string,
    onStatus: HarnessInstallStatus,
    seedRoot?: string,
  ): Promise<void> {
    mkdirSync(this.options.logsRoot, { recursive: true });
    const logPath = path.join(this.options.logsRoot, "harness-update.log");
    const cachePath = path.join(path.dirname(this.options.logsRoot), "npm-cache");
    const log = createWriteStream(logPath, { flags: "a" });
    log.write(`\n[${new Date().toISOString()}] Installing ${HARNESS_PACKAGE}@${version}\n`);

    return new Promise((resolve, reject) => {
      const child = spawn(
        this.options.nodeExecutable,
        [
          this.options.workerPath,
          prefix,
          version,
          cachePath,
          ...(seedRoot ? [seedRoot] : []),
        ],
        {
          cwd: prefix,
          env: {
            ...process.env,
            npm_config_update_notifier: "false",
            npm_config_audit: "false",
            npm_config_fund: "false",
            npm_config_cache: cachePath,
            ...(this.options.runElectronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );

      let stdoutBuffer = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        log.write(chunk);
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim() === "@dsh-update-stage:downloading") {
            onStatus("downloading");
          }
        }
      });
      child.stderr?.pipe(log, { end: false });
      let settled = false;
      let timeout: NodeJS.Timeout;
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        log.end(
          `[${new Date().toISOString()}] ${error ? `Failed: ${error.message}` : "Completed"}\n`,
        );
        error ? reject(error) : resolve();
      };
      timeout = setTimeout(() => {
        void terminateProcessTree(child.pid).finally(() => {
          finish(new Error(`Harness 更新超时，请查看日志：${logPath}`));
        });
      }, 30 * 60 * 1_000);

      child.once("error", (error) => finish(error));
      child.once("exit", (code) => {
        if (code === 0) {
          finish();
          return;
        }
        finish(new Error(`Harness 安装失败（退出码 ${String(code)}），请查看日志：${logPath}`));
      });
    });
  }
}

async function terminateProcessTree(pid: number | undefined): Promise<void> {
  if (pid === undefined) {
    return;
  }
  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The installer already exited.
    }
    return;
  }
  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolve());
    killer.once("exit", () => resolve());
  });
}

function readPackageVersion(packagePath: string): string {
  const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
  if (typeof metadata.version !== "string" || valid(metadata.version) === null) {
    throw new Error("Harness 安装包缺少有效版本号");
  }
  return metadata.version;
}
