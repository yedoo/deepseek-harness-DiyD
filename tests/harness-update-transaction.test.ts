import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessUpdateTransactionStore } from "../src/main/harness-update-transaction";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function transactionPath(): string {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-update-transaction-"));
  temporaryDirectories.push(root);
  return path.join(root, "harness-update.json");
}

describe("HarnessUpdateTransactionStore", () => {
  it("restores a prepared update in a new application process", () => {
    const filePath = transactionPath();
    const firstProcess = new HarnessUpdateTransactionStore(
      filePath,
      () => "2026-08-16T13:20:00.000Z",
    );

    firstProcess.prepare("0.1.0-rc.5", "0.1.0-rc.6");

    const restartedProcess = new HarnessUpdateTransactionStore(filePath);
    expect(restartedProcess.read()).toEqual({
      schemaVersion: 1,
      phase: "prepared",
      currentVersion: "0.1.0-rc.5",
      targetVersion: "0.1.0-rc.6",
      createdAt: "2026-08-16T13:20:00.000Z",
      updatedAt: "2026-08-16T13:20:00.000Z",
    });
  });
});
