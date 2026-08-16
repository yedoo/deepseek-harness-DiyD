import type { HarnessInstallation } from "./config";

const UPDATE_PROBE_STARTUP_TIMEOUT_MS = 120_000;

export interface HarnessUpdateProbeProcess {
  start(onStatus?: (message: string) => void): Promise<unknown>;
  stop(): Promise<void>;
}

export type HarnessUpdateProbeProcessFactory = (
  installation: HarnessInstallation,
  startupTimeoutMs: number,
) => HarnessUpdateProbeProcess;

export class HarnessUpdateProbe {
  constructor(private readonly createProcess: HarnessUpdateProbeProcessFactory) {}

  async verify(
    installation: HarnessInstallation,
    onStatus: (message: string) => void = () => undefined,
  ): Promise<void> {
    const probeProcess = this.createProcess(
      installation,
      UPDATE_PROBE_STARTUP_TIMEOUT_MS,
    );
    try {
      await probeProcess.start(onStatus);
    } finally {
      await probeProcess.stop();
    }
  }
}
