import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface HarnessUpdateTransaction {
  schemaVersion: 1;
  phase: "prepared" | "applying" | "applied" | "failed";
  currentVersion: string;
  targetVersion: string;
  createdAt: string;
  updatedAt: string;
  message?: string;
}

export class HarnessUpdateTransactionStore {
  constructor(
    private readonly filePath: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  read(): HarnessUpdateTransaction | undefined {
    try {
      const value = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<HarnessUpdateTransaction>;
      if (
        value.schemaVersion !== 1 ||
        !["prepared", "applying", "applied", "failed"].includes(String(value.phase)) ||
        typeof value.currentVersion !== "string" ||
        typeof value.targetVersion !== "string" ||
        typeof value.createdAt !== "string" ||
        typeof value.updatedAt !== "string" ||
        (value.phase === "failed" && typeof value.message !== "string")
      ) {
        return undefined;
      }
      return value as HarnessUpdateTransaction;
    } catch {
      return undefined;
    }
  }

  prepare(currentVersion: string, targetVersion: string): HarnessUpdateTransaction {
    const timestamp = this.now();
    const transaction: HarnessUpdateTransaction = {
      schemaVersion: 1,
      phase: "prepared",
      currentVersion,
      targetVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.write(transaction);
    return transaction;
  }

  markApplying(transaction: HarnessUpdateTransaction): HarnessUpdateTransaction {
    const next: HarnessUpdateTransaction = {
      ...transaction,
      phase: "applying",
      updatedAt: this.now(),
    };
    this.write(next);
    return next;
  }

  fail(transaction: HarnessUpdateTransaction, message: string): HarnessUpdateTransaction {
    const next: HarnessUpdateTransaction = {
      ...transaction,
      phase: "failed",
      message,
      updatedAt: this.now(),
    };
    this.write(next);
    return next;
  }

  markApplied(transaction: HarnessUpdateTransaction): HarnessUpdateTransaction {
    const next: HarnessUpdateTransaction = {
      ...transaction,
      phase: "applied",
      updatedAt: this.now(),
    };
    this.write(next);
    return next;
  }

  clear(): void {
    rmSync(this.filePath, { force: true });
    rmSync(`${this.filePath}.tmp`, { force: true });
  }

  private write(transaction: HarnessUpdateTransaction): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(transaction, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}
