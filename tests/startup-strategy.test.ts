import { describe, expect, it, vi } from "vitest";
import { chooseStartupStrategy } from "../src/main/startup-strategy";

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
});
