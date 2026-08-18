# Appearance settings design QA

- Source visual truth: `C:\Users\TianYe\AppData\Local\Temp\codex-clipboard-889963da-daa0-45f8-8313-bac9166954cd.png`
- Source control detail: `C:\Users\TianYe\AppData\Local\Temp\codex-clipboard-b14f3f4d-e271-4904-9a8e-5597ec8a0b3f.png`
- Same-build native reference: `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.7\native-model.png`
- Implementation screenshot: `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.7\appearance.png`
- Full-view comparison: `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.7\native-vs-appearance-full.png`
- Focused header comparison: `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.7\native-vs-appearance-header.png`
- Viewport: 1141 × 1062 CSS px, Windows device scale factor 1.25
- Pixel dimensions: native reference 1429 × 1330 px; implementation 1429 × 1330 px; no density normalization was needed for the same-build comparison
- State: desktop settings modal, dark mode, native Model page compared with Appearance page

## Full-view comparison evidence

The same-build side-by-side comparison shows that the Appearance page preserves the native modal bounds, navigation geometry, content grid, header position, and right edge. Only the Appearance Shadow DOM changes; native General, Model, Plugins, and Agent Presets pages remain untouched. The Appearance page remains vertically scrollable with no visible scrollbar track or thumb.

## Focused region comparison evidence

The combined header crop and live computed-style checks verify the typography and controls that were visibly drifting:

- Native and Appearance heading: top 54px, left 212px, font family `-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Helvetica, Arial, sans-serif`, font size 16px, line height 24px, weight 500, normal letter spacing.
- Native and Appearance description: top 90px, left 212px, the same native font family, font size 14px, line height 22px, weight 400.
- Native and Appearance “打开配置文件” button: top 20px, right 50px, 93.6 × 28px, font size 12px, line height 18px, 14px radius, 10px horizontal padding, and the same native border/background/color tokens.
- Native and Appearance close control: top 20px, right 14px, 28 × 28px; the Appearance control reuses the native SVG icon markup.
- Appearance scroll container: `overflow-y: auto`, scrollbar width 0px, and bottom content remains reachable.

## Required fidelity surfaces

- Fonts and typography: passed; title, description, and header control inherit the native font family, size, weight, line height, and letter spacing.
- Spacing and layout rhythm: passed; content insets and header-control geometry match the native page within 1px.
- Colors and visual tokens: passed; the header button copies the native dark-mode foreground, transparent background, border color, and shadow values.
- Image quality and asset fidelity: not applicable; no image asset was added or replaced.
- Copy and content: passed; existing Appearance labels and copy are unchanged.

## Comparison history

1. The previous v0.8.6 comparison fixed content position and scrollbar visibility, but the latest user capture exposed a P1 control mismatch and P2 typography drift. The Appearance page still declared its own Segoe-based font stack, while the native app used the platform/PingFang/Microsoft YaHei stack. Its configuration button rendered at 116 × 34px with 14px text instead of the native 93.6 × 28px control with 12px text.
2. The Appearance-only integration now rejects unrelated section headings as typography sources, copies the active native page’s complete text metrics, resolves the native header controls at activation time, and mirrors their full computed styles. The close control also reuses the native SVG icon instead of a text approximation.
3. The post-fix live comparison reports exact heading, description, configuration-button, and close-control metrics. Fixture and live regression checks pass, the scrollbar remains hidden, and no native settings page styles were modified.

## Findings

No actionable P0, P1, or P2 differences remain for the requested Appearance-page typography and header-control alignment.

## Follow-up polish

No P3 work is required for this fix.

final result: passed
