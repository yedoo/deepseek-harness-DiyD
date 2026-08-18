export type SkillSource =
  | "project-dsh"
  | "project-agents"
  | "user-dsh"
  | "user-agents"
  | "custom"
  | "bundled";

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
  source: SkillSource;
  sourceLabel: "项目" | "用户" | "自定义" | "内置";
  sourcePath: string;
  filePath: string;
  modelInvocable: boolean;
  userInvocable: boolean;
}

export interface SkillCatalogSnapshot {
  workspaceRoot?: string;
  userSkillsRoot: string;
  skills: SkillCatalogEntry[];
  sourceCounts: {
    project: number;
    user: number;
    custom: number;
    bundled: number;
  };
}

export interface SkillImportResult {
  imported: SkillCatalogEntry;
  snapshot: SkillCatalogSnapshot;
}
