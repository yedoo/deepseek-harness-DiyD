import type { HarnessInstallation } from "./config";
import {
  HarnessRuntimeInstaller,
  type HarnessInstallStatus,
} from "./harness-runtime-installer";
import {
  HarnessUpdateTransactionStore,
  type HarnessUpdateTransaction,
} from "./harness-update-transaction";

export type HarnessRuntimeVerifier = (installation: HarnessInstallation) => Promise<void>;

export type HarnessPendingUpdateResult =
  | { status: "none" }
  | { status: "applied"; previousVersion: string; version: string }
  | { status: "failed"; previousVersion: string; version: string; message: string };

export class HarnessUpdateCoordinator {
  constructor(
    private readonly runtime: HarnessRuntimeInstaller,
    private readonly transactions: HarnessUpdateTransactionStore,
    private readonly verifyRuntime: HarnessRuntimeVerifier,
  ) {}

  transaction(): HarnessUpdateTransaction | undefined {
    return this.transactions.read();
  }

  dismissFailure(): boolean {
    if (this.transactions.read()?.phase !== "failed") {
      return false;
    }
    this.transactions.clear();
    return true;
  }

  acknowledgeApplied(): boolean {
    if (this.transactions.read()?.phase !== "applied") {
      return false;
    }
    this.transactions.clear();
    return true;
  }

  async prepare(
    currentVersion: string,
    targetVersion: string,
    onStatus: HarnessInstallStatus = () => undefined,
  ): Promise<HarnessUpdateTransaction> {
    await this.runtime.prepare(targetVersion, onStatus);
    return this.transactions.prepare(currentVersion, targetVersion);
  }

  async applyPending(): Promise<HarnessPendingUpdateResult> {
    const transaction = this.transactions.read();
    if (!transaction) {
      return { status: "none" };
    }

    if (transaction.phase === "failed") {
      return {
        status: "failed",
        previousVersion: transaction.currentVersion,
        version: transaction.targetVersion,
        message: transaction.message ?? "Harness 更新失败",
      };
    }

    if (transaction.phase === "applied") {
      return {
        status: "applied",
        previousVersion: transaction.currentVersion,
        version: transaction.targetVersion,
      };
    }

    let activated = false;
    try {
      let nextRuntime;
      if (transaction.phase === "applying") {
        try {
          nextRuntime = this.runtime.activeRuntime(transaction.targetVersion);
        } catch {
          nextRuntime = this.runtime.activate(
            this.runtime.preparedRuntime(transaction.targetVersion),
          );
        }
      } else {
        const prepared = this.runtime.preparedRuntime(transaction.targetVersion);
        this.transactions.markApplying(transaction);
        nextRuntime = this.runtime.activate(prepared);
      }
      activated = true;
      await this.verifyRuntime(nextRuntime.installation);
      this.runtime.commit();
      this.transactions.markApplied(transaction);
      return {
        status: "applied",
        previousVersion: transaction.currentVersion,
        version: transaction.targetVersion,
      };
    } catch (error) {
      if (activated) {
        this.runtime.rollback();
      }
      const message = error instanceof Error ? error.message : String(error);
      this.transactions.fail(transaction, message);
      return {
        status: "failed",
        previousVersion: transaction.currentVersion,
        version: transaction.targetVersion,
        message,
      };
    }
  }
}
