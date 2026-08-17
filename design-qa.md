# Design QA

final result: passed

## Evidence

- source: `C:\Users\TianYe\.codex\generated_images\01a00880-43f8-75b0-8fcd-1be281045c1a\exec-0eedaee0-73cf-40a3-8ada-3431dc0366cc.png`
- source dimensions: 1562 × 1007
- implementation: `D:\DeepSeek\deepseek-harness-desktop\.tmp-market-qa.png`
- online-search implementation: `D:\DeepSeek\deepseek-harness-desktop\.tmp-market-online-qa.png`
- implementation dimensions: 2192 × 1413 (Windows DPI-scaled capture; same 1.551 aspect ratio)
- implementation route/state: Electron `BrowserWindow`, Settings → Plugins → Plugin Market, bundled visual fixture with one installed plugin
- comparison method: source and implementation were rendered together in one full-frame comparison; the modal fills most of both frames and card text remains legible, so a separate crop was not required

## Comparison history

### Iteration 1

- The market was injected without changing the desktop title bar, Harness workbench, settings modal, or left settings navigation.
- The primary hierarchy, tab underline, search field, category row, compact horizontal cards, install controls, dimmed backdrop, and modal proportions matched the approved design.
- P2 fixes identified: curated cards exposed package-style names instead of the friendly approved labels; the footer alignment did not match; a restored restart notice could incorrectly offer one-click restart for an externally connected Harness.

### Iteration 2

- Added friendly presentation names while retaining the real package identity for installation.
- Aligned the community-permission footer with the card column.
- Made restart availability part of the market snapshot so restored notices reflect the actual Harness connection mode.
- Re-ran the same-state comparison and interaction smoke test.

### Iteration 3 — open discovery

- Preserved the approved workbench, settings modal, navigation, density, and monochrome visual language.
- Extended the existing search field instead of adding another market page: curated results are filtered immediately, while npm and GitHub discovery runs after a short debounce.
- Added compact provenance badges (`已审核`, `npm · 未审核`, `GitHub · 未审核`) and version metadata without changing card height.
- Verified the online-result state with `dsh-plugin-wallpaper-engine`; the result remains readable and the unreviewed status is visible before installation.

### Iteration 4 — category cleanup

- Removed the duplicate `搜索` category; the search field is now the only market-search control.
- Search/browser plugins are grouped under the existing tool classification instead of maintaining a second search concept.
- Added an Electron interaction assertion so the duplicate category cannot silently return.

### Iteration 5 — tab isolation

- Corrected the Shadow DOM host rule so a hidden market panel computes to `display: none`.
- Verified the market starts hidden, appears only after selecting `插件市场`, and hides again when either native plugin tab is selected.
- Added the visibility transitions to the Electron interaction smoke test.

## Final severity assessment

- P0 blockers: none
- P1 major issues: none
- P2 visual or functional mismatches: none
- P3 intentional differences:
  - The existing Harness tab label remains `插件列表` instead of replacing it with an installed-count label; this preserves the host UI outside the new market tab.
  - Repository avatars use live GitHub identicons instead of invented logos; failed images collapse cleanly.
  - A small `刷新目录` action and an uninstall action are present because they are required for a functioning independent market.
  - The title bar shows v0.6.2, the release fixing plugin-tab isolation.

## Interaction verification

- Plugin market tab mounts inside the existing settings plugin section.
- Search reduces the fixture catalog to one result.
- Install opens an explicit confirmation dialog showing the command and permission warning.
- Confirmed installation updates installed state and exposes the Harness restart action.
- Catalog source validation rejects non-GitHub repositories and unsafe install commands.
- Online discovery rejects packages without an explicit DSH bundle/client declaration and excludes internal runtime packages.
- The renderer can install only server-verified result IDs; direct npm package names and GitHub URLs are resolved by the main process before confirmation.
- All automated tests, TypeScript checks, Electron market smoke checks, and title-bar smoke checks passed.
