# Skills 管理页设计 QA

## Evidence

- source visual truth path: `C:\Users\TianYe\.codex\generated_images\01a00880-43f8-75b0-8fcd-1be281045c1a\exec-e2d80579-8904-4f1a-92de-0cc226fb03ef.png`
- implementation screenshot path: `D:\DeepSeek\deepseek-harness-desktop\artifacts\skills-manager-qa.png`
- side-by-side comparison path: `D:\DeepSeek\deepseek-harness-desktop\artifacts\skills-manager-comparison.png`
- viewport: Electron `1440 x 1000` CSS px, Windows 125% display scale
- source pixels: `1487 x 1058`; treated as a 1x visual target
- implementation pixels: `1802 x 1253`; captured from the `1440 x 1000` CSS viewport at the host display scale
- density normalization: both images were proportionally resized to `900px` height and placed side by side without cropping
- state: dark settings modal, Skills navigation active, empty search query, eight representative catalog entries

## Full-view comparison evidence

The side-by-side comparison confirms the selected information architecture: the Skills entry follows Plugins, the page uses one native heading/subtitle, one search field, a compact workspace/action row, and a two-column card catalog. The implementation deliberately keeps the repository's existing native settings frame instead of enlarging or restyling the modal to the generated concept's frame.

Automated rendered checks also confirmed:

- Skills heading top, left, size, line-height and weight exactly match the native Plugins heading.
- Search and cards render with dark backgrounds (`rgb(41, 41, 44)`), not white controls.
- The card catalog has exactly two grid tracks at the tested width.
- The injected page stays inside the modal, with zero horizontal overflow.
- The scrollbar track is transparent and the thumb is a narrow neutral gray.
- Returning to another settings page hides the Skills panel and restores the native content; the Appearance entry remains present.

## Focused region comparison evidence

A separate crop was not required because the normalized full-view composite keeps the complete settings content legible. Typography and alignment were additionally checked from rendered DOM metrics, while search, source badges, invocation badges, page isolation and overflow were checked interactively by `scripts/check-skills.cjs`.

## Findings

- No actionable P0, P1 or P2 mismatch remains.
- [P3] The QA fixture does not contain Harness's production SVG navigation assets, so leading card icons are absent in the captured fixture. In the real Harness settings DOM, the implementation reuses the existing Agent, Plugin and Model SVG assets by source type; it does not ship handcrafted icons or add an icon dependency.
- [P3] The implementation uses native bordered text buttons for `导入 Skill` and `打开目录`, while the concept uses icon-text actions. This is intentional to stay consistent with the current official settings controls and avoid adding visual assets or package weight.

## Required fidelity surfaces

- Fonts and typography: inherits the native settings font family; rendered heading metrics match the official Plugins page exactly; card copy uses compact 12–14px hierarchy and single-line truncation.
- Spacing and layout rhythm: existing modal geometry is preserved; page title alignment, 44px search field, two-column 10px grid and bottom/right padding are stable with no clipping.
- Colors and visual tokens: dark controls inherit the active Harness theme; source and invocation badges use restrained semantic colors with readable contrast.
- Image quality and asset fidelity: no raster product imagery is needed; production icons are cloned from native Harness SVG assets, with no emoji, CSS drawings or handcrafted SVGs.
- Copy and content: labels match the approved design and display live Skill names, descriptions, sources and invocation policies instead of fixed examples.

## Primary interactions tested

- Activate and leave the Skills settings page.
- Load and render a catalog snapshot.
- Search by name and reduce the result set to one Skill.
- Display project, user and bundled sources.
- Display model/user invocation-policy variants.
- Verify import/open-directory controls are wired through the desktop bridge.
- Verify card open actions use a catalog ID rather than an arbitrary renderer-provided path.

## Comparison history

- Initial rendered comparison: no P0/P1/P2 visual defects found. No visual fix iteration was required.
- Implementation checks passed after adding the production page: 89 unit tests, TypeScript/build, plugin-market UI regression, appearance UI regression and Skills UI regression.

## Implementation checklist

- [x] Match native settings heading metrics and modal geometry.
- [x] Keep search and cards dark in dark mode.
- [x] Keep the list two-column at desktop widths and one-column at narrower widths.
- [x] Hide overflow and avoid the white outer scrollbar regression.
- [x] Preserve all existing settings pages and injected Appearance behavior.
- [x] Use live Harness Skill roots and precedence.

final result: passed
