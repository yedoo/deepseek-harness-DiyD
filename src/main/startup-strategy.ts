import { isLoopbackHttpUrl } from "./navigation";

export type StartupStrategy<TInstallation> =
  | { kind: "connect"; url: string }
  | { kind: "launch"; installation: TInstallation };

export interface StartupStrategyOptions<TInstallation> {
  preferredUrl?: string;
  preferInstallation?: boolean;
  isHealthy: (url: string) => Promise<boolean>;
  resolveHarnessInstallation: () => TInstallation;
}

export interface HarnessBootstrapPolicy {
  isPackaged: boolean;
  explicitRoot?: string;
  preferredUrl?: string;
  managedHarnessEnabled?: boolean;
}

export function shouldBootstrapMissingHarness(policy: HarnessBootstrapPolicy): boolean {
  return policy.isPackaged
    && !policy.explicitRoot
    && !policy.preferredUrl
    && policy.managedHarnessEnabled !== false;
}

export async function chooseStartupStrategy<TInstallation>(
  options: StartupStrategyOptions<TInstallation>,
): Promise<StartupStrategy<TInstallation>> {
  if (options.preferInstallation) {
    return {
      kind: "launch",
      installation: options.resolveHarnessInstallation(),
    };
  }

  const candidates = [options.preferredUrl, "http://127.0.0.1:3080"]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .filter(isLoopbackHttpUrl);

  for (const url of candidates) {
    if (await options.isHealthy(url)) {
      return { kind: "connect", url };
    }
  }

  return {
    kind: "launch",
    installation: options.resolveHarnessInstallation(),
  };
}
