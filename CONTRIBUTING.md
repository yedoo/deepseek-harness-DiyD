# 参与贡献

感谢你愿意帮助改进 DeepSeek Harness Desktop。文档修正、问题复现、界面优化、平台适配和功能实现都欢迎提交。

## 开始之前

- Bug 请先搜索现有 Issue，并附上客户端版本、Harness 版本、Windows 版本和复现步骤。
- 新功能或较大的界面改动请先创建功能建议，说明使用场景和预期交互，避免重复开发。
- 安全问题不要公开提交 Issue，请按照 [SECURITY.md](SECURITY.md) 私下报告。
- 第一次参与可以优先领取带有 `good first issue` 或 `help wanted` 标签的任务。

## 本地开发

需要 Node.js 20 或更高版本，CI 当前使用 Node.js 24。

```powershell
git clone https://github.com/yedoo/deepseek-harness-DiyD.git
cd deepseek-harness-DiyD
npm ci
npm test
npm run typecheck
npm run dev
```

开发模式不会自动下载 Harness。请把官方仓库放在相邻目录，首次启动时选择其目录，或设置：

```powershell
$env:DSH_INSTALL_ROOT = "D:\DeepSeek\deepseek-harness"
npm run dev
```

更多模块边界和安全约束见 [docs/architecture.md](docs/architecture.md)。

## 修改原则

- 保留官方 Harness 工作台的数据格式和主要交互，不直接修改上游源码。
- Renderer 保持沙箱与 `contextIsolation`，不要开启 `nodeIntegration`。
- 新的系统能力必须通过受限 Preload 接口暴露，不向页面提供任意文件或进程访问。
- 外部网页使用系统浏览器打开，应用内只允许当前 Harness 的精确本机 Origin。
- 优先把复杂行为放进具有小接口的模块，并通过其公开行为编写测试。
- 不要提交 API Key、访问令牌、用户数据、构建产物或本机绝对路径。

## 验证

提交 PR 前至少运行：

```powershell
npm test
npm run typecheck
npm run build
```

涉及对应界面时再运行：

```powershell
npm run test:market-ui
npm run test:appearance-ui
npm run test:skills-ui
npm run test:titlebar
```

涉及安装包或原生依赖时运行：

```powershell
npm run dist:win
npm run test:packaged-native
```

## 提交与 Pull Request

建议使用简洁的 Conventional Commit 前缀，例如：

```text
feat: bootstrap Harness on first launch
fix: keep plugin search inside the market tab
docs: explain the managed runtime
```

一个 PR 尽量只解决一个问题。描述中请包括：

- 为什么需要修改；
- 用户可观察到的变化；
- 测试方式和结果；
- 界面变化前后的截图；
- 已知限制或后续工作。

PR 合并到默认分支后，GitHub 会自动把提交作者计入 Contributors。共同作者请在提交信息中使用 `Co-authored-by`。

## 维护者权限

仓库写入权限不会因为一次贡献自动授予。持续提供高质量提交、参与评审并遵守社区规范的贡献者，可以逐步成为协作者或维护者。
