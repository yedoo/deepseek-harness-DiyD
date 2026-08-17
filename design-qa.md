# Appearance settings design QA

- Source visual truth: `C:\Users\TianYe\AppData\Local\Temp\codex-clipboard-37933ec8-7e06-4d92-b91b-a8174349ba60.png`
- Same-build native reference: `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.6\native-model-1128x1067.png`
- Implementation screenshot: `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.6\appearance-1128x1067.png`
- Combined comparison: `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.6\native-model-vs-appearance.png`
- Viewport: 1128 × 1067 CSS px, Windows device scale factor 1.25
- Pixel dimensions: native reference 1412 × 1337 px; implementation 1412 × 1337 px; no density normalization was needed for the same-build comparison
- State: desktop settings modal, dark mode, Model page compared with Appearance page

## Full-view comparison evidence

The same-build side-by-side comparison shows that the Appearance page now begins on the same content grid as the native Model page. The settings navigation, page heading, description, header action row, modal bounds, and right content edge preserve the native hierarchy. The page remains vertically scrollable, while no scrollbar track or thumb is visible.

## Focused region comparison evidence

Programmatic measurements in the live Harness window verify the critical region:

- Native and Appearance heading: top 54px, left 212px, font size 16px, line height 24px, weight 500.
- Native and Appearance description: top 90px, left 212px, font size 14px, line height 22px.
- Native and Appearance header action top: 20px.
- Appearance scroll container: `overflow-y: auto`, scrollbar width 0px, bottom content reachable.

Focused metrics were used because typography and the hidden scrollbar are more reliable to judge from computed geometry than from a scaled full-window screenshot.

## Required fidelity surfaces

- Fonts and typography: passed; title and description inherit the native page's measured size, line height, and weight.
- Spacing and layout rhythm: passed; content top and left insets match the native page and the right inset remains 24px.
- Colors and visual tokens: passed; Appearance continues to inherit the existing Harness dark-mode tokens.
- Image quality and asset fidelity: not applicable; this fix adds or replaces no imagery.
- Copy and content: passed; existing Appearance labels and copy are unchanged.

## Comparison history

1. Initial comparison found a P1 hierarchy mismatch: the Appearance title started 54px too high and 24px too far left, using 22px / 31.9px / weight 700 instead of the native 16px / 24px / weight 500. It also found a P2 scrollbar mismatch: a 15px white scrollbar was visible.
2. The Appearance-only Shadow DOM now reads the visible native page's layout and typography metrics before activation, applies those values to its own header, and hides the scrollbar without disabling scrolling.
3. The post-fix live comparison reports exact title and description alignment, a 0px scrollbar width, and reachable bottom content. Fixture and live regression checks both pass.

## Findings

No actionable P0, P1, or P2 differences remain for the requested Appearance-page alignment.

## Follow-up polish

No P3 work is required for this fix.

final result: passed
