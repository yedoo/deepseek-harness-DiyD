import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const CORE_PROFILE_PACKAGES = [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
] as const;

interface ProfileManifest {
  dependencies?: Record<string, string>;
  dsh?: {
    profile?: {
      bundles?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface HarnessProfilePackageSynchronizer {
  synchronize(profileDirectory: string, targetVersion: string): Promise<void>;
}

export interface ProcessHarnessProfilePackageSynchronizerOptions {
  nodeExecutable: string;
  workerPath: string;
  logsRoot: string;
  cachePath: string;
  runElectronAsNode?: boolean;
}

interface ProfileBackup {
  manifest: string;
  nodeModules: string;
  packageLock: string;
  pnpmLock: string;
}

export class HarnessProfileCompatibility {
  constructor(private readonly packages: HarnessProfilePackageSynchronizer) {}

  async verify(
    dataRoot: string,
    targetVersion: string,
    verifyRuntime: () => Promise<void>,
  ): Promise<void> {
    const profileDirectory = path.join(dataRoot, "profiles", "web");
    const manifestPath = path.join(profileDirectory, "package.json");
    const backup = backupPaths(profileDirectory);
    if (existsSync(backup.manifest)) {
      restoreBackup(profileDirectory, backup);
    }
    if (!existsSync(manifestPath)) {
      await verifyRuntime();
      return;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ProfileManifest;
    if (Object.keys(manifest.dependencies ?? {}).length === 0) {
      await verifyRuntime();
      return;
    }

    renameSync(manifestPath, backup.manifest);
    moveIfPresent(path.join(profileDirectory, "node_modules"), backup.nodeModules);
    moveIfPresent(path.join(profileDirectory, "package-lock.json"), backup.packageLock);
    moveIfPresent(path.join(profileDirectory, "pnpm-lock.yaml"), backup.pnpmLock);

    const dependencies = { ...(manifest.dependencies ?? {}) };
    for (const packageName of CORE_PROFILE_PACKAGES) {
      dependencies[packageName] = targetVersion;
    }
    const bundles = Array.from(new Set([
      ...CORE_PROFILE_PACKAGES,
      ...(manifest.dsh?.profile?.bundles ?? []),
    ]));
    const staged: ProfileManifest = {
      ...manifest,
      dependencies,
      dsh: {
        ...manifest.dsh,
        profile: {
          ...manifest.dsh?.profile,
          bundles,
        },
      },
    };
    writeFileSync(manifestPath, `${JSON.stringify(staged, null, 2)}\n`, "utf8");

    try {
      await this.packages.synchronize(profileDirectory, targetVersion);
      await verifyRuntime();
    } catch (error) {
      restoreBackup(profileDirectory, backup);
      throw error;
    }
    removeBackup(backup);
  }
}

export class ProcessHarnessProfilePackageSynchronizer
implements HarnessProfilePackageSynchronizer {
  constructor(private readonly options: ProcessHarnessProfilePackageSynchronizerOptions) {}

  synchronize(profileDirectory: string, targetVersion: string): Promise<void> {
    mkdirSync(this.options.logsRoot, { recursive: true });
    mkdirSync(this.options.cachePath, { recursive: true });
    const logPath = path.join(this.options.logsRoot, "harness-profile-update.log");
    const log = createWriteStream(logPath, { flags: "a" });
    log.write(`\n[${new Date().toISOString()}] Synchronizing profile for ${targetVersion}\n`);

    return new Promise((resolve, reject) => {
      const child = spawn(
        this.options.nodeExecutable,
        [
          this.options.workerPath,
          "synchronize",
          profileDirectory,
          targetVersion,
          this.options.cachePath,
        ],
        {
          cwd: profileDirectory,
          env: {
            ...process.env,
            npm_config_update_notifier: "false",
            npm_config_audit: "false",
            npm_config_fund: "false",
            npm_config_cache: this.options.cachePath,
            ...(this.options.runElectronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      child.stdout?.pipe(log, { end: false });
      child.stderr?.pipe(log, { end: false });
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        log.end(`[${new Date().toISOString()}] ${error ? `Failed: ${error.message}` : "Completed"}\n`);
        error ? reject(error) : resolve();
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error(`插件兼容依赖更新超时，请查看日志：${logPath}`));
      }, 20 * 60 * 1_000);
      child.once("error", (error) => finish(error));
      child.once("exit", (code) => {
        if (code === 0) {
          finish();
          return;
        }
        finish(new Error(`插件兼容依赖更新失败（退出码 ${String(code)}），请查看日志：${logPath}`));
      });
    });
  }
}

function backupPaths(profileDirectory: string): ProfileBackup {
  return {
    manifest: path.join(profileDirectory, "package.desktop-harness-update.json"),
    nodeModules: path.join(profileDirectory, "node_modules.desktop-harness-update"),
    packageLock: path.join(profileDirectory, "package-lock.desktop-harness-update.json"),
    pnpmLock: path.join(profileDirectory, "pnpm-lock.desktop-harness-update.yaml"),
  };
}

function moveIfPresent(source: string, destination: string): void {
  if (existsSync(source)) {
    renameSync(source, destination);
  }
}

function removeBackup(backup: ProfileBackup): void {
  // The manifest is the recovery marker. Remove it first so an antivirus lock
  // on the old node_modules tree cannot roll back an already verified update.
  removeBestEffort(backup.manifest);
  removeBestEffort(backup.nodeModules, true);
  removeBestEffort(backup.packageLock);
  removeBestEffort(backup.pnpmLock);
}

function removeBestEffort(target: string, recursive = false): void {
  try {
    rmSync(target, { recursive, force: true });
  } catch {
    // Old backup data is inert once the recovery marker has been removed.
  }
}

function restoreBackup(profileDirectory: string, backup: ProfileBackup): void {
  rmSync(path.join(profileDirectory, "package.json"), { force: true });
  rmSync(path.join(profileDirectory, "node_modules"), { recursive: true, force: true });
  rmSync(path.join(profileDirectory, "package-lock.json"), { force: true });
  rmSync(path.join(profileDirectory, "pnpm-lock.yaml"), { force: true });
  moveIfPresent(backup.manifest, path.join(profileDirectory, "package.json"));
  moveIfPresent(backup.nodeModules, path.join(profileDirectory, "node_modules"));
  moveIfPresent(backup.packageLock, path.join(profileDirectory, "package-lock.json"));
  moveIfPresent(backup.pnpmLock, path.join(profileDirectory, "pnpm-lock.yaml"));
}
