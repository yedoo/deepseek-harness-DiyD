# 架构与贡献边界

DeepSeek Harness Desktop 是官方 Harness 的桌面宿主，不维护 Harness 的分叉版本。桌面端负责窗口、进程、更新、系统集成和可控的扩展体验。

```text
Electron Main
├─ Harness 启动与首次安装
├─ 客户端 / Harness 更新
├─ 插件、Skills 与外观数据
└─ 文件、进程和系统能力
        │ 受限 IPC
        ▼
Sandboxed Preload
├─ 标题栏
├─ 插件市场
├─ 外观与主题
└─ Skills 管理
        │ 当前本机 Origin
        ▼
Official Harness Web UI
```

## 主要模块

- `src/main/main.ts`：应用组合根，只负责创建窗口和组织模块。
- `src/main/harness-service.ts`：发现端口、启动、健康检查和停止 Harness。
- `src/main/harness-bootstrapper.ts`：全新安装的完整事务；获取版本、暂存、验证、提交或回滚。
- `src/main/harness-runtime-installer.ts`：用户目录中的托管运行时和原子目录切换。
- `src/main/harness-update-coordinator.ts`：跨进程重启仍可恢复的 Harness 更新事务。
- `src/main/plugin-market.ts`：目录发现、来源验证和插件安装状态。
- `src/main/appearance-service.ts`：声明式主题、资源和外观提供器。
- `src/main/skill-service.ts`：按项目、用户和内置来源发现 Skills。
- `src/preload.ts`：唯一允许暴露给页面的桌面能力入口。

## 首次安装

正式安装版在没有发现运行中的 Harness、源码目录或托管运行时时执行：

```text
读取官方 npm 最新版本
→ 安装到 staging
→ 校验包入口和版本
→ 原子切换到 current
→ 独立启动健康检查
→ 成功后提交 / 失败则回滚
→ 启动工作台
```

下载缓存、运行时和 Harness 数据都位于 Electron 用户数据目录，不要求系统安装 Node.js，也不修改用户的源码目录。

显式设置 `DSH_INSTALL_ROOT`、`DSH_SERVER_URL`，或手动选择源码目录后，客户端尊重用户选择，不自动切换到托管运行时。

## 安全不变量

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 页面不能拼接任意插件安装命令。
- 应用内导航仅允许当前 Harness 的精确回环地址 Origin。
- 外部 URL 必须交给系统浏览器。
- 文件和目录参数在 Main 进程重新验证。
- 主题包不执行 JavaScript、CSS 或安装脚本。
- 客户端只停止自己启动的 Harness 进程。

修改这些不变量需要在 PR 中单独说明风险、替代方案和测试证据。

## 扩展方向

新增功能优先选择以下方式：

1. 官方 Harness 插件；
2. 已定义的外观提供器等扩展接口；
3. 独立的 Main 模块与受限 Preload 接口；
4. 最后才是在官方页面中增加必要的桌面 UI。

避免依赖易变化的 CSS 类名或 DOM 层级。确需适配官方页面时，应提供可回归的 UI 检查脚本。
