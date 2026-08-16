import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopSettingsStore } from "../src/main/desktop-settings";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("DesktopSettingsStore", () => {
  it("persists the Harness directory selected during onboarding", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "dsh-settings-"));
    temporaryDirectories.push(directory);
    const store = new DesktopSettingsStore(path.join(directory, "settings.json"));

    store.save({ harnessRoot: "D:\\DeepSeek\\deepseek-harness" });

    expect(store.load()).toEqual({ harnessRoot: "D:\\DeepSeek\\deepseek-harness" });
  });

  it("allows the selected Harness directory to be changed", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "dsh-settings-"));
    temporaryDirectories.push(directory);
    const store = new DesktopSettingsStore(path.join(directory, "settings.json"));
    store.save({ harnessRoot: "D:\\DeepSeek\\deepseek-harness" });

    store.save({ harnessRoot: "E:\\Harness" });

    expect(store.load()).toEqual({ harnessRoot: "E:\\Harness" });
  });
});
