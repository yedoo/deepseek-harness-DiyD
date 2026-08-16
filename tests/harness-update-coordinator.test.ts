import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessUpdateCoordinator } from "../src/main/harness-update-coordinator";
import {
  HarnessRuntimeInstaller,
  type HarnessPackageInstaller,
} from "../src/main/harness-runtime-installer";
import { HarnessUpdateTransactionStore } from "../src/main/harness-update-transaction";
import { readHarnessVersion } from "../src/main/harness-updater";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function testRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-update-coordinator-"));
  temporaryDirectories.push(root);
  return root;
}

const packageInstaller: HarnessPackageInstaller = {
  install: async (prefix, version, onStatus) => {
    onStatus("downloading");
    const packageRoot = path.join(prefix, "node_modules", "@deepseek-ai", "dsh");
    mkdirSync(path.join(packageRoot, "lib"), { recursive: true });
    writeFileSync(path.join(packageRoot, "lib", "bin.js"), "");
    writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "@deepseek-ai/dsh", version }),
    );
  },
};

describe("HarnessUpdateCoordinator", () => {
  it("applies a prepared update after restart and clears the transaction", async () => {
    const root = testRoot();
    const runtimeRoot = path.join(root, "runtime");
    const transactionPath = path.join(root, "harness-update.json");
    const firstRuntime = new HarnessRuntimeInstaller(runtimeRoot, packageInstaller);
    firstRuntime.activate(await firstRuntime.prepare("0.1.0-rc.5"));
    firstRuntime.commit();
    const firstProcess = new HarnessUpdateCoordinator(
      firstRuntime,
      new HarnessUpdateTransactionStore(transactionPath),
      async () => undefined,
    );
    await firstProcess.prepare("0.1.0-rc.5", "0.1.0-rc.6");

    const restartedRuntime = new HarnessRuntimeInstaller(runtimeRoot, packageInstaller);
    const restartedStore = new HarnessUpdateTransactionStore(transactionPath);
    const restartedProcess = new HarnessUpdateCoordinator(
      restartedRuntime,
      restartedStore,
      async (installation) => {
        expect(readHarnessVersion(installation.root)).toBe("0.1.0-rc.6");
      },
    );

    await expect(restartedProcess.applyPending()).resolves.toEqual({
      status: "applied",
      previousVersion: "0.1.0-rc.5",
      version: "0.1.0-rc.6",
    });
    expect(readHarnessVersion(restartedRuntime.currentRoot)).toBe("0.1.0-rc.6");
    expect(restartedStore.read()).toMatchObject({
      phase: "applied",
      currentVersion: "0.1.0-rc.5",
      targetVersion: "0.1.0-rc.6",
    });
    expect(restartedProcess.acknowledgeApplied()).toBe(true);
    expect(restartedStore.read()).toBeUndefined();
  });

  it("rolls back a runtime that fails its startup check and remembers the error", async () => {
    const root = testRoot();
    const runtimeRoot = path.join(root, "runtime");
    const transactionPath = path.join(root, "harness-update.json");
    const runtime = new HarnessRuntimeInstaller(runtimeRoot, packageInstaller);
    runtime.activate(await runtime.prepare("0.1.0-rc.5"));
    runtime.commit();
    const store = new HarnessUpdateTransactionStore(
      transactionPath,
      () => "2026-08-16T13:25:00.000Z",
    );
    const firstProcess = new HarnessUpdateCoordinator(
      runtime,
      store,
      async () => undefined,
    );
    await firstProcess.prepare("0.1.0-rc.5", "0.1.0-rc.6");

    const restartedProcess = new HarnessUpdateCoordinator(
      new HarnessRuntimeInstaller(runtimeRoot, packageInstaller),
      store,
      async () => {
        throw new Error("Harness startup probe failed");
      },
    );

    await expect(restartedProcess.applyPending()).resolves.toEqual({
      status: "failed",
      previousVersion: "0.1.0-rc.5",
      version: "0.1.0-rc.6",
      message: "Harness startup probe failed",
    });
    expect(readHarnessVersion(runtime.currentRoot)).toBe("0.1.0-rc.5");
    expect(new HarnessUpdateTransactionStore(transactionPath).read()).toMatchObject({
      phase: "failed",
      currentVersion: "0.1.0-rc.5",
      targetVersion: "0.1.0-rc.6",
      message: "Harness startup probe failed",
    });
  });

  it("finishes an update when the app previously closed after the atomic switch", async () => {
    const root = testRoot();
    const runtimeRoot = path.join(root, "runtime");
    const transactionPath = path.join(root, "harness-update.json");
    const runtime = new HarnessRuntimeInstaller(runtimeRoot, packageInstaller);
    runtime.activate(await runtime.prepare("0.1.0-rc.5"));
    runtime.commit();
    const store = new HarnessUpdateTransactionStore(transactionPath);
    const firstProcess = new HarnessUpdateCoordinator(
      runtime,
      store,
      async () => undefined,
    );
    await firstProcess.prepare("0.1.0-rc.5", "0.1.0-rc.6");
    const transaction = store.read();
    expect(transaction).toBeDefined();
    store.markApplying(transaction!);
    runtime.activate(runtime.preparedRuntime("0.1.0-rc.6"));

    const restartedProcess = new HarnessUpdateCoordinator(
      new HarnessRuntimeInstaller(runtimeRoot, packageInstaller),
      new HarnessUpdateTransactionStore(transactionPath),
      async () => undefined,
    );

    await expect(restartedProcess.applyPending()).resolves.toMatchObject({
      status: "applied",
      version: "0.1.0-rc.6",
    });
    expect(readHarnessVersion(runtime.currentRoot)).toBe("0.1.0-rc.6");
    expect(restartedProcess.acknowledgeApplied()).toBe(true);
    expect(store.read()).toBeUndefined();
  });

  it("resumes when the app closed immediately before the atomic switch", async () => {
    const root = testRoot();
    const runtimeRoot = path.join(root, "runtime");
    const transactionPath = path.join(root, "harness-update.json");
    const runtime = new HarnessRuntimeInstaller(runtimeRoot, packageInstaller);
    runtime.activate(await runtime.prepare("0.1.0-rc.5"));
    runtime.commit();
    const store = new HarnessUpdateTransactionStore(transactionPath);
    const firstProcess = new HarnessUpdateCoordinator(runtime, store, async () => undefined);
    await firstProcess.prepare("0.1.0-rc.5", "0.1.0-rc.6");
    store.markApplying(store.read()!);

    const restartedProcess = new HarnessUpdateCoordinator(
      new HarnessRuntimeInstaller(runtimeRoot, packageInstaller),
      new HarnessUpdateTransactionStore(transactionPath),
      async () => undefined,
    );

    await expect(restartedProcess.applyPending()).resolves.toMatchObject({
      status: "applied",
      version: "0.1.0-rc.6",
    });
    expect(readHarnessVersion(runtime.currentRoot)).toBe("0.1.0-rc.6");
  });

  it("clears a remembered failure before the user retries the download", () => {
    const root = testRoot();
    const store = new HarnessUpdateTransactionStore(path.join(root, "harness-update.json"));
    const transaction = store.prepare("0.1.0-rc.5", "0.1.0-rc.6");
    store.fail(transaction, "startup failed");
    const coordinator = new HarnessUpdateCoordinator(
      new HarnessRuntimeInstaller(path.join(root, "runtime"), packageInstaller),
      store,
      async () => undefined,
    );

    expect(coordinator.dismissFailure()).toBe(true);
    expect(store.read()).toBeUndefined();
  });

  it("recovers a committed update before the caller saves its managed-runtime setting", async () => {
    const root = testRoot();
    const runtimeRoot = path.join(root, "runtime");
    const transactionPath = path.join(root, "harness-update.json");
    const runtime = new HarnessRuntimeInstaller(runtimeRoot, packageInstaller);
    runtime.activate(await runtime.prepare("0.1.0-rc.5"));
    runtime.commit();
    const firstProcess = new HarnessUpdateCoordinator(
      runtime,
      new HarnessUpdateTransactionStore(transactionPath),
      async () => undefined,
    );
    await firstProcess.prepare("0.1.0-rc.5", "0.1.0-rc.6");
    await firstProcess.applyPending();

    const restartedProcess = new HarnessUpdateCoordinator(
      new HarnessRuntimeInstaller(runtimeRoot, packageInstaller),
      new HarnessUpdateTransactionStore(transactionPath),
      async () => {
        throw new Error("an applied transaction must not launch another probe");
      },
    );

    await expect(restartedProcess.applyPending()).resolves.toEqual({
      status: "applied",
      previousVersion: "0.1.0-rc.5",
      version: "0.1.0-rc.6",
    });
    expect(restartedProcess.acknowledgeApplied()).toBe(true);
  });
});
