import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SkillService } from "../src/main/skill-service";

function writeSkill(
  root: string,
  name: string,
  description: string,
  extraFrontmatter = "",
): string {
  const directory = path.join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n${extraFrontmatter}---\n\n# ${name}\n`,
    "utf8",
  );
  return directory;
}

function writeSessionCache(dataRoot: string, sessions: Array<{
  id: string;
  cwd: string;
  createdAt: number;
  lastPromptAt?: number;
}>): void {
  const tables = Object.fromEntries(sessions.map((session) => [
    session.id,
    {
      identity: { cwd: session.cwd, createdAt: session.createdAt },
      rows: {
        sessionListMetadata: {
          val: { lastPromptAt: session.lastPromptAt ?? null },
        },
      },
    },
  ]));
  const storageRoot = path.join(dataRoot, "storages");
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(
    path.join(storageRoot, "session_projcache.json"),
    JSON.stringify({ tables: { sessions: tables } }),
    "utf8",
  );
}

describe("SkillService", () => {
  it("merges project, user, agent and bundled skills using Harness precedence", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dsh-skills-"));
    const dataRoot = path.join(root, "data");
    const agentsHome = path.join(root, ".agents");
    const harnessRoot = path.join(root, "harness");
    const workspace = path.join(root, "workspace");
    const nestedWorkspace = path.join(workspace, "packages", "app");
    mkdirSync(path.join(workspace, ".git"), { recursive: true });
    mkdirSync(nestedWorkspace, { recursive: true });

    writeSessionCache(dataRoot, [
      { id: "older", cwd: path.join(root, "old-workspace"), createdAt: 10 },
      { id: "current", cwd: nestedWorkspace, createdAt: 20, lastPromptAt: 50 },
    ]);
    writeFileSync(
      path.join(dataRoot, "settings.yaml"),
      "agent-presets:\n  default: cordis\n",
      "utf8",
    );

    writeSkill(path.join(workspace, ".dsh", "skills"), "code-review", "Project review");
    writeSkill(
      path.join(workspace, ".agents", "skills"),
      "code-review",
      "Lower priority duplicate",
    );
    writeSkill(path.join(dataRoot, "skills"), "docs-writer", "Write project docs");
    writeSkill(
      path.join(agentsHome, "skills"),
      "web-search",
      "Search the web",
      "disable-model-invocation: true\nuser-invocable: true\n",
    );
    writeSkill(
      path.join(harnessRoot, "apps", "cli", "config", "agent-presets", "cordis", "skills"),
      "bundled-helper",
      "Bundled helper",
    );

    const snapshot = new SkillService({ dataRoot, agentsHome, harnessRoot }).snapshot();

    expect(snapshot.workspaceRoot).toBe(workspace);
    expect(snapshot.skills.map((skill) => skill.name)).toEqual([
      "bundled-helper",
      "code-review",
      "docs-writer",
      "web-search",
    ]);
    expect(snapshot.skills.find((skill) => skill.name === "code-review")).toMatchObject({
      description: "Project review",
      source: "project-dsh",
      sourceLabel: "项目",
      modelInvocable: true,
      userInvocable: true,
    });
    expect(snapshot.skills.find((skill) => skill.name === "web-search")).toMatchObject({
      source: "user-agents",
      sourceLabel: "用户",
      modelInvocable: false,
      userInvocable: true,
    });
    expect(snapshot.sourceCounts).toEqual({ project: 1, user: 2, bundled: 1, custom: 0 });
  });

  it("imports a validated directory package into the user DSH skill root", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dsh-skill-import-"));
    const dataRoot = path.join(root, "data");
    const source = writeSkill(path.join(root, "downloads"), "release-notes", "Write release notes");
    writeFileSync(path.join(source, "template.md"), "# Template\n", "utf8");
    const service = new SkillService({ dataRoot, agentsHome: path.join(root, ".agents") });

    const result = service.importSkill(source);

    expect(result.imported.name).toBe("release-notes");
    expect(result.imported.source).toBe("user-dsh");
    expect(result.snapshot.skills).toContainEqual(expect.objectContaining({
      name: "release-notes",
      source: "user-dsh",
    }));
    expect(() => service.importSkill(source)).toThrow(/已存在/);
  });

  it("discovers bundled skills from an installed @deepseek-ai/dsh package root", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dsh-installed-skills-"));
    const dataRoot = path.join(root, "data");
    const harnessRoot = path.join(root, "node_modules", "@deepseek-ai", "dsh");
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(
      path.join(dataRoot, "settings.yaml"),
      "agent-presets:\n  default: cordis\n",
      { encoding: "utf8", flag: "w" },
    );
    writeSkill(
      path.join(harnessRoot, "config", "agent-presets", "cordis", "skills"),
      "installed-helper",
      "Installed package helper",
    );

    const snapshot = new SkillService({
      dataRoot,
      agentsHome: path.join(root, ".agents"),
      harnessRoot,
    }).snapshot();

    expect(snapshot.skills).toContainEqual(expect.objectContaining({
      name: "installed-helper",
      source: "bundled",
    }));
  });

  it("rejects directories that are not valid Skill packages", () => {
    const root = mkdtempSync(path.join(tmpdir(), "dsh-skill-invalid-"));
    const source = path.join(root, "not-a-skill");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "README.md"), "missing frontmatter", "utf8");
    const service = new SkillService({
      dataRoot: path.join(root, "data"),
      agentsHome: path.join(root, ".agents"),
    });

    expect(() => service.importSkill(source)).toThrow(/SKILL\.md/);
  });
});
