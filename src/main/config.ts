import { existsSync } from "node:fs";
import path from "node:path";

export const HARNESS_CLI_RELATIVE_PATH = path.join("apps", "cli", "lib", "bin.js");

export interface HarnessLocationContext {
  explicitRoot?: string;
  appPath: string;
  cwd: string;
  executablePath: string;
  resourcesPath: string;
}

export function resolveHarnessRoot(context: HarnessLocationContext): string {
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

    if (existsSync(path.join(root, HARNESS_CLI_RELATIVE_PATH))) {
      return root;
    }
  }

  throw new Error(
    "DeepSeek Harness was not found. Set DSH_INSTALL_ROOT to a checkout containing apps/cli/lib/bin.js.",
  );
}
