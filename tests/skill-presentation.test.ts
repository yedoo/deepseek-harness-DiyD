import { describe, expect, it } from "vitest";
import type { SkillCatalogEntry } from "../src/skill-types";
import {
  filterSkillEntries,
  invocationLabel,
} from "../src/preload/skill-presentation";

function entry(overrides: Partial<SkillCatalogEntry> = {}): SkillCatalogEntry {
  return {
    id: "project-dsh:code-review",
    name: "code-review",
    description: "审查代码变更并提供改进建议。",
    source: "project-dsh",
    sourceLabel: "项目",
    sourcePath: ".dsh/skills",
    filePath: "D:\\project\\.dsh\\skills\\code-review\\SKILL.md",
    modelInvocable: true,
    userInvocable: true,
    ...overrides,
  };
}

describe("skill presentation", () => {
  it("filters by name, description, source label and usage guidance", () => {
    const skills = [
      entry(),
      entry({
        id: "user-agents:web-search",
        name: "web-search",
        description: "搜索最新网络信息。",
        whenToUse: "需要外部资料时使用",
        source: "user-agents",
        sourceLabel: "用户",
      }),
    ];

    expect(filterSkillEntries(skills, "review").map((skill) => skill.name)).toEqual(["code-review"]);
    expect(filterSkillEntries(skills, "外部资料").map((skill) => skill.name)).toEqual(["web-search"]);
    expect(filterSkillEntries(skills, "用户").map((skill) => skill.name)).toEqual(["web-search"]);
  });

  it("presents the four invocation policies without inventing an enabled state", () => {
    expect(invocationLabel(entry())).toBe("模型可调用");
    expect(invocationLabel(entry({ modelInvocable: false, userInvocable: true }))).toBe("仅用户");
    expect(invocationLabel(entry({ modelInvocable: true, userInvocable: false }))).toBe("仅模型");
    expect(invocationLabel(entry({ modelInvocable: false, userInvocable: false }))).toBe("未公开");
  });
});
