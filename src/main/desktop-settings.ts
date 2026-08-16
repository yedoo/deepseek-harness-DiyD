import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface DesktopSettings {
  harnessRoot?: string;
}

export class DesktopSettingsStore {
  constructor(private readonly filePath: string) {}

  load(): DesktopSettings {
    try {
      const value = JSON.parse(readFileSync(this.filePath, "utf8")) as DesktopSettings;
      return typeof value.harnessRoot === "string" ? { harnessRoot: value.harnessRoot } : {};
    } catch {
      return {};
    }
  }

  save(settings: DesktopSettings): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}
