import { existsSync } from "node:fs";
import path from "node:path";

export const HARNESS_CLI_RELATIVE_PATH = path.join("apps", "cli", "lib", "bin.js");
export const MANAGED_HARNESS_CLI_RELATIVE_PATH = path.join(
  "node_modules",
  "@deepseek-ai",
  "dsh",
  "lib",
  "bin.js",
);

export interface HarnessInstallation {
  root: string;
  cliPath: string;
  packagePath: string;
  kind: "checkout" | "managed";
}

export interface HarnessLocationContext {
  explicitRoot?: string;
  appPath: string;
  cwd: string;
  executablePath: string;
  resourcesPath: string;
}

export function inspectHarnessInstallation(root: string): HarnessInstallation | undefined {
  const absoluteRoot = path.resolve(root);
  const checkoutCli = path.join(absoluteRoot, HARNESS_CLI_RELATIVE_PATH);
  if (existsSync(checkoutCli)) {
    return {
      root: absoluteRoot,
      cliPath: checkoutCli,
      packagePath: path.join(absoluteRoot, "apps", "cli", "package.json"),
      kind: "checkout",
    };
  }

  const managedCli = path.join(absoluteRoot, MANAGED_HARNESS_CLI_RELATIVE_PATH);
  if (existsSync(managedCli)) {
    return {
      root: absoluteRoot,
      cliPath: managedCli,
      packagePath: path.join(
        absoluteRoot,
        "node_modules",
        "@deepseek-ai",
        "dsh",
        "package.json",
      ),
      kind: "managed",
    };
  }

  return undefined;
}

export function resolveHarnessInstallation(
  context: HarnessLocationContext,
): HarnessInstallation {
  const candidates = [
    context.explicitRoot,
    path.join(context.resourcesPath, "deepseek-harness"),
    path.join(path.dirname(context.appPath), "deepseek-harness"),
    path.join(context.cwd, "deepseek-harness"),
    path.join(path.dirname(context.cwd), "deepseek-harness"),
    path.join(path.dirname(context.executablePath), "deepseek-harness"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const visited = new Set<string>();
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    const installation = inspectHarnessInstallation(root);
    if (installation) {
      return installation;
    }
  }

  throw new Error(
    "DeepSeek Harness was not found. Select a checkout containing apps/cli/lib/bin.js.",
  );
}

export function resolveHarnessRoot(context: HarnessLocationContext): string {
  return resolveHarnessInstallation(context).root;
}
