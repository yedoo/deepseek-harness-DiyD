import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { valid } from "semver";

interface ArboristInstance {
  reify(options: {
    add: string[];
    save: boolean;
    omit: string[];
  }): Promise<unknown>;
}

interface ArboristConstructor {
  new (options: {
    path: string;
    audit: boolean;
    fund: boolean;
  }): ArboristInstance;
}

const Arborist = require("@npmcli/arborist") as ArboristConstructor;
const HARNESS_PACKAGE = "@deepseek-ai/dsh";

export async function installHarnessPackage(prefix: string, version: string): Promise<void> {
  if (!path.isAbsolute(prefix)) {
    throw new Error("Harness staging 路径必须是绝对路径");
  }
  if (valid(version) === null) {
    throw new Error("Harness 更新版本号无效");
  }

  mkdirSync(prefix, { recursive: true });
  writeFileSync(
    path.join(prefix, "package.json"),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
    { flag: "wx" },
  );
  const arborist = new Arborist({ path: prefix, audit: false, fund: false });
  await arborist.reify({
    add: [`${HARNESS_PACKAGE}@${version}`],
    save: true,
    omit: ["dev"],
  });
}

export function bundledArboristVersion(): string {
  const metadata = require("@npmcli/arborist/package.json") as { version?: unknown };
  if (typeof metadata.version !== "string") {
    throw new Error("Arborist package metadata is invalid");
  }
  return metadata.version;
}

async function main(): Promise<void> {
  if (process.argv[2] === "--probe") {
    process.stdout.write(`${bundledArboristVersion()}\n`);
    return;
  }
  const prefix = process.argv[2];
  const version = process.argv[3];
  if (!prefix || !version) {
    throw new Error("Usage: harness-package-worker <absolute-prefix> <version>");
  }
  await installHarnessPackage(prefix, version);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
