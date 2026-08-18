import type { HarnessInstallation } from "./config";
import {
  HarnessRuntimeInstaller,
  type HarnessInstallStage,
  type HarnessInstallStatus,
  type PreparedHarnessRuntime,
} from "./harness-runtime-installer";
import type { HarnessVersionSource } from "./harness-updater";

export type HarnessBootstrapStage = "checking" | HarnessInstallStage | "starting";
export type HarnessBootstrapStatus = (stage: HarnessBootstrapStage) => void;
export type HarnessBootstrapVerifier = (installation: HarnessInstallation) => Promise<void>;

/**
 * Owns the complete first-run transaction: resolve a release, stage it, switch
 * atomically, prove that it starts, and only then commit it as the managed
 * runtime. Callers only need to render progress and launch the candidate.
 */
export class HarnessBootstrapper {
  constructor(
    private readonly runtime: HarnessRuntimeInstaller,
    private readonly latestVersion: HarnessVersionSource,
  ) {}

  async install(
    onStatus: HarnessBootstrapStatus,
    verifyRuntime: HarnessBootstrapVerifier,
  ): Promise<HarnessInstallation> {
    onStatus("checking");
    const version = await this.latestVersion();
    const prepared = await this.prepare(version, onStatus);
    let activated = false;

    try {
      const nextRuntime = this.runtime.activate(prepared);
      activated = true;
      onStatus("starting");
      await verifyRuntime(nextRuntime.installation);
      this.runtime.commit();
      return nextRuntime.installation;
    } catch (error) {
      if (activated) {
        this.runtime.rollback();
      }
      throw error;
    }
  }

  private async prepare(
    version: string,
    onStatus: HarnessInstallStatus,
  ): Promise<PreparedHarnessRuntime> {
    try {
      return this.runtime.recoverFailedRuntime(version);
    } catch {
      return this.runtime.prepare(version, onStatus);
    }
  }
}
