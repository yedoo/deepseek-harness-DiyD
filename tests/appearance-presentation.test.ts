import { describe, expect, it } from "vitest";
import {
  appearanceCssVariables,
  resolveEffectiveAppearance,
} from "../src/preload/appearance-presentation";
import type { AppearanceSnapshot } from "../src/appearance-types";

describe("appearance presentation", () => {
  it("applies the active theme and then user overrides", () => {
    const snapshot = {
      settings: {
        mode: "system",
        activeThemeId: "custom-rain",
        background: { kind: "none" },
        effects: { dim: 0.1, blur: 8, panelOpacity: 0.9, borderAlpha: 0.2, radius: 16 },
        colors: {},
        assets: {},
        providers: {},
        overrides: { effects: { blur: 26 }, colors: { accent: "#77aaff" } },
      },
      themes: [{
        id: "custom-rain",
        name: "雨夜",
        author: "TianYe",
        version: "1.0.0",
        kind: "custom",
        createdAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z",
        config: {
          mode: "dark",
          background: { kind: "none" },
          effects: { dim: 0.4, blur: 18, panelOpacity: 0.7, borderAlpha: 0.4, radius: 20 },
          colors: { surface: "#10182b" },
          assets: {},
        },
      }],
      providers: [],
    } satisfies AppearanceSnapshot;

    const effective = resolveEffectiveAppearance(snapshot);
    expect(effective.mode).toBe("dark");
    expect(effective.effects.blur).toBe(26);
    expect(effective.colors).toMatchObject({ surface: "#10182b", accent: "#77aaff" });
  });

  it("maps appearance controls to stable Harness design tokens", () => {
    const variables = appearanceCssVariables({
      mode: "dark",
      background: { kind: "none" },
      effects: { dim: 0.25, blur: 24, panelOpacity: 0.74, borderAlpha: 0.35, radius: 22 },
      colors: { accent: "#77aaff", surface: "#10182b", text: "#f4f7ff" },
      assets: {},
    });

    expect(variables).toMatchObject({
      "--dsh-appearance-blur": "24px",
      "--dsh-appearance-panel-opacity": "0.74",
      "--dsh-appearance-radius": "22px",
      "--dsw-alias-label-primary": "#f4f7ff",
    });
  });
});
