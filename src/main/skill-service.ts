import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  SkillCatalogEntry,
  SkillCatalogSnapshot,
  SkillImportResult,
  SkillSource,
} from "../skill-types";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface SkillRoot {
  source: SkillSource;
  sourceLabel: SkillCatalogEntry["sourceLabel"];
  sourcePath: string;
  directory: string;
}

export interface SkillServiceOptions {
  dataRoot: string;
  agentsHome?: string;
  harnessRoot?: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
  whenToUse?: string;
  modelInvocable: boolean;
  userInvocable: boolean;
}

export class SkillService {
  private readonly dataRoot: string;
  private readonly agentsHome: string;
  private readonly harnessRoot?: string;

  constructor(options: SkillServiceOptions) {
    this.dataRoot = path.resolve(options.dataRoot);
    this.agentsHome = path.resolve(options.agentsHome ?? path.join(os.homedir(), ".agents"));
    this.harnessRoot = options.harnessRoot ? path.resolve(options.harnessRoot) : undefined;
  }

  snapshot(): SkillCatalogSnapshot {
    const workspaceRoot = this.resolveWorkspaceRoot();
    const roots = this.skillRoots(workspaceRoot);
    const winners = new Map<string, SkillCatalogEntry>();
    for (const root of roots) {
      for (const skill of discoverRoot(root)) {
        if (!winners.has(skill.name)) {
          winners.set(skill.name, skill);
        }
      }
    }
    const skills = [...winners.values()].sort((first, second) => (
      first.name.localeCompare(second.name, "en")
    ));
    return {
      ...(workspaceRoot ? { workspaceRoot } : {}),
      userSkillsRoot: this.userSkillsRoot(),
      skills,
      sourceCounts: {
        project: skills.filter((skill) => skill.source.startsWith("project-")).length,
        user: skills.filter((skill) => skill.source.startsWith("user-")).length,
        custom: skills.filter((skill) => skill.source === "custom").length,
        bundled: skills.filter((skill) => skill.source === "bundled").length,
      },
    };
  }

  importSkill(sourceDirectory: string): SkillImportResult {
    const source = path.resolve(sourceDirectory);
    const sourceFile = path.join(source, "SKILL.md");
    if (!existsSync(sourceFile) || !statSync(sourceFile).isFile()) {
      throw new Error("所选目录不是有效的 Skill 包：缺少 SKILL.md");
    }
    const parsed = readSkill(sourceFile, {
      source: "user-dsh",
      sourceLabel: "用户",
      sourcePath: "DSH_HOME/skills",
      directory: this.userSkillsRoot(),
    });
    if (!parsed) {
      throw new Error("SKILL.md 缺少有效的名称或说明");
    }
    const destination = path.join(this.userSkillsRoot(), parsed.name);
    if (existsSync(destination)) {
      throw new Error(`用户 Skills 中已存在 ${parsed.name}`);
    }
    mkdirSync(this.userSkillsRoot(), { recursive: true });
    cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
    const imported = readSkill(path.join(destination, "SKILL.md"), {
      source: "user-dsh",
      sourceLabel: "用户",
      sourcePath: "DSH_HOME/skills",
      directory: this.userSkillsRoot(),
    });
    if (!imported) {
      throw new Error("导入后的 Skill 无法读取");
    }
    return { imported, snapshot: this.snapshot() };
  }

  userSkillsRoot(): string {
    return path.join(this.dataRoot, "skills");
  }

  private skillRoots(workspaceRoot?: string): SkillRoot[] {
    const roots: SkillRoot[] = [];
    if (workspaceRoot) {
      roots.push(
        {
          source: "project-dsh",
          sourceLabel: "项目",
          sourcePath: ".dsh/skills",
          directory: path.join(workspaceRoot, ".dsh", "skills"),
        },
        {
          source: "project-agents",
          sourceLabel: "项目",
          sourcePath: ".agents/skills",
          directory: path.join(workspaceRoot, ".agents", "skills"),
        },
      );
    }
    roots.push(
      {
        source: "user-dsh",
        sourceLabel: "用户",
        sourcePath: "DSH_HOME/skills",
        directory: this.userSkillsRoot(),
      },
      {
        source: "user-agents",
        sourceLabel: "用户",
        sourcePath: "~/.agents/skills",
        directory: path.join(this.agentsHome, "skills"),
      },
    );
    const bundled = this.resolveBundledRoot();
    if (bundled) {
      roots.push({
        source: "bundled",
        sourceLabel: "内置",
        sourcePath: "Harness preset",
        directory: bundled,
      });
    }
    return roots;
  }

  private resolveWorkspaceRoot(): string | undefined {
    const storagePath = path.join(this.dataRoot, "storages", "session_projcache.json");
    try {
      const value = JSON.parse(readFileSync(storagePath, "utf8")) as {
        tables?: { sessions?: Record<string, {
          identity?: { cwd?: unknown; createdAt?: unknown };
          rows?: { sessionListMetadata?: { val?: { lastPromptAt?: unknown } } };
        }> };
      };
      const sessions = Object.values(value.tables?.sessions ?? {});
      const candidates = sessions
        .map((session) => {
          const cwd = typeof session.identity?.cwd === "string" ? session.identity.cwd : undefined;
          const createdAt = typeof session.identity?.createdAt === "number" ? session.identity.createdAt : 0;
          const lastPromptAt = session.rows?.sessionListMetadata?.val?.lastPromptAt;
          return {
            cwd,
            activity: typeof lastPromptAt === "number" ? lastPromptAt : createdAt,
          };
        })
        .filter((candidate): candidate is { cwd: string; activity: number } => (
          typeof candidate.cwd === "string"
          && existsSync(candidate.cwd)
          && statSync(candidate.cwd).isDirectory()
        ))
        .sort((first, second) => second.activity - first.activity);
      return candidates[0] ? findProjectRoot(candidates[0].cwd) : undefined;
    } catch {
      return undefined;
    }
  }

  private resolveBundledRoot(): string | undefined {
    if (!this.harnessRoot) return undefined;
    const preset = readDefaultPreset(path.join(this.dataRoot, "settings.yaml")) ?? "cordis";
    const candidates = [
      path.join(this.harnessRoot, "apps", "cli", "config", "agent-presets", preset, "skills"),
      path.join(this.harnessRoot, "config", "agent-presets", preset, "skills"),
      path.join(this.harnessRoot, "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets", preset, "skills"),
      path.join(this.harnessRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "config", "agent-presets", preset, "skills"),
    ];
    return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory());
  }
}

function discoverRoot(root: SkillRoot): SkillCatalogEntry[] {
  if (!existsSync(root.directory) || !statSync(root.directory).isDirectory()) {
    return [];
  }
  const skills: SkillCatalogEntry[] = [];
  for (const entry of readdirSync(root.directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const filePath = entry.isDirectory()
      ? path.join(root.directory, entry.name, "SKILL.md")
      : entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".md")
        ? path.join(root.directory, entry.name)
        : undefined;
    if (!filePath || !existsSync(filePath)) continue;
    const skill = readSkill(filePath, root);
    if (skill) skills.push(skill);
  }
  return skills.sort((first, second) => first.name.localeCompare(second.name, "en"));
}

function readSkill(filePath: string, root: SkillRoot): SkillCatalogEntry | undefined {
  try {
    const content = readFileSync(filePath, "utf8");
    const fallbackName = path.basename(filePath).toLocaleLowerCase() === "skill.md"
      ? path.basename(path.dirname(filePath))
      : path.basename(filePath, path.extname(filePath));
    const frontmatter = parseFrontmatter(content);
    const name = frontmatter.name ?? fallbackName;
    if (!SKILL_NAME_PATTERN.test(name) || !frontmatter.description) {
      return undefined;
    }
    return {
      id: `${root.source}:${name}`,
      name,
      description: frontmatter.description,
      ...(frontmatter.whenToUse ? { whenToUse: frontmatter.whenToUse } : {}),
      source: root.source,
      sourceLabel: root.sourceLabel,
      sourcePath: root.sourcePath,
      filePath,
      modelInvocable: frontmatter.modelInvocable,
      userInvocable: frontmatter.userInvocable,
    };
  } catch {
    return undefined;
  }
}

function parseFrontmatter(content: string): Frontmatter {
  const result: Frontmatter = { modelInvocable: true, userInvocable: true };
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return result;
  const fields = parseSimpleYaml(match[1] ?? "");
  result.name = fields.name;
  result.description = fields.description;
  result.whenToUse = fields["when-to-use"] ?? fields.whenToUse;
  result.modelInvocable = !parseBoolean(fields["disable-model-invocation"], false);
  result.userInvocable = parseBoolean(fields["user-invocable"], true);
  return result;
}

function parseSimpleYaml(value: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = value.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index] ?? "");
    if (!match) continue;
    const key = match[1]!;
    const raw = match[2]!.trim();
    if (raw === "|" || raw === ">") {
      const parts: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1] ?? "")) {
        index += 1;
        parts.push((lines[index] ?? "").trim());
      }
      fields[key] = parts.join(raw === ">" ? " " : "\n").trim();
    } else if (raw) {
      fields[key] = unquote(raw);
    }
  }
  return fields;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value.trim();
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (/^(true|yes|on|1)$/i.test(value)) return true;
  if (/^(false|no|off|0)$/i.test(value)) return false;
  return fallback;
}

function readDefaultPreset(settingsPath: string): string | undefined {
  try {
    const content = readFileSync(settingsPath, "utf8");
    return /^agent-presets:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+default:\s*([^\s#]+)/m.exec(content)?.[1];
  } catch {
    return undefined;
  }
}

function findProjectRoot(cwd: string): string {
  let current = path.resolve(cwd);
  while (true) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}
