import { describe, expect, it } from "vitest";
import {
  DesktopUpdater,
  type DesktopUpdateTransport,
} from "../src/main/desktop-updater";

describe("DesktopUpdater", () => {
  it("reports an actionable version when a newer desktop release exists", async () => {
    const transport: DesktopUpdateTransport = {
      check: async () => ({ version: "0.1.3" }),
      download: async () => undefined,
      install: () => undefined,
    };
    const updater = new DesktopUpdater("0.1.2", transport);

    await updater.check();

    expect(updater.getState()).toEqual({
      phase: "available",
      currentVersion: "0.1.2",
      version: "0.1.3",
    });
  });

  it("downloads with progress and installs only after the package is ready", async () => {
    let installed = false;
    const transport: DesktopUpdateTransport = {
      check: async () => ({ version: "0.1.3" }),
      download: async (onProgress) => {
        onProgress(42);
        onProgress(100);
      },
      install: () => {
        installed = true;
      },
    };
    const updater = new DesktopUpdater("0.1.2", transport);

    expect(updater.install()).toBe(false);
    await updater.check();
    await updater.download();

    expect(updater.getState()).toEqual({
      phase: "downloaded",
      currentVersion: "0.1.2",
      version: "0.1.3",
    });
    expect(updater.install()).toBe(true);
    expect(installed).toBe(true);
  });

  it("coalesces concurrent update checks into one network request", async () => {
    let checks = 0;
    let finishCheck: ((release: { version: string } | null) => void) | undefined;
    const pendingCheck = new Promise<{ version: string } | null>((resolve) => {
      finishCheck = resolve;
    });
    const transport: DesktopUpdateTransport = {
      check: async () => {
        checks += 1;
        return pendingCheck;
      },
      download: async () => undefined,
      install: () => undefined,
    };
    const updater = new DesktopUpdater("0.1.2", transport);

    const first = updater.check();
    const second = updater.check();
    finishCheck?.({ version: "0.1.3" });
    await Promise.all([first, second]);

    expect(checks).toBe(1);
  });

  it("does not replace a downloaded update during a later scheduled check", async () => {
    const transport: DesktopUpdateTransport = {
      check: async () => ({ version: "0.1.3" }),
      download: async () => undefined,
      install: () => undefined,
    };
    const updater = new DesktopUpdater("0.1.2", transport);
    await updater.check();
    await updater.download();

    await updater.check();

    expect(updater.getState()).toEqual({
      phase: "downloaded",
      currentVersion: "0.1.2",
      version: "0.1.3",
    });
  });
});
