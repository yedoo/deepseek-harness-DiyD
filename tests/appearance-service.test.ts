import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { AppearanceService } from "../src/main/appearance-service";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "dsh-appearance-"));
  temporaryDirectories.push(root);
  return root;
}

describe("AppearanceService", () => {
  it("starts with built-in themes and persists bounded appearance settings", () => {
    const root = temporaryRoot();
    const service = new AppearanceService(root);

    expect(service.snapshot().themes.filter((theme) => theme.kind === "builtin")).toHaveLength(3);

    service.updateSettings({
      mode: "dark",
      effects: { dim: 2, blur: -4, panelOpacity: 0.72, borderAlpha: 0.31, radius: 99 },
    });

    expect(new AppearanceService(root).snapshot().settings).toMatchObject({
      mode: "dark",
      effects: { dim: 0.9, blur: 0, panelOpacity: 0.72, borderAlpha: 0.31, radius: 32 },
    });
  });

  it("copies local images into controlled storage and never exposes the source path", () => {
    const root = temporaryRoot();
    const source = path.join(root, "outside.png");
    writeFileSync(source, Buffer.from("fake-png"));
    const service = new AppearanceService(path.join(root, "appearance"));

    const asset = service.importLocalAsset(source, "background");
    const snapshot = service.snapshot();

    expect(asset.id).toMatch(/^asset-/);
    expect(snapshot.settings.background).toEqual({ kind: "local-image", assetId: asset.id });
    expect(JSON.stringify(snapshot)).not.toContain(source);
    expect(service.readAsset(asset.id)).toEqual({
      mimeType: "image/png",
      data: Buffer.from("fake-png").toString("base64"),
    });
  });

  it("creates, applies, duplicates and deletes user themes without mutating built-ins", () => {
    const service = new AppearanceService(temporaryRoot());
    const created = service.createTheme({ name: "雨夜", author: "TianYe" });

    service.updateTheme(created.id, {
      name: "雨夜蓝",
      config: { colors: { accent: "#77aaff", text: "#f4f7ff" } },
    });
    const duplicate = service.duplicateTheme(created.id);
    service.applyTheme(duplicate.id);

    expect(service.snapshot().settings.activeThemeId).toBe(duplicate.id);
    expect(service.snapshot().themes.find((theme) => theme.id === created.id)).toMatchObject({
      name: "雨夜蓝",
      author: "TianYe",
    });
    expect(() => service.deleteTheme("builtin-light")).toThrow(/内置主题/);

    service.deleteTheme(created.id);
    expect(service.snapshot().themes.some((theme) => theme.id === created.id)).toBe(false);
  });

  it("exports and imports a declarative .dsh-theme package with its image assets", () => {
    const root = temporaryRoot();
    const source = path.join(root, "background.jpg");
    writeFileSync(source, Buffer.from("theme-image"));
    const first = new AppearanceService(path.join(root, "first"));
    const asset = first.importLocalAsset(source, "background");
    const theme = first.createTheme({
      name: "深海女仆",
      author: "TianYe",
      config: { assets: { background: asset.id, characterLeft: asset.id } },
    });
    const packagePath = path.join(root, "maid.dsh-theme");

    first.exportTheme(theme.id, packagePath);
    const archive = new AdmZip(packagePath);
    expect(archive.getEntry("manifest.json")).toBeTruthy();
    expect(archive.getEntries().some((entry) => entry.entryName.startsWith("assets/"))).toBe(true);

    const second = new AppearanceService(path.join(root, "second"));
    const imported = second.importTheme(packagePath);
    const importedAsset = imported.config.assets.background;

    expect(imported).toMatchObject({ name: "深海女仆", kind: "imported" });
    expect(importedAsset).toMatch(/^asset-/);
    expect(second.readAsset(importedAsset!)).toMatchObject({ mimeType: "image/jpeg" });
  });

  it("rejects theme packages containing executable or path-traversal entries", () => {
    const root = temporaryRoot();
    const packagePath = path.join(root, "unsafe.dsh-theme");
    const archive = new AdmZip();
    archive.addFile("manifest.json", Buffer.from(JSON.stringify({ schemaVersion: 1, theme: { name: "X" } })));
    archive.addFile("assets/payload.js", Buffer.from("alert(1)"));
    archive.writeZip(packagePath);

    expect(() => new AppearanceService(path.join(root, "appearance")).importTheme(packagePath))
      .toThrow(/不支持的主题资源/);
  });

  it("uses a generic provider state rather than Wallpaper-specific persisted fields", () => {
    const root = temporaryRoot();
    const service = new AppearanceService(root);
    service.updateProvider("wallpaper-engine", {
      enabled: true,
      settings: { wallpaperId: "123", dim: 0.25 },
    });

    const reloaded = new AppearanceService(root).snapshot();
    expect(reloaded.settings.background).toEqual({
      kind: "provider",
      providerId: "wallpaper-engine",
    });
    expect(reloaded.settings.providers["wallpaper-engine"]).toEqual({
      enabled: true,
      settings: { wallpaperId: "123", dim: 0.25 },
    });
  });
});
