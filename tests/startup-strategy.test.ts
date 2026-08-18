import { describe, expect, it, vi } from "vitest";
import {
  chooseStartupStrategy,
  shouldBootstrapMissingHarness,
} from "../src/main/startup-strategy";

describe("chooseStartupStrategy", () => {
  it("connects to a healthy running Harness before resolving an installation", async () => {
    const resolveHarnessInstallation = vi.fn(() => {
      throw new Error("DeepSeek Harness was not found");
    });

    const strategy = await chooseStartupStrategy({
      preferredUrl: undefined,
      isHealthy: async (url) => url === "http://127.0.0.1:3080",
      resolveHarnessInstallation,
    });

    expect(strategy).toEqual({ kind: "connect", url: "http://127.0.0.1:3080" });
    expect(resolveHarnessInstallation).not.toHaveBeenCalled();
  });

  it("resolves the local installation only when no running Harness is healthy", async () => {
    const installation = { harnessRoot: "D:\\DeepSeek\\deepseek-harness" };
    const resolveHarnessInstallation = vi.fn(() => installation);

    const strategy = await chooseStartupStrategy({
      preferredUrl: undefined,
      isHealthy: async () => false,
      resolveHarnessInstallation,
    });

    expect(strategy).toEqual({ kind: "launch", installation });
    expect(resolveHarnessInstallation).toHaveBeenCalledOnce();
  });

  it("prefers a managed updated runtime over an older service on port 3080", async () => {
    const installation = { harnessRoot: "managed" };
    const isHealthy = vi.fn(async () => true);

    const strategy = await chooseStartupStrategy({
      preferredUrl: undefined,
      preferInstallation: true,
      isHealthy,
      resolveHarnessInstallation: () => installation,
    });

    expect(strategy).toEqual({ kind: "launch", installation });
    expect(isHealthy).not.toHaveBeenCalled();
  });
});

describe("shouldBootstrapMissingHarness", () => {
  it("bootstraps an unconfigured packaged app", () => {
    expect(shouldBootstrapMissingHarness({ isPackaged: true })).toBe(true);
  });

  it("does not override development or an explicit Harness choice", () => {
    expect(shouldBootstrapMissingHarness({ isPackaged: false })).toBe(false);
    expect(shouldBootstrapMissingHarness({
      isPackaged: true,
      explicitRoot: "D:\\DeepSeek\\deepseek-harness",
    })).toBe(false);
    expect(shouldBootstrapMissingHarness({
      isPackaged: true,
      preferredUrl: "http://127.0.0.1:3080",
    })).toBe(false);
    expect(shouldBootstrapMissingHarness({
      isPackaged: true,
      managedHarnessEnabled: false,
    })).toBe(false);
  });
});
