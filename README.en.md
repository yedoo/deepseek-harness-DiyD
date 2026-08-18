# DeepSeek Harness Desktop

[简体中文](README.md) · [Latest release](https://github.com/yedoo/deepseek-harness-DiyD/releases/latest) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

[![Windows CI](https://github.com/yedoo/deepseek-harness-DiyD/actions/workflows/windows.yml/badge.svg)](https://github.com/yedoo/deepseek-harness-DiyD/actions/workflows/windows.yml)
[![Release](https://img.shields.io/github/v/release/yedoo/deepseek-harness-DiyD)](https://github.com/yedoo/deepseek-harness-DiyD/releases/latest)
[![License](https://img.shields.io/github/license/yedoo/deepseek-harness-DiyD)](LICENSE)

An unofficial, frameless, ready-to-use Windows desktop client for DeepSeek Harness. It preserves the official workbench and data format while adding desktop startup, independent updates, a plugin marketplace, themes, and Skill management.

> This is an independent community project and is not affiliated with DeepSeek. DeepSeek names and marks belong to their respective owner.

## Quick start

1. Download `DeepSeek-Harness-Desktop-*-x64.exe` from [GitHub Releases](https://github.com/yedoo/deepseek-harness-DiyD/releases/latest).
2. Run the installer for a one-click per-user installation, then launch the app.
3. On a clean machine, the packaged app downloads and verifies the official `@deepseek-ai/dsh` runtime automatically. No separate Node.js installation, local port setup, or source checkout is required.
4. Enter the workbench. Future desktop and Harness updates are both handled in the app.

The current target is Windows 10/11 x64. macOS is not in the immediate development scope.

## Highlights

- Automatic first-run Harness installation with staging, version validation, an isolated startup probe, atomic activation, retry reuse, and rollback.
- Independent desktop and Harness update channels.
- Online plugin discovery across the curated catalog, npm, and GitHub.
- Plugin install, enable, disable, uninstall, and restart flows.
- Native appearance controls, layered themes, portable `.dsh-theme` packages, and generic appearance providers.
- Skill discovery by workspace, user, and bundled source, with an in-app Markdown detail view.
- Sandboxed Renderer, restricted Preload capabilities, exact loopback-origin navigation, and external links opened by the system browser.

## Development

Node.js 20 or newer is required.

```powershell
npm ci
npm test
npm run typecheck
npm run dev
```

Development mode intentionally does not bootstrap Harness automatically. Keep an official Harness checkout next to this repository, select it on first launch, or set `DSH_INSTALL_ROOT`.

See [docs/architecture.md](docs/architecture.md) for module seams, the managed runtime transaction, and security invariants.

## Contributing

Everyone can fork the repository and submit a Pull Request. Once a commit is merged into the default branch, GitHub adds its author to Contributors automatically.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Good first contributions include documentation, startup recovery tests, plugin compatibility, accessibility, UI polish, and Windows packaging improvements.

## License

[MIT](LICENSE)
