import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { HARNESS_CLI_RELATIVE_PATH } from "./config";

export type ProcessCommandLineSource = () => Promise<readonly string[]>;

const execFileAsync = promisify(execFile);
const CLI_ARGUMENT = /(?:"([^"\r\n]*[\\/]apps[\\/]cli[\\/]lib[\\/]bin\.js)"|(\S*[\\/]apps[\\/]cli[\\/]lib[\\/]bin\.js))\s+web(?:\s|$)/i;

export class RunningHarnessLocator {
  constructor(
    private readonly commandLines: ProcessCommandLineSource = listWindowsProcessCommandLines,
  ) {}

  async find(): Promise<string | undefined> {
    for (const commandLine of await this.commandLines()) {
      const match = CLI_ARGUMENT.exec(commandLine);
      const cliEntry = match?.[1] ?? match?.[2];
      if (!cliEntry) {
        continue;
      }
      const harnessRoot = path.resolve(path.dirname(cliEntry), "..", "..", "..");
      if (existsSync(path.join(harnessRoot, HARNESS_CLI_RELATIVE_PATH))) {
        return harnessRoot;
      }
    }
    return undefined;
  }
}

async function listWindowsProcessCommandLines(): Promise<readonly string[]> {
  if (process.platform !== "win32") {
    return [];
  }
  const script = [
    "Get-CimInstance Win32_Process",
    "Where-Object { $_.CommandLine -like '*apps\\cli\\lib\\bin.js* web*' }",
    "Select-Object -ExpandProperty CommandLine",
    "ConvertTo-Json -Compress",
  ].join(" | ");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: 5_000, windowsHide: true },
    );
    const value = JSON.parse(stdout.trim() || "null") as unknown;
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  } catch (error) {
    console.warn("Unable to inspect running Harness processes", error);
  }
  return [];
}
