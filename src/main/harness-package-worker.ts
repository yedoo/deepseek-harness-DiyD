import { constants, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { cp, readdir } from "node:fs/promises";
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
    cache?: string;
    preferOffline?: boolean;
    preferOnline?: boolean;
  }): ArboristInstance;
}

const Arborist = require("@npmcli/arborist") as ArboristConstructor;
const HARNESS_PACKAGE = "@deepseek-ai/dsh";

export function harnessArboristOptions(prefix: string, cachePath?: string): {
  path: string;
  audit: boolean;
  fund: boolean;
  cache?: string;
  preferOffline?: boolean;
  preferOnline?: boolean;
} {
  return {
    path: prefix,
    audit: false,
    fund: false,
    cache: cachePath,
    preferOnline: true,
  };
}

export async function installHarnessPackage(
  prefix: string,
  version: string,
  cachePath?: string,
  seedRoot?: string,
  onReadyToInstall: () => void = () => undefined,
): Promise<void> {
  if (!path.isAbsolute(prefix)) {
    throw new Error("Harness staging 路径必须是绝对路径");
  }
  if (valid(version) === null) {
    throw new Error("Harness 更新版本号无效");
  }
  if (cachePath !== undefined && !path.isAbsolute(cachePath)) {
    throw new Error("Harness npm 缓存路径必须是绝对路径");
  }
  if (seedRoot !== undefined && !path.isAbsolute(seedRoot)) {
    throw new Error("Harness 复用路径必须是绝对路径");
  }

  mkdirSync(prefix, { recursive: true });
  if (seedRoot !== undefined) {
    await cloneRuntime(seedRoot, prefix);
  }
  const manifestPath = path.join(prefix, "package.json");
  if (!existsSync(manifestPath)) {
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ private: true }, null, 2)}\n`,
      { flag: "wx" },
    );
  }
  onReadyToInstall();
  const arborist = new Arborist(harnessArboristOptions(prefix, cachePath));
  await arborist.reify({
    add: [`${HARNESS_PACKAGE}@${version}`],
    save: true,
    omit: ["dev"],
  });
}

async function cloneRuntime(sourceRoot: string, targetRoot: string): Promise<void> {
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  if (source === target || target.startsWith(`${source}${path.sep}`)) {
    throw new Error("Harness 复用目录不能与 staging 相同");
  }
  for (const entry of await readdir(source)) {
    await cp(path.join(source, entry), path.join(target, entry), {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
  }
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
  const cachePath = process.argv[4];
  const seedRoot = process.argv[5];
  if (!prefix || !version) {
    throw new Error("Usage: harness-package-worker <absolute-prefix> <version>");
  }
  await installHarnessPackage(prefix, version, cachePath, seedRoot, () => {
    process.stdout.write("@dsh-update-stage:downloading\n");
  });
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
