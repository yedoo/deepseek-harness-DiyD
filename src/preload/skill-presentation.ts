import type { SkillCatalogEntry } from "../skill-types";

export function filterSkillEntries(
  skills: SkillCatalogEntry[],
  query: string,
): SkillCatalogEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return skills;
  }

  return skills.filter((skill) =>
    [skill.name, skill.description, skill.whenToUse, skill.sourceLabel]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function invocationLabel(skill: SkillCatalogEntry): string {
  if (skill.modelInvocable && skill.userInvocable) {
    return "模型可调用";
  }
  if (skill.userInvocable) {
    return "仅用户";
  }
  if (skill.modelInvocable) {
    return "仅模型";
  }
  return "未公开";
}
