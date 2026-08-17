# Design QA

final result: passed

## Evidence

- source: `C:\Users\TianYe\.codex\generated_images\01a00880-43f8-75b0-8fcd-1be281045c1a\exec-0eedaee0-73cf-40a3-8ada-3431dc0366cc.png`
- source dimensions: 1562 × 1007
- implementation: `D:\DeepSeek\deepseek-harness-desktop\.tmp-market-qa.png`
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

## Final severity assessment

- P0 blockers: none
- P1 major issues: none
- P2 visual or functional mismatches: none
- P3 intentional differences:
  - The existing Harness tab label remains `插件列表` instead of replacing it with an installed-count label; this preserves the host UI outside the new market tab.
  - Repository avatars use live GitHub identicons instead of invented logos; failed images collapse cleanly.
  - A small `刷新目录` action and an uninstall action are present because they are required for a functioning independent market.
  - The title bar shows v0.5.0, the release containing this feature.

## Interaction verification

- Plugin market tab mounts inside the existing settings plugin section.
- Search reduces the fixture catalog to one result.
- Install opens an explicit confirmation dialog showing the command and permission warning.
- Confirmed installation updates installed state and exposes the Harness restart action.
- Catalog source validation rejects non-GitHub repositories and unsafe install commands.
- All automated tests, TypeScript checks, Electron market smoke checks, and title-bar smoke checks passed.
