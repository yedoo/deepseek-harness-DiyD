# DeepSeek Harness Desktop

[English](README.en.md) · [下载最新版](https://github.com/yedoo/deepseek-harness-DiyD/releases/latest) · [参与贡献](CONTRIBUTING.md) · [安全策略](SECURITY.md)

[![Windows CI](https://github.com/yedoo/deepseek-harness-DiyD/actions/workflows/windows.yml/badge.svg)](https://github.com/yedoo/deepseek-harness-DiyD/actions/workflows/windows.yml)
[![Release](https://img.shields.io/github/v/release/yedoo/deepseek-harness-DiyD)](https://github.com/yedoo/deepseek-harness-DiyD/releases/latest)
[![License](https://img.shields.io/github/license/yedoo/deepseek-harness-DiyD)](LICENSE)

一个简洁、无边框、开箱即用的 DeepSeek Harness Windows 桌面客户端。它保留官方工作台和数据格式，补充桌面启动、独立更新、插件市场、外观主题和 Skills 管理。

> 本项目是非官方社区项目，与 DeepSeek 官方无隶属关系。DeepSeek 名称与标识归其权利人所有。

## 快速开始

1. 从 [GitHub Releases](https://github.com/yedoo/deepseek-harness-DiyD/releases/latest) 下载 `DeepSeek-Harness-Desktop-*-x64.exe`。
2. 双击安装包，一键完成当前用户安装并启动客户端。
3. 全新电脑会自动下载并验证官方 `@deepseek-ai/dsh`，不需要安装 Node.js、打开本地端口或准备源码仓库。
4. 初始化完成后直接进入工作台；以后客户端和 Harness 都可以在应用内更新。

首次下载失败时可以直接重试；高级用户也可以选择本机 Harness 源码目录。显式配置过本地目录或服务地址时，客户端不会覆盖你的选择。

当前支持 Windows 10/11 x64。macOS 暂未进入当前开发优先级。

## 为什么做这个项目

官方 Harness 提供 Agent 和 Web 工作台能力，本项目专注于把它变成普通用户可以安装、启动和维护的桌面产品：

- 不要求用户理解 Node.js、命令行或本地端口；
- 不分叉和改写官方 Harness 源码；
- 客户端、Harness、插件和主题各自独立更新；
- 保留社区插件生态，同时允许桌面端提供更完整的管理界面；
- 把文件、进程和系统能力放在受限的 Electron Main 层中。

## 主要功能

### 桌面体验

- 36px 无边框标题栏和完整窗口控制；
- 单实例运行；
- 自动连接已经运行的本机 Harness；
- 未发现服务时自动分配端口并启动工作台；
- Windows 工作区目录选择器保持在应用前方；
- 启动状态、失败重试和日志入口；
- 退出时只清理客户端自己启动的 Harness 进程。

### 一键初始化与独立更新

- 正式安装版首次启动会从官方 npm 获取最新可安装 Harness；
- 使用 Electron 内置 Node.js 和用户目录中的独立托管运行时；
- 下载、版本校验、独立启动验证、原子切换和失败回滚组成完整事务；
- 首次启动验证失败后保留已下载运行时，重试不必重新下载；
- 客户端从本项目 Releases 后台下载新版，可立即重启或退出时安装；
- NSIS blockmap 支持桌面客户端差分更新；
- Harness 后续升级复用当前运行时和 npm 缓存，完成后重启切换；
- 更新不会覆盖源码目录、`DSH_HOME` 或工作区文件。

### 插件市场

- 在官方设置页原位增加独立插件市场；
- 默认读取社区目录，离线时使用缓存或内置精选列表；
- 同时搜索社区目录、npm 和 GitHub；
- 支持 npm 包名、`owner/repo` 和完整 GitHub 地址；
- 安装前展示来源、目标和生命周期脚本风险；
- 在线结果必须包含可验证的 DSH bundle/client 声明；
- 支持安装、停用、启用、卸载和按真实配置识别已安装插件；
- 插件变更后提供一键重启 Harness。

### 外观与主题

- 独立“外观”分类，不改写官方通用设置；
- 支持纯色、本地图片和外观提供器三种背景来源；
- 支持暗化、玻璃模糊、面板透明度、边框和圆角；
- 主题可配置主背景、左右人物、侧边栏装饰、输入框装饰和封面；
- 自定义主题可以复制、编辑、应用和删除；
- `.dsh-theme` 可连同图片资源导入、导出和分享；
- 主题包只接受声明式 JSON 和受限图片，不执行 JavaScript、CSS 或安装脚本；
- 外观插件通过通用能力注册，Wallpaper Engine 只是首个适配器，并非写死的专用页面。

明亮、深色和跟随系统继续使用 Harness 原生显示模式，桌面端不会维护第二套冲突的深浅色设置。

### Skills 管理

- 在官方设置中增加独立 Skills 页面；
- 按当前工作区、用户和 Harness 内置来源发现 Skill；
- 搜索并查看来源、调用范围、说明和完整 Markdown 内容；
- 在应用内阅读 `SKILL.md`，也可以打开原文件或所在目录；
- 支持导入 Skill 到当前工作区。

## 安装与数据模型

```text
桌面客户端
├─ Electron 与桌面功能
├─ harness-runtime/current      # 自动管理的官方 Harness
├─ npm-cache                    # 首次安装和更新共享缓存
├─ data                         # Harness 会话与配置
├─ plugin-market               # 市场缓存和状态
└─ appearance                  # 主题与图片资源
```

这些目录都位于当前用户的 Electron 应用数据目录。自动安装不写入系统 Node.js，也不会修改你已有的 Harness 源码仓库。

客户端仍支持开发者自定义：

| 环境变量 | 用途 |
| --- | --- |
| `DSH_INSTALL_ROOT` | 指定官方 Harness 源码仓库目录 |
| `DSH_HOME` | 指定 Harness 数据目录 |
| `DSH_SERVER_URL` | 连接指定的本机 Harness 地址 |
| `DSH_NODE_EXECUTABLE` | 使用指定 Node.js；默认复用 Electron 内置 Node |

## 更新策略

客户端和 Harness 使用两个独立通道：

```text
桌面客户端 → GitHub Releases → 后台差分下载 → 重启安装
官方 Harness → npm 官方包 → staging → 健康检查 → 重启切换/失败回滚
```

两个通道在启动后检查，之后每六小时检查一次。网络失败不会阻止已有工作台启动；发现新版只在标题栏显示状态圆点，不主动打断工作。

## 安全设计

- Renderer 使用沙箱、`contextIsolation`，不启用 Node.js；
- Preload 只暴露窗口、更新、插件、主题、Skills 和日志所需的受限操作；
- 应用内导航锁定到当前 Harness 的精确本机 Origin；
- 外部网页使用系统浏览器打开；
- 插件安装命令由 Main 层生成和校验，页面不能提交任意命令；
- 主题包解压时限制路径、类型、单文件大小和总大小。

漏洞请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 本地开发

需要 Node.js 20 或更高版本。

```powershell
npm ci
npm test
npm run typecheck
npm run dev
```

开发模式为了避免在调试时意外下载运行时，不会执行自动首次安装。建议使用：

```text
DeepSeek/
├─ deepseek-harness/          # 官方仓库
├─ deepseek-harness-desktop/  # 本项目
└─ data/                      # 可选共享数据目录
```

如果官方仓库不在相邻目录，首次运行时选择目录或设置：

```powershell
$env:DSH_INSTALL_ROOT = "D:\DeepSeek\deepseek-harness"
```

常用验证命令：

```powershell
npm test
npm run typecheck
npm run build
npm run test:market-ui
npm run test:appearance-ui
npm run test:skills-ui
npm run dist:win
npm run test:packaged-native
```

Windows 安装包输出到 `release/`。

## 架构

```text
Electron Main
  ├─ 首次安装 / 启动 / 更新 / 系统能力
  │              │ 受限 IPC
  ▼              ▼
Sandboxed Preload 扩展
  │              │ 当前本机 Origin
  ▼              ▼
官方 Harness Web 工作台
```

详细模块、首次安装事务和安全不变量见 [docs/architecture.md](docs/architecture.md)。

## 参与贡献

任何人都可以 Fork 仓库并提交 Pull Request。PR 合并到默认分支后，GitHub 会自动把作者计入 Contributors，不需要提前申请仓库写入权限。

参与前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。第一次贡献可以从 `good first issue`、`help wanted` 或文档任务开始。

我们特别欢迎：

- 启动、更新和失败恢复测试；
- 插件与 Skills 兼容性适配；
- UI/UX、可访问性和多语言改进；
- Windows 安装、签名和性能优化；
- 文档、示例主题和插件目录维护。

## 路线图

- [x] Windows 桌面宿主
- [x] 客户端与 Harness 独立更新
- [x] 在线插件市场
- [x] 外观、主题包与外观提供器
- [x] Skills 管理
- [x] 全新电脑自动初始化 Harness
- [ ] Windows 代码签名和更顺滑的安装体验
- [ ] 系统托盘与任务完成通知
- [ ] 主题商店与更多外观扩展
- [ ] 移动端安全远程控制
- [ ] macOS 适配

## License

[MIT](LICENSE)
