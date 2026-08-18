# Appearance and plugin-market dark-mode design QA

- User issue sources:
  - `C:\Users\TianYe\AppData\Local\Temp\codex-clipboard-899ad803-4414-413f-b3a7-7c7e64b0680e.png` — three nonfunctional built-in presets
  - `C:\Users\TianYe\AppData\Local\Temp\codex-clipboard-c4cb3a5e-9496-4ec7-a567-b7e9238e3e7e.png` — asset-slot copy stuck to the top edge
  - `C:\Users\TianYe\AppData\Local\Temp\codex-clipboard-ed43452a-725b-45d4-afe1-bd1175e6c824.png` — white theme-name input in dark mode
  - `C:\Users\TianYe\AppData\Local\Temp\codex-clipboard-dd9e8477-ee23-4b61-b51e-0c220712e609.png` — Wallpaper Engine selector overflowing the right edge
  - `C:\Users\TianYe\AppData\Local\Temp\codex-clipboard-1d629aba-5c8e-4f57-bf5d-222a4fa3a275.png` — white marketplace controls in dark mode
- Native dark reference: `C:\Users\TianYe\AppData\Local\Temp\codex-clipboard-56ffa66b-ee98-4d38-87c0-c9b2a5913ed4.png`
- Implementation screenshots:
  - `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.8\appearance-themes.png`
  - `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.8\appearance-editor.png`
  - `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.8\appearance-settings.png`
  - `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.8\plugin-market-dark-clean.png`
- Combined evidence:
  - `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.8\appearance-comparison.png`
  - `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.8\plugin-market-comparison.png`
- Same-build native regression screenshot: `C:\Users\TianYe\AppData\Local\Temp\dsh-design-qa-v0.8.8\native-model.png`
- Appearance viewport: 1141 × 1062 CSS px at Windows device scale factor 1.25; screenshots are 1429 × 1330 px.
- Marketplace fixture viewport: 1752 × 1128 CSS px at Windows device scale factor 1.25; screenshot is 2192 × 1413 px.
- State: Windows desktop settings modal, Harness dark mode, Appearance custom pages and Plugin Market selected.

## Full-view comparison evidence

The combined Appearance board compares each reported defect with its corrected state. “My Themes” now contains only real user-created or imported `.dsh-theme` packages. The Theme Editor keeps the native modal geometry while rendering the name input with a dark control surface. The Wallpaper Engine selector remains fully inside its provider panel.

The combined Plugin Market board compares the former white controls, the official dark plugin-list reference, and the corrected marketplace. Search, sort, cards, dialogs, badges, buttons, and empty/loading surfaces now react to the actual `data-ds-dark-theme` state used by Harness instead of the operating-system color preference.

## Focused and computed evidence

- Removed presets: service snapshots and the rendered theme list both report zero built-in cards.
- Theme migration: stored `builtin-light`, `builtin-dark`, and `builtin-deep-sea` selections migrate to native system appearance while preserving background-provider and effect settings.
- Asset alignment: the first asset slot’s combined text center matches the slot center within 4 CSS px.
- Theme-name input: computed background `rgb(36, 36, 39)` and foreground `rgb(244, 244, 245)`.
- Wallpaper selector: computed right edge stays inside the provider-panel right edge; width is constrained by a `minmax(0, 1fr)` grid track.
- Marketplace search: computed background `rgb(36, 36, 39)` and foreground `rgb(244, 244, 245)`.
- Marketplace sort and cards: computed background `rgb(36, 36, 39)`.
- Native-page isolation: same-build Model-page screenshot and computed native typography/header-control checks remain unchanged.

## Required fidelity surfaces

- Fonts and typography: passed; custom-page titles, descriptions, header action, and close action retain the native inherited metrics.
- Spacing and layout rhythm: passed; asset copy is centered, the provider control does not overflow, and modal right/bottom content remains reachable.
- Colors and visual tokens: passed; custom controls use the Harness dark-state surface, text, border, and badge tokens.
- Image quality and asset fidelity: not applicable; no user wallpaper or theme asset was replaced.
- Copy and content: passed; fake preset names were removed while user theme creation/import affordances remain.

## Comparison history

1. Initial evidence showed three built-in theme cards that did not provide a reliable applied state, vertically misaligned asset-slot text, white inputs/cards in dark mode, and a provider selector that could exceed the modal width.
2. Service and UI changes removed the fake presets and added a migration for previously persisted built-in IDs. Appearance-only styles centered slot content, constrained provider controls, and inherited the real Harness dark state.
3. Marketplace styles changed from `prefers-color-scheme` to the Harness body dark-state attribute. Fixture and live-server checks now report the same dark computed colors as the native plugin reference.
4. The final combined boards were opened and inspected. No custom surface overlaps the modal boundary, no fake preset remains, and no white custom search/input/card surface remains in dark mode.

## Findings

No actionable P0, P1, or P2 differences remain for the six reported defects. The light outer shell visible in the isolated marketplace fixture is test-fixture chrome; the marketplace Shadow DOM under test is dark, and the live Harness run confirms the same computed dark values inside the native dark modal.

## Follow-up polish

No P3 work is required for this fix.

final result: passed
