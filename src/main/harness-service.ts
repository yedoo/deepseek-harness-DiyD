import { createWriteStream, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { isLoopbackHttpUrl } from "./navigation";

export interface HarnessServiceOptions {
  harnessRoot: string;
  cliPath: string;
  dataRoot: string;
  logsRoot: string;
  nodeExecutable: string;
  runElectronAsNode?: boolean;
  preferredUrl?: string;
  startupTimeoutMs?: number;
  reuseExisting?: boolean;
}

export interface HarnessConnection {
  url: string;
  managedByDesktop: boolean;
}

export type HarnessStatusListener = (message: string) => void;

export class HarnessService extends EventEmitter {
  private ownedProcess?: ChildProcess;
  private stopping = false;

  constructor(private readonly options: HarnessServiceOptions) {
    super();
  }

  async start(onStatus: HarnessStatusListener = () => undefined): Promise<HarnessConnection> {
    const reusableUrls = (this.options.reuseExisting === false
      ? []
      : [this.options.preferredUrl, "http://127.0.0.1:3080"])
      .filter((value): value is string => Boolean(value))
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter(isLoopbackHttpUrl);

    for (const url of reusableUrls) {
      onStatus("正在检查已有的 Harness 服务…");
      if (await isHarnessHealthy(url)) {
        onStatus("已连接到正在运行的 Harness");
        return { url, managedByDesktop: false };
      }
    }

    onStatus("正在分配本地端口…");
    const port = await findAvailablePort();
    const url = `http://127.0.0.1:${port}`;
    mkdirSync(this.options.dataRoot, { recursive: true });
    mkdirSync(this.options.logsRoot, { recursive: true });

    const stdout = createWriteStream(path.join(this.options.logsRoot, "harness.log"), {
      flags: "a",
    });
    const stderr = createWriteStream(path.join(this.options.logsRoot, "harness.error.log"), {
      flags: "a",
    });
    const child = spawn(
      this.options.nodeExecutable,
      [this.options.cliPath, "web", "--host", "127.0.0.1", "--port", String(port)],
      {
        cwd: this.options.harnessRoot,
        env: {
          ...process.env,
          DSH_HOME: this.options.dataRoot,
          ...(this.options.runElectronAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.ownedProcess = child;
    this.stopping = false;
    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);

    let startupError: Error | undefined;
    let becameReady = false;
    child.once("error", (error) => {
      startupError = error;
    });
    child.once("exit", (code, signal) => {
      stdout.end();
      stderr.end();
      if (this.ownedProcess === child) {
        this.ownedProcess = undefined;
      }
      if (becameReady && !this.stopping) {
        this.emit(
          "unexpected-exit",
          new Error(`Harness 服务意外退出（code=${String(code)}, signal=${String(signal)}）`),
        );
      }
    });

    onStatus("正在启动 DeepSeek Harness…");
    const timeout = this.options.startupTimeoutMs ?? 30_000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (startupError) {
        await this.stop();
        throw startupError;
      }
      if (child.exitCode !== null) {
        throw new Error(
          `DeepSeek Harness 在启动完成前退出（退出码 ${String(child.exitCode)}）。请查看日志。`,
        );
      }
      if (await isHarnessHealthy(url)) {
        becameReady = true;
        onStatus("Harness 已就绪，正在打开工作台…");
        return { url, managedByDesktop: true };
      }
      await delay(350);
    }

    await this.stop();
    throw new Error(`DeepSeek Harness 未能在 ${Math.round(timeout / 1000)} 秒内启动。`);
  }

  async stop(): Promise<void> {
    const child = this.ownedProcess;
    if (!child || child.pid === undefined || child.exitCode !== null) {
      this.ownedProcess = undefined;
      return;
    }

    this.stopping = true;
    child.kill();
    if (!(await waitForExit(child, 2_000)) && process.platform === "win32") {
      await terminateWindowsProcessTree(child.pid);
      await waitForExit(child, 3_000);
    }
    this.ownedProcess = undefined;
    this.stopping = false;
  }
}

export async function isHarnessHealthy(url: string): Promise<boolean> {
  if (!isLoopbackHttpUrl(url)) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return false;
    }
    return (await response.text()).includes("__DSH_BOOT__");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("无法获取本地端口。"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return true;
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function terminateWindowsProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolve());
    killer.once("exit", () => resolve());
  });
}
