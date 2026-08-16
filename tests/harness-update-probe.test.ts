import { describe, expect, it } from "vitest";
import { HarnessUpdateProbe } from "../src/main/harness-update-probe";
import type { HarnessInstallation } from "../src/main/config";

const installation: HarnessInstallation = {
  root: "C:\\managed-harness",
  cliPath: "C:\\managed-harness\\bin.js",
  packagePath: "C:\\managed-harness\\package.json",
  kind: "managed",
};

describe("HarnessUpdateProbe", () => {
  it("allows a slow first boot to finish and always stops the probe process", async () => {
    const events: string[] = [];
    const probe = new HarnessUpdateProbe((_installation, startupTimeoutMs) => ({
      start: async () => {
        events.push("start");
        if (startupTimeoutMs < 120_000) {
          throw new Error("cold profile migration exceeded the startup budget");
        }
      },
      stop: async () => {
        events.push("stop");
      },
    }));

    await expect(probe.verify(installation)).resolves.toBeUndefined();
    expect(events).toEqual(["start", "stop"]);
  });
});
