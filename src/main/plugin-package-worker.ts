import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

interface ArboristInstance {
  reify(options: {
    add?: string[];
    rm?: string[];
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
    legacyPeerDeps?: boolean;
  }): ArboristInstance;
}

interface ProfileManifest {
  private?: boolean;
  dependencies?: Record<string, string>;
  dsh?: {
    profile?: {
      bundles?: string[];
    };
  };
}

export interface PluginPackageOperationResult {
  dependencies: Record<string, string>;
  bundles: string[];
}

const Arborist = require("@npmcli/arborist") as ArboristConstructor;
const RESULT_PREFIX = "@dsh-plugin-market-result:";

function readManifest(manifestPath: string): ProfileManifest {
  const value = JSON.parse(readFileSync(manifestPath, "utf8")) as ProfileManifest;
  if (value.dependencies !== undefined && (typeof value.dependencies !== "object" || value.dependencies === null)) {
    throw new Error("插件配置中的 dependencies 无效");
  }
  return value;
}

function packageManifestPath(profileDirectory: string, packageName: string): string {
  return path.join(profileDirectory, "node_modules", ...packageName.split("/"), "package.json");
}

function isBundle(profileDirectory: string, packageName: string): boolean {
  const manifestPath = packageManifestPath(profileDirectory, packageName);
  if (!existsSync(manifestPath)) {
    return false;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      dsh?: { bundle?: { patch?: unknown } };
    };
    return typeof manifest.dsh?.bundle?.patch === "string";
  } catch {
    return false;
  }
}

function writeManifestAtomic(manifestPath: string, manifest: ProfileManifest): void {
  const temporaryPath = `${manifestPath}.desktop-market.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, manifestPath);
}

export function reconcileProfileBundles(
  profileDirectory: string,
  before: ProfileManifest,
  after: ProfileManifest,
): PluginPackageOperationResult {
  const beforeDependencies = new Set(Object.keys(before.dependencies ?? {}));
  const dependencies = after.dependencies ?? {};
  const afterNames = Object.keys(dependencies);
  const dependencyNames = new Set(afterNames);
  const bundles = [...(after.dsh?.profile?.bundles ?? [])];

  for (const packageName of afterNames) {
    if (isBundle(profileDirectory, packageName) && !bundles.includes(packageName)) {
      bundles.push(packageName);
    }
  }

  for (const packageName of [...bundles]) {
    const dependencyManaged = beforeDependencies.has(packageName) || dependencyNames.has(packageName);
    if (dependencyManaged && (!dependencyNames.has(packageName) || !isBundle(profileDirectory, packageName))) {
      bundles.splice(bundles.indexOf(packageName), 1);
    }
  }

  after.dsh = {
    ...after.dsh,
    profile: {
      ...after.dsh?.profile,
      bundles,
    },
  };
  return { dependencies, bundles };
}

export async function runPluginPackageOperation(
  operation: "add" | "remove",
  profileDirectory: string,
  target: string,
  cachePath?: string,
): Promise<PluginPackageOperationResult> {
  if (!path.isAbsolute(profileDirectory)) {
    throw new Error("插件 profile 路径必须是绝对路径");
  }
  if (!target || target.startsWith("-") || /[\r\n]/.test(target)) {
    throw new Error("插件安装目标无效");
  }
  mkdirSync(profileDirectory, { recursive: true });
  const manifestPath = path.join(profileDirectory, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error("Harness Web profile 尚未初始化");
  }

  const originalText = readFileSync(manifestPath, "utf8");
  const before = readManifest(manifestPath);
  const arborist = new Arborist({
    path: profileDirectory,
    audit: false,
    fund: false,
    cache: cachePath,
    preferOffline: true,
    legacyPeerDeps: true,
  });

  try {
    await arborist.reify({
      ...(operation === "add" ? { add: [target] } : { rm: [target] }),
      save: true,
      omit: ["dev"],
    });
    const after = readManifest(manifestPath);
    const result = reconcileProfileBundles(profileDirectory, before, after);
    writeManifestAtomic(manifestPath, after);
    return result;
  } catch (error) {
    writeFileSync(manifestPath, originalText, "utf8");
    try {
      await arborist.reify({ save: true, omit: ["dev"] });
    } catch (recoveryError) {
      throw new Error(
        `插件操作失败，配置已恢复，但依赖清理失败：${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function synchronizeHarnessProfilePackages(
  profileDirectory: string,
  targetVersion: string,
  cachePath?: string,
): Promise<PluginPackageOperationResult> {
  if (!path.isAbsolute(profileDirectory)) {
    throw new Error("Harness profile 路径必须是绝对路径");
  }
  if (!targetVersion || /[\r\n]/.test(targetVersion)) {
    throw new Error("Harness 目标版本无效");
  }
  const manifestPath = path.join(profileDirectory, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error("Harness Web profile 尚未初始化");
  }
  const arborist = new Arborist({
    path: profileDirectory,
    audit: false,
    fund: false,
    cache: cachePath,
    preferOffline: true,
    legacyPeerDeps: true,
  });
  await arborist.reify({ save: false, omit: ["dev"] });
  const manifest = readManifest(manifestPath);
  return {
    dependencies: manifest.dependencies ?? {},
    bundles: manifest.dsh?.profile?.bundles ?? [],
  };
}

async function main(): Promise<void> {
  const operation = process.argv[2];
  const profileDirectory = process.argv[3];
  const target = process.argv[4];
  const cachePath = process.argv[5];
  if ((operation !== "add" && operation !== "remove" && operation !== "synchronize") || !profileDirectory || !target) {
    throw new Error("Usage: plugin-package-worker <add|remove|synchronize> <profile-dir> <target> [cache]");
  }
  const result = operation === "synchronize"
    ? await synchronizeHarnessProfilePackages(profileDirectory, target, cachePath)
    : await runPluginPackageOperation(operation, profileDirectory, target, cachePath);
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}

export { RESULT_PREFIX };
